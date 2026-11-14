import type { AnalysisResult, CueKind, HotCue, Loop, Section, SectionType } from '../core/types';
import { allKeys } from '../core/key';
import { CUE_KIND_LABEL, DEFAULT_COLORS } from '../core/profiles';
import { SECTION_LABEL } from '../core/structure';
import { matchTracks } from '../core/matching';
import type { TrackRecord } from '../shared/api';
import { allProfiles, api, applyTheme, doneResults, history, state } from './state';
import { WaveView, drawOverview } from './waveform';
import { openDuplicates, openExport, openHelp, openSettings } from './dialogs';
import {
  $, announce, camelotColor, clearTokenCache, confBadge, fmtBpm, fmtDur, fmtTime, h, hexOf, initToast, LETTERS, rgb, rgbOf, toast, toFileUrl, worst,
} from './util';

const audio = $<HTMLAudioElement>('audio');
const rowEls = new Map<string, HTMLTableRowElement>();
let sortKey = '';
let sortDir = 1;
let filter = '';
let activeTab = 'cues';
let loopPlay: Loop | null = null;
let batchTotal = 0;

const current = (): AnalysisResult | null => {
  const r = state.selected ? state.tracks.get(state.selected) : null;
  return r?.result ?? null;
};

// ===================================================================== persistence of edits
const saveTimers = new Map<string, number>();
function persist(r: AnalysisResult) {
  window.clearTimeout(saveTimers.get(r.path));
  saveTimers.set(r.path, window.setTimeout(() => void api.saveTrack(r), 300));
}

/** Every manual edit goes through here: undo snapshot → change → save → redraw. */
function edit(r: AnalysisResult, change: () => void) {
  history.push(r);
  change();
  persist(r);
  refreshTrack(r.path);
}

function refreshTrack(path: string) {
  const rec = state.tracks.get(path);
  if (rec) renderRow(rec);
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

function matchesFilter(rec: TrackRecord) {
  if (!filter) return true;
  const r = rec.result;
  const hay = [rec.fileName, r?.title, r?.artist, r?.key.camelot, r?.key.musical, r ? fmtBpm(r.bpm) : ''].join(' ').toLowerCase();
  return filter.split(/\s+/).every((w) => hay.includes(w));
}

function sortValue(rec: TrackRecord): string | number {
  const r = rec.result;
  switch (sortKey) {
    case 'title': return (r?.title ?? rec.fileName).toLowerCase();
    case 'artist': return (r?.artist ?? '').toLowerCase();
    case 'bpm': return r?.bpm ?? 0;
    case 'key': return r?.key.camelot ? parseInt(r.key.camelot, 10) * 2 + (r.key.camelot.endsWith('B') ? 1 : 0) : 99;
    case 'energy': return r?.energy?.score ?? 0;
    case 'cues': return r?.cues.length ?? 0;
    case 'conf': return r ? { high: 0, medium: 1, low: 2 }[overallConfidence(r)] : 3;
    case 'duration': return r?.durationSec ?? 0;
    default: return rec.addedAt;
  }
}

function renderLibrary() {
  const recs = [...state.tracks.values()].filter(matchesFilter);
  recs.sort((a, b) => {
    const x = sortValue(a), y = sortValue(b);
    return (x < y ? -1 : x > y ? 1 : 0) * (sortKey ? sortDir : 1);
  });
  const body = $('rows');
  const frag = document.createDocumentFragment();
  for (const rec of recs) {
    let tr = rowEls.get(rec.path);
    if (!tr) {
      tr = h('tr', { class: 'row', tabIndex: 0 });
      const p = rec.path;
      tr.addEventListener('click', () => select(p));
      tr.addEventListener('dblclick', () => api.revealInFolder(p));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); select(p); }
      });
      rowEls.set(rec.path, tr);
      renderRow(rec, tr);
    }
    frag.append(tr);
  }
  body.replaceChildren(frag);
  const total = state.tracks.size;
  $('empty').hidden = total > 0;
  $('tracks').hidden = total === 0;
  $('lib-count').textContent = total ? `${recs.length} / ${total} morceau${total > 1 ? 'x' : ''}` : '';
  document.querySelectorAll<HTMLElement>('th[data-sort]').forEach((th) => {
    th.setAttribute('aria-sort', th.dataset.sort === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none');
  });
  updateGlobalButtons();
}

