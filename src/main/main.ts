import { randomUUID } from 'node:crypto';
import { applyCrateAction, replaceCratePaths, type CrateAction, type PrepCrate } from '../core/crates';
import { analysisChanges, comparisonPoint, type AnalysisComparison } from '../core/analysisComparison';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { collectAudioFiles } from '../core/scan';
import { ADAPTERS, exportSummary, type ExportOptions } from '../core/export/index';
import { traktorPlan } from '../core/export/traktor';
import { mergeWithPrevious } from '../core/merge';
import { prepareTrack } from '../core/preparation';
import { activePreparationProfile, PREPARATION_PROFILES, findProfile, sanitizeProfile } from '../core/profiles';
import { describe, emptyStats, recordDeleted, recordMoved, recordSuggested, suppressedKinds, type LearningStats } from '../core/learning';
import { AUDIO_EXTENSIONS, type AnalysisResult, type CueKind, type Overrides } from '../core/types';
import type { AdapterInfo, ExportPreview, ExportResponse, ImportSummary, InitialState, Settings, TrackEdits, TrackRecord } from '../shared/api';
import { applyImport, parseRekordboxXml, parseTraktorNml } from '../core/import/collection';
import { AnalysisQueue, type WorkerLike } from './queue';
import { backupIfExists, JsonStore, LibraryStore } from './store';
import { FolderWatcher } from './watch';
import { referenceFrom, type Reference } from '../core/evaluate';
import { computePeaks, type Peaks } from '../core/peaks';
import { checkNeuralModels } from '../core/neuralModels';
import { Updater } from './updater';
import { resolveLang, translate } from '../shared/i18n';

/** Native dialog texts follow the UI language. */
const uiText = (s: string) => translate(s, resolveLang(settingsStore.data.language, app.getLocale()));

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
  keyNotation: 'camelot',
  autoUpdateCheck: true,
};
const parallelLimit = (value: number) => Number.isFinite(value)
  ? Math.max(1, Math.min(cores, Math.round(value))) : DEFAULT_SETTINGS.maxWorkers;

let library: LibraryStore<AnalysisResult, TrackRecord>;
let settingsStore: JsonStore<Settings>;
let crateStore: JsonStore<{ crates: PrepCrate[] }>;
let updater: Updater;
let learningStore: JsonStore<LearningStats>;
let referenceStore: JsonStore<{ version: 1; refs: Record<string, Reference> }>;
const referenceIndex = () => Object.fromEntries(Object.values(referenceStore.data.refs).map((r) => [r.fileHash, r.createdAt]));
let queue: AnalysisQueue;
let watcher: FolderWatcher;

const records = () => library.data.tracks;

function updateCratePaths(paths: string[], movedTo?: string) {
  if (!crateStore.data.crates.length || !paths.length) return;
  const crates = replaceCratePaths(crateStore.data.crates, new Set(paths), movedTo);
  if (crates === crateStore.data.crates) return;
  crateStore.data.crates = crates;
  crateStore.save();
  send('crates', crates);
}
/** Light copy for progress events (the result is only sent when it changes) */
const lite = (r: TrackRecord): TrackRecord => ({ ...r, result: undefined });

function pushRecord(r: TrackRecord, withResult = false) {
  send('track', { path: r.path, record: withResult ? r : lite(r) });
}

type PreviousAnalysis = { result: AnalysisResult; batch: number; reviewedAt?: number };

const previousFile = (p: string) => `${library.resultFile(p)}.previous`;

function forgetComparison(record: TrackRecord) {
  record.comparison = undefined;
  try { fs.rmSync(previousFile(record.path), { force: true }); }
  catch (error) { console.warn('Could not clear previous analysis', error); }
}

function previousAnalysis(record: TrackRecord | undefined): PreviousAnalysis | undefined {
  if (!record?.comparison || !record.result) return;
  try {
    const previous: PreviousAnalysis = JSON.parse(fs.readFileSync(previousFile(record.path), 'utf8'));
    if (previous.batch === record.comparison.batch && previous.result.fileHash === record.result.fileHash) return previous;
  } catch {
    // The comparison is optional, so a missing or damaged snapshot cannot block the library.
  }
}

function saveComparison(record: TrackRecord, fresh: AnalysisResult, batch: number, reviewedAt?: number) {
  const previous = record.result;
  if (!previous?.fileHash || previous.fileHash !== fresh.fileHash) { forgetComparison(record); return; }
  const changes = analysisChanges(comparisonPoint(previous), comparisonPoint(fresh));
  if (!Object.values(changes).some(Boolean)) return;
  const file = previousFile(record.path);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const snapshot: PreviousAnalysis = { result: previous, batch, reviewedAt };
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(snapshot));
    fs.renameSync(`${file}.tmp`, file);
    record.comparison = { batch, changes };
  } catch (error) {
    forgetComparison(record);
    console.warn('Could not save previous analysis', error);
  }
}

function currentProfile() {
  return sanitizeProfile(findProfile(settingsStore.data.profileId, settingsStore.data.customProfiles));
}

