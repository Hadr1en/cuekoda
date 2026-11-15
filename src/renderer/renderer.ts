import type { PrepCrate } from '../core/crates';
import { openCrates } from './crates';
import { gridAudition, gridBeats, type GridBeat } from '../core/beatgrid';
import { openComparison } from './comparison';
import type { AnalysisResult, CueKind, HotCue, Loop, Section, SectionType, VocalSegment } from '../core/types';
import { allKeys, formatKey } from '../core/key';
import { CUE_KIND_LABEL, DEFAULT_COLORS } from '../core/profiles';
import { cueAt, duplicateCueIds } from '../core/cues';
import { SECTION_LABEL } from '../core/structure';
import { matchTracks } from '../core/matching';
import { resolveLang, setLang, tr } from '../shared/i18n';
import { bTimeAt, fadeGains, planTransition } from '../core/transition';
import type { TrackEdits, TrackRecord } from '../shared/api';
import { allProfiles, api, applyTheme, changedEdits, doneResults, history, keyLabel, snapshotEdits, state } from './state';
import { metronome } from './metronome';
import { WaveView, drawOverview } from './waveform';
import { openDuplicates, openExport, openHelp, openSetOrder, openSettings, renderUpdateBadge } from './dialogs';
import {
  $, announce, camelotColor, setText, translateDom, clearTokenCache, confBadge, fmtBpm, fmtDur, fmtTime, h, hexOf, initToast, LETTERS, rgb, rgbOf, toast, toFileUrl, worst,
} from './util';

const windowOverlay = (navigator as Navigator & { windowControlsOverlay?: EventTarget & { visible: boolean } }).windowControlsOverlay;
if (windowOverlay) {
  const syncOverlay = () => document.documentElement.toggleAttribute('data-window-overlay', windowOverlay.visible);
  windowOverlay.addEventListener('geometrychange', syncOverlay);
  syncOverlay();
}

const audio = $<HTMLAudioElement>('audio');
const rowEls = new Map<string, HTMLTableRowElement>();
let sortKey = '';
let sortDir = 1;
let searchTerms: string[] = [];
let visibleRecords: TrackRecord[] = [];
let visibleIndex = new Map<string, number>();
let libraryFrame = 0;
let markedPaths = new Set<string>();
let selectionAnchor: string | null = null;
const selectAll = $<HTMLInputElement>('select-all');
const trackActions = $('track-actions');
const searchText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
let activeTab = 'cues';
let loopPlay: Loop | null = null;
let batchTotal = 0;

const current = (): AnalysisResult | null => {
  const r = state.selected ? state.tracks.get(state.selected) : null;
  return r?.result ?? null;
};

// ===================================================================== persistence of edits
function persist(r: AnalysisResult, before: TrackEdits) {
  const edits = changedEdits(before, r);
  if (Object.keys(edits).length && !api.saveTrackEdits(r.path, r.fileHash, edits)) {
    Object.assign(r, before);
    toast('Le morceau a changé pendant la correction. Réessayez.');
    return false;
  }
  return Object.keys(edits).length > 0;
}

function finishEdit(r: AnalysisResult, before: TrackEdits) {
  if (persist(r, before)) history.push(r, before);
  refreshTrack(r.path);
}

/** Every manual edit goes through here: snapshot → change → save → redraw. */
function edit(r: AnalysisResult, change: () => void) {
  const before = snapshotEdits(r);
  change();
  finishEdit(r, before);
}

function refreshTrack(path: string) {
  const rec = state.tracks.get(path);
  if (rec) {
    renderRow(rec);
    if (sortKey || searchTerms.length || libView !== 'all') scheduleLibrary();
  }
  if (path === state.selected) renderDetail();
  updateUndo();
}

function updateUndo() {
  $<HTMLButtonElement>('btn-undo').disabled = !history.canUndo();
  $<HTMLButtonElement>('btn-redo').disabled = !history.canRedo();
}

// ===================================================================== library
function overallConfidence(r: AnalysisResult) {
  return worst(r.tempo?.confidence, r.key.level, r.grid.downbeatConfidence);
}

let libView: 'all' | 'review' | 'missing' = 'all';
let activeCrate: string | undefined;
let crateOrder = new Map<string, number>();

/**
 * Why a track should be checked by ear before a gig (empty = nothing to check): low confidence on tempo,
 * downbeat or key, analysis warnings, duplicated pads, failed analysis. "✓ Vérifié" clears it.
 */
function reviewReasons(rec: TrackRecord): string[] {
  if (rec.reviewedAt) return [];
  if (rec.status === 'error') return ['analyse en échec'];
  const r = rec.result;
  if (!r) return [];
  const out: string[] = [];
  if (r.tempo?.confidence === 'low' || r.tempo?.competingBpm) out.push('tempo incertain');
  if (r.grid.downbeatConfidence === 'low') out.push('premier temps incertain');
  if (r.key.level === 'low' || r.key.ambiguous) out.push('tonalité incertaine');
  if (r.key.changes?.length) out.push('changement de tonalité');
  if (duplicateCueIds(r.cues).size) out.push('pads en double');
  if (r.warnings.some((w) => /tronqué|endommagé|LAME/.test(w))) out.push('fichier à vérifier');
  return out;
}

function matchesFilter(rec: TrackRecord) {
  if (activeCrate && !crateOrder.has(rec.path)) return false;
  if (libView === 'review' && !reviewReasons(rec).length) return false;
  if (libView === 'missing' && !rec.missing) return false;
  if (!searchTerms.length) return true;
  const r = rec.result;
  const hay = searchText([rec.fileName, r?.title, r?.artist, r?.key.camelot, r?.key.musical,
    r ? formatKey(r.key, 'openKey') : '', r ? fmtBpm(r.bpm) : ''].join(' '));
  return searchTerms.every((word) => hay.includes(word));
}

function keyOrder(key: AnalysisResult['key']) {
  const code = keyLabel(key);
  return code ? Number.parseInt(code, 10) * 2 + (/[Bd]$/.test(code) ? 1 : 0) : 99;
}

function keyBadge(key: AnalysisResult['key'], showAmbiguity = false) {
  const code = keyLabel(key);
  if (!code) return '—';
  const title = [key.musical, key.camelot, formatKey(key, 'openKey'), key.ambiguous ? tr('ambiguë') : '']
    .filter(Boolean).join(' · ');
  return h('span', { class: 'key', style: { background: camelotColor(key.camelot) }, title },
    code + (showAmbiguity && key.ambiguous ? '?' : ''));
}

function sortValue(rec: TrackRecord): string | number {
  const r = rec.result;
  switch (sortKey) {
    case 'title': return (r?.title ?? rec.fileName).toLowerCase();
    case 'artist': return (r?.artist ?? '').toLowerCase();
    case 'bpm': return r?.bpm ?? 0;
    case 'key': return r ? keyOrder(r.key) : 99;
    case 'energy': return r?.energy?.score ?? 0;
    case 'cues': return r?.cues.length ?? 0;
    case 'conf': return r ? { high: 0, medium: 1, low: 2 }[overallConfidence(r)] : 3;
    case 'duration': return r?.durationSec ?? 0;
    default: return crateOrder.get(rec.path) ?? rec.addedAt;
  }
}

function scheduleLibrary() {
  if (!libraryFrame) libraryFrame = requestAnimationFrame(renderLibrary);
}

function renderLibrary() {
  cancelAnimationFrame(libraryFrame);
  libraryFrame = 0;
  const recs = [...state.tracks.values()].filter(matchesFilter);
  recs.sort((a, b) => {
    const x = sortValue(a), y = sortValue(b);
    return (x < y ? -1 : x > y ? 1 : 0) * (sortKey ? sortDir : 1);
  });
  visibleRecords = recs;
  visibleIndex = new Map(recs.map(({ path }, index) => [path, index]));
  for (const path of markedPaths) {
    if (!visibleIndex.has(path)) {
      markRow(path, false);
      markedPaths.delete(path);
    }
  }
  const body = $('rows');
  const focusedRow = document.activeElement?.closest('tr.row');
  const shownRows = new Set(recs.map(({ path }) => rowEls.get(path)));
  for (const row of Array.from(body.children)) {
    if (!shownRows.has(row as HTMLTableRowElement)) row.remove();
  }
  let next = body.firstElementChild;
  for (const rec of recs) {
    let tr = rowEls.get(rec.path);
    if (!tr) {
      tr = h('tr', { class: 'row', tabIndex: 0, 'data-track': rec.path });
      const p = rec.path;
      tr.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('input')) chooseTrack(p, e);
      });
      tr.addEventListener('dblclick', (e) => {
        if (!(e.target as HTMLElement).closest('input') && !e.shiftKey && !e.ctrlKey && !e.metaKey) api.revealInFolder(p);
      });
      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openTrackActions(p, e.clientX, e.clientY);
      });
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target === tr) { e.preventDefault(); chooseTrack(p, e); }
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openTrackActions(p, rect.left + 20, rect.bottom);
        }
      });
      rowEls.set(rec.path, tr);
      renderRow(rec, tr);
    }
    if (tr === next) next = next.nextElementSibling;
    else body.insertBefore(tr, next);
  }
  if (focusedRow instanceof HTMLElement && focusedRow.isConnected && document.activeElement !== focusedRow) {
    focusedRow.focus({ preventScroll: true });
  }
  const total = state.tracks.size;
  $('empty').hidden = total > 0;
  $('tracks').hidden = recs.length === 0;
  $('no-matches').hidden = total === 0 || recs.length > 0;
  setText($('lib-count'), total ? `${recs.length} / ${total} morceau${total > 1 ? 'x' : ''}` : '');
  document.querySelectorAll<HTMLElement>('th[data-sort]').forEach((th) => {
    th.setAttribute('aria-sort', th.dataset.sort === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none');
  });
  syncTrackSelection();
  updateGlobalButtons();
  updateTransport();
}

function markRow(path: string, marked: boolean) {
  const row = rowEls.get(path);
  if (!row) return;
  row.classList.toggle('marked', marked);
  row.querySelector<HTMLInputElement>('input')!.checked = marked;
}

function syncTrackSelection() {
  const count = markedPaths.size;
  selectAll.checked = count > 0 && count === visibleRecords.length;
  selectAll.indeterminate = count > 0 && count < visibleRecords.length;
  $('selection-count').hidden = count === 0;
  setText($('selection-count'), `${count} sélectionné${count > 1 ? 's' : ''}`);
  $<HTMLButtonElement>('btn-remove').disabled = count === 0;
  $<HTMLButtonElement>('btn-reanalyze').disabled = ![...markedPaths].some((p) => !state.tracks.get(p)?.missing && !isBusy(state.tracks.get(p)));
}

function replaceTrackSelection(next: Set<string>) {
  for (const path of markedPaths) if (!next.has(path)) markRow(path, false);
  for (const path of next) if (!markedPaths.has(path)) markRow(path, true);
  markedPaths = next;
  syncTrackSelection();
}

function selectedPaths() {
  return [...markedPaths].filter((path) => visibleIndex.has(path) && state.tracks.has(path));
}

function selectedInViewOrder() {
  return selectedPaths().sort((a, b) => visibleIndex.get(a)! - visibleIndex.get(b)!);
}

function chooseTrack(path: string, e?: MouseEvent | KeyboardEvent, checkbox = false) {
  const toggle = checkbox || !!(e?.metaKey || e?.ctrlKey);
  const anchor = selectionAnchor === null ? undefined : visibleIndex.get(selectionAnchor);
  const index = visibleIndex.get(path);
  const next = new Set(toggle ? markedPaths : []);
  if (e?.shiftKey && anchor !== undefined && index !== undefined) {
    for (const record of visibleRecords.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)) next.add(record.path);
  } else {
    selectionAnchor = path;
    if (toggle && next.has(path)) next.delete(path);
    else next.add(path);
    if (!toggle) select(path);
  }
  replaceTrackSelection(next);
  // The native checkbox has already toggled itself, even when a range keeps its selection.
  if (checkbox) markRow(path, markedPaths.has(path));
}

function markAllVisible(on: boolean) {
  selectionAnchor = on ? visibleRecords[0]?.path ?? null : null;
  replaceTrackSelection(new Set(on ? visibleRecords.map(({ path }) => path) : []));
}