const td = (text: string | Node, cls = '') => h('td', { class: cls }, text);

function renderRow(rec: TrackRecord, tr = rowEls.get(rec.path)) {
  if (!tr) return;
  tr.replaceChildren();
  if (rec.path === state.selected) tr.setAttribute('aria-current', 'true');
  else tr.removeAttribute('aria-current');
  const r = rec.result;
  const warn = rec.status === 'done' && (r?.warnings.length ?? 0) > 0;
  const stateText =
    rec.status === 'analyzing' ? `Analyse ${Math.round((rec.progress ?? 0) * 100)} % (${rec.stage ?? ''})`
      : rec.status === 'queued' ? 'En attente'
        : rec.status === 'error' ? `Erreur : ${rec.error ?? ''}`
          : rec.status === 'cancelled' ? 'Annulé'
            : warn ? `À vérifier : ${r!.warnings.join(' ; ')}` : rec.cached ? 'Analysé (cache)' : 'Analysé';
  tr.append(td(h('span', {}, h('span', { class: `dot ${warn ? 'warn' : rec.status}`, title: stateText }), h('span', { class: 'sr-only' }, stateText)), 'c-state'));

  if (r && rec.status !== 'error') {
    const reanalysing = rec.status !== 'done';
    tr.append(
      td(h('span', {}, r.title, reanalysing ? h('span', { class: 'muted' }, ` — ${stateText}`) : '')),
      td(r.artist, 'muted'),
      td(h('span', {}, fmtBpm(r.bpm), r.tempo ? confBadge(r.tempo.confidence, true) : ''), 'c-num'),
      td(r.key.camelot
        ? h('span', { class: 'key', style: { background: camelotColor(r.key.camelot) }, title: `${r.key.musical} · Open Key ${r.key.openKey}${r.key.ambiguous ? ' · ambiguë' : ''}` }, r.key.camelot + (r.key.ambiguous ? '?' : ''))
        : '—', 'c-key'),
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
    tr.append(td(rec.fileName), td(h('span', { class: rec.status === 'error' ? 'err' : 'muted' }, stateText), ''));
    (tr.lastChild as HTMLTableCellElement).colSpan = 8;
  }
}

function updateGlobalButtons() {
  const done = doneResults().length;
  $<HTMLButtonElement>('btn-export').disabled = done === 0;
  const failed = [...state.tracks.values()].filter((r) => r.status === 'error' || r.status === 'cancelled').length;
  const retry = $<HTMLButtonElement>('btn-retry');
  retry.hidden = failed === 0;
  retry.textContent = `↻ Relancer ${failed} échec${failed > 1 ? 's' : ''}`;
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
  $('queue-label').textContent = q.paused
    ? `En pause · ${q.pending} en attente`
    : `${batchTotal - active}/${batchTotal} · ${q.running} en cours`;
  $('btn-pause').textContent = q.paused ? 'Reprendre' : 'Pause';
}

// ===================================================================== selection & detail
const wave = new WaveView($<HTMLCanvasElement>('wave'), () => audio.currentTime, {
  seek: (t) => jump(t),
  cueSelected: () => renderDetail(),
  viewChanged: () => drawOverview($<HTMLCanvasElement>('overview'), current(), wave, audio.currentTime),
  cueMoved: (cue, t, done) => {
    const r = current();
    if (!r) return;
    if (!dragStart) {
      dragStart = { id: cue.id, time: cue.timeSec, wasAuto: cue.origin === 'auto' };
      history.push(r);
    }
    cue.timeSec = t;
    if (done) {
      cue.bar = Math.round((t - r.grid.firstDownbeatSec) / (4 * (60 / r.bpm)));
      cue.origin = 'user';
      if (dragStart.wasAuto) api.learningEvent({ type: 'moved', kind: cue.kind, beats: (t - dragStart.time) / (60 / r.bpm) });
      dragStart = null;
      persist(r);
      refreshTrack(r.path);
    }
  },
  loopMoved: (loop, t, done) => {
    const r = current();
    if (!r) return;
    if (!dragStart) {
      dragStart = { id: loop.id, time: loop.startSec, wasAuto: false };
      history.push(r);
    }
    loop.startSec = t;
    if (done) {
      loop.bar = Math.round((t - r.grid.firstDownbeatSec) / (4 * (60 / r.bpm)));
      loop.origin = 'user';
      dragStart = null;
      persist(r);
      refreshTrack(r.path);
    }
  },
});
let dragStart: { id: string; time: number; wasAuto: boolean } | null = null;

function select(path: string) {
  const prev = state.selected;
  state.selected = path;
  if (prev && state.tracks.has(prev)) renderRow(state.tracks.get(prev)!);
  const rec = state.tracks.get(path);
  if (rec) renderRow(rec);
  const r = rec?.result ?? null;
  if (r && prev !== path) {
    audio.pause();
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
  renderDetail();
  rowEls.get(path)?.scrollIntoView({ block: 'nearest' });
}

function jump(t: number) {
  const r = current();
  audio.currentTime = Math.max(0, Math.min(r?.durationSec ?? t, t));
  redrawWave();
}

function redrawWave() {
  const r = current();
  wave.draw();
  drawOverview($<HTMLCanvasElement>('overview'), r, wave, audio.currentTime);
  const label = fmtTime(audio.currentTime);
  $('time').textContent = label;
  const c = $('wave');
  c.setAttribute('aria-valuenow', String(Math.round(audio.currentTime)));
  c.setAttribute('aria-valuetext', label);
}

function renderDetail() {
  const r = current();
  const rec = state.selected ? state.tracks.get(state.selected) : undefined;
  $('detail').hidden = !r;
  if (!r) return;
  if (wave.track !== r) wave.set(r, true);
  $('d-title').textContent = r.title + (r.artist ? ` — ${r.artist}` : '');
  const busy = rec && rec.status !== 'done' ? ` · ${rec.status === 'analyzing' ? `ré-analyse ${Math.round((rec.progress ?? 0) * 100)} %` : 'en attente'}` : '';
  $('d-sub').textContent =
    `${fmtBpm(r.bpm)} BPM · ${r.key.camelot} (${r.key.musical}) · ${fmtDur(r.durationSec)} · énergie ${r.energy?.score ?? '—'}/10 · ` +
    `profil ${allProfiles().find((p) => p.id === r.profileId)?.name ?? r.profileId ?? '—'}${busy}`;
  $('d-warn').textContent = r.warnings.join(' · ');
  // corrections
  const bpmInput = $<HTMLInputElement>('bpm-input');
  if (document.activeElement !== bpmInput) bpmInput.value = r.bpm.toFixed(2);
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
  const alts = new Set((r.key.alternatives ?? []).map((a) => a.camelot));
  ks.replaceChildren(
    ...allKeys().map((k) =>
      h('option', { value: k.musical, selected: k.camelot === r.key.camelot },
        `${k.camelot} · ${k.musical}${alts.has(k.camelot) ? ' (alternative plausible)' : ''}`)),
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
const snapBeat = (r: AnalysisResult, t: number) => {
  const b = beatOf(r);
  const d0 = r.grid.firstDownbeatSec;
  return Math.max(0, d0 + Math.round((t - d0) / b) * b);
};
const barOf = (r: AnalysisResult, t: number) => Math.round((t - r.grid.firstDownbeatSec) / (4 * beatOf(r)));
const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function profileColors() {
  return (allProfiles().find((p) => p.id === state.settings.profileId) ?? allProfiles()[0]).colors;
}

function setCueAt(r: AnalysisResult, slot: number, t: number, kind?: CueKind) {
  edit(r, () => {
    const existing = r.cues.find((c) => c.slot === slot);
    const time = snapBeat(r, t);
    if (existing) {
      existing.timeSec = time;
      existing.bar = barOf(r, time);
      existing.origin = 'user';
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
    cue.timeSec = Math.max(0, Math.min(r.durationSec - 0.05, cue.timeSec + beats * beatOf(r)));
    cue.bar = barOf(r, cue.timeSec);
    cue.origin = 'user';
  });
}

function renderCues(r: AnalysisResult) {
  const kinds = Object.keys(CUE_KIND_LABEL) as CueKind[];
  const pads = [];
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
      class: `pad${selected ? ' selected' : ''}`, style: { '--pad-color': rgb(cue.color) } as never,
      onclick: () => { wave.selectedCueId = cue.id; renderDetail(); },
    },
      h('div', { class: 'pad-head' },
        h('span', { class: 'letter' }, LETTERS[slot]),
        h('input', { type: 'color', value: hexOf(cue.color), 'aria-label': `Couleur du pad ${LETTERS[slot]}`, disabled: cue.locked,
          onchange: (e: Event) => edit(r, () => { cue.color = rgbOf((e.target as HTMLInputElement).value); cue.origin = 'user'; }) }),
        confBadge(cue.confidence, true),
        cue.origin === 'user' ? h('span', { class: 'pill', title: 'Modifié par vous : conservé lors des ré-analyses' }, 'perso') : '',
      ),
      h('input', { class: 'nm', type: 'text', value: cue.name, 'aria-label': `Nom du pad ${LETTERS[slot]}`, disabled: cue.locked,
        onchange: (e: Event) => edit(r, () => { cue.name = (e.target as HTMLInputElement).value || cue.name; cue.origin = 'user'; }) }),
      h('div', { class: 'tm' }, `${fmtTime(cue.timeSec)} · mes. ${cue.bar + 1}`),
      h('div', { class: 'why', title: cue.reason }, cue.reason),
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
  $('tab-cues').replaceChildren(h('div', { class: 'pads' }, ...pads));
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

function sectionEdit(r: AnalysisResult, fn: (s: Section[]) => void) {
  edit(r, () => {
    const s = r.sections ?? [];
    fn(s);
    // keep the timeline consistent: contiguous, recomputed times, owned by the user from now on
    s.sort((a, b) => a.startBar - b.startBar);
    const bar = 4 * beatOf(r);
    s.forEach((sec, i) => {
      sec.endBar = i + 1 < s.length ? s[i + 1].startBar : sec.endBar;
      sec.startSec = Math.max(0, r.grid.firstDownbeatSec + sec.startBar * bar);
      sec.endSec = i + 1 < s.length ? r.grid.firstDownbeatSec + sec.endBar * bar : r.durationSec;
      sec.origin = 'user';
    });
    r.sections = s.filter((x) => x.endBar > x.startBar);
  });
}

function renderSections(r: AnalysisResult) {
  const s = r.sections ?? [];
  const ph = r.phrases;
  $('tab-sections').replaceChildren(
    h('p', { class: 'muted' },
      ph?.lengthBars
        ? `Phrases de ${ph.lengthBars} mesures (régularité ${Math.round(ph.regularity * 100)} %) — affichées en traits pleins sur la waveform.`
        : 'Pas de phrasé régulier détecté : aucune limite de phrase n’est affichée (pas d’hypothèse forcée).',
      ' Couplet / refrain ne sont pas proposés automatiquement : il faudrait une détection vocale.'),
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
  );
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
              h('button', { type: 'button', class: 'btn small', onclick: () => {
                const free = [0, 1, 2, 3, 4, 5, 6, 7].find((s) => !r.cues.some((c) => c.slot === s));
                if (free === undefined) return toast('Les 8 pads sont occupés');
                setCueAt(r, free, m.timeSec, kind);
              } }, 'Créer un cue'),
            )))
        : h('p', { class: 'muted' }, 'Aucune suggestion.'),
    );
  const matches = matchTracks(r, doneResults(), 8);
  $('tab-mix').replaceChildren(
    h('p', { class: 'muted' }, 'Suggestions à valider : elles s’appuient sur la structure, les phrases, l’énergie et la percussion. La présence de voix n’est pas encore analysée.'),
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
                h('span', { class: 'muted' }, m.reasons.join(' · ') + (m.cautions.length ? ` (⚠ ${m.cautions.join(', ')})` : '')),
              )))
          : h('p', { class: 'muted' }, 'Pas encore de morceau compatible dans la bibliothèque.'),
      ),
    ),
  );
}

