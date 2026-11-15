import type { ComparisonPoint } from '../core/analysisComparison';
import { api, state } from './state';
import { $, fmtBpm, fmtTime, h, toast } from './util';
import { tr } from '../shared/i18n';

export function openComparison(opts: {
  batch?: number;
  path?: string;
  listen: (path: string, point: ComparisonPoint, timeSec: number) => void;
  stop: () => void;
}) {
  const dlg = $<HTMLDialogElement>('dlg-comparison');
  if (dlg.open) return;
  let active = opts.path;
  let page = 0;
  let restoring = false;
  let detailRequest = 0;
  const PAGE_SIZE = 25;
  const detail = h('div', { class: 'comparison-detail' });

  async function renderDetail() {
    const request = ++detailRequest;
    detail.replaceChildren();
    if (!active) return;
    const path = active;
    const data = await api.analysisComparison(path);
    if (request !== detailRequest || !dlg.open) return;
    if (!data) {
      detail.replaceChildren(h('p', { class: 'muted' }, 'Comparaison indisponible pour ce morceau.'));
      return;
    }
    const sameCue = (a: ComparisonPoint['cues'][number], b: ComparisonPoint['cues'][number]) =>
      a.slot === b.slot && a.kind === b.kind && a.name === b.name && Math.abs(a.timeSec - b.timeSec) < 0.01;
    const cueOnly = data.changes.cues && !data.changes.bpm && !data.changes.grid;
    const changedAfter = data.after.cues.find((cue) => !data.before.cues.some((old) => sameCue(cue, old)));
    const removedBefore = data.before.cues.find((cue) => !data.after.cues.some((next) => sameCue(cue, next)));
    const changedBefore = changedAfter
      ? data.before.cues.find((cue) => cue.kind === changedAfter.kind && cue.name === changedAfter.name)
        ?? data.before.cues.find((cue) => cue.slot === changedAfter.slot)
      : removedBefore;
    const base = data.after.grid.firstDownbeatSec;
    const beforeStart = cueOnly ? changedBefore?.timeSec ?? changedAfter?.timeSec ?? base : base;
    const afterStart = cueOnly ? changedAfter?.timeSec ?? changedBefore?.timeSec ?? base : base;
    const column = (title: string, point: ComparisonPoint, other: ComparisonPoint, start: number) => h('section', {},
      h('div', { class: 'hrow' },
        h('h3', {}, title),
        h('button', { class: 'btn small', type: 'button', onclick: () => opts.listen(path, point, start) }, 'Écouter 4 mesures')),
      h('p', { class: 'muted' }, `${fmtBpm(point.bpm)} BPM · `, 'Temps 1', ` ${point.grid.firstDownbeatSec.toFixed(3)} s`),
      h('ul', { class: 'summary' }, ...[...point.cues].sort((a, b) => a.slot - b.slot).map((cue) =>
        h('li', { class: other.cues.some((c) => sameCue(c, cue)) ? '' : 'comparison-changed' }, `${cue.slot >= 0 ? String.fromCharCode(65 + cue.slot) + ' · ' : ''}${cue.name} · ${fmtTime(cue.timeSec)}`),
      )),
    );
    const restore = h('button', { class: 'btn small ghost', type: 'button', disabled: restoring || state.tracks.get(path)?.status !== 'done',
      onclick: async () => {
        if (restoring || !confirm(tr('Rétablir l’analyse précédente de ce morceau ?'))) return;
        restoring = true;
        restore.disabled = true;
        opts.stop();
        try {
          if (await api.restoreAnalysis(path)) {
            active = undefined;
            render();
            toast('Analyse précédente rétablie');
          } else toast('Ce morceau ne peut pas être rétabli maintenant.');
        } finally {
          restoring = false;
          restore.disabled = false;
        }
      },
    }, 'Rétablir l’analyse précédente');
    detail.replaceChildren(
      h('div', { class: 'cols' }, column('Avant', data.before, data.after, beforeStart), column('Après', data.after, data.before, afterStart)),
      h('div', { class: 'hrow' }, restore,
        h('button', { class: 'btn small ghost', type: 'button', onclick: opts.stop }, 'Arrêter l’écoute')),
    );
  }

  function render() {
    const records = [...state.tracks.values()];
    const batch = opts.batch ?? records.reduce((last, r) => Math.max(last, r.comparison?.batch ?? 0, r.compareNext ?? 0), 0);
    const changed = records.filter((r) => r.comparison && (opts.path ? r.path === opts.path : r.comparison.batch === batch));
    const pending = !opts.path && records.some((r) => r.compareNext === batch);
    page = Math.min(page, Math.max(0, Math.ceil(changed.length / PAGE_SIZE) - 1));
    if (!changed.some((r) => r.path === active)) active = changed[page * PAGE_SIZE]?.path;
    const list = h('div', { class: 'comparison-list' });
    for (const r of changed.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const changes = r.comparison!.changes;
      list.append(h('button', { type: 'button', class: 'btn ghost', 'aria-pressed': String(r.path === active),
        onclick: (event: Event) => {
          opts.stop();
          active = r.path;
          for (const item of Array.from(list.children)) item.setAttribute('aria-pressed', String(item === event.currentTarget));
          void renderDetail();
        },
      }, h('span', {}, r.result?.title || r.fileName),
      h('span', { class: 'muted' }, [changes.bpm ? 'BPM' : '', changes.grid ? tr('Grille') : '', changes.cues ? 'Cues' : ''].filter(Boolean).join(' · '))));
    }
    const paging = (delta: number) => {
      opts.stop();
      page += delta;
      active = undefined;
      render();
    };
    dlg.replaceChildren(h('div', {},
      h('h2', { id: 'dlg-comparison-title' }, 'Comparaison après réanalyse'),
      pending ? h('p', { role: 'status', class: 'muted' }, 'Réanalyse en cours…') : null,
      !changed.length && !pending ? h('p', {}, 'Aucun changement de BPM, de grille ou de cues pour cette réanalyse.') : null,
      list,
      changed.length > PAGE_SIZE ? h('div', { class: 'hrow' },
        h('button', { type: 'button', class: 'btn small', disabled: page <= 0, onclick: () => paging(-1) }, 'Précédent'),
        h('button', { type: 'button', class: 'btn small', disabled: (page + 1) * PAGE_SIZE >= changed.length, onclick: () => paging(1) }, 'Suivant'),
      ) : null,
      detail,
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Fermer')),
    ));
    void renderDetail();
  }
  dlg.addEventListener('close', () => { detailRequest++; opts.stop(); }, { once: true });
  render();
  dlg.showModal();
  return () => { if (dlg.open) render(); };
}