function openTrackActions(path: string, x: number, y: number) {
  rowEls.get(path)?.focus({ preventScroll: true });
  if (!markedPaths.has(path)) chooseTrack(path);
  const button = (label: string, action: () => void, disabled = false) => h('button', {
    type: 'button', class: 'btn ghost', disabled, onclick: () => { trackActions.hidePopover(); action(); },
  }, label);
  trackActions.replaceChildren(
    button('Ré-analyser', () => void reanalyzeSelected(), !selectedPaths().some((p) => !state.tracks.get(p)?.missing && !isBusy(state.tracks.get(p)))),
    button('Ajouter à un bac…', () => showCrates()),
    button('Exporter la sélection…', () => openExport(state.selected, undefined, selectedInViewOrder()),
      !selectedPaths().some((p) => state.tracks.get(p)?.status === 'done')),
    button(activeCrate ? 'Retirer du bac' : 'Retirer de la bibliothèque', () => void removeSelected()),
    button('Afficher le fichier', () => void api.revealInFolder(path), markedPaths.size > 1 || !!state.tracks.get(path)?.missing),
    button('Tout sélectionner', () => markAllVisible(true)),
  );
  if (!trackActions.matches(':popover-open')) trackActions.showPopover();
  trackActions.style.left = `${Math.max(4, Math.min(x, innerWidth - trackActions.offsetWidth - 4))}px`;
  trackActions.style.top = `${Math.max(4, Math.min(y, innerHeight - trackActions.offsetHeight - 4))}px`;
  trackActions.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}

const selectionLabel = (name: string) => `${tr('Sélectionner')} ${name}`;
const td = (text: string | Node, cls = '') => h('td', { class: cls }, text);

const isBusy = (rec?: TrackRecord) => !!rec && (rec.status === 'analyzing' || rec.status === 'queued');
// Analysis stages in the order the engine reports them (src/core/analyzer.ts)
const STAGES = ['décodage', 'tempo', 'grille', 'structure', 'voix', 'tonalité', 'terminé'];
function busyText(rec: TrackRecord): string {
  if (rec.status === 'queued') {
    const waiting = [...state.tracks.values()].filter((t) => t.status === 'queued');
    const pos = waiting.indexOf(rec) + 1;
    return pos > 0 ? `En attente · ${pos}ᵉ dans la file` : 'En attente';
  }
  const i = STAGES.indexOf(rec.stage ?? '');
  const step = i >= 0 ? ` · étape ${i + 1}/${STAGES.length - 1}` : '';
  return `${rec.result ? 'Ré-analyse' : 'Analyse'} ${Math.round((rec.progress ?? 0) * 100)} % — ${rec.stage ?? 'démarrage'}${step}`;
}
/** Progress bar + stage text; indeterminate while queued, animated while running. */
function busyLine(rec: TrackRecord, inRow = false) {
  const label = inRow && rec.status === 'queued' ? 'En attente' : busyText(rec);
  const bar = h('progress', { max: 100, 'aria-label': label });
  if (rec.status === 'analyzing') bar.value = Math.max(2, Math.round((rec.progress ?? 0) * 100));
  return h('span', { class: `busy-line ${rec.status}` }, bar, h('span', { class: 'muted' }, label));
}

function renderRow(rec: TrackRecord, tr = rowEls.get(rec.path)) {
  if (!tr) return;
  const checkboxFocused = document.activeElement?.parentElement === tr.firstElementChild;
  tr.replaceChildren();
  if (rec.path === state.selected) tr.setAttribute('aria-current', 'true');
  else tr.removeAttribute('aria-current');
  tr.classList.toggle('busy', isBusy(rec));
  tr.classList.toggle('marked', markedPaths.has(rec.path));
  const r = rec.result;
  const reasons = rec.status === 'done' ? reviewReasons(rec) : [];
  const warn = rec.missing || reasons.length > 0;
  const stateText =
    rec.missing ? 'Fichier introuvable à cet emplacement'
    : rec.status === 'analyzing' ? `Analyse ${Math.round((rec.progress ?? 0) * 100)} % (${rec.stage ?? ''})`
      : rec.status === 'queued' ? 'En attente'
        : rec.status === 'error' ? `Erreur : ${rec.error ?? ''}`
          : rec.status === 'cancelled' ? 'Annulé'
            : warn ? `À vérifier : ${[...reasons, ...r!.warnings].join(' ; ')}` : rec.reviewedAt ? 'Vérifié par vous' : rec.cached ? 'Analysé (cache)' : 'Analysé';
  tr.append(td(h('input', {
    type: 'checkbox', 'aria-label': selectionLabel(r?.title || rec.fileName),
    checked: markedPaths.has(rec.path),
    onclick: (e: MouseEvent) => chooseTrack(rec.path, e, true),
  }), 'c-select'));
  if (checkboxFocused) tr.querySelector('input')?.focus({ preventScroll: true });
  tr.append(td(h('span', {}, h('span', { class: `dot ${warn ? 'warn' : rec.status}`, title: stateText }), h('span', { class: 'sr-only' }, stateText)), 'c-state'));

  if (r && rec.status !== 'error') {
    const reanalysing = rec.status !== 'done';
    tr.append(
      td(h('span', {}, r.title, reanalysing && isBusy(rec) ? busyLine(rec, true) : '')),
      td(r.artist, 'muted'),
      td(h('span', {}, fmtBpm(r.bpm), r.tempo ? confBadge(r.tempo.confidence, true) : ''), 'c-num'),
      td(keyBadge(r.key, true), 'c-key'),
      td(r.energy
        ? h('span', { class: 'meter', title: `Énergie estimée ${r.energy.score}/10` }, h('span', { style: { inlineSize: `${r.energy.score * 10}%` } }), h('b', {}, r.energy.score.toFixed(1)))
        : '—', 'c-energy'),
      td(h('div', { class: 'strip' }, ...r.cues.map((c) =>
        h('i', { style: { insetInlineStart: `${Math.min(99, (c.timeSec / r.durationSec) * 100)}%`, background: rgb(c.color) }, title: `${LETTERS[c.slot] ?? ''} · ${c.name} · ${fmtTime(c.timeSec)}` }))), 'c-cues'),
      td(String(r.cues.length), 'c-num'),
      td(confBadge(overallConfidence(r)), 'c-conf'),
      td(fmtDur(r.durationSec), 'c-num muted'),
    );
  } else {
    tr.append(td(rec.fileName), td(isBusy(rec) ? busyLine(rec, true) : h('span', { class: rec.status === 'error' ? 'err' : 'muted' }, stateText), ''));
    (tr.lastChild as HTMLTableCellElement).colSpan = 8;
  }
}

function updateGlobalButtons() {
  const done = doneResults().length;
  $<HTMLButtonElement>('btn-export').disabled = done === 0;
  const failed = [...state.tracks.values()].filter((r) => r.status === 'error' || r.status === 'cancelled').length;
  const retry = $<HTMLButtonElement>('btn-retry');
  retry.hidden = failed === 0;
  setText(retry, `↻ Relancer ${failed} échec${failed > 1 ? 's' : ''}`);
}

function onQueue() {
  const q = state.queue;
  const active = q.pending + q.running;
  if (active === 0) batchTotal = 0;
  else batchTotal = Math.max(batchTotal, active);
  $('queue').hidden = active === 0 && !q.paused;
  const bar = $<HTMLProgressElement>('queue-bar');
  bar.max = Math.max(1, batchTotal);
  bar.value = batchTotal - active;
  const running = [...state.tracks.values()].filter((t) => t.status === 'analyzing');
  const now = running.length === 1
    ? ` · ${running[0].result?.title ?? running[0].fileName} — ${tr(running[0].stage ?? '…')} ${Math.round((running[0].progress ?? 0) * 100)} %`
    : running.length > 1 ? ` · ${tr(`${running.length} en cours`)}` : '';
  $('queue-label').textContent = q.paused
    ? tr(`En pause · ${q.pending} en attente`)
    : `${tr(`Analyse ${batchTotal - active}/${batchTotal}`)}${now}`;
  $('queue').classList.toggle('running', !q.paused && active > 0);
  setText($('btn-pause'), q.paused ? 'Reprendre' : 'Pause');
}

// ===================================================================== selection & detail
const overview = $<HTMLCanvasElement>('overview');
const waveCanvas = $<HTMLCanvasElement>('wave');
const wavePlayhead = $('wave-playhead');
const overviewPlayhead = $('overview-playhead');
const timeDisplay = $('time');
const wave = new WaveView(waveCanvas, {
  seek: (t) => jump(t),
  cueSelected: () => renderDetail(),
  dragCancelled: () => {
    dragStart?.restorePosition();
    dragStart = null;
  },
  viewChanged: () => { drawOverview(overview, current(), wave); updatePlayheads(); },
  cueMoved: (cue, t, done) => {
    const r = current();
    if (!r) return;
    if (!dragStart) {
      const time = cue.timeSec;
      dragStart = { time, wasAuto: cue.origin === 'auto', before: snapshotEdits(r), restorePosition: () => { cue.timeSec = time; } };
    }
    cue.timeSec = t;
    if (done) {
      const oldBar = cue.bar;
      cue.bar = Math.round((t - r.grid.firstDownbeatSec) / (4 * (60 / r.bpm)));
      cue.origin = 'user';
      syncSectionWithCue(r, cue, oldBar);
      if (dragStart.wasAuto) api.learningEvent({ type: 'moved', kind: cue.kind, beats: (t - dragStart.time) / (60 / r.bpm) });
      const { before } = dragStart;
      dragStart = null;
      finishEdit(r, before);
    }
  },
  loopMoved: (loop, t, done) => {
    const r = current();
    if (!r) return;
    if (!dragStart) {
      const time = loop.startSec;
      dragStart = { time, wasAuto: false, before: snapshotEdits(r), restorePosition: () => { loop.startSec = time; } };
    }
    loop.startSec = t;
    if (done) {
      loop.bar = Math.round((t - r.grid.firstDownbeatSec) / (4 * (60 / r.bpm)));
      loop.origin = 'user';
      const { before } = dragStart;
      dragStart = null;
      finishEdit(r, before);
    }
  },
});
let dragStart: { time: number; wasAuto: boolean; before: TrackEdits; restorePosition: () => void } | null = null;

/** Track whose audio / peaks are loaded in the player */
let audioPath = '';

function select(path: string | null) {
  const prev = state.selected;
  if (prev !== path) stopAudition();
  state.selected = path;
  if (prev) rowEls.get(prev)?.removeAttribute('aria-current');
  if (path) rowEls.get(path)?.setAttribute('aria-current', 'true');
  const rec = path ? state.tracks.get(path) : undefined;
  const r = rec?.result ?? null;
  // (re)load the media when the track changes OR when its first result just arrived (selected while pending)
  if (path && r && (prev !== path || audioPath !== path)) {
    tx?.stop();
    audio.pause();
    audioPath = path;
    audio.src = toFileUrl(r.path);
    loopPlay = null;
    wave.selectedCueId = null;
    wave.set(r);
    void api.peaks(r.path).then((pk) => {
      if (pk && state.selected === path) {
        wave.peaks = pk;
        wave.draw();
      }
    });
  }
  if (!r && audioPath) {
    tx?.stop();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audioPath = '';
    loopPlay = null;
    wave.set(null);
  }
  renderDetail();
  updateTransport();
  if (path) rowEls.get(path)?.scrollIntoView({ block: 'nearest' });
}

function jump(t: number) {
  if (audition) stopAudition();
  const r = current();
  audio.currentTime = Math.max(0, Math.min(r?.durationSec ?? t, t));
  updatePlayheads();
}

function movePlayhead(el: HTMLElement, fraction: number) {
  const hidden = !(fraction >= 0 && fraction <= 1);
  if (el.hidden !== hidden) el.hidden = hidden;
  if (!hidden) el.style.transform = `translateX(${fraction * 100}%)`;
}

function updatePlayheads() {
  const now = audio.currentTime;
  movePlayhead(wavePlayhead, wave.track ? (now - wave.start) / (wave.end - wave.start) : NaN);
  movePlayhead(overviewPlayhead, now / (wave.track?.durationSec ?? 0));
  const label = fmtTime(now);
  if (timeDisplay.textContent !== label) {
    timeDisplay.textContent = label;
    waveCanvas.setAttribute('aria-valuenow', String(Math.round(now)));
    waveCanvas.setAttribute('aria-valuetext', label);
  }
}