// ---------------------------------------------------------------- tab: info
/** Vocal detection summary — always labelled as an unvalidated estimate. */
function vocalSummary(r: AnalysisResult): string | undefined {
  const v = r.vocals;
  if (!v) return undefined;
  if (!v.segments.length) return `aucune voix détectée${v.note ? ` — ${v.note}` : ''} (heuristique non validée : des voix peuvent être manquées)`;
  const strong = v.segments.filter((s) => s.strength === 'strong').length;
  const parts = v.segments.map((s) => `${fmtTime(s.startSec)}–${fmtTime(s.endSec)}${s.strength === 'strong' ? '' : ' (faible)'}`);
  return `${v.segments.length} passage(s), ${Math.round(v.coverage * 100)} % du morceau, ${strong} net(s) : ${parts.join(' · ')} (heuristique non validée)`;
}

function renderInfo(r: AnalysisResult) {
  const row = (k: string, v: string | number | undefined | null) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, v === undefined || v === null || v === '' ? '—' : String(v)));
  const L = r.loudness;
  $('tab-info').replaceChildren(
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
          row('Ajustement de la grille', `${Math.round(r.grid.confidence * 100)} % des temps alignés à ±12 ms`),
          row('Premier temps', `${r.grid.firstDownbeatSec.toFixed(3)} s`),
          row('Tonalité', `${r.key.musical} · ${r.key.camelot} · ${r.key.openKey}${r.key.ambiguous ? ' (ambiguë)' : ''}`),
          row('Alternatives tonalité', (r.key.alternatives ?? []).map((a) => `${a.camelot} (${Math.round(a.weight * 100)} %)`).join(' · ')),
          row('Loudness intégrée', L?.integratedLufs != null ? `${L.integratedLufs.toFixed(1)} LUFS` : undefined),
          row('Plage de loudness', L?.loudnessRangeLu != null ? `${L.loudnessRangeLu.toFixed(1)} LU` : undefined),
          row('True peak', L?.truePeakDbtp != null ? `${L.truePeakDbtp.toFixed(1)} dBTP` : undefined),
          row('RMS / crête', L ? `${L.rmsDb.toFixed(1)} dBFS · facteur de crête ${L.crestDb.toFixed(1)} dB` : undefined),
          row('Énergie estimée', r.energy ? `${r.energy.score}/10 (algorithmique, comparable dans cette bibliothèque)` : undefined),
          row('Voix (expérimental)', vocalSummary(r)),
          row('Moteur', `v${r.engineVersion ?? '?'} · ${(r.analysisMs / 1000).toFixed(1)} s${state.tracks.get(r.path)?.cached ? ' · depuis le cache' : ''}`),
        ))),
    ),
    h('div', { class: 'hrow' },
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => api.revealInFolder(r.path) }, 'Afficher le fichier'),
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => void api.reanalyze([r.path], true) }, 'Ré-analyser sans cache (corrections conservées)'),
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
  const r = current();
  if (!r) return;
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
let raf = 0;
function loop() {
  if (loopPlay && current()) {
    const end = loopPlay.startSec + loopPlay.beats * beatOf(current()!);
    if (audio.currentTime >= end) audio.currentTime = loopPlay.startSec;
  }
  wave.follow(audio.currentTime);
  redrawWave();
  raf = audio.paused ? 0 : requestAnimationFrame(loop);
}
audio.addEventListener('play', () => {
  $('btn-play').textContent = '❚❚ Pause';
  if (!raf) raf = requestAnimationFrame(loop);
});
audio.addEventListener('pause', () => ($('btn-play').textContent = '▶︎ Lecture'));
audio.addEventListener('seeked', redrawWave);
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
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { clearTokenCache(); redrawWave(); });

