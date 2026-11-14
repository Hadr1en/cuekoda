import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { collectAudioFiles } from '../core/scan';
import { ADAPTERS, exportSummary, type ExportOptions } from '../core/export/index';
import { mergeWithPrevious } from '../core/merge';
import { BUILTIN_PROFILES, findProfile, sanitizeProfile } from '../core/profiles';
import { describe, emptyStats, recordDeleted, recordMoved, recordSuggested, suppressedKinds, type LearningStats } from '../core/learning';
import { AUDIO_EXTENSIONS, type AnalysisResult, type CueKind, type Overrides } from '../core/types';
import type { AdapterInfo, ExportResponse, InitialState, Settings, TrackRecord } from '../shared/api';
import { AnalysisQueue, type WorkerLike } from './queue';
import { backupIfExists, JsonStore } from './store';
import { FolderWatcher } from './watch';
import { referenceFrom, type Reference } from '../core/evaluate';
import { computePeaks, type Peaks } from '../core/peaks';

let win: BrowserWindow | null = null;
const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload);

// --- persistent state ---------------------------------------------------------
const userData = () => app.getPath('userData');
const cores = Math.max(1, os.cpus().length);
const DEFAULT_SETTINGS: Settings = {
  profileId: 'edm',
  customProfiles: [],
  maxWorkers: Math.max(1, Math.min(4, cores - 1)),
  watchFolders: [],
  watchPaused: false,
  autoAnalyzeWatched: true,
  learningEnabled: true,
  exportOptions: { memoryCues: true, loops: 'accepted' },
  theme: 'dark',
};

let library: JsonStore<{ version: 1; tracks: Record<string, TrackRecord> }>;
let settingsStore: JsonStore<Settings>;
let learningStore: JsonStore<LearningStats>;
let referenceStore: JsonStore<{ version: 1; refs: Record<string, Reference> }>;
const referenceIndex = () => Object.fromEntries(Object.values(referenceStore.data.refs).map((r) => [r.fileHash, r.createdAt]));
let queue: AnalysisQueue;
let watcher: FolderWatcher;

const records = () => library.data.tracks;
/** Light copy for progress events (the result is only sent when it changes) */
const lite = (r: TrackRecord): TrackRecord => ({ ...r, result: undefined });

function pushRecord(r: TrackRecord, withResult = false) {
  send('track', { path: r.path, record: withResult ? r : lite(r) });
}

function currentProfile() {
  return sanitizeProfile(findProfile(settingsStore.data.profileId, settingsStore.data.customProfiles));
}

function enqueue(p: string, force = false) {
  const rec = records()[p];
  if (!rec) return;
  const learn = settingsStore.data.learningEnabled ? suppressedKinds(learningStore.data) : [];
  // mark it queued BEFORE handing it to the queue: a free worker starts it synchronously, and the
  // "analyzing" state set by the start hook must not be overwritten (the UI looked idle until done)
  rec.status = 'queued';
  rec.progress = 0;
  rec.error = undefined;
  pushRecord(rec);
  queue.enqueue({
    path: p,
    force,
    options: { profile: currentProfile(), overrides: rec.result?.overrides, suppressKinds: learn },
  });
  library.save();
}

function addFiles(files: string[]): { path: string; fileName: string }[] {
  const added: { path: string; fileName: string }[] = [];
  for (const f of files) {
    if (records()[f]) continue; // already in the library: no duplicate entry
    const rec: TrackRecord = { path: f, fileName: path.basename(f), status: 'queued', addedAt: Date.now() };
    records()[f] = rec;
    added.push({ path: f, fileName: rec.fileName });
    pushRecord(rec);
    enqueue(f);
  }
  library.save();
  return added;
}