function redrawWave() {
  wave.draw();
  drawOverview(overview, current(), wave);
  updatePlayheads();
}

function renderBusy(rec?: TrackRecord) {
  const el = $('d-busy');
  const busy = isBusy(rec);
  el.hidden = !busy;
  if (busy) el.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), busyLine(rec!),
    rec!.result ? h('span', { class: 'muted' }, ' · l’analyse précédente reste affichée, tes corrections seront conservées') : '');
  // first analysis: nothing to show yet except the progress
  const pending = $('pending');
  pending.hidden = !busy || !!rec!.result;
  if (busy && !rec!.result) pending.replaceChildren(
    h('div', { class: 'big' }, rec!.fileName),
    h('div', { class: 'pending-line' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), busyLine(rec!)),
    h('div', { class: 'sub muted' }, 'Tempo, grille, structure, voix puis tonalité : les cues apparaîtront à la fin de l’analyse.'),
  );
}

function renderDetail() {
  const r = current();
  const rec = state.selected ? state.tracks.get(state.selected) : undefined;
  renderBusy(rec);
  $('detail').hidden = !r;
  if (!r) return;
  if (wave.track !== r) wave.set(r, true);
  $('d-title').textContent = r.title;
  const profile = tr(allProfiles().find((p) => p.id === r.profileId)?.name ?? r.profileId ?? '—');
  $('d-sub').replaceChildren(
    ...(r.artist ? [h('span', { class: 'd-artist' }, document.createTextNode(r.artist))] : []),
    h('span', {}, `${fmtBpm(r.bpm)} BPM`),
    r.key.camelot ? keyBadge(r.key) : '',
    r.energy ? h('span', {}, `${tr('énergie')} ${r.energy.score}/10`) : '',
    h('span', {}, profile),
  );
  $('time-total').textContent = `/ ${fmtDur(r.durationSec)}`;
  waveCanvas.setAttribute('aria-valuemax', String(Math.round(r.durationSec)));
  $('d-warn').textContent = [...(rec?.missing ? ['Fichier introuvable à cet emplacement (déplacé, renommé ou disque débranché)'] : []), ...r.warnings].map(tr).join(' · ');
  const reviewed = !!rec?.reviewedAt;
  const reasons = rec ? reviewReasons({ ...rec, reviewedAt: undefined }) : [];
  setText($('btn-reviewed'), reviewed ? '✓ Vérifié' : reasons.length ? `À vérifier : ${reasons.join(', ')} — marquer vérifié` : 'Marquer vérifié');
  $('btn-reviewed').classList.toggle('done', reviewed);
  // corrections
  const bpmInput = $<HTMLInputElement>('bpm-input');
  if (document.activeElement !== bpmInput) bpmInput.value = r.bpm.toFixed(2);
  const alt = r.tempo?.competingBpm;
  const tempoActions = $('tempo-actions');
  tempoActions.replaceChildren(
    alt !== undefined ? h('button', {
      type: 'button', class: 'btn small', disabled: isBusy(rec),
      title: 'L’écoute permet de choisir entre les deux pulsations',
      onclick: () => override({ bpm: alt }, `BPM fixé à ${alt}`),
    }, `Utiliser ${fmtBpm(alt)} BPM`) : '',
    r.overrides?.bpm !== undefined || r.overrides?.firstDownbeatSec !== undefined
      ? h('button', {
        type: 'button', class: 'btn small ghost', disabled: isBusy(rec),
        title: 'Recalculer le BPM et le premier temps sans les corrections de grille',
        onclick: () => override({ bpm: undefined, firstDownbeatSec: undefined }, 'BPM et grille automatiques'),
      }, 'BPM et grille automatiques') : '',
  );
  tempoActions.hidden = !tempoActions.childElementCount;
  $('bpm-conf').replaceChildren(
    r.tempo ? confBadge(r.tempo.confidence) : '',
    r.overrides?.bpm ? h('span', { class: 'pill' }, 'manuel') : '',
    r.tempo?.variable ? h('span', { class: 'pill warn' }, 'tempo variable') : '',
  );
  $('grid-conf').replaceChildren(
    confBadge(r.grid.downbeatConfidence),
    r.overrides?.firstDownbeatSec !== undefined ? h('span', { class: 'pill' }, 'manuel') : '',
  );
  const ks = $<HTMLSelectElement>('key-select');
  const alternatives = new Set((r.key.alternatives ?? []).map((a) => a.camelot));
  const candidateOrder = [r.key.camelot, ...alternatives];
  const keys = allKeys().sort((a, b) => keyOrder(a) - keyOrder(b));
  const option = (k: AnalysisResult['key']) =>
    h('option', { value: k.musical, selected: k.camelot === r.key.camelot }, `${keyLabel(k)} · ${k.musical}`);
  ks.replaceChildren(
    ...(alternatives.size ? [
      h('optgroup', { label: tr('Tonalités proposées') },
        ...candidateOrder.flatMap((c) => keys.filter((k) => k.camelot === c).map(option))),
      h('optgroup', { label: tr('Autres tonalités') },
        ...keys.filter((k) => !candidateOrder.includes(k.camelot)).map(option)),
    ] : keys.map(option)),
  );
  if (r.overrides?.key) ks.append(h('option', { value: '' }, '↺ Revenir à la détection automatique'));
  $('key-conf').replaceChildren(
    confBadge(r.key.level),
    r.overrides?.key ? h('span', { class: 'pill' }, 'manuel') : '',
    r.key.ambiguous ? h('span', { class: 'pill warn', title: 'Plusieurs tonalités plausibles' }, 'ambiguë') : '',
  );
  ({ cues: renderCues, loops: renderLoops, sections: renderSections, mix: renderMix, info: renderInfo } as Record<string, (r: AnalysisResult) => void>)[activeTab](r);
  redrawWave();
}

// ---------------------------------------------------------------- tab: cues
const beatOf = (r: AnalysisResult) => 60 / r.bpm;
const snapBeat = (t: number) => wave.snap(t);
const barOf = (r: AnalysisResult, t: number) => Math.round((t - r.grid.firstDownbeatSec) / (4 * beatOf(r)));
const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function profileColors() {
  return (allProfiles().find((p) => p.id === state.settings.profileId) ?? allProfiles()[0]).colors;
}

/** A cue already sits at that position: say which one instead of wasting a second pad on it. */
function refuseSamePosition(r: AnalysisResult, t: number, except?: HotCue): boolean {
  const other = cueAt(r.cues, snapBeat(t), except);
  if (!other) return false;
  toast(`Déjà un cue à ${fmtTime(other.timeSec)} : ${other.name}${other.slot >= 0 ? ` (pad ${LETTERS[other.slot]})` : ' (memory cue)'}`);
  return true;
}

function setCueAt(r: AnalysisResult, slot: number, t: number, kind?: CueKind) {
  const existing = r.cues.find((c) => c.slot === slot);
  if (existing?.locked) return toast('Ce cue est verrouillé');
  if (refuseSamePosition(r, t, existing)) return;
  edit(r, () => {
    const time = snapBeat(t);
    if (existing) {
      const oldBar = existing.bar;
      existing.timeSec = time;
      existing.bar = barOf(r, time);
      existing.origin = 'user';
      syncSectionWithCue(r, existing, oldBar);
    } else {
      const k = kind ?? 'custom';
      r.cues.push({
        id: newId('c'), slot, role: 'custom', kind: k, name: CUE_KIND_LABEL[k], timeSec: time, bar: barOf(r, time),
        color: profileColors()[k] ?? DEFAULT_COLORS[k], confidence: 'high', reason: 'Placé manuellement', origin: 'user',
      });
    }
    r.cues.sort((a, b) => a.slot - b.slot);
  });
}

/**
 * Adds a cue at time t: on the first free pad, or as a memory cue (no pad, slot −1) when the 8 pads are
 * taken or when asked. Memory cues are exported as rekordbox memory cues / Traktor stored cues.
 */
function addCue(r: AnalysisResult, t: number, kind: CueKind, memory = false) {
  if (refuseSamePosition(r, t)) return;
  const free = [0, 1, 2, 3, 4, 5, 6, 7].find((s) => !r.cues.some((c) => c.slot === s));
  const slot = memory || free === undefined ? -1 : free;
  edit(r, () => {
    const time = snapBeat(t);
    r.cues.push({
      id: newId('c'), slot, role: 'custom', kind, name: CUE_KIND_LABEL[kind], timeSec: time, bar: barOf(r, time),
      color: profileColors()[kind] ?? DEFAULT_COLORS[kind], confidence: 'high', reason: 'Placé manuellement', origin: 'user',
    });
    r.cues.sort((a, b) => a.slot - b.slot || a.timeSec - b.timeSec);
  });
  const where = slot < 0 ? (memory ? 'memory cue' : 'memory cue (les 8 pads sont occupés)') : `pad ${LETTERS[slot]}`;
  toast(`${CUE_KIND_LABEL[kind]} ajouté à ${fmtTime(snapBeat(t))} — ${where}`);
}

/** Moves a memory cue onto a free pad (or swaps it with the pad's cue, which becomes a memory cue). */
function promoteCue(r: AnalysisResult, cue: HotCue, slot: number) {
  const occupant = r.cues.find((c) => c.slot === slot);
  if (cue.locked || occupant?.locked) return toast('Ce cue est verrouillé');
  edit(r, () => {
    if (occupant) occupant.slot = -1;
    cue.slot = slot;
    cue.origin = 'user';
    if (occupant) occupant.origin = 'user';
    r.cues.sort((a, b) => a.slot - b.slot || a.timeSec - b.timeSec);
  });
}

function deleteCue(r: AnalysisResult, cue: HotCue) {
  if (cue.locked) return toast('Ce cue est verrouillé');
  edit(r, () => {
    r.cues = r.cues.filter((c) => c !== cue);
    if (cue.origin === 'auto') api.learningEvent({ type: 'deleted', kind: cue.kind });
  });
}

function moveCue(r: AnalysisResult, cue: HotCue, beats: number) {
  if (cue.locked) return toast('Ce cue est verrouillé');
  edit(r, () => {
    if (cue.origin === 'auto') api.learningEvent({ type: 'moved', kind: cue.kind, beats });
    const oldBar = cue.bar;
    cue.timeSec = Math.max(0, Math.min(r.durationSec - 0.05, wave.stepBeats(cue.timeSec, beats)));
    cue.bar = barOf(r, cue.timeSec);
    cue.origin = 'user';
    syncSectionWithCue(r, cue, oldBar);
  });
  // moving through another cue is allowed (several steps), but landing on it is flagged
  const other = cueAt(r.cues, cue.timeSec, cue);
  if (other) toast(`${cue.name} est maintenant au même endroit que ${other.name} : un des deux pads est inutile`);
}