// undo / redo
function undo() { const p = history.undo(); if (p) { void api.saveTrack(state.tracks.get(p)!.result!); refreshTrack(p); announce('Modification annulée'); } }
function redo() { const p = history.redo(); if (p) { void api.saveTrack(state.tracks.get(p)!.result!); refreshTrack(p); announce('Modification rétablie'); } }
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);

// keyboard
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  const typing = t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); if (doneResults().length) openExport(state.selected); return; }
  if (typing || mod || document.querySelector('dialog[open]')) return;
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
    const step = (e.shiftKey ? 1 : 4) * beatOf(r) * (e.key === 'ArrowLeft' ? -1 : 1);
    jump(audio.currentTime + step);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const rows = Array.from($('rows').children) as HTMLTableRowElement[];
    const paths = [...rowEls.entries()].filter(([, tr]) => rows.includes(tr)).sort((a, b) => rows.indexOf(a[1]) - rows.indexOf(b[1])).map(([p]) => p);
    const i = state.selected ? paths.indexOf(state.selected) : -1;
    const next = paths.at(Math.max(0, Math.min(paths.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
    if (next) { select(next); rowEls.get(next)?.focus({ preventScroll: true }); }
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && r && selCue) {
    e.preventDefault();
    deleteCue(r, selCue);
  } else if ((e.key === ',' || e.key === '.' || e.key === '<' || e.key === '>' || e.key === ';' || e.key === ':') && r && selCue) {
    moveCue(r, selCue, (e.key === ',' || e.key === '<' || e.key === ';' ? -1 : 1) * (e.shiftKey ? 4 : 1));
  } else if (e.key.toLowerCase() === 'l' && r) {
    addLoop(r, 16);
    setTab('loops');
  } else if (e.key === '+' || e.key === '=') wave.zoom(2, audio.currentTime);
  else if (e.key === '-') wave.zoom(0.5, audio.currentTime);
  else if (e.key === '0') wave.fit();
  else if (e.key === '?') openHelp();
});