function enqueue(p: string, force = false, overrides?: Overrides) {
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
    options: { profile: currentProfile(), overrides: overrides ?? rec.result?.overrides, suppressKinds: learn },
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
        // Relocation: a new path whose content (hash) is that of a track whose file is gone = the same file,
        // moved or renamed. Its corrections, imported cues and "checked" mark follow it.
        if (!r.result && result.fileHash) {
          const old = Object.values(records()).find((o) => o !== r && o.result?.fileHash === result.fileHash && !fs.existsSync(o.path));
          if (old) {
            r.result = { ...old.result!, path: p, fileName: path.basename(p) };
            r.reviewedAt = old.reviewedAt;
            r.imported = r.imported ?? old.imported;
            if (old.comparison) forgetComparison(old);
            delete records()[old.path];
            updateCratePaths([old.path], p);
            send('removed', { path: old.path, movedTo: p });
          }
        }
        const previousReviewed = r.reviewedAt;
        // a new engine version invalidates the "checked by ear" mark
        if (r.reviewedAt && r.result?.engineVersion && result.engineVersion !== r.result.engineVersion) r.reviewedAt = undefined;
        const strictSlots = findProfile(result.profileId, settingsStore.data.customProfiles).slotOrder === 'template';
        let merged = mergeWithPrevious(result, r.result, { strictSlots });
        // cues imported from the DJ's collection before this track was analysed
        if (r.imported) {
          merged = applyImport(merged, r.imported, { strictSlots });
          r.imported = undefined;
        }
        if (!cached && settingsStore.data.learningEnabled) {
          recordSuggested(learningStore.data, result.cues.map((c) => c.kind));
          learningStore.save();
        }
        if (r.compareNext) {
          saveComparison(r, merged, r.compareNext, previousReviewed);
          if (r.comparison?.batch === r.compareNext) r.reviewedAt = undefined;
          r.compareNext = undefined;
        } else if (r.comparison) forgetComparison(r);
        Object.assign(r, { status: 'done', progress: 1, stage: undefined, error: undefined, cached, result: merged });
        pushRecord(r, true);
        library.save();
      },
      error: (p, message) => {
        const r = records()[p];
        if (!r) return;
        Object.assign(r, { status: 'error', error: message, progress: undefined, stage: undefined, compareNext: undefined });
        pushRecord(r);
        library.save();
      },
      cancelled: (p) => {
        const r = records()[p];
        if (!r) return;
        // a track that already had a result keeps it
        Object.assign(r, { status: r.result ? 'done' : 'cancelled', progress: undefined, stage: undefined, compareNext: undefined });
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
function windowsTitleBarOverlay() {
  const theme = settingsStore.data.theme;
  const light = theme === 'light' || (theme === 'system' && !nativeTheme.shouldUseDarkColors);
  return { color: light ? '#ffffff' : '#171923', symbolColor: light ? '#1b1e2a' : '#e8eaf0', height: 42 };
}

function updateWindowsTitleBar() {
  if (process.platform === 'win32') win?.setTitleBarOverlay(windowsTitleBarOverlay());
}

let exportInProgress = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 660,
    // Matches the --color-bg token (dark by default, see styles.css)
    backgroundColor: settingsStore.data.theme === 'light' || (settingsStore.data.theme === 'system' && !nativeTheme.shouldUseDarkColors) ? '#f3f4f8' : '#101116',
    title: 'CueKoda',
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: windowsTitleBarOverlay() } : {}),
    show: !SMOKE_DIR,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.platform === 'win32') win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', (event) => { if (exportInProgress) event.preventDefault(); });
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

async function checkExportTracks(paths: string[]) {
  const checks = await Promise.all(paths.map(async (p) => {
    const file = await fs.promises.stat(p).catch(() => null);
    return { path: p, present: file?.isFile() ?? false };
  }));
  const tracks: AnalysisResult[] = [];
  const missing: string[] = [];
  let notAnalyzed = 0;
  for (const { path: p, present } of checks) {
    const result = records()[p]?.result;
    if (!present) missing.push(path.basename(p));
    else if (result) tracks.push(result);
    else notAnalyzed++;
  }
  return { tracks, missing, notAnalyzed };
}