function renderCues(r: AnalysisResult) {
  const kinds = Object.keys(CUE_KIND_LABEL) as CueKind[];
  const pads = [];
  const dups = duplicateCueIds(r.cues);
  for (let slot = 0; slot < 8; slot++) {
    const cue = r.cues.find((c) => c.slot === slot);
    if (!cue) {
      const sel = h('select', { 'aria-label': `Type du cue ${LETTERS[slot]}` }, ...kinds.map((k) => h('option', { value: k }, CUE_KIND_LABEL[k])));
      pads.push(h('div', { class: 'pad empty-pad' },
        h('div', { class: 'letter' }, LETTERS[slot]),
        h('div', { class: 'tm' }, 'libre'),
        h('div', { class: 'ctl' }, sel,
          h('button', { type: 'button', onclick: () => setCueAt(r, slot, audio.currentTime, sel.value as CueKind), 'aria-label': `Poser le pad ${LETTERS[slot]} à la position de lecture` }, '+ ici')),
      ));
      continue;
    }
    const b = (label: string, title: string, fn: () => void, disabled = false) =>
      h('button', { type: 'button', title, 'aria-label': `${title} — pad ${LETTERS[slot]}`, disabled, onclick: (e: Event) => { e.stopPropagation(); fn(); } }, label);
    const selected = wave.selectedCueId === cue.id;
    pads.push(h('div', {
      class: `pad${selected ? ' selected' : ''}${dups.has(cue.id) ? ' dup' : ''}`, style: { '--pad-color': rgb(cue.color) },
      title: dups.has(cue.id) ? 'Même position qu’un autre cue : ce pad est en double' : undefined,
      onclick: () => { wave.selectedCueId = cue.id; renderDetail(); },
    },
      h('div', { class: 'pad-head' },
        h('span', { class: 'letter' }, LETTERS[slot]),
        h('input', { type: 'color', value: hexOf(cue.color), 'aria-label': `Couleur du pad ${LETTERS[slot]}`, disabled: cue.locked,
          onchange: (e: Event) => edit(r, () => { cue.color = rgbOf((e.target as HTMLInputElement).value); cue.origin = 'user'; }) }),
        confBadge(cue.confidence, true),
        cue.origin === 'user' ? h('span', { class: 'pill', title: 'Modifié par vous : conservé lors des ré-analyses' }, 'perso') : '',
        dups.has(cue.id) ? h('span', { class: 'pill warn' }, 'doublon') : '',
      ),
      h('input', { class: 'nm', type: 'text', value: cue.name, 'aria-label': `Nom du pad ${LETTERS[slot]}`, disabled: cue.locked,
        onchange: (e: Event) => edit(r, () => { cue.name = (e.target as HTMLInputElement).value || cue.name; cue.origin = 'user'; }) }),
      h('div', { class: 'tm' }, `${fmtTime(cue.timeSec)} · mes. ${cue.bar + 1}`),
      h('div', { class: 'why' }, cue.reason.replace(/ — détection heuristique non validée$/, '')),
      h('div', { class: 'ctl' },
        b('▶', 'Aller au cue', () => { jump(cue.timeSec); void audio.play(); }),
        b('−mes', '1 mesure plus tôt', () => moveCue(r, cue, -4), cue.locked),
        b('−1', '1 temps plus tôt', () => moveCue(r, cue, -1), cue.locked),
        b('+1', '1 temps plus tard', () => moveCue(r, cue, 1), cue.locked),
        b('+mes', '1 mesure plus tard', () => moveCue(r, cue, 4), cue.locked),
        b(cue.locked ? '🔒' : '🔓', cue.locked ? 'Déverrouiller' : 'Verrouiller (protégé des ré-analyses et modifications)', () => edit(r, () => { cue.locked = !cue.locked; })),
        b('✕', 'Supprimer le cue', () => deleteCue(r, cue), cue.locked),
      ),
    ));
  }
  // add-a-cue toolbar: always available (a vocal highlight, a fill, a riser…)
  const kindSel = h('select', { class: 'new-cue-kind', 'aria-label': 'Type du nouveau cue' }, ...kinds.map((k) => h('option', { value: k, selected: k === 'vocal' }, CUE_KIND_LABEL[k])));
  const tools = h('div', { class: 'hrow' },
    h('button', { type: 'button', class: 'btn small', title: 'Raccourci : C', onclick: () => addCue(r, audio.currentTime, kindSel.value as CueKind) }, '+ Cue ici'),
    kindSel,
    h('button', { type: 'button', class: 'btn small ghost', title: 'Raccourci : M', onclick: () => addCue(r, audio.currentTime, kindSel.value as CueKind, true) }, '+ Memory cue ici'),
    h('span', { class: 'muted' }, 'Posé sur le temps le plus proche de la lecture. Pads pleins : le cue devient une memory cue (exportée sans pad).'),
  );
  const memo = r.cues.filter((c) => c.slot < 0).sort((a, b) => a.timeSec - b.timeSec);
  const memoBlock = memo.length
    ? h('section', { class: 'memo' },
        h('h3', {}, `Memory cues (${memo.length})`),
        h('table', { class: 'caps' },
          h('thead', {}, h('tr', {}, ...['Nom', 'Type', 'Position', '', 'Pad'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, ...memo.map((cue) => {
            const padSel = h('select', { 'aria-label': `Placer « ${cue.name} » sur un pad`, disabled: cue.locked },
              h('option', { value: '' }, '→ pad…'),
              ...[0, 1, 2, 3, 4, 5, 6, 7].map((sl) => {
                const occ = r.cues.find((c) => c.slot === sl);
                return h('option', { value: String(sl), disabled: occ?.locked }, `${LETTERS[sl]}${occ ? ` (remplace ${occ.name})` : ' (libre)'}`);
              }));
            padSel.addEventListener('change', () => { if (padSel.value !== '') promoteCue(r, cue, Number(padSel.value)); });
            const btn = (label: string, title: string, fn: () => void) => h('button', { type: 'button', class: 'btn small ghost', title, 'aria-label': title, onclick: fn }, label);
            return h('tr', { class: wave.selectedCueId === cue.id ? 'selected' : '' },
              h('td', {}, h('input', { type: 'text', value: cue.name, 'aria-label': 'Nom de la memory cue', disabled: cue.locked,
                onchange: (e: Event) => edit(r, () => { cue.name = (e.target as HTMLInputElement).value || cue.name; cue.origin = 'user'; }) })),
              h('td', {}, h('select', { 'aria-label': 'Type de la memory cue', disabled: cue.locked, onchange: (e: Event) => edit(r, () => {
                const k = (e.target as HTMLSelectElement).value as CueKind;
                if (cue.name === CUE_KIND_LABEL[cue.kind]) cue.name = CUE_KIND_LABEL[k];
                cue.kind = k; cue.color = profileColors()[k] ?? DEFAULT_COLORS[k]; cue.origin = 'user';
              }) }, ...kinds.map((k) => h('option', { value: k, selected: k === cue.kind }, CUE_KIND_LABEL[k])))),
              h('td', {}, `${fmtTime(cue.timeSec)} · mes. ${cue.bar + 1}`),
              h('td', {},
                btn('▶', 'Aller à la memory cue', () => { jump(cue.timeSec); void audio.play(); }),
                btn('−1', '1 temps plus tôt', () => moveCue(r, cue, -1)),
                btn('+1', '1 temps plus tard', () => moveCue(r, cue, 1)),
                btn('✕', 'Supprimer la memory cue', () => deleteCue(r, cue)),
              ),
              h('td', {}, padSel),
            );
          })),
        ),
      )
    : '';
  $('tab-cues').replaceChildren(tools, h('div', { class: 'pads' }, ...pads), memoBlock);
}

// ---------------------------------------------------------------- tab: loops
function renderLoops(r: AnalysisResult) {
  const loops = r.loops ?? [];
  const lenSel = h('select', { 'aria-label': 'Longueur de la nouvelle boucle' }, ...[4, 8, 16, 32, 64].map((v) => h('option', { value: String(v), selected: v === 16 }, `${v} temps`)));
  $('tab-loops').replaceChildren(
    h('div', { class: 'hrow' },
      h('button', { type: 'button', class: 'btn small', onclick: () => addLoop(r, Number(lenSel.value)) }, '+ Boucle à la position de lecture'),
      lenSel,
      h('span', { class: 'muted' }, 'Seules les boucles validées sont exportées par défaut.'),
    ),
    loops.length
      ? h('table', { class: 'caps loops' },
          h('thead', {}, h('tr', {}, ...['Boucle', 'Début', 'Longueur', 'Confiance', 'Pourquoi', 'Validée', ''].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, ...loops.map((l) =>
            h('tr', {},
              h('td', {}, h('input', { type: 'text', value: l.name, 'aria-label': 'Nom de la boucle', onchange: (e: Event) => edit(r, () => { l.name = (e.target as HTMLInputElement).value; l.origin = 'user'; }) })),
              h('td', {}, `${fmtTime(l.startSec)} · mes. ${l.bar + 1}`),
              h('td', {}, h('select', { 'aria-label': 'Longueur', onchange: (e: Event) => edit(r, () => { l.beats = Number((e.target as HTMLSelectElement).value); l.origin = 'user'; }) },
                ...[4, 8, 16, 32, 64].map((v) => h('option', { value: String(v), selected: v === l.beats }, `${v} temps (${v / 4} mes.)`)))),
              h('td', {}, confBadge(l.confidence)),
              h('td', { class: 'muted' }, l.reason),
              h('td', {}, h('input', { type: 'checkbox', checked: l.accepted, 'aria-label': 'Valider la boucle', onchange: (e: Event) => edit(r, () => { l.accepted = (e.target as HTMLInputElement).checked; }) })),
              h('td', {},
                h('button', { type: 'button', class: 'btn small ghost', onclick: () => { loopPlay = loopPlay === l ? null : l; jump(l.startSec); void audio.play(); renderDetail(); } }, loopPlay === l ? '■ Stop boucle' : '▶ Écouter'),
                h('button', { type: 'button', class: 'btn small ghost', 'aria-label': 'Supprimer la boucle', onclick: () => edit(r, () => { r.loops = (r.loops ?? []).filter((x) => x !== l); if (loopPlay === l) loopPlay = null; }) }, '✕'),
              ),
            ))),
        )
      : h('p', { class: 'muted' }, 'Aucune suggestion de boucle pour ce morceau avec le profil actuel.'),
  );
}

function addLoop(r: AnalysisResult, beats: number) {
  edit(r, () => {
    const bar = 4 * beatOf(r);
    const d0 = r.grid.firstDownbeatSec;
    const start = Math.max(0, d0 + Math.floor((audio.currentTime - d0) / bar) * bar);
    (r.loops ??= []).push({
      id: newId('l'), kind: 'custom', name: 'Boucle', startSec: start, beats, bar: barOf(r, start),
      confidence: 'high', reason: 'Ajoutée manuellement', origin: 'user', accepted: true,
    });
  });
}

// ---------------------------------------------------------------- tab: sections
const SECTION_TYPES = Object.keys(SECTION_LABEL) as SectionType[];

/** Keeps the timeline consistent: sorted, contiguous, recomputed times, owned by the user from now on. */
function normalizeSections(r: AnalysisResult) {
  const s = r.sections ?? [];
  s.sort((a, b) => a.startBar - b.startBar);
  const bar = 4 * beatOf(r);
  s.forEach((sec, i) => {
    sec.endBar = i + 1 < s.length ? s[i + 1].startBar : sec.endBar;
    sec.startSec = Math.max(0, r.grid.firstDownbeatSec + sec.startBar * bar);
    sec.endSec = i + 1 < s.length ? r.grid.firstDownbeatSec + sec.endBar * bar : r.durationSec;
    sec.origin = 'user';
  });
  r.sections = s.filter((x) => x.endBar > x.startBar);
}

function sectionEdit(r: AnalysisResult, fn: (s: Section[]) => void) {
  edit(r, () => {
    fn(r.sections ?? []);
    normalizeSections(r);
  });
}

/** Structure cues and the section they name move together (the timeline follows the DJ's cues). */
const CUE_SECTION: Partial<Record<CueKind, SectionType>> = {
  intro: 'intro',
  build: 'build',
  drop: 'drop',
  break: 'breakdown',
  outro: 'outro',
};
function syncSectionWithCue(r: AnalysisResult, cue: HotCue, oldBar: number) {
  const type = CUE_SECTION[cue.kind];
  const s = r.sections;
  const nb = cue.bar;
  if (!type || !s?.length || nb === oldBar || nb < 0) return;
  s.sort((a, b) => a.startBar - b.startBar);
  const linked = s.find((x) => x.startBar === oldBar && (x.type === type || x.label === cue.name));
  if (linked) {
    const i = s.indexOf(linked);
    const prev = s[i - 1];
    const next = s[i + 1];
    if (i > 0 && nb > prev.startBar && (!next || nb < next.startBar)) {
      linked.startBar = nb; // simple case: the boundary moves
      normalizeSections(r);
      return;
    }
    // the cue jumped elsewhere: the old section is no longer that drop / break…
    linked.type = 'section';
    linked.label = SECTION_LABEL.section;
  }
  const host = s.find((x) => x.startBar <= nb && nb < x.endBar) ?? s[s.length - 1];
  if (host.startBar === nb) {
    host.type = type;
    host.label = cue.name;
  } else {
    s.push({ ...host, id: newId('s'), startBar: nb, type, label: cue.name, confidence: 'high', origin: 'user' });
  }
  normalizeSections(r);
}

// ---------------------------------------------------------------- vocal parts (editable)
function vocalEdit(r: AnalysisResult, fn: (segs: VocalSegment[]) => void) {
  edit(r, () => {
    const v = (r.vocals ??= {
      method: 'manuel', validated: false, curve: [], present: [], segments: [], coverage: 0, tonalShare: 0, level: 'low',
    });
    fn(v.segments);
    const bar = 4 * beatOf(r);
    const d0 = r.grid.firstDownbeatSec;
    v.segments.sort((a, b) => a.startBar - b.startBar);
    // merge overlaps, recompute times and coverage
    const out: VocalSegment[] = [];
    for (const seg of v.segments) {
      seg.endBar = Math.max(seg.startBar + 1, seg.endBar);
      const last = out[out.length - 1];
      if (last && seg.startBar <= last.endBar) {
        last.endBar = Math.max(last.endBar, seg.endBar);
        if (seg.strength === 'strong') last.strength = 'strong';
        last.origin = 'user';
      } else out.push(seg);
    }
    for (const seg of out) {
      seg.startSec = Math.max(0, d0 + seg.startBar * bar);
      seg.endSec = Math.min(r.durationSec, d0 + seg.endBar * bar);
    }
    v.segments = out.filter((x) => x.endSec > x.startSec);
    const total = Math.max(1, Math.round((r.durationSec - Math.max(0, d0)) / bar));
    v.coverage = Math.min(1, v.segments.reduce((a, x) => a + (x.endBar - x.startBar), 0) / total);
    v.edited = true;
  });
}

function renderVocals(r: AnalysisResult): HTMLElement {
  const segs = r.vocals?.segments ?? [];
  const lenSel = h('select', { 'aria-label': 'Longueur du nouveau passage vocal' }, ...[2, 4, 8, 16].map((v) => h('option', { value: String(v), selected: v === 8 }, `${v} mes.`)));
  const btn = (label: string, title: string, fn: () => void, disabled = false) =>
    h('button', { type: 'button', class: 'btn small ghost', title, 'aria-label': title, disabled, onclick: fn }, label);
  return h('section', { class: 'vocals-edit' },
    h('h3', {}, 'Voix'),
    h('p', { class: 'muted' }, 'Ajuste les passages vocaux à la mesure près. CueKoda conserve tes corrections.'),
    h('div', { class: 'hrow' },
      h('button', { type: 'button', class: 'btn small', onclick: () => vocalEdit(r, (list) => {
        const b = Math.max(0, barOf(r, audio.currentTime));
        list.push({ startBar: b, endBar: b + Number(lenSel.value), startSec: 0, endSec: 0, score: 1, strength: 'strong', confidence: 'high', origin: 'user' });
      }) }, '+ Passage vocal à la lecture'),
      lenSel,
      h('button', { type: 'button', class: 'btn small ghost', title: 'Le passage vocal en cours s’arrête à la mesure de lecture', onclick: () => vocalEdit(r, (list) => {
        const b = barOf(r, audio.currentTime);
        const seg = list.find((x) => x.startBar < b && b <= x.endBar + 8) ?? [...list].reverse().find((x) => x.startBar < b);
        if (!seg) return toast('Aucun passage vocal avant la position de lecture');
        seg.endBar = b;
        seg.origin = 'user';
      }) }, 'Fin de voix ici'),
      h('button', { type: 'button', class: 'btn small ghost', title: 'Coupe le passage vocal à la mesure de lecture (pause dans le chant)', onclick: () => vocalEdit(r, (list) => {
        const b = barOf(r, audio.currentTime);
        const seg = list.find((x) => x.startBar < b && b < x.endBar);
        if (!seg) return toast('Place la lecture à l’intérieur d’un passage vocal');
        list.push({ ...seg, startBar: b + 1, origin: 'user' });
        seg.endBar = b;
        seg.origin = 'user';
      }) }, 'Pause dans la voix ici'),
    ),
    segs.length
      ? h('table', { class: 'caps' },
          h('thead', {}, h('tr', {}, ...['Début', 'Fin', 'Durée', 'Voix', ''].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, ...segs.map((seg, i) =>
            h('tr', {},
              h('td', {}, `${fmtTime(seg.startSec)} · mes. ${seg.startBar + 1} `,
                btn('−', 'Début une mesure plus tôt', () => vocalEdit(r, (l) => { l[i].startBar = Math.max(0, l[i].startBar - 1); l[i].origin = 'user'; })),
                btn('+', 'Début une mesure plus tard', () => vocalEdit(r, (l) => { l[i].startBar += 1; l[i].origin = 'user'; }), seg.endBar - seg.startBar <= 1)),
              h('td', {}, `${fmtTime(seg.endSec)} · mes. ${seg.endBar + 1} `,
                btn('−', 'Fin une mesure plus tôt', () => vocalEdit(r, (l) => { l[i].endBar -= 1; l[i].origin = 'user'; }), seg.endBar - seg.startBar <= 1),
                btn('+', 'Fin une mesure plus tard', () => vocalEdit(r, (l) => { l[i].endBar += 1; l[i].origin = 'user'; }))),
              h('td', { class: 'muted' }, `${seg.endBar - seg.startBar} mes.`),
              h('td', {}, h('select', { 'aria-label': 'Présence de la voix', onchange: (e: Event) => vocalEdit(r, (l) => { l[i].strength = (e.target as HTMLSelectElement).value as VocalSegment['strength']; l[i].origin = 'user'; }) },
                h('option', { value: 'strong', selected: seg.strength === 'strong' }, 'nette'),
                h('option', { value: 'light', selected: seg.strength === 'light' }, 'faible / chœurs'))),
              h('td', {},
                btn('▶', 'Écouter le passage', () => { jump(seg.startSec); void audio.play(); }),
                btn('Cue', 'Créer un cue Vocal au début du passage', () => addCue(r, seg.startSec, 'vocal')),
                btn('✕', 'Supprimer le passage vocal', () => vocalEdit(r, (l) => { l.splice(i, 1); })),
                seg.origin === 'user' ? h('span', { class: 'pill', title: 'Modifié par vous' }, 'perso') : '',
              ),
            ))),
        )
      : h('p', { class: 'muted' }, 'Aucun passage vocal.'),
  );
}

function renderSections(r: AnalysisResult) {
  const s = r.sections ?? [];
  const ph = r.phrases;
  $('tab-sections').replaceChildren(
    h('p', { class: 'muted' },
      ph?.lengthBars
        ? `Phrases de ${ph.lengthBars} mesures (régularité ${Math.round(ph.regularity * 100)} %) — affichées en traits pleins sur la waveform.`
        : 'Pas de phrasé régulier détecté : aucune limite de phrase n’est affichée (pas d’hypothèse forcée).',
      ' Couplet / refrain ne sont pas proposés automatiquement. Les passages vocaux se corrigent plus bas.'),
    h('div', { class: 'hrow' },
      h('button', { type: 'button', class: 'btn small', onclick: () => sectionEdit(r, (list) => {
        const b = barOf(r, audio.currentTime);
        const host = list.find((x) => x.startBar < b && b < x.endBar);
        if (!host) return toast('Placez la lecture à l’intérieur d’une section');
        list.push({ ...host, id: newId('s'), startBar: b, label: 'Section', type: 'section', confidence: 'high', origin: 'user' });
      }) }, 'Scinder à la position de lecture'),
    ),
    h('table', { class: 'caps sections' },
      h('thead', {}, h('tr', {}, ...['Type', 'Nom', 'Début', 'Durée', 'Énergie', 'Confiance', ''].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, ...s.map((sec, i) =>
        h('tr', {},
          h('td', {}, h('select', { 'aria-label': 'Type de section', onchange: (e: Event) => sectionEdit(r, () => { sec.type = (e.target as HTMLSelectElement).value as SectionType; sec.label = SECTION_LABEL[sec.type]; }) },
            ...SECTION_TYPES.map((t) => h('option', { value: t, selected: t === sec.type }, SECTION_LABEL[t])))),
          h('td', {}, h('input', { type: 'text', value: sec.label, 'aria-label': 'Nom de la section', onchange: (e: Event) => sectionEdit(r, () => { sec.label = (e.target as HTMLInputElement).value; }) })),
          h('td', {},
            `${fmtTime(sec.startSec)} · mes. ${sec.startBar + 1} `,
            i > 0 ? h('button', { type: 'button', class: 'btn small ghost', 'aria-label': 'Début une mesure plus tôt', onclick: () => sectionEdit(r, () => { if (sec.startBar - 1 > s[i - 1].startBar) sec.startBar -= 1; }) }, '−') : '',
            i > 0 ? h('button', { type: 'button', class: 'btn small ghost', 'aria-label': 'Début une mesure plus tard', onclick: () => sectionEdit(r, () => { if (sec.startBar + 1 < sec.endBar) sec.startBar += 1; }) }, '+') : '',
            h('button', { type: 'button', class: 'btn small ghost', 'aria-label': 'Écouter', onclick: () => { jump(sec.startSec); void audio.play(); } }, '▶'),
          ),
          h('td', { class: 'muted' }, `${sec.endBar - sec.startBar} mes.`),
          h('td', {}, h('span', { class: 'meter' }, h('span', { style: { inlineSize: `${Math.round(sec.energy * 100)}%` } }))),
          h('td', {}, confBadge(sec.confidence)),
          h('td', {}, i > 0 ? h('button', { type: 'button', class: 'btn small ghost', 'aria-label': 'Supprimer (fusionner avec la section précédente)', onclick: () => sectionEdit(r, (list) => { list.splice(list.indexOf(sec), 1); }) }, '✕') : ''),
        ))),
    ),
    renderVocals(r),
  );
}

// ---------------------------------------------------------------- transition preview (A → B)
let tx: { stop: (msg?: string) => void; b: string } | null = null;

/** Plays the end of the current track into `b`: B tempo-matched (pitch kept), beats aligned, equal-power fade. */
async function previewTransition(a: AnalysisResult, b: AnalysisResult) {
  tx?.stop();
  const plan = planTransition(a, b);
  if ('error' in plan) return toast(plan.error, 6000);
  const el = new Audio(toFileUrl(b.path));
  el.preservesPitch = true;
  el.volume = 0;
  el.preload = 'auto';
  try {
    await new Promise<void>((res, rej) => {
      el.addEventListener('canplay', () => res(), { once: true });
      el.addEventListener('error', () => rej(new Error(String(el.error?.code ?? ''))), { once: true });
      el.currentTime = plan.inSec;
    });
  } catch (e) {
    return toast(`Lecture de « ${b.title} » impossible : ${playbackHelp(Number((e as Error).message) || 0)}`, 8000);
  }
  let started = false;
  let frame = 0;
  const stop = (msg?: string) => {
    cancelAnimationFrame(frame);
    el.pause();
    el.removeAttribute('src');
    audio.volume = 1;
    if (tx?.b === b.path) tx = null;
    if (msg) toast(msg);
    renderDetail();
  };
  tx = { stop, b: b.path };
  const tick = () => {
    const ta = audio.currentTime;
    if (audio.paused || ta >= plan.endASec || ta < plan.startASec - 1) {
      if (!audio.paused && ta >= plan.endASec) audio.pause();
      return stop();
    }
    if (ta >= plan.outSec) {
      const want = bTimeAt(plan, ta);
      if (!started) {
        el.currentTime = want;
        el.playbackRate = plan.rate;
        void el.play();
        started = true;
      } else {
        // keep B on A's beats: hard re-sync on a big jump, gentle tempo nudge otherwise
        const drift = el.currentTime - want;
        if (Math.abs(drift) > 0.12) el.currentTime = want;
        else el.playbackRate = plan.rate * (1 - Math.max(-0.02, Math.min(0.02, drift * 0.5)));
      }
      const g = fadeGains(plan, ta);
      audio.volume = g.a;
      el.volume = g.b;
    }
    frame = requestAnimationFrame(tick);
  };
  audio.volume = 1;
  jump(plan.startASec);
  try {
    await audio.play();
  } catch {
    return stop('Lecture impossible pour le moment');
  }
  frame = requestAnimationFrame(tick);
  toast(`Transition → ${b.title} · ${plan.notes.join(' · ')} · fondu ${plan.fadeBars} mesures · Espace : arrêter`, 9000);
  renderDetail();
}

// ---------------------------------------------------------------- tab: mix & compatibles
function renderMix(r: AnalysisResult) {
  const list = (title: string, items: NonNullable<AnalysisResult['mix']>['mixIn'], kind: CueKind) =>
    h('section', {},
      h('h3', {}, title),
      items.length
        ? h('ul', { class: 'mixlist' }, ...items.map((m) =>
            h('li', {},
              h('button', { type: 'button', class: 'btn small ghost', onclick: () => { jump(m.timeSec); void audio.play(); } }, `▶ ${fmtTime(m.timeSec)}`),
              confBadge(m.confidence),
              h('span', {}, m.reason),
              h('button', { type: 'button', class: 'btn small', onclick: () => addCue(r, m.timeSec, kind) }, 'Créer un cue'),
            )))
        : h('p', { class: 'muted' }, 'Aucune suggestion.'),
    );
  const matches = matchTracks(r, doneResults(), 8);
  $('tab-mix').replaceChildren(
    h('div', { class: 'cols' },
      list('Mix In', r.mix?.mixIn ?? [], 'mixin'),
      list('Mix Out', r.mix?.mixOut ?? [], 'mixout'),
      h('section', {},
        h('h3', {}, 'Morceaux compatibles'),
        matches.length
          ? h('ul', { class: 'mixlist' }, ...matches.map((m) =>
              h('li', {},
                h('button', { type: 'button', class: 'btn small ghost', onclick: () => select(m.path) }, `${m.title}${m.artist ? ` — ${m.artist}` : ''}`),
                h('span', { class: 'score' }, `${m.score}`),
                h('button', { type: 'button', class: 'btn small', title: 'Écouter la transition : fin de ce morceau → début de l’autre, tempo calé, temps alignés, fondu de 16 mesures',
                  onclick: () => {
                    if (tx?.b === m.path) { audio.pause(); return; }
                    const other = doneResults().find((x) => x.path === m.path);
                    if (other) void previewTransition(r, other);
                  } }, tx?.b === m.path ? '■ Arrêter' : '🎧 Transition'),
                h('span', { class: 'muted' }, m.reasons.join(' · ') + (m.cautions.length ? ` (⚠ ${m.cautions.join(', ')})` : '')),
              )))
          : h('p', { class: 'muted' }, 'Pas encore de morceau compatible dans la bibliothèque.'),
      ),
    ),
  );
}

// ---------------------------------------------------------------- tab: info
function vocalSummary(r: AnalysisResult): string | undefined {
  const v = r.vocals;
  if (!v) return undefined;
  if (!v.segments.length) return 'Aucune voix détectée';
  const strong = v.segments.filter((s) => s.strength === 'strong').length;
  const parts = v.segments.map((s) => `${fmtTime(s.startSec)}–${fmtTime(s.endSec)}${s.strength === 'strong' ? '' : ' (faible)'}`);
  return `${v.segments.length} passage(s), ${Math.round(v.coverage * 100)} % du morceau, ${strong} net(s) : ${parts.join(' · ')}`;
}

function renderInfo(r: AnalysisResult) {
  const row = (k: string, v: string | number | undefined | null) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, v === undefined || v === null || v === '' ? '—' : String(v)));
  const L = r.loudness;
  $('tab-info').replaceChildren(
    state.tracks.get(r.path)?.comparison
      ? h('button', { type: 'button', class: 'btn small', onclick: () => showComparison(r.path) }, 'Comparer la réanalyse…')
      : '',
    h('div', { class: 'cols' },
      h('section', {}, h('h3', {}, 'Métadonnées du fichier'),
        h('table', { class: 'caps kv' }, h('tbody', {},
          row('Fichier', r.fileName), row('Format', [r.container, r.codec].filter(Boolean).join(' · ') || r.kind), row('Sans perte', r.lossless === undefined ? undefined : r.lossless ? 'oui' : 'non'),
          row('Échantillonnage', `${r.sampleRate} Hz`), row('Débit', r.bitrate ? `${Math.round(r.bitrate / 1000)} kb/s` : undefined), row('Canaux', r.channels),
          row('Taille', `${(r.sizeBytes / 1048576).toFixed(1)} Mo`), row('Durée', fmtTime(r.durationSec)),
          row('Titre (tag)', r.title), row('Artiste', r.artist), row('Album', r.album), row('Genre', r.genre), row('Année', r.year),
          row('BPM déjà tagué', r.tagBpm), row('Clé déjà taguée', r.tagKey),
        ))),
      h('section', {}, h('h3', {}, 'Résultats d’analyse (estimations)'),
        h('table', { class: 'caps kv' }, h('tbody', {},
          row('Tempo', `${r.bpm.toFixed(2)} BPM${r.tempo ? ` (Essentia brut ${r.tempo.rawEstimate.toFixed(1)})` : ''}`),
          row('Stabilité', r.tempo ? (r.tempo.variable ? `variable ${r.tempo.localMin.toFixed(1)}–${r.tempo.localMax.toFixed(1)}` : `stable (${r.tempo.localMin.toFixed(2)}–${r.tempo.localMax.toFixed(2)})`) : undefined),
          row('Alternatives tempo', r.tempo?.alternatives.join(' · ')),
          row('Ajustement de la grille', `${Math.round(r.grid.confidence * 100)} % des attaques retenues alignées à ±12 ms`),
          row('Premier temps', `${r.grid.firstDownbeatSec.toFixed(3)} s`),
          row('Tonalité', `${r.key.musical} · ${r.key.camelot} · ${formatKey(r.key, 'openKey')}${r.key.ambiguous ? ' (ambiguë)' : ''}`),
          row('Alternatives tonalité', (r.key.alternatives ?? []).map((a) => `${keyLabel(a)} (${Math.round(a.weight * 100)} %)`).join(' · ')),
          row('Changement de tonalité', (r.key.changes ?? []).map((c) => `${keyLabel(c)} (${fmtTime(c.startSec)} → ${fmtTime(c.endSec)})`).join(' · ') || undefined),
          row('Loudness intégrée', L?.integratedLufs != null ? `${L.integratedLufs.toFixed(1)} LUFS` : undefined),
          row('Plage de loudness', L?.loudnessRangeLu != null ? `${L.loudnessRangeLu.toFixed(1)} LU` : undefined),
          row('True peak', L?.truePeakDbtp != null ? `${L.truePeakDbtp.toFixed(1)} dBTP` : undefined),
          row('RMS / crête', L ? `${L.rmsDb.toFixed(1)} dBFS · facteur de crête ${L.crestDb.toFixed(1)} dB` : undefined),
          row('Énergie estimée', r.energy ? `${r.energy.score}/10 (algorithmique, comparable dans cette bibliothèque)` : undefined),
          row('Voix', vocalSummary(r)),
          row('Moteur', `v${r.engineVersion ?? '?'} · ${(r.analysisMs / 1000).toFixed(1)} s${state.tracks.get(r.path)?.cached ? ' · depuis le cache' : ''}`),
        ))),
    ),
    h('div', { class: 'hrow' },
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => api.revealInFolder(r.path) }, 'Afficher le fichier'),
      h('button', { type: 'button', class: 'btn small ghost', onclick: async () => { latestComparison = await api.reanalyze([r.path], true); } }, 'Ré-analyser sans cache (corrections conservées)'),
    ),
    referenceBlock(r),
  );
}

// ---------------------------------------------------------------- reference annotations (spec §21)
function referenceBlock(r: AnalysisResult): HTMLElement {
  const saved = r.fileHash ? state.references[r.fileHash] : undefined;
  const rating = h('select', { 'aria-label': 'Votre ressenti d’énergie (optionnel)' },
    h('option', { value: '' }, 'Énergie ressentie : —'),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => h('option', { value: String(v) }, `Énergie ressentie : ${v}/10`)));
  const count = Object.keys(state.references).length;
  return h('section', { class: 'set' },
    h('h3', {}, 'Référence de qualité'),
    h('p', { class: 'muted' },
      'Quand ce morceau est vérifié à l’oreille et corrigé (BPM, temps 1, clé, cues, sections), enregistrez-le comme référence. ',
      '« npm run eval » ré-analyse ensuite les références sans vos corrections et mesure la justesse du moteur.'),
    saved ? h('p', {}, `✓ Référence enregistrée le ${new Date(saved).toLocaleString('fr-FR')}`) : null,
    h('div', { class: 'hrow' },
      rating,
      h('button', {
        type: 'button', class: 'btn small',
        onclick: async () => {
          state.references = await api.saveReference(r.path, rating.value ? Number(rating.value) : undefined);
          toast('Référence enregistrée : elle servira à évaluer le moteur');
          renderDetail();
        },
      }, saved ? 'Mettre à jour la référence' : '✓ Valider comme référence'),
      h('span', { class: 'muted' }, `${count} référence${count > 1 ? 's' : ''} au total`),
      count ? h('button', {
        type: 'button', class: 'btn small ghost',
        onclick: async () => {
          const res = await api.exportReferences();
          if (res.ok) toast(`Références exportées : ${res.file}`);
        },
      }, 'Exporter…') : null,
    ),
  );
}