// library tools
$('search').addEventListener('input', (e) => { filter = (e.target as HTMLInputElement).value.trim().toLowerCase(); renderLibrary(); });
document.querySelectorAll<HTMLElement>('th[data-sort]').forEach((th) => {
  th.tabIndex = 0;
  const go = () => { const k = th.dataset.sort!; sortDir = sortKey === k ? -sortDir : 1; sortKey = k; renderLibrary(); };
  th.addEventListener('click', go);
  th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
});
$('btn-reanalyze').addEventListener('click', () => {
  const paths = [...state.tracks.values()].filter(matchesFilter).map((r) => r.path);
  if (paths.length > 1 && !confirm(`Ré-analyser ${paths.length} morceaux avec le profil actuel ? Vos cues modifiés ou verrouillés sont conservés.`)) return;
  void api.reanalyze(paths);
});
$('btn-remove').addEventListener('click', () => {
  if (!state.selected) return toast('Sélectionnez un morceau');
  const p = state.selected;
  if (!confirm('Retirer ce morceau de la bibliothèque CueKoda ? Le fichier audio n’est pas supprimé.')) return;
  void api.removeTracks([p]).then(() => {
    state.tracks.delete(p);
    rowEls.delete(p);
    state.selected = null;
    audio.pause();
    renderLibrary();
    renderDetail();
  });
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
$('btn-export').addEventListener('click', () => openExport(state.selected));
$('btn-dupes').addEventListener('click', openDuplicates);
$('btn-settings').addEventListener('click', () => openSettings(() => { fillProfiles(); renderDetail(); }));
$('profile').addEventListener('change', async (e) => {
  state.settings = await api.setSettings({ profileId: (e.target as HTMLSelectElement).value });
  toast('Profil appliqué aux prochaines analyses — « Ré-analyser » pour l’appliquer aux morceaux existants');
});

function fillProfiles() {
  $('profile').replaceChildren(...allProfiles().map((p) => h('option', { value: p.id, selected: p.id === state.settings.profileId }, p.name)));
}

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
  state.builtinProfiles = s.builtinProfiles;
  state.adapters = s.adapters;
  state.learning = s.learning;
  state.cores = s.cores;
  state.references = s.references ?? {};
  state.queue = s.queue;
  applyTheme(s.settings.theme ?? 'dark');
  for (const t of s.tracks) state.tracks.set(t.path, t);
  fillProfiles();
  renderLibrary();
  onQueue();
  const first = s.tracks.find((t) => t.result);
  if (first) select(first.path);

  api.onTrack(({ path, record }) => {
    const prev = state.tracks.get(path);
    const isNew = !prev;
    // progress events carry no result: keep the previous one on screen meanwhile
    const merged: TrackRecord = { ...record, result: record.result ?? prev?.result };
    state.tracks.set(path, merged);
    if (isNew) renderLibrary();
    else renderRow(merged);
    updateGlobalButtons();
    if (record.result && path === state.selected) {
      wave.set(merged.result!, true);
      renderDetail();
    } else if (path === state.selected) renderDetail();
    if (record.result && !state.selected) select(path);
  });
  api.onQueue((q) => { state.queue = q; onQueue(); });
  api.onSummary((sum) => {
    const parts = [`${sum.done} analysé(s)`];
    if (sum.cached) parts.push(`${sum.cached} depuis le cache`);
    if (sum.errors) parts.push(`${sum.errors} erreur(s)`);
    if (sum.cancelled) parts.push(`${sum.cancelled} annulé(s)`);
    toast(`Analyse terminée : ${parts.join(', ')} en ${(sum.durationMs / 1000).toFixed(0)} s`, 7000);
    updateGlobalButtons();
  });
  api.onWatch((w) => toast(`${w.level === 'error' ? '⚠ ' : ''}${w.message} (${w.folder})`, w.level === 'error' ? 8000 : 3000));
}
void boot();