function createQueue() {
  queue = new AnalysisQueue(
    () => new Worker(path.join(__dirname, 'worker.js')) as unknown as WorkerLike,
    {
      start: (p) => {
        const r = records()[p];
        if (!r) return;
        r.status = 'analyzing';
        r.progress = 0;
        r.stage = 'démarrage';
        pushRecord(r);
      },
      progress: (p, stage, fraction) => {
        const r = records()[p];
        if (!r) return;
        r.status = 'analyzing';
        r.progress = fraction;
        r.stage = stage;
        pushRecord(r);
      },
      result: (p, result, cached) => {
        const r = records()[p];
        if (!r) return;
        const merged = mergeWithPrevious(result, r.result);
        if (!cached && settingsStore.data.learningEnabled) {
          recordSuggested(learningStore.data, result.cues.map((c) => c.kind));
          learningStore.save();
        }
        Object.assign(r, { status: 'done', progress: 1, stage: undefined, error: undefined, cached, result: merged });
        pushRecord(r, true);
        library.save();
      },
      error: (p, message) => {
        const r = records()[p];
        if (!r) return;
        Object.assign(r, { status: 'error', error: message, progress: undefined, stage: undefined });
        pushRecord(r);
        library.save();
      },
      cancelled: (p) => {
        const r = records()[p];
        if (!r) return;
        // a track that already had a result keeps it
        Object.assign(r, { status: r.result ? 'done' : 'cancelled', progress: undefined, stage: undefined });
        pushRecord(r);
        library.save();
      },
      state: (s) => send('queue', s),
      drained: (s) => send('summary', s),
    },
    () => ({ cacheDir: path.join(userData(), 'cache') }),
    settingsStore.data.maxWorkers,
  );
}

function syncWatch() {
  watcher.sync(settingsStore.data.watchFolders, settingsStore.data.watchPaused);
}

// --- window -----------------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 660,
    // Matches the --color-bg token (dark by default, see styles.css)
    backgroundColor: settingsStore.data.theme === 'light' || (settingsStore.data.theme === 'system' && !nativeTheme.shouldUseDarkColors) ? '#f3f4f8' : '#0e0f13',
    title: 'CueKoda',
    show: !SMOKE_DIR,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => (win = null));
}

/** Traktor needs the volume name of the disk holding the file on macOS. */
function macBootVolume(): string {
  try {
    for (const v of fs.readdirSync('/Volumes')) {
      if (fs.realpathSync(path.join('/Volumes', v)) === '/') return v;
    }
  } catch {
    /* ignore */
  }
  return 'Macintosh HD';
}

const adapterInfo = (): AdapterInfo[] =>
  ADAPTERS.map(({ build: _b, extension: _e, ...a }) => a);

function resultsFor(paths: string[]): AnalysisResult[] {
  return paths.map((p) => records()[p]?.result).filter((r): r is AnalysisResult => !!r);
}