// ===================================================================== events & wiring
function setTab(id: string) {
  activeTab = id;
  for (const t of ['cues', 'loops', 'sections', 'mix', 'info']) {
    $(`t-${t}`).setAttribute('aria-selected', String(t === id));
    $(`tab-${t}`).hidden = t !== id;
  }
  renderDetail();
}
for (const t of ['cues', 'loops', 'sections', 'mix', 'info']) $(`t-${t}`).addEventListener('click', () => setTab(t));

// corrections → re-analysis with overrides (edits kept)
function override(ov: Parameters<typeof api.setOverrides>[1], label: string) {
  stopAudition();
  const r = current();
  if (!r || isBusy(state.tracks.get(r.path))) return;
  void api.setOverrides(r.path, ov);
  toast(`${label} — ré-analyse en cours (vos cues sont conservés)`);
}
$('bpm-input').addEventListener('change', (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  if (v >= 40 && v <= 260) override({ bpm: v }, `BPM fixé à ${v}`);
});
$('bpm-half').addEventListener('click', () => current() && override({ bpm: current()!.bpm / 2 }, 'BPM ÷2'));
$('bpm-double').addEventListener('click', () => current() && override({ bpm: current()!.bpm * 2 }, 'BPM ×2'));
$('grid-here').addEventListener('click', () => current() && override({ bpm: current()!.bpm, firstDownbeatSec: audio.currentTime }, 'Temps 1 placé à la lecture'));
$('grid-minus').addEventListener('click', () => current() && override({ bpm: current()!.bpm, firstDownbeatSec: current()!.grid.firstDownbeatSec - 0.01 }, 'Grille −10 ms'));
$('grid-plus').addEventListener('click', () => current() && override({ bpm: current()!.bpm, firstDownbeatSec: current()!.grid.firstDownbeatSec + 0.01 }, 'Grille +10 ms'));
$('grid-beat').addEventListener('click', () => current() && override({ bpm: current()!.bpm, firstDownbeatSec: current()!.grid.firstDownbeatSec + 60 / current()!.bpm }, 'Temps 1 décalé d’un temps'));
$('key-select').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value;
  override({ key: (v || null) as string }, v ? `Clé fixée à ${v}` : 'Clé automatique');
});