// --- IPC ----------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('init', (): InitialState => ({
    crates: crateStore.data.crates,
    tracks: Object.values(records()).sort((a, b) => a.addedAt - b.addedAt),
    settings: settingsStore.data,
    builtinProfiles: PREPARATION_PROFILES,
    queue: queue.state(),
    adapters: adapterInfo(),
    learning: describe(learningStore.data),
    cores,
    references: referenceIndex(),
    appVersion: app.getVersion(),
    appBuild: updater.currentBuild,
    update: updater.status,
  }));
  ipcMain.handle('update-check', () => updater.check());
  ipcMain.handle('update-install', () => updater.install());
  // only the CueKoda release pages on GitHub can be opened from the UI
  ipcMain.on('open-external', (_e, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://github.com/Hadr1en/cuekoda/')) void shell.openExternal(url);
  });

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
      title: uiText('Exporter les références'),
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
      title: uiText(kind === 'files' ? 'Choisir des fichiers audio' : 'Choisir un dossier de musique'),
      properties: kind === 'files' ? ['openFile', 'multiSelections'] : ['openDirectory', 'multiSelections'],
      filters: kind === 'files' ? [{ name: 'Audio', extensions: AUDIO_EXTENSIONS.map((x) => x.slice(1)) }] : undefined,
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('crates-update', (_e, action: CrateAction) => {
    const response = applyCrateAction(crateStore.data.crates, action, (p) => Object.hasOwn(records(), p), randomUUID);
    if (response.crates !== crateStore.data.crates) {
      crateStore.data.crates = response.crates;
      crateStore.save();
    }
    return response;
  });

  ipcMain.handle('add-paths', (_e, paths: string[]) => addFiles(collectAudioFiles(paths)));

  ipcMain.handle('reanalyze', (_e, paths: string[], force = false) => {
    const batch = Date.now();
    for (const p of new Set(paths)) {
      const record = records()[p];
      if (!record || record.missing || queue.has(p)) continue;
      if (record.result) record.compareNext = batch;
      enqueue(p, force);
    }
    return batch;
  });

  ipcMain.handle('apply-preparation-profile', (_e, paths: string[]) => {
    const profile = currentProfile();
    const learn = settingsStore.data.learningEnabled ? suppressedKinds(learningStore.data) : [];
    const batch = Date.now();
    let applied = 0;
    let needsAnalysis = 0;
    for (const p of new Set(paths)) {
      const record = records()[p];
      if (record?.status !== 'done' || !record.result || queue.has(p)) continue;
      const fresh = prepareTrack(record.result, profile, learn);
      if (fresh === record.result) { needsAnalysis++; continue; }
      const merged = mergeWithPrevious(fresh, record.result, {
        strictSlots: profile.slotOrder === 'template',
        preserveCues: !!record.reviewedAt,
      });
      saveComparison(record, merged, batch, record.reviewedAt);
      record.result = merged;
      pushRecord(record, true);
      applied++;
    }
    if (applied) library.save();
    return { applied, needsAnalysis };
  });

  ipcMain.handle('analysis-comparison', (_e, p: string): AnalysisComparison | null => {
    const record = records()[p];
    const previous = previousAnalysis(record);
    return previous && record?.result && record.comparison ? {
      before: comparisonPoint(previous.result), after: comparisonPoint(record.result), changes: record.comparison.changes,
    } : null;
  });

  ipcMain.handle('restore-analysis', (_e, p: string): boolean => {
    const record = records()[p];
    if (queue.has(p) || record?.missing || record?.status !== 'done') return false;
    const previous = previousAnalysis(record);
    if (!previous || !record.result) return false;
    // Keep later DJ edits in place while restoring the older automatic analysis.
    record.result = record.comparison?.edited ? {
      ...mergeWithPrevious(previous.result, record.result, { strictSlots: true }),
      overrides: previous.result.overrides,
    } : previous.result;
    record.cached = false;
    record.reviewedAt = previous.reviewedAt;
    forgetComparison(record);
    pushRecord(record, true);
    library.save();
    return true;
  });

  ipcMain.handle('set-overrides', (_e, p: string, ov: Overrides) => {
    const r = records()[p];
    if (!r?.result || queue.has(p)) return;
    const next: Overrides = { ...(r.result.overrides ?? {}), ...ov };
    for (const k of Object.keys(next) as (keyof Overrides)[]) if (next[k] === undefined || next[k] === null) delete next[k];
    r.result.overrides = next;
    library.touch(p);
    enqueue(p);
  });

  ipcMain.on('save-track-edits', (e, p: string, fileHash: string | undefined, edits: Partial<TrackEdits>) => {
    const r = records()[p];
    const result = r?.result;
    if (!result || result.fileHash !== fileHash) {
      e.returnValue = false;
      return;
    }
    if (r.comparison) r.comparison.edited = true;
    // Copy only editor-owned fields. Preserve engine data and overrides from any newer analysis.
    if ('cues' in edits && edits.cues) result.cues = edits.cues;
    if ('loops' in edits) result.loops = edits.loops;
    if ('sections' in edits) result.sections = edits.sections;
    if ('vocals' in edits) result.vocals = edits.vocals;
    library.touch(p);
    library.save();
    e.returnValue = true;
  });

  ipcMain.handle('remove', (_e, paths: string[]) => {
    queue.cancel(paths);
    for (const p of paths) {
      const record = records()[p];
      if (record?.comparison) forgetComparison(record);
      delete records()[p];
    }
    updateCratePaths(paths);
    library.save();
  });

  ipcMain.handle('clear', () => {
    queue.cancel();
    for (const record of Object.values(records())) if (record.comparison) forgetComparison(record);
    updateCratePaths(Object.keys(records()));
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
    s.maxWorkers = parallelLimit(s.maxWorkers);
    s.customProfiles = s.customProfiles.map(sanitizeProfile);
    s.profileId = activePreparationProfile(s.profileId, s.customProfiles);
    settingsStore.save(0);
    queue.setMaxWorkers(s.maxWorkers);
    if ('watchFolders' in patch || 'watchPaused' in patch) syncWatch();
    if ('theme' in patch) updateWindowsTitleBar();
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

  ipcMain.handle('traktor-plan', (_e, p: string, loops: ExportOptions['loops']) => {
    const result = records()[p]?.result;
    return result ? traktorPlan(result, loops) : null;
  });

  ipcMain.handle('export-preview', async (_e, id: AdapterInfo['id'], paths: string[], opts: ExportOptions): Promise<ExportPreview> => {
    const adapter = ADAPTERS.find((x) => x.id === id);
    if (!adapter) return { lines: [], readyPaths: [] };
    const { tracks, missing, notAnalyzed } = await checkExportTracks(paths);
    const lines = exportSummary(adapter, tracks, opts);
    if (missing.length) lines.unshift(`⚠ Fichiers introuvables écartés (${missing.length}) : ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
    if (notAnalyzed) lines.unshift(`⚠ Morceaux sans analyse écartés : ${notAnalyzed}`);
    return { lines, readyPaths: tracks.map((track) => track.path) };
  });

  ipcMain.handle('export', async (_e, id: AdapterInfo['id'], paths: string[], opts: ExportOptions): Promise<ExportResponse> => {
    const adapter = ADAPTERS.find((x) => x.id === id);
    if (!adapter) return { ok: false, error: 'Format d’export indisponible' };
    if (!win || !paths.length) return { ok: false, error: 'Aucun morceau analysé et accessible à exporter' };
    if (exportInProgress) return { ok: false, error: 'Export en cours…' };
    const owner = win;
    exportInProgress = true;
    try {
      const { tracks } = await checkExportTracks(paths);
      if (tracks.length !== paths.length) return { ok: false, error: 'Les fichiers disponibles ont changé. Rouvrez l’aperçu d’export.' };
      const r = await dialog.showSaveDialog(owner, {
        title: uiText(`Exporter pour ${adapter.name}`),
        defaultPath: path.join(app.getPath('documents'),
          `${opts.playlistName ? opts.playlistName.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'CueKoda-set' : `CueKoda-${adapter.id}`}.${adapter.extension}`),
        filters: [{ name: adapter.formatName, extensions: [adapter.extension] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      const latest = await checkExportTracks(paths);
      if (latest.tracks.length !== tracks.length || latest.tracks.some((track, index) => track.path !== tracks[index].path)) {
        return { ok: false, error: 'Les fichiers disponibles ont changé. Rouvrez l’aperçu d’export.' };
      }
      const body = adapter.build(latest.tracks, { ...opts, macVolume: macBootVolume() });
      const tempDir = await fs.promises.mkdtemp(path.join(path.dirname(r.filePath), '.cuekoda-export-'));
      let backup: string | undefined;
      try {
        const tempFile = path.join(tempDir, 'collection');
        await fs.promises.writeFile(tempFile, body, 'utf8');
        backup = backupIfExists(r.filePath);
        await fs.promises.rename(tempFile, r.filePath);
      } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
      const { playlistName: _set, macVolume: _vol, ...keep } = opts;
      settingsStore.data.exportOptions = keep;
      settingsStore.save();
      return { ok: true, file: r.filePath, backup };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    } finally {
      exportInProgress = false;
    }
  });

  ipcMain.handle('import-collection', async (): Promise<ImportSummary> => {
    const none: ImportSummary = { ok: false, matched: 0, added: 0, notFound: 0, cues: 0, gridTaken: false };
    if (!win) return none;
    const pick = await dialog.showOpenDialog(win, {
      title: uiText('Importer une collection rekordbox ou Traktor'),
      properties: ['openFile'],
      filters: [{ name: 'rekordbox XML / Traktor NML', extensions: ['xml', 'nml'] }],
    });
    if (pick.canceled || !pick.filePaths[0]) return { ...none, canceled: true };
    let tracks;
    let source: 'rekordbox' | 'traktor';
    try {
      const text = fs.readFileSync(pick.filePaths[0], 'utf8');
      if (text.includes('<DJ_PLAYLISTS')) { tracks = parseRekordboxXml(text); source = 'rekordbox'; }
      else if (text.includes('<NML')) { tracks = parseTraktorNml(text, macBootVolume()); source = 'traktor'; }
      else return { ...none, error: uiText('Fichier non reconnu : ni collection rekordbox XML, ni collection Traktor NML') };
    } catch (e) {
      return { ...none, error: (e as Error).message };
    }
    const norm = (p: string) => p.normalize('NFC');
    const known = new Map(Object.keys(records()).map((p) => [norm(p), p]));
    const present = tracks.filter((t) => known.has(norm(t.path)) || fs.existsSync(t.path));
    const outside = present.filter((t) => !known.has(norm(t.path))).length;
    const box = await dialog.showMessageBox(win, {
      type: 'question',
      message: uiText('Importer les cues de la collection'),
      detail: uiText(`${present.length} morceau(x) trouvé(s) sur cet ordinateur, dont ${outside} pas encore dans CueKoda (${tracks.length - present.length} introuvable(s)).\nLeurs cues deviennent des cues verrouillés sur leurs pads ; CueKoda ne remplit que les pads libres. Le fichier de collection n’est pas modifié.`),
      buttons: [uiText('Importer et ajouter les morceaux manquants'), uiText('Seulement les morceaux déjà dans CueKoda'), uiText('Annuler')],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: uiText('Reprendre aussi le BPM et la grille du logiciel (ré-analyse avec cette grille)'),
      checkboxChecked: false,
    });
    if (box.response === 2) return { ...none, canceled: true };
    const strictSlots = currentProfile().slotOrder === 'template';
    const out: ImportSummary = { ok: true, source, matched: 0, added: 0, notFound: tracks.length - present.length, cues: 0, gridTaken: box.checkboxChecked };
    for (const t of present) {
      let p = known.get(norm(t.path));
      if (!p) {
        if (box.response !== 0) continue;
        addFiles([t.path]);
        p = t.path;
        out.added++;
      }
      const r = records()[p];
      if (!r) continue;
      out.matched++;
      out.cues += t.cues.length;
      if (r.result && r.status !== 'queued' && r.status !== 'analyzing') {
        if (r.comparison) r.comparison.edited = true;
        r.result = applyImport(r.result, t, { strictSlots });
        pushRecord(r, true);
      } else {
        r.imported = t;
      }
      if (box.checkboxChecked && t.bpm && t.gridSec !== undefined) {
        const ov = { ...(r.result?.overrides ?? {}), bpm: t.bpm, firstDownbeatSec: t.gridSec };
        if (r.result) { r.result.overrides = ov; library.touch(p); }
        enqueue(p, false, ov);
      }
    }
    library.save();
    return out;
  });

  ipcMain.handle('set-reviewed', (_e, paths: string[], reviewed: boolean) => {
    for (const p of paths) {
      const r = records()[p];
      if (!r) continue;
      r.reviewedAt = reviewed ? Date.now() : undefined;
      pushRecord(r);
    }
    library.save();
  });

  ipcMain.handle('add-watch-folder', async () => {
    if (!win) return settingsStore.data;
    const r = await dialog.showOpenDialog(win, { title: uiText('Dossier à surveiller'), properties: ['openDirectory'] });
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
const SMOKE_WINDOW = process.platform === 'win32' && process.env.CUEKODA_SMOKE_WINDOW === '1';
const SMOKE_SETTINGS = process.env.CUEKODA_SMOKE_SETTINGS === '1';
const SMOKE_MODELS = process.env.CUEKODA_SMOKE_MODELS === '1';
if (SMOKE_DIR || SMOKE_WINDOW || SMOKE_SETTINGS || SMOKE_MODELS) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cuekoda-smoke-')));

/** Renderer-side script of the smoke test (runs in the real UI). */
const SMOKE_UI_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const pads = () => [...document.querySelectorAll('.pad:not(.empty-pad)')];
  const btn = (el, label) => [...el.querySelectorAll('button')].find((b) => b.textContent === label);
  const out = {};
  const rows = [...document.querySelectorAll('tr.row')];
  out.rows = rows.length;
  const bpms = rows.map((row) => parseFloat(row.cells[3]?.textContent));
  out.liveTempoSort = document.querySelector('#tracks th[data-sort="bpm"]').getAttribute('aria-sort') === 'descending' &&
    bpms.every((bpm, index) => index === 0 || bpms[index - 1] >= bpm);
  rows[0].click();
  const profileSelect = $('profile');
  const trackTitle = $('d-title').textContent;
  const readTrack = async () => (await window.cuekoda.init()).tracks.find((track) => track.result?.title === trackTitle)?.result;
  const beforeProfile = await readTrack();
  const activeProfile = profileSelect.value;
  const setProfile = async (id) => {
    profileSelect.value = id;
    profileSelect.dispatchEvent(new Event('change'));
    await wait(120);
    $('btn-apply-preparation').click();
    await wait(120);
  };
  await setProfile('edm-fixed');
  const afterProfile = await readTrack();
  out.preparationProfiles = [...profileSelect.options].map((option) => option.textContent);
  out.preparationKeptMusic = !!beforeProfile && afterProfile?.profileId === 'edm-fixed'
    && JSON.stringify([beforeProfile.bpm, beforeProfile.key, beforeProfile.grid])
      === JSON.stringify([afterProfile.bpm, afterProfile.key, afterProfile.grid]);
  await setProfile(activeProfile);
  if (rows.length > 1) {
    $('btn-next-track').click();
    out.nextTrack = rows[1].getAttribute('aria-current') === 'true';
    $('btn-prev-track').click();
    out.previousTrack = rows[0].getAttribute('aria-current') === 'true';
    $('btn-review-next').click();
    await wait(50);
    out.reviewNext = rows[1].getAttribute('aria-current') === 'true';
    $('btn-prev-track').click();
    out.reviewMarked = $('btn-reviewed').classList.contains('done');
  }
  const search = $('search');
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
  out.searchShortcut = document.activeElement === search;
  search.value = '__no_cuekoda_track__';
  search.dispatchEvent(new Event('input'));
  out.emptySearch = !$('no-matches').hidden && $('tracks').hidden;
  $('clear-filters').click();
  out.filtersCleared = !search.value && document.querySelectorAll('tr.row').length === rows.length;
  const notation = $('key-notation');
  const initialKey = rows[0].querySelector('.c-key .key');
  if (initialKey) {
    const keys = initialKey.title.split(' · ');
    const setNotation = async (value) => {
      notation.value = value;
      notation.dispatchEvent(new Event('change'));
      for (let i = 0; i < 30 && notation.disabled; i++) await wait(20);
    };
    await setNotation('openKey');
    out.openKeyDisplay = rows[0].querySelector('.c-key .key').textContent.startsWith(keys[2])
      && $('d-sub').querySelector('.key').textContent === keys[2];
    out.openKeySaved = (await window.cuekoda.init()).settings.keyNotation === 'openKey';
    search.value = keys[1];
    search.dispatchEvent(new Event('input'));
    await wait(80);
    out.camelotSearchInOpenKey = rows[0].isConnected;
    $('clear-filters').click();
    await setNotation('camelot');
    out.camelotRestored = rows[0].querySelector('.c-key .key').textContent.startsWith(keys[1]);
  }
  search.blur();
  await wait(400);
  out.detailVisible = !$('detail').hidden;
  out.pads = pads().length;
  out.padColorApplied = !!pads()[0]?.style.getPropertyValue('--pad-color');
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
  const persistedState = await window.cuekoda.init();
  out.editDeliveredWithoutDelay = persistedState.tracks.some((t) => t.result?.cues.some((c) => c.name === 'Smoke cue'));
  out.renamed = pads()[0].querySelector('input.nm').value === 'Smoke cue';
  const trackPath = decodeURIComponent(new URL($('audio').src).pathname).replace(/^\\/([A-Za-z]:)/, '$1');
  const verification = await window.cuekoda.exportPreview('rekordbox', [trackPath, trackPath + '.missing'], { memoryCues: true, loops: 'accepted' });
  out.exportChecksMissing = verification.readyPaths.length === 1 && verification.lines.some((line) => line.includes('.missing'));
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
  const oscStart = OscillatorNode.prototype.start;
  const gainFactory = AudioContext.prototype.createGain;
  const clicks = [];
  OscillatorNode.prototype.start = function (...args) {
    clicks.push(this.frequency.value);
    return oscStart.apply(this, args);
  };
  AudioContext.prototype.createGain = function () {
    const gain = gainFactory.call(this);
    const connect = gain.connect.bind(gain);
    gain.connect = (target, ...args) => target === this.destination ? target : connect(target, ...args);
    return gain;
  };
  let waveformRedraws = 0;
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    if (this.canvas.id === 'wave' || this.canvas.id === 'overview') waveformRedraws++;
    return clear.apply(this, args);
  };
  try {
    $('zoom-fit').click();
    $('btn-metronome').click();
    await wait(100);
    out.metronomeEnabled = $('btn-metronome').getAttribute('aria-pressed') === 'true';
    // never hang the smoke test on a play() promise that does not settle
    await Promise.race([audio.play(), wait(8000).then(() => { throw new Error('play() did not settle in 8 s'); })]);
    const beforePlayback = waveformRedraws;
    const playhead = $('wave-playhead').style.transform;
    await wait(1500);
    out.playbackWaveformRedraws = waveformRedraws - beforePlayback;
    out.playheadMoves = $('wave-playhead').style.transform !== playhead;
    out.audioPlaying = !audio.paused && audio.currentTime > 0.5;
    out.audioTime = audio.currentTime;
    audio.currentTime = 30;
    await wait(500);
    out.audioSeek = audio.currentTime >= 29.5;
    audio.pause();
    const clicksAtPause = clicks.length;
    await wait(100);
    out.metronomeClicks = clicksAtPause;
    out.metronomePaused = clicks.length === clicksAtPause;
    $('btn-metronome').click();
    await wait(25);
    out.metronomeDisabled = $('btn-metronome').getAttribute('aria-pressed') === 'false';
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
  OscillatorNode.prototype.start = oscStart;
  AudioContext.prototype.createGain = gainFactory;
  CanvasRenderingContext2D.prototype.clearRect = clear;
  return out;
})()`;

/** Exercise the real slider with pointer and keyboard input in an isolated profile. */
async function smokeSettingsSlider(window: BrowserWindow) {
  const contents = window.webContents;
  const control = () => contents.executeJavaScript(`(() => {
    const slider = document.querySelector('#dlg-settings input[type="range"]');
    if (!slider) return null;
    const rect = slider.getBoundingClientRect();
    return { x: rect.x, y: Math.round(rect.y + rect.height / 2), width: rect.width,
      value: slider.valueAsNumber, min: Number(slider.min), max: Number(slider.max),
      label: slider.closest('label').textContent, focused: document.activeElement === slider };
  })()`);
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitUntil = async (condition: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 40; i++) {
      if (await condition()) return true;
      await wait(50);
    }
    return false;
  };
  if (!await waitUntil(() => contents.executeJavaScript(`Boolean(document.querySelector('#profile option'))`))) throw new Error('Settings did not initialize');
  window.focus();
  await contents.executeJavaScript(`
    document.getElementById('btn-settings').click();
    document.querySelector('#dlg-settings input[type="range"]').scrollIntoView({ block: 'center' });
  `);
  const initial = await control();
  if (!initial?.width) throw new Error('Parallel analysis slider is not visible');
  if (initial.max > initial.min) {
    const target = initial.value === initial.min ? initial.max : initial.min;
    const x = Math.round(initial.x + 8 + (initial.width - 16) * (initial.value - initial.min) / (initial.max - initial.min));
    const end = Math.round(target === initial.min ? initial.x + 2 : initial.x + initial.width - 2);
    contents.sendInputEvent({ type: 'mouseMove', x, y: initial.y });
    contents.sendInputEvent({ type: 'mouseDown', x, y: initial.y, button: 'left', clickCount: 1 });
    await wait(50);
    contents.sendInputEvent({ type: 'mouseMove', x: end, y: initial.y, button: 'left', modifiers: ['leftbuttondown'] });
    await wait(50);
    const live = await control();
    contents.sendInputEvent({ type: 'mouseUp', x: end, y: initial.y, button: 'left', clickCount: 1 });
    if (live.value !== target || !live.label.includes(`${target} / ${initial.max}`)) {
      throw new Error(`Slider did not update while dragging (value ${live.value}, label “${live.label}”)`);
    }
    if (!await waitUntil(() => queue.state().maxWorkers === target)) throw new Error('Slider value did not reach the analysis queue');
    const keyCode = target === initial.min ? 'End' : 'Home';
    const keyboardTarget = target === initial.min ? initial.max : initial.min;
    contents.sendInputEvent({ type: 'keyDown', keyCode });
    contents.sendInputEvent({ type: 'keyUp', keyCode });
    if (!await waitUntil(() => queue.state().maxWorkers === keyboardTarget) || !(await control()).focused) {
      throw new Error('Keyboard change did not update the queue while keeping focus');
    }
    await contents.executeJavaScript(`
      document.getElementById('dlg-settings').close();
      document.getElementById('btn-settings').click();
    `);
    if ((await control()).value !== keyboardTarget) throw new Error('Reopened slider lost the saved value');
    const file = path.join(userData(), 'settings.json');
    if (!await waitUntil(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).maxWorkers === keyboardTarget)) {
      throw new Error('Parallel analysis limit was not saved');
    }
  }
  console.log('Parallel analysis slider verified');
}

/** Verify the renderer geometry against the native Windows caption controls. */
async function smokeWindowsTitleBar(window: BrowserWindow) {
  const timeout = setTimeout(() => app.exit(1), 15000);
  try {
    const readGeometry = () => window.webContents.executeJavaScript(`(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const area = navigator.windowControlsOverlay?.getTitlebarAreaRect();
      if (!navigator.windowControlsOverlay?.visible || !area || area.height <= 0) return false;
      const toolbar = document.querySelector('.bar');
      document.querySelector('#queue').hidden = false;
      const aligned = (selector) => {
        const rects = [...document.querySelectorAll(selector)]
          .map((button) => button.getBoundingClientRect()).filter((rect) => rect.width);
        return rects.length >= 3 && rects.every((rect) => Math.abs(rect.top - rects[0].top) < 2);
      };
      const contentEnd = Math.max(...[...toolbar.querySelectorAll('.actions > button')].map((button) => button.getBoundingClientRect().right));
      return document.documentElement.hasAttribute('data-window-overlay')
        && area.right < innerWidth && contentEnd <= area.right
        && aligned('.actions > button') && aligned('.lib-tools > button');
    })()`);
    if (!await readGeometry()) throw new Error('Caption controls overlap the default toolbar');
    window.setSize(980, 660);
    if (!await readGeometry()) throw new Error('Caption controls overlap the minimum-width toolbar');
    await smokeSettingsSlider(window);
    clearTimeout(timeout);
    console.log('Windows title bar geometry verified');
    app.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    console.error(error);
    app.exit(1);
  }
}

function runSmoke() {
  const report: Record<string, unknown> = { rendererErrors: [] as string[], batches: [] as unknown[] };
  // CUEKODA_SMOKE_LANG=en runs the whole smoke test with the English UI (temporary profile, nothing kept)
  const smokeLang = process.env.CUEKODA_SMOKE_LANG;
  if (smokeLang === 'en' || smokeLang === 'fr') settingsStore.data.language = smokeLang;
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
          if (${!smokeLang}) {
            const bpm = document.querySelector('#tracks th[data-sort="bpm"]');
            bpm.click();
            bpm.click(); // descending before the first track results arrive
          }
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
      // CUEKODA_SMOKE_LANG set = screenshot mode (README): no scripted edits, clean screens in that language
      const captureOnly = smokeLang === 'en' || smokeLang === 'fr';
      const js = (code: string) => win!.webContents.executeJavaScript(`(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); ${code} })()`);
      if (captureOnly) {
        report.ui = await js(`
          const row = [...document.querySelectorAll('tr.row')].find((tr) => tr.textContent.includes('This Dream of You')) ?? document.querySelector('tr.row');
          row.click();
          await wait(800);
          return { lang: document.documentElement.lang, detail: !document.getElementById('detail').hidden };`);
      } else report.ui = await win!.webContents.executeJavaScript(SMOKE_UI_SCRIPT);
      // export target picker and mix-order suggestion, with screenshots when asked
      const shots = process.env.CUEKODA_SMOKE_SHOTS;
      const shot = async (name: string) => {
        if (!shots) return;
        // no notification over the screenshot
        await win!.webContents.executeJavaScript(`(() => { const t = document.getElementById('toast'); if (t && t.matches(':popover-open')) t.hidePopover(); return true; })()`);
        await new Promise((r) => setTimeout(r, 500));
        fs.writeFileSync(path.join(shots, `${name}.png`), (await win!.webContents.capturePage()).toPNG());
      };
      if (captureOnly) {
        await shot('detail');
        const toTabs = `const d = document.getElementById('detail'); d.scrollTop += document.querySelector('.tabs').getBoundingClientRect().top - d.getBoundingClientRect().top - 8;`;
        await js(`document.getElementById('t-sections').click(); await wait(100); ${toTabs} return true;`);
        await shot('structure');
        await js(`document.getElementById('t-mix').click(); await wait(100); ${toTabs} return true;`);
        await shot('mix');
        await js(`document.getElementById('detail').scrollTop = 0; document.getElementById('t-cues').click(); document.getElementById('btn-settings').click(); await wait(300);
          const d = document.getElementById('dlg-settings'); const h = [...d.querySelectorAll('h3')].find((x) => /Mises à jour|Updates/.test(x.textContent));
          if (h) h.scrollIntoView({ block: 'start' }); return true;`);
        await shot('settings');
        await js(`document.getElementById('dlg-settings').close(); return true;`);
      }
      report.dialogs = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        document.getElementById('btn-export').click();
        await wait(400);
        const d = document.getElementById('dlg-export');
        return { exportOpen: d.open, targets: [...d.querySelectorAll('.target b')].map((b) => b.textContent),
          choices: d.querySelectorAll('.target input').length };
      })()`);
      await shot('export');
      report.order = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        document.getElementById('dlg-export').close();
        document.getElementById('btn-order').click();
        await wait(300);
        const d = document.getElementById('dlg-order');
        const rows = d.querySelectorAll('tbody tr').length;
        const listen = ${captureOnly ? 'null' : `d.querySelector('button[aria-label^="Écouter la transition"]')`};
        if (listen) listen.click();
        await wait(2500);
        const audio = document.getElementById('audio');
        return { open: d.open, rows, weak: d.querySelectorAll('tr.weak').length, listening: !!listen && !audio.paused };
      })()`);
      await shot('order');
      // "Export this set…": export window on top, with the set as a named playlist and the comment tags
      report.setExport = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        document.getElementById('dlg-order').querySelector('.hrow button.primary').click();
        await wait(500);
        const e = document.getElementById('dlg-export');
        const text = e.textContent;
        const out = { open: e.open, nameField: !!e.querySelector('input.set-name'),
          playlistLine: /Playlist « Set CueKoda|Playlist “Set CueKoda/.test(text), commentLine: /E\\d+ · \\d+[AB]/.test(text) };
        return out;
      })()`);
      await shot('export-set');
      await win!.webContents.executeJavaScript(`document.getElementById('dlg-export').close(); true`);
      await win!.webContents.executeJavaScript(`document.getElementById('dlg-order').close(); true`);
      if (captureOnly) return finish();
      await new Promise((r) => setTimeout(r, 1000)); // allow the batched disk write to finish
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

app.whenReady().then(async () => {
  if (SMOKE_MODELS) {
    const ready = await checkNeuralModels();
    console.log(ready ? 'Packaged analysis models initialized' : 'Failed to initialize packaged analysis models');
    app.exit(ready ? 0 : 1);
    return;
  }
  // Dev mode on macOS: show the CueKoda icon in the Dock (packaged builds get it from electron-builder)
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(path.join(__dirname, '..', '..', 'build', 'icon.png'));
  library = new LibraryStore<AnalysisResult, TrackRecord>(path.join(userData(), 'library.json'));
  // files moved / renamed / on a disconnected drive: flagged, never removed from the library
  for (const r of Object.values(library.data.tracks)) r.missing = !fs.existsSync(r.path) || undefined;
  settingsStore = new JsonStore(path.join(userData(), 'settings.json'), DEFAULT_SETTINGS);
  const settings = settingsStore.data;
  settings.profileId = activePreparationProfile(settings.profileId, settings.customProfiles);
  settings.maxWorkers = parallelLimit(settings.maxWorkers);
  crateStore = new JsonStore(path.join(userData(), 'crates.json'), { crates: [] });
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
  updater = new Updater((st) => send('update', st));
  registerIpc();
  createWindow();
  nativeTheme.on('updated', updateWindowsTitleBar);
  if (SMOKE_WINDOW) {
    const smokeWindow = win!;
    smokeWindow.webContents.once('did-finish-load', () => void smokeWindowsTitleBar(smokeWindow));
    smokeWindow.webContents.once('did-fail-load', () => app.exit(1));
  } else if (SMOKE_SETTINGS) {
    const smokeWindow = win!;
    smokeWindow.webContents.once('did-finish-load', () => void smokeSettingsSlider(smokeWindow).then(() => app.exit(0), (error) => {
      console.error(error);
      app.exit(1);
    }));
    smokeWindow.webContents.once('did-fail-load', () => app.exit(1));
  } else if (SMOKE_DIR) runSmoke();
  // update check: packaged builds only, never during the smoke test, and only if the DJ allows it
  else if (app.isPackaged && settingsStore.data.autoUpdateCheck !== false) {
    setTimeout(() => void updater.check(), 8000);
    setInterval(() => { if (settingsStore.data.autoUpdateCheck !== false) void updater.check(); }, 6 * 3600 * 1000);
  }
  // Analyses interrupted by quitting the app resume automatically
  for (const r of Object.values(records())) if (r.status === 'queued' || r.status === 'analyzing') enqueue(r.path);
  syncWatch();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (event) => {
  if (exportInProgress) { event.preventDefault(); return; }
  library?.flush();
  settingsStore?.flush();
  crateStore?.flush();
  learningStore?.flush();
  referenceStore?.flush();
  watcher?.close();
  queue?.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