// --- IPC ----------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('init', (): InitialState => ({
    tracks: Object.values(records()).sort((a, b) => a.addedAt - b.addedAt),
    settings: settingsStore.data,
    builtinProfiles: BUILTIN_PROFILES,
    queue: queue.state(),
    adapters: adapterInfo(),
    learning: describe(learningStore.data),
    cores,
    references: referenceIndex(),
  }));

  ipcMain.handle('reference-save', (_e, p: string, rating?: number) => {
    const r = records()[p]?.result;
    if (!r?.fileHash) return referenceIndex();
    referenceStore.data.refs[r.fileHash] = referenceFrom(r, rating);
    referenceStore.save(0);
    return referenceIndex();
  });

  ipcMain.handle('references-export', async (): Promise<ExportResponse> => {
    if (!win) return { ok: false };
    const res = await dialog.showSaveDialog(win, {
      title: 'Exporter les références',
      defaultPath: path.join(app.getPath('documents'), 'cuekoda-references.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    const backup = backupIfExists(res.filePath);
    fs.writeFileSync(res.filePath, JSON.stringify(Object.values(referenceStore.data.refs), null, 2));
    return { ok: true, file: res.filePath, backup };
  });

  ipcMain.handle('pick', async (_e, kind: 'files' | 'folder') => {
    if (!win) return [];
    const r = await dialog.showOpenDialog(win, {
      title: kind === 'files' ? 'Choisir des fichiers audio' : 'Choisir un dossier de musique',
      properties: kind === 'files' ? ['openFile', 'multiSelections'] : ['openDirectory', 'multiSelections'],
      filters: kind === 'files' ? [{ name: 'Audio', extensions: AUDIO_EXTENSIONS.map((x) => x.slice(1)) }] : undefined,
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('add-paths', (_e, paths: string[]) => addFiles(collectAudioFiles(paths)));

  ipcMain.handle('reanalyze', (_e, paths: string[], force = false) => {
    for (const p of paths) enqueue(p, force);
  });

  ipcMain.handle('set-overrides', (_e, p: string, ov: Overrides) => {
    const r = records()[p];
    if (!r?.result) return;
    const next: Overrides = { ...(r.result.overrides ?? {}), ...ov };
    for (const k of Object.keys(next) as (keyof Overrides)[]) if (next[k] === undefined || next[k] === null) delete next[k];
    r.result.overrides = next;
    enqueue(p);
  });

  ipcMain.handle('save-track', (_e, result: AnalysisResult) => {
    const r = records()[result.path];
    if (!r) return;
    r.result = result;
    library.save();
  });

  ipcMain.handle('remove', (_e, paths: string[]) => {
    queue.cancel(paths);
    for (const p of paths) delete records()[p];
    library.save();
  });

  ipcMain.handle('clear', () => {
    queue.cancel();
    library.data.tracks = {};
    library.save();
  });

  ipcMain.handle('pause', () => queue.pause());
  ipcMain.handle('resume', () => queue.resume());
  ipcMain.handle('cancel', (_e, paths?: string[]) => queue.cancel(paths));
  ipcMain.handle('retry', () => {
    for (const r of Object.values(records())) if (r.status === 'error' || r.status === 'cancelled') enqueue(r.path);
  });

  ipcMain.handle('set-settings', (_e, patch: Partial<Settings>) => {
    const s = settingsStore.data;
    Object.assign(s, patch);
    s.maxWorkers = Math.max(1, Math.min(cores, Math.round(s.maxWorkers)));
    s.customProfiles = s.customProfiles.map(sanitizeProfile);
    settingsStore.save(0);
    queue.setMaxWorkers(s.maxWorkers);
    if ('watchFolders' in patch || 'watchPaused' in patch) syncWatch();
    return s;
  });

  ipcMain.on('learning-event', (_e, ev: { type: 'deleted' | 'moved'; kind: CueKind; beats?: number }) => {
    if (!settingsStore.data.learningEnabled) return;
    if (ev.type === 'deleted') recordDeleted(learningStore.data, ev.kind);
    else recordMoved(learningStore.data, ev.kind, ev.beats ?? 0);
    learningStore.save();
  });

  ipcMain.handle('reset-learning', () => {
    learningStore.data = emptyStats();
    learningStore.save(0);
    return describe(learningStore.data);
  });

  ipcMain.handle('export-preview', (_e, id: AdapterInfo['id'], paths: string[], opts: ExportOptions) => {
    const a = ADAPTERS.find((x) => x.id === id);
    return a ? exportSummary(a, resultsFor(paths), opts) : [];
  });

  ipcMain.handle('export', async (_e, id: AdapterInfo['id'], paths: string[], opts: ExportOptions): Promise<ExportResponse> => {
    const adapter = ADAPTERS.find((x) => x.id === id);
    if (!adapter?.build || adapter.status !== 'available') return { ok: false, error: `${adapter?.name ?? id} : export non disponible` };
    const tracks = resultsFor(paths);
    if (!win || !tracks.length) return { ok: false, error: 'Aucun morceau analysé à exporter' };
    const r = await dialog.showSaveDialog(win, {
      title: `Exporter pour ${adapter.name}`,
      defaultPath: path.join(app.getPath('documents'), `CueKoda-${adapter.id}.${adapter.extension}`),
      filters: [{ name: adapter.formatName, extensions: [adapter.extension] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      const body = adapter.build(tracks, { ...opts, macVolume: macBootVolume() });
      // Never silently overwrite: an existing file is copied aside first.
      const backup = backupIfExists(r.filePath);
      fs.writeFileSync(r.filePath, body, 'utf8');
      settingsStore.data.exportOptions = opts;
      settingsStore.save();
      return { ok: true, file: r.filePath, backup };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('add-watch-folder', async () => {
    if (!win) return settingsStore.data;
    const r = await dialog.showOpenDialog(win, { title: 'Dossier à surveiller', properties: ['openDirectory'] });
    if (!r.canceled && r.filePaths[0] && !settingsStore.data.watchFolders.some((f) => f.path === r.filePaths[0])) {
      settingsStore.data.watchFolders.push({ path: r.filePaths[0], enabled: true });
      settingsStore.save(0);
      syncWatch();
    }
    return settingsStore.data;
  });

  ipcMain.on('reveal', (_e, p: string) => shell.showItemInFolder(p));

  // High-resolution waveform for the opened track (small in-memory LRU, nothing persisted)
  const peaksCache = new Map<string, Peaks>();
  ipcMain.handle('peaks', async (_e, p: string): Promise<Peaks | null> => {
    const hit = peaksCache.get(p);
    if (hit) return hit;
    try {
      const pk = await computePeaks(p);
      peaksCache.set(p, pk);
      if (peaksCache.size > 12) peaksCache.delete(peaksCache.keys().next().value!);
      return pk;
    } catch {
      return null;
    }
  });
}

/**
 * Dev-only smoke test of the real Electron app (no visible window, temporary user data):
 *   CUEKODA_SMOKE_DIR=<folder> CUEKODA_SMOKE_REPORT=<file.json> electron .
 * Adds the folder, waits for the batch, re-adds it (must come from the cache), collects renderer
 * console errors and writes a JSON report, then quits.
 */
const SMOKE_DIR = process.env.CUEKODA_SMOKE_DIR;
if (SMOKE_DIR) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cuekoda-smoke-')));

/** Renderer-side script of the smoke test (runs in the real UI). */
const SMOKE_UI_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const pads = () => [...document.querySelectorAll('.pad:not(.empty-pad)')];
  const btn = (el, label) => [...el.querySelectorAll('button')].find((b) => b.textContent === label);
  const out = {};
  const rows = [...document.querySelectorAll('tr.row')];
  out.rows = rows.length;
  rows[0].click();
  await wait(400);
  out.detailVisible = !$('detail').hidden;
  out.pads = pads().length;
  const t0 = pads()[0].querySelector('.tm').textContent;
  btn(pads()[0], '+1').click();
  await wait(50);
  out.cueMoved = pads()[0].querySelector('.tm').textContent !== t0;
  $('btn-undo').click();
  await wait(50);
  out.undoRestored = pads()[0].querySelector('.tm').textContent === t0;
  const nm = pads()[0].querySelector('input.nm');
  nm.value = 'Smoke cue';
  nm.dispatchEvent(new Event('change'));
  await wait(50);
  out.renamed = pads()[0].querySelector('input.nm').value === 'Smoke cue';
  const before = pads().length;
  btn(pads()[pads().length - 1], '✕').click();
  await wait(50);
  out.cueDeleted = pads().length === before - 1;
  for (const t of ['loops', 'sections', 'mix', 'info', 'cues']) { $('t-' + t).click(); await wait(30); }
  out.tabsOk = !$('tab-cues').hidden;
  $('btn-export').click();
  await wait(300);
  out.exportDialogOpen = $('dlg-export').open;
  out.exportRows = $('dlg-export').querySelectorAll('.caps tbody tr').length;
  $('dlg-export').close();
  // add cues: memory cue via the toolbar, vocal part in the Structure tab
  const before2 = document.querySelectorAll('.memo tbody tr').length;
  btn($('tab-cues'), '+ Memory cue ici').click();
  await wait(50);
  out.memoryCueAdded = document.querySelectorAll('.memo tbody tr').length === before2 + 1;
  $('t-sections').click();
  await wait(30);
  const vRows = () => document.querySelectorAll('.vocals-edit tbody tr').length;
  const v0 = vRows();
  btn($('tab-sections'), '+ Passage vocal à la lecture').click();
  await wait(50);
  out.vocalPartAdded = vRows() >= Math.max(1, v0);
  out.vocalEdited = document.querySelector('.vocals-edit p').textContent.includes('corrigés');
  $('t-cues').click();
  $('zoom-in').click();
  out.errorsShown = [...document.querySelectorAll('.err')].length;
  // audio playback of the selected track (what the DJ needs to check cues by ear)
  const audio = $('audio');
  audio.muted = true;
  out.audioSrc = audio.src.slice(0, 40);
  try {
    // never hang the smoke test on a play() promise that does not settle
    await Promise.race([audio.play(), wait(8000).then(() => { throw new Error('play() did not settle in 8 s'); })]);
    await wait(1500);
    out.audioPlaying = !audio.paused && audio.currentTime > 0.5;
    out.audioTime = audio.currentTime;
    audio.currentTime = 30;
    await wait(500);
    out.audioSeek = audio.currentTime >= 29.5;
    audio.pause();
    // transition preview A → B from the Mix tab
    $('t-mix').click();
    await wait(50);
    const mixBtns = () => [...$('tab-mix').querySelectorAll('button')].map((b) => b.textContent);
    const tb = [...$('tab-mix').querySelectorAll('button')].find((b) => b.textContent === '🎧 Transition');
    out.transitionButton = !!tb;
    if (tb) {
      tb.click();
      await wait(2500);
      out.transitionPlaying = !audio.paused && mixBtns().includes('■ Arrêter');
      out.transitionStart = audio.currentTime;
      audio.pause();
      await wait(200);
      out.transitionStopped = !mixBtns().includes('■ Arrêter') && audio.volume === 1;
    }
    $('t-cues').click();
  } catch (e) {
    out.audioPlaying = false;
    out.audioError = String(e) + ' code=' + (audio.error ? audio.error.code + ' ' + audio.error.message : 'none');
  }
  return out;
})()`;

function runSmoke() {
  const report: Record<string, unknown> = { rendererErrors: [] as string[], batches: [] as unknown[] };
  // Electron ≥ 35: details on the event object (positional args deprecated, removed in 47)
  win!.webContents.on('console-message', (e) => {
    if (e.level === 'error') (report.rendererErrors as string[]).push(e.message);
  });
  const finish = () => {
    report.tracks = Object.values(records()).map((r) => ({
      file: r.fileName, status: r.status, cached: r.cached, error: r.error,
      bpm: r.result?.bpm, key: r.result?.key.camelot, cues: r.result?.cues.length, sections: r.result?.sections?.length,
      lufs: r.result?.loudness?.integratedLufs,
    }));
    library.flush();
    report.libraryFileBytes = fs.statSync(path.join(userData(), 'library.json')).size;
    fs.writeFileSync(process.env.CUEKODA_SMOKE_REPORT ?? 'smoke-report.json', JSON.stringify(report, null, 2));
    app.exit(0);
  };
  let round = 0;
  let editedPath: string | null = null;
  win!.webContents.once('did-finish-load', () => {
    report.rendererLoaded = true;
    addFiles(collectAudioFiles([SMOKE_DIR!]));
    // while the batch runs, the UI must show it: busy rows, header label, progress on the selected track
    setTimeout(async () => {
      try {
        report.busyUi = await win!.webContents.executeJavaScript(`(async () => {
          const busy = [...document.querySelectorAll('tr.busy')];
          const out = { busyRows: busy.length, header: document.getElementById('queue-label').textContent,
            queueVisible: !document.getElementById('queue').hidden };
          const running = busy.find((tr) => tr.querySelector('.busy-line.analyzing')) ?? busy[0];
          if (running) { running.click(); await new Promise((r) => setTimeout(r, 200)); }
          out.pendingVisible = !document.getElementById('pending').hidden || !document.getElementById('d-busy').hidden;
          out.pendingText = (document.getElementById('pending').hidden ? document.getElementById('d-busy') : document.getElementById('pending')).textContent;
          return out;
        })()`);
        if (process.env.CUEKODA_SMOKE_SHOT) {
          const img = await win!.webContents.capturePage();
          fs.writeFileSync(process.env.CUEKODA_SMOKE_SHOT, img.toPNG());
        }
      } catch (e) {
        report.busyUiError = String(e);
      }
    }, 2500);
  });
  // Drives the real UI: open a track, move / undo / rename / delete cues, tabs, export dialog, zoom.
  const runUi = async () => {
    try {
      report.ui = await win!.webContents.executeJavaScript(SMOKE_UI_SCRIPT);
      await new Promise((r) => setTimeout(r, 1000)); // edits are saved after a 300 ms debounce
      const edited = Object.values(records()).find((r) => r.result?.cues.some((c) => c.name === 'Smoke cue'));
      report.uiEditPersisted = !!edited;
      report.learningDeletions = Object.values(learningStore.data.kinds).reduce((n, k) => n + (k?.deleted ?? 0), 0);
      if (!edited) return finish();
      editedPath = edited.path;
      enqueue(edited.path, true); // forced re-analysis: the renamed cue must survive
    } catch (e) {
      report.uiError = String(e);
      finish();
    }
  };
  // hook the queue's drained event
  const q = queue as unknown as { hooks: { drained: (s: unknown) => void } };
  const prev = q.hooks.drained;
  q.hooks.drained = (s) => {
    prev(s);
    (report.batches as unknown[]).push(s);
    round++;
    console.log(`[smoke] round ${round} drained`);
    if (round === 1) {
      // second pass: same files, forced through the queue → must be served by the cache
      for (const p of Object.keys(records())) enqueue(p);
    } else if (round === 2) {
      void runUi();
    } else {
      report.editKeptAfterReanalysis = !!editedPath && !!records()[editedPath]?.result?.cues.some((c) => c.name === 'Smoke cue');
      finish();
    }
  };
  setTimeout(() => {
    report.timeout = true;
    finish();
  }, 10 * 60 * 1000);
}

app.whenReady().then(() => {
  // Dev mode on macOS: show the CueKoda icon in the Dock (packaged builds get it from electron-builder)
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(path.join(__dirname, '..', '..', 'build', 'icon.png'));
  library = new JsonStore(path.join(userData(), 'library.json'), { version: 1 as const, tracks: {} });
  settingsStore = new JsonStore(path.join(userData(), 'settings.json'), DEFAULT_SETTINGS);
  learningStore = new JsonStore(path.join(userData(), 'learning.json'), emptyStats());
  referenceStore = new JsonStore(path.join(userData(), 'references.json'), { version: 1 as const, refs: {} });
  createQueue();
  watcher = new FolderWatcher(
    (file, folder) => {
      if (records()[file]) return; // already known: no duplicate
      if (!settingsStore.data.autoAnalyzeWatched) return;
      const added = addFiles([file]);
      if (added.length) send('watch', { folder, message: `Nouveau fichier : ${path.basename(file)}`, level: 'info' });
    },
    (folder, message, level) => send('watch', { folder, message, level }),
  );
  registerIpc();
  createWindow();
  if (SMOKE_DIR) runSmoke();
  // Analyses interrupted by quitting the app resume automatically
  for (const r of Object.values(records())) if (r.status === 'queued' || r.status === 'analyzing') enqueue(r.path);
  syncWatch();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  library?.flush();
  settingsStore?.flush();
  learningStore?.flush();
  referenceStore?.flush();
  watcher?.close();
  queue?.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