// transport
/**
 * Playback errors: the first time, the file is simply reloaded (on a first launch macOS may still have
 * been asking for folder access). If it fails again, say why instead of blaming the format.
 */
let audioRetried = '';
const MEDIA_ERR: Record<number, string> = {
  1: 'lecture interrompue',
  2: 'fichier inaccessible (dossier protégé par macOS ou fichier déplacé ?)',
  3: 'décodage impossible',
  4: 'format non pris en charge par le lecteur',
};
function playbackHelp(code: number): string {
  const access = code === 2 || code === 4;
  const mac = navigator.userAgent.includes('Mac');
  return (
    `Lecture impossible : ${MEDIA_ERR[code] ?? 'erreur inconnue'}.` +
    (access && mac ? ' Vérifiez Réglages Système › Confidentialité et sécurité › Fichiers et dossiers › CueKoda, puis relancez l’app.' : '') +
    ' L’analyse et l’export restent valides.'
  );
}
audio.addEventListener('error', () => {
  const r = current();
  if (!r || !audio.error) return;
  if (audioRetried !== r.path) {
    audioRetried = r.path;
    const t = audio.currentTime;
    audio.src = toFileUrl(r.path);
    audio.load();
    if (t) audio.currentTime = t;
    return;
  }
  toast(playbackHelp(audio.error.code), 10000);
});
audio.addEventListener('canplay', () => {
  audioRetried = '';
});

function togglePlay() {
  if (!current()) return;
  if (audio.paused) {
    audio.play().catch(() => {
      // the 'error' handler retries once and explains; only report here if no media error is pending
      if (!audio.error) toast('Lecture impossible pour le moment — réessayez dans un instant', 6000);
    });
  } else audio.pause();
}
$('btn-play').addEventListener('click', togglePlay);
let metronomeWanted = false;
let audition: { end: number; beats: readonly GridBeat[]; source: 'review' | 'comparison' } | undefined;
let auditionRequest = 0;
const setClickTrack = metronome(audio, () => audition?.beats ?? wave.beats, () => !!tx);

function stopAudition(source?: 'review' | 'comparison') {
  if (source && audition?.source !== source) return;
  auditionRequest++;
  if (!audition) return;
  audition = undefined;
  $('review-stop').hidden = true;
  audio.pause();
  void setClickTrack(metronomeWanted);
}

async function playAudition(beats: readonly GridBeat[], durationSec: number, around: number, source: 'review' | 'comparison') {
  stopAudition();
  tx?.stop();
  loopPlay = null;
  const { start, end } = gridAudition(beats, durationSec, around);
  const request = ++auditionRequest;
  audio.pause();
  audio.currentTime = start;
  audition = { end, beats, source };
  $('review-stop').hidden = source !== 'review';
  try {
    await Promise.all([setClickTrack(true), audio.play()]);
  } catch {
    if (request === auditionRequest) {
      stopAudition();
      toast('Écoute indisponible');
    }
  }
}

$('btn-metronome').addEventListener('click', async () => {
  metronomeWanted = !metronomeWanted;
  try {
    await setClickTrack(metronomeWanted || !!audition);
    $('btn-metronome').setAttribute('aria-pressed', String(metronomeWanted));
  } catch {
    metronomeWanted = false;
    $('btn-metronome').setAttribute('aria-pressed', 'false');
    toast('Métronome indisponible');
  }
});
audio.addEventListener('ended', () => stopAudition());
audio.addEventListener('timeupdate', () => {
  if (audition && audio.currentTime >= audition.end) stopAudition();
});

const reviewPanel = $('quick-review');
function firstDrop(r: AnalysisResult) {
  const drops = r.cues.filter(({ kind }) => kind === 'drop').map(({ timeSec }) => timeSec);
  return drops.length ? Math.min(...drops) : r.sections?.find(({ type }) => type === 'drop')?.startSec;
}
function playReview(where: 'intro' | 'drop' | 'tail') {
  const r = current();
  if (!r || state.tracks.get(r.path)?.missing) return;
  const around = where === 'intro' ? r.cues.find((c) => c.kind === 'intro')?.timeSec ?? r.grid.firstDownbeatSec
    : where === 'tail' ? r.durationSec - 16 * 60 / r.bpm : firstDrop(r);
  if (around !== undefined) void playAudition(wave.beats, r.durationSec, around, 'review');
}
$('btn-quick-review').addEventListener('click', () => {
  reviewPanel.hidden = !reviewPanel.hidden;
  $('btn-quick-review').setAttribute('aria-expanded', String(!reviewPanel.hidden));
  if (reviewPanel.hidden) stopAudition('review');
  else reviewPanel.focus();
});
for (const where of ['intro', 'drop', 'tail'] as const) $('review-' + where).addEventListener('click', () => playReview(where));
$('review-stop').addEventListener('click', () => { stopAudition('review'); reviewPanel.focus(); });
$('review-shift').addEventListener('click', () => $('grid-beat').click());
$('review-set').addEventListener('click', () => $('grid-here').click());
$('review-accept').addEventListener('click', () => void validateAndNext());
reviewPanel.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const actions: Record<string, string> = { '1': 'review-intro', '2': 'review-drop', '3': 'review-tail',
    t: 'review-set', v: 'review-accept', ']': 'grid-plus', '[': 'grid-minus' };
  const action = actions[e.key.toLowerCase()];
  if (action) { e.preventDefault(); e.stopPropagation(); $(action).click(); }
  if (e.key === 'Escape') { e.stopPropagation(); $('btn-quick-review').click(); $('btn-quick-review').focus(); }
});

let latestComparison: number | undefined;
let refreshComparison: (() => void) | undefined;
function showComparison(path?: string) {
  stopAudition();
  refreshComparison = openComparison({
    path,
    batch: path ? undefined : latestComparison,
    listen: (trackPath, point, at) => {
      if (state.tracks.get(trackPath)?.missing) return toast('Fichier introuvable à cet emplacement');
      select(trackPath);
      void playAudition(gridBeats(point), point.durationSec, at, 'comparison');
    },
    stop: () => stopAudition('comparison'),
  });
}
$('btn-comparison').addEventListener('click', () => showComparison());

let raf = 0;
function loop() {
  if (audition && audio.currentTime >= audition.end) stopAudition();
  if (loopPlay && current()) {
    const end = loopPlay.startSec + loopPlay.beats * beatOf(current()!);
    if (audio.currentTime >= end) audio.currentTime = loopPlay.startSec;
  }
  if (wave.follow(audio.currentTime)) redrawWave();
  else updatePlayheads();
  raf = audio.paused ? 0 : requestAnimationFrame(loop);
}
audio.addEventListener('play', () => {
  setText($('btn-play'), '❚❚ Pause');
  if (!raf) raf = requestAnimationFrame(loop);
});
audio.addEventListener('pause', () => setText($('btn-play'), '▶︎ Lecture'));
audio.addEventListener('seeked', updatePlayheads);
$('btn-help').addEventListener('click', openHelp);
$('zoom-in').addEventListener('click', () => wave.zoom(2, audio.currentTime));
$('zoom-out').addEventListener('click', () => wave.zoom(0.5, audio.currentTime));
$('zoom-fit').addEventListener('click', () => wave.fit());
$('overview').addEventListener('click', (e) => {
  const r = current();
  if (!r) return;
  const rect = (e.target as HTMLElement).getBoundingClientRect();
  const t = ((e.clientX - rect.left) / rect.width) * r.durationSec;
  const span = wave.end - wave.start;
  wave.start = Math.max(0, t - span / 2);
  wave.end = wave.start + span;
  wave.pan(0);
  jump(t);
});
new ResizeObserver(() => redrawWave()).observe($('overview'));
function redrawTheme() { clearTokenCache(); redrawWave(); }
new MutationObserver(redrawTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawTheme);

// undo / redo
function restoreEdit(direction: 'undo' | 'redo') {
  const change = history[direction]();
  if (!change) return updateUndo();
  const { r, previous } = change;
  if (persist(r, previous)) announce(direction === 'undo' ? 'Modification annulée' : 'Modification rétablie');
  refreshTrack(r.path);
}

const undo = () => restoreEdit('undo');
const redo = () => restoreEdit('redo');
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);

// keyboard
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  const typing = t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
  const mod = e.metaKey || e.ctrlKey;
  const inLibrary = !!t.closest('#list-wrap');
  if (t.closest('.action-popover') || document.querySelector('dialog[open]')) return;
  if (mod && (!typing || t === selectAll || t.matches('#rows input[type=checkbox]'))
    && (inLibrary || t === document.body) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    markAllVisible(true);
    return;
  }
  if (inLibrary && (e.key === 'Delete' || e.key === 'Backspace')) {
    e.preventDefault();
    if (!e.repeat) void removeSelected();
    return;
  }
  if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); if (doneResults().length) exportCurrentView(); return; }
  if (mod && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    search.focus();
    search.select();
    return;
  }
  if (typing || mod) return;
  const r = current();
  const selCue = r?.cues.find((c) => c.id === wave.selectedCueId);
  if (e.code === 'Space') {
    if (t.tagName === 'BUTTON') return;
    e.preventDefault();
    togglePlay();
  } else if (/^Digit[1-8]$/.test(e.code) && r) {
    const slot = Number(e.code.slice(5)) - 1;
    if (e.shiftKey) setCueAt(r, slot, audio.currentTime);
    else {
      const c = r.cues.find((x) => x.slot === slot);
      if (c) { jump(c.timeSec); void audio.play(); }
    }
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && r) {
    e.preventDefault();
    const step = (e.shiftKey ? 1 : 4) * (e.key === 'ArrowLeft' ? -1 : 1);
    jump(wave.stepBeats(audio.currentTime, step));
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const focused = t.closest<HTMLElement>('tr.row')?.dataset.track;
    const path = focused ?? state.selected;
    const index = path ? visibleIndex.get(path) : undefined;
    if (e.shiftKey && selectionAnchor === null) selectionAnchor = path;
    const next = visibleRecords[Math.max(0, (index ?? -1) + (e.key === 'ArrowDown' ? 1 : -1))]?.path;
    if (next) { chooseTrack(next, e); rowEls.get(next)?.focus(); }
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && r && selCue) {
    e.preventDefault();
    deleteCue(r, selCue);
  } else if ((e.key === ',' || e.key === '.' || e.key === '<' || e.key === '>' || e.key === ';' || e.key === ':') && r && selCue) {
    moveCue(r, selCue, (e.key === ',' || e.key === '<' || e.key === ';' ? -1 : 1) * (e.shiftKey ? 4 : 1));
  } else if ((e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'm') && r) {
    const sel = $('tab-cues').querySelector<HTMLSelectElement>('select.new-cue-kind');
    addCue(r, audio.currentTime, (sel?.value as CueKind) || 'custom', e.key.toLowerCase() === 'm');
    setTab('cues');
  } else if (e.key.toLowerCase() === 'l' && r) {
    addLoop(r, 16);
    setTab('loops');
  } else if (e.key === '+' || e.key === '=') wave.zoom(2, audio.currentTime);
  else if (e.key === '-') wave.zoom(0.5, audio.currentTime);
  else if (e.key === '0') wave.fit();
  else if (e.key === '?') openHelp();
});

// library tools
const search = $<HTMLInputElement>('search');
const viewSelect = $<HTMLSelectElement>('lib-view');

function updateSearch() {
  const query = searchText(search.value).trim();
  searchTerms = query ? query.split(/\s+/) : [];
  renderLibrary();
}

function adjacentTrack(direction: -1 | 1) {
  const from = state.selected ? visibleIndex.get(state.selected) : undefined;
  const start = from ?? (direction === 1 ? -1 : visibleRecords.length);
  for (let i = start + direction; i >= 0 && i < visibleRecords.length; i += direction) {
    const rec = state.tracks.get(visibleRecords[i].path);
    if (rec?.result && !rec.missing && rec.status !== 'error') return rec.path;
  }
}

function updateTransport() {
  $<HTMLButtonElement>('btn-prev-track').disabled = !adjacentTrack(-1);
  const next = adjacentTrack(1);
  $<HTMLButtonElement>('btn-next-track').disabled = !next;
  const selected = state.selected ? state.tracks.get(state.selected) : undefined;
  const canReview = selected?.status === 'done' && !!selected.result && !selected.missing;
  $<HTMLButtonElement>('btn-review-next').disabled = !canReview;
  $<HTMLButtonElement>('review-accept').disabled = !canReview;
  $<HTMLButtonElement>('review-shift').disabled = !canReview;
  $<HTMLButtonElement>('review-set').disabled = !canReview;
  $<HTMLButtonElement>('review-drop').disabled = !selected?.result || firstDrop(selected.result) === undefined;
  for (const id of ['btn-review-next', 'review-accept']) setText($(id), next ? 'Valider et passer au suivant' : 'Valider le morceau');
}

for (const [id, direction] of [['btn-prev-track', -1], ['btn-next-track', 1]] as const) {
  $(id).addEventListener('click', () => {
    const target = adjacentTrack(direction);
    if (target) select(target);
  });
}

search.addEventListener('input', updateSearch);
function updateCrateView() {
  const crate = state.crates.find((item) => item.id === activeCrate);
  activeCrate = crate?.id;
  crateOrder = new Map(crate?.paths.map((path, i) => [path, i]));
  const base = ['all', 'review', 'missing'] as const;
  viewSelect.replaceChildren(
    ...base.map((value, i) => h('option', { value }, ['Tous', 'À vérifier', 'Fichiers introuvables'][i])),
    ...(state.crates.length ? [h('optgroup', { label: tr('Bacs de préparation') },
      ...state.crates.map((item) => h('option', { value: `crate:${item.id}` }, document.createTextNode(item.name))),
    )] : []),
  );
  viewSelect.value = activeCrate ? `crate:${activeCrate}` : libView;
  setText($('btn-remove'), activeCrate ? 'Retirer du bac' : 'Retirer');
  renderLibrary();
}

function applyCrates(crates: PrepCrate[]) {
  state.crates = crates;
  updateCrateView();
}

function showCrates() {
  openCrates({
    selected: selectedInViewOrder(),
    active: activeCrate,
    update: applyCrates,
    show: (id) => {
      activeCrate = id;
      libView = 'all';
      search.value = '';
      searchTerms = [];
      sortKey = '';
      updateCrateView();
      if (visibleRecords[0]) chooseTrack(visibleRecords[0].path);
    },
    export: (crate) => openExport(null, { ...crate, source: 'crate' }),
  });
}

function exportCurrentView() {
  const crate = state.crates.find((item) => item.id === activeCrate);
  const paths = selectedInViewOrder();
  openExport(state.selected, crate ? { ...crate, source: 'crate' } : undefined, paths.length > 1 ? paths : []);
}

viewSelect.addEventListener('change', () => {
  const value = viewSelect.value;
  activeCrate = value.startsWith('crate:') ? value.slice(6) : undefined;
  libView = activeCrate ? 'all' : value as typeof libView;
  if (activeCrate) sortKey = '';
  updateCrateView();
});
$('clear-filters').addEventListener('click', () => {
  search.value = '';
  libView = 'all';
  activeCrate = undefined;
  searchTerms = [];
  updateCrateView();
  search.focus();
});
$('btn-reviewed').addEventListener('click', async () => {
  const rec = state.selected ? state.tracks.get(state.selected) : undefined;
  if (!rec) return;
  await api.setReviewed([rec.path], !rec.reviewedAt);
});
async function validateAndNext() {
  const path = state.selected;
  const next = adjacentTrack(1);
  const rec = path ? state.tracks.get(path) : undefined;
  if (!path || rec?.status !== 'done' || rec.missing) return;
  stopAudition('review');
  await api.setReviewed([path], true);
  if (next && state.selected === path && state.tracks.has(next)) select(next);
  if (!reviewPanel.hidden) reviewPanel.focus();
}
$('btn-review-next').addEventListener('click', () => void validateAndNext());
$('btn-import').addEventListener('click', async () => {
  const s = await api.importCollection();
  if (s.canceled) return;
  if (!s.ok) return toast(`Import impossible : ${s.error ?? ''}`);
  toast(`Collection ${s.source} : ${s.matched} morceau(x), ${s.cues} cue(s) importé(s) et verrouillé(s)${s.added ? `, ${s.added} ajouté(s) à l’analyse` : ''}${s.notFound ? ` · ${s.notFound} introuvable(s) sur cet ordinateur` : ''}`, 7000);
});
document.querySelectorAll<HTMLElement>('th[data-sort]').forEach((th) => {
  th.tabIndex = 0;
  const go = () => { const k = th.dataset.sort!; sortDir = sortKey === k ? -sortDir : 1; sortKey = k; renderLibrary(); };
  th.addEventListener('click', go);
  th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
});
$('btn-order').addEventListener('click', () => {
  // the tracks currently shown (filter applies), analysed ones only
  const shown = new Set(visibleRecords.map(({ path }) => path));
  const tracks = doneResults().filter((r) => shown.has(r.path));
  if (tracks.length < 2) return toast('Il faut au moins 2 morceaux analysés affichés');
  openSetOrder({
    tracks,
    listen: (a, b) => {
      if (state.selected !== a.path) select(a.path);
      void previewTransition(a, b);
    },
    show: (p) => select(p),
    stop: () => { tx?.stop(); audio.pause(); },
  });
});
selectAll.addEventListener('change', () => markAllVisible(selectAll.checked));

async function reanalyzeSelected() {
  const paths = selectedPaths().filter((p) => !state.tracks.get(p)?.missing && !isBusy(state.tracks.get(p)));
  if (!paths.length) return;
  if (paths.length > 1 && !confirm(tr(`Ré-analyser ${paths.length} morceaux avec le profil actuel ? Vos cues modifiés ou verrouillés sont conservés.`))) return;
  latestComparison = await api.reanalyze(paths, true);
}

let removing = false;
async function removeSelected() {
  const paths = selectedPaths();
  if (!paths.length || removing) return;
  if (activeCrate) {
    removing = true;
    try { applyCrates((await api.updateCrates({ type: 'remove', id: activeCrate, paths })).crates); }
    catch { toast('Impossible d’enregistrer le bac.'); }
    finally { removing = false; }
    return;
  }
  const message = paths.length === 1
    ? 'Retirer ce morceau de la bibliothèque CueKoda ? Le fichier audio n’est pas supprimé.'
    : `Retirer ${paths.length} morceaux de la bibliothèque ? Les fichiers audio sont conservés.`;
  if (!confirm(tr(message))) return;
  const selected = state.selected;
  const removed = new Set(paths);
  removing = true;
  try {
    await api.removeTracks(paths);
    for (const p of paths) {
      state.tracks.delete(p);
      rowEls.delete(p);
      markedPaths.delete(p);
    }
    if (selected && state.selected === selected && removed.has(selected)) select(null);
    renderLibrary();
    selectAll.focus({ preventScroll: true });
  } finally {
    removing = false;
  }
}
$('btn-reanalyze').addEventListener('click', () => void reanalyzeSelected());
$('btn-remove').addEventListener('click', () => void removeSelected());

// Close the overflow before opening a secondary dialog.
$('main-more').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('button')) $('main-more').hidePopover();
});

// header
async function addPaths(paths: string[]) {
  if (!paths.length) return;
  const added = await api.addPaths(paths);
  toast(added.length ? `${added.length} fichier(s) ajouté(s) à la file d’analyse` : 'Aucun nouveau fichier audio (déjà dans la bibliothèque ?)');
}
$('btn-files').addEventListener('click', async () => addPaths(await api.pick('files')));
$('btn-folder').addEventListener('click', async () => addPaths(await api.pick('folder')));
$('btn-pause').addEventListener('click', () => void (state.queue.paused ? api.resume() : api.pause()));
$('btn-cancel').addEventListener('click', () => void api.cancel());
$('btn-retry').addEventListener('click', () => void api.retryErrors());
$('btn-export').addEventListener('click', exportCurrentView);
$('btn-crates').addEventListener('click', showCrates);
$('btn-dupes').addEventListener('click', openDuplicates);
$('btn-settings').addEventListener('click', () => openSettings(() => { fillProfiles(); renderDetail(); }));
$('profile').addEventListener('change', async (e) => {
  state.settings = await api.setSettings({ profileId: (e.target as HTMLSelectElement).value });
  toast('Profil appliqué aux prochaines analyses — « Ré-analyser » pour l’appliquer aux morceaux existants');
});

function fillProfiles() {
  $('profile').replaceChildren(...allProfiles().map((p) => h('option', { value: p.id, selected: p.id === state.settings.profileId }, p.name)));
}

const keyNotation = $<HTMLSelectElement>('key-notation');
keyNotation.addEventListener('change', async () => {
  const notation = keyNotation.value === 'openKey' ? 'openKey' : 'camelot';
  keyNotation.disabled = true;
  try {
    state.settings = await api.setSettings({ keyNotation: notation });
    for (const [path, row] of rowEls) {
      const track = state.tracks.get(path);
      if (track) renderRow(track, row);
    }
    renderLibrary();
    renderDetail();
  } catch {
    keyNotation.value = state.settings.keyNotation ?? 'camelot';
    toast('Impossible d’enregistrer la notation de tonalité.');
  } finally {
    keyNotation.disabled = false;
  }
});

// drag & drop
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('dropmask').hidden = false; });
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) $('dropmask').hidden = true; });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropmask').hidden = true;
  void addPaths(api.pathsForFiles(Array.from(e.dataTransfer?.files ?? [])));
});

// ===================================================================== boot
async function boot() {
  initToast();
  const s = await api.init();
  state.settings = s.settings;
  keyNotation.value = s.settings.keyNotation === 'openKey' ? 'openKey' : 'camelot';
  setLang(resolveLang(s.settings.language, navigator.language));
  document.documentElement.lang = resolveLang(s.settings.language, navigator.language);
  translateDom(document.body);
  state.builtinProfiles = s.builtinProfiles;
  state.adapters = s.adapters;
  state.learning = s.learning;
  state.cores = s.cores;
  state.references = s.references ?? {};
  state.queue = s.queue;
  state.appVersion = s.appVersion;
  state.appBuild = s.appBuild;
  state.update = s.update;
  renderUpdateBadge();
  api.onUpdate((u) => {
    state.update = u;
    renderUpdateBadge();
    if (u.state === 'error' && u.message) toast(u.message, 6000);
  });
  applyTheme(s.settings.theme ?? 'dark');
  for (const t of s.tracks) state.tracks.set(t.path, t);
  fillProfiles();
  applyCrates(s.crates ?? []);
  api.onCrates(applyCrates);
  onQueue();
  const first = s.tracks.find((t) => t.result);
  if (first && visibleIndex.has(first.path)) chooseTrack(first.path);

  api.onTrack(({ path, record }) => {
    const prev = state.tracks.get(path);
    // progress events carry no result: keep the previous one on screen meanwhile
    const merged: TrackRecord = { ...record, result: record.result ?? prev?.result };
    state.tracks.set(path, merged);
    if (prev) renderRow(merged);
    const needsSort = !!prev && sortKey && sortValue(prev) !== sortValue(merged);
    if (!prev || needsSort || matchesFilter(prev) !== matchesFilter(merged)) scheduleLibrary();
    if (prev?.status !== merged.status || prev?.missing !== merged.missing || record.result !== undefined) {
      updateGlobalButtons();
      updateTransport();
      if ((prev?.missing !== merged.missing || prev?.status !== merged.status) && markedPaths.has(path)) syncTrackSelection();
    }
    onQueue(); // the header names the track being analysed and its stage
    if (record.result && path === state.selected) {
      if (audioPath !== path) select(path); // first result of a track selected while pending
      else {
        wave.set(merged.result!, true);
        renderDetail();
      }
    } else if (path === state.selected) {
      if (prev?.status !== merged.status || prev?.missing !== merged.missing || prev?.reviewedAt !== merged.reviewedAt) renderDetail();
      else renderBusy(merged);
    }
    if (record.result && !state.selected) {
      if (visibleIndex.has(path) && !markedPaths.size) chooseTrack(path);
      else select(path);
    }
  });
  api.onQueue((q) => { state.queue = q; onQueue(); });
  api.onSummary((sum) => {
    refreshComparison?.();
    const parts = [`${sum.done} analysé(s)`];
    if (sum.cached) parts.push(`${sum.cached} depuis le cache`);
    if (sum.errors) parts.push(`${sum.errors} erreur(s)`);
    if (sum.cancelled) parts.push(`${sum.cancelled} annulé(s)`);
    toast(`Analyse terminée : ${parts.join(', ')} en ${(sum.durationMs / 1000).toFixed(0)} s`, 7000);
    updateGlobalButtons();
  });
  api.onRemoved(({ path: p, movedTo }) => {
    state.tracks.delete(p);
    rowEls.delete(p);
    if (state.selected === p) select(movedTo ?? null);
    if (movedTo) toast(`Fichier retrouvé : ${movedTo.split(/[\\/]/).pop()} — vos corrections le suivent`);
    renderLibrary();
    renderDetail();
  });
  api.onWatch((w) => toast(`${w.level === 'error' ? '⚠ ' : ''}${w.message} (${w.folder})`, w.level === 'error' ? 8000 : 3000));
}
void boot();
