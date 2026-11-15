import type { ExportOptions } from '../core/export/index';
import type { CueKind, LoopKind } from '../core/types';
import type { UpdateStatus } from '../shared/update';
import type { AnalysisResult } from '../core/types';
import { ARC_LABEL, isWeakLink, suggestOrder, type ArcShape } from '../core/setorder';
import { pairScore, tempoGapPct } from '../core/matching';
import { CUE_KIND_LABEL, DEFAULT_COLORS, sanitizeProfile, type Profile } from '../core/profiles';
import { findDuplicates } from '../core/duplicates';
import type { AdapterInfo } from '../shared/api';
import { allProfiles, api, applyTheme, doneResults, keyLabel, state } from './state';
import { $, camelotColor, fmtTime, h, hexOf, rgbOf, toast } from './util';
import { tr } from '../shared/i18n';

const closeBtn = (dlg: HTMLDialogElement) =>
  h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Fermer');

// ================================================================= export
const SUPPORT_TEXT = { yes: '✓', partial: '≈', no: '✗' } as const;

function traktorInspector(
  paths: string[], opts: ExportOptions, inspectedPath: string | null, onChoose: (path: string) => void, expanded: boolean,
) {
  const tracks = paths.map((path) => state.tracks.get(path)?.result).filter((r): r is AnalysisResult => !!r);
  const search = h('input', { type: 'search', placeholder: 'Rechercher un morceau', 'aria-label': 'Rechercher un morceau' });
  const picker = h('select', { 'aria-label': 'Morceau à prévisualiser' });
  const content = h('div', { class: 'traktor-markers', 'aria-live': 'polite' });
  let current = tracks.find((track) => track.path === inspectedPath) ?? tracks[0];
  let request = 0;
  const display = async () => {
    const id = ++request;
    if (!current) { content.replaceChildren(); return; }
    const plan = await api.traktorPlan(current.path, opts.loops);
    if (id !== request) return;
    if (!plan) { content.replaceChildren(); return; }
    const markers = (entries: typeof plan.stored) => h('ul', { class: 'summary' },
      ...entries.map(({ name, timeSec }) => h('li', {}, name, h('span', { class: 'muted' }, ` · ${fmtTime(timeSec)}`))),
    );
    content.replaceChildren(
      h('ol', { class: 'traktor-pads', 'aria-label': 'Boutons Traktor' }, ...plan.pads.map((marker, i) =>
        h('li', { class: marker ? 'filled' : '' },
          h('b', {}, String(i + 1)),
          h('span', { title: marker?.name }, marker?.name ?? '—'),
          marker ? h('small', { class: 'muted' }, fmtTime(marker.timeSec)) : null,
        ),
      )),
      ...(plan.stored.length ? [h('h4', {}, 'Cues mémorisés'), markers(plan.stored)] : []),
      h('h4', {}, 'Boucles mémorisées'),
      plan.loops.length ? h('ul', { class: 'summary' }, ...plan.loops.map((loop) =>
        h('li', {}, loop.name, h('span', { class: 'muted' }, ` · ${fmtTime(loop.timeSec)} · ${loop.beats} temps`)),
      )) : h('p', { class: 'muted' }, 'Aucune boucle à exporter'),
    );
  };
  const filter = () => {
    const term = search.value.trim().toLowerCase();
    const options = tracks.filter((track) => `${track.title} ${track.artist} ${track.fileName}`.toLowerCase().includes(term)).slice(0, 50);
    if (!term && current && !options.includes(current)) options.unshift(current);
    if (!current || !options.includes(current)) current = options[0];
    picker.replaceChildren(...options.map((track) => h('option', { value: track.path, selected: track === current },
      [track.title || track.fileName, track.artist].filter(Boolean).join(' — '),
    )));
    picker.disabled = !options.length;
    if (current) onChoose(current.path);
    void display();
  };
  search.addEventListener('input', filter);
  picker.addEventListener('change', () => {
    current = tracks.find((track) => track.path === picker.value) ?? tracks[0];
    if (current) onChoose(current.path);
    void display();
  });
  const details = h('details', { class: 'traktor-inspector', open: expanded },
    h('summary', {}, 'Aperçu des boutons Traktor'),
    h('div', { class: 'hrow' }, tracks.length > 1 ? search : null, picker),
    content,
  );
  details.addEventListener('toggle', () => { if (details.open) filter(); });
  if (expanded) filter();
  return details;
}

/** set: tracks in the order of the mix-order window, exported as one named playlist */
export function openExport(currentPath: string | null, set?: { name: string; paths: string[]; source?: 'crate' }, selection: string[] = []) {
  const dlg = $<HTMLDialogElement>('dlg-export');
  if (dlg.open) return;
  let target: AdapterInfo['id'] = 'rekordbox';
  let scope: 'all' | 'current' | 'set' | 'selection' = set ? 'set' : selection.length ? 'selection' : 'all';
  let setName = set?.name ?? '';
  let inspectedPath = currentPath;
  let inspectorOpen = false;
  const opts: ExportOptions = { ...state.settings.exportOptions };

  let previewRequest = 0;
  let exporting = false;
  dlg.oncancel = (event) => { if (exporting) event.preventDefault(); };
  const render = async () => {
    const request = ++previewRequest;
    const adapter = state.adapters.find((a) => a.id === target)!;
    const paths = scope === 'set' && set ? set.paths : scope === 'selection' ? selection : scope === 'current' && currentPath ? [currentPath] : doneResults().map((r) => r.path);
    opts.playlistName = scope === 'set' ? setName.trim() || 'Set CueKoda' : undefined;
    const exportOptions = { ...opts };
    const preview = await api.exportPreview(adapter.id, paths, exportOptions);
    if (request !== previewRequest) return;
    const inspector = adapter.id === 'traktor' && preview.readyPaths.length
      ? traktorInspector(preview.readyPaths, exportOptions, inspectedPath, (p) => { inspectedPath = p; }, inspectorOpen)
      : null;
    inspector?.addEventListener('toggle', () => { inspectorOpen = inspector.open; });
    const parts: (Node | null)[] = [
      h('h2', { id: 'dlg-export-title' }, set ? set.source === 'crate' ? 'Exporter le bac vers…' : 'Exporter le set vers…' : 'Exporter vers…'),
      h(
        'div',
        { class: 'targets', role: 'radiogroup', 'aria-label': 'Logiciel DJ' },
        ...state.adapters.map((a) =>
          h('label', { class: `target${a.id === target ? ' on' : ''}` },
            h('input', { type: 'radio', name: 'target', checked: a.id === target, onchange: () => { target = a.id; void render(); } }),
            h('b', {}, a.name),
            h('span', { class: 'muted' }, a.tagline),
          ),
        ),
      ),
      h('p', { class: 'muted' }, `Format : ${adapter.formatName}`),
      h('table', { class: 'caps' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Donnée'), h('th', { scope: 'col' }, 'Transfert'), h('th', { scope: 'col' }, 'Détail'))),
        h('tbody', {}, ...adapter.capabilities.map((c) =>
          h('tr', {}, h('td', {}, c.field), h('td', { class: `sup-${c.support}` }, SUPPORT_TEXT[c.support]), h('td', { class: 'muted' }, c.note)))),
      ),
      h('fieldset', { class: 'opts' },
        h('legend', {}, 'Options'),
        set ? h('label', {}, h('input', { type: 'radio', name: 'scope', checked: scope === 'set', onchange: () => { scope = 'set'; void render(); } }), set.source === 'crate' ? ' Le bac dans l’ordre enregistré' : ` Le set (${set.paths.length} morceaux, dans l’ordre) en playlist : `,
          h('input', { type: 'text', class: 'set-name', value: setName, 'aria-label': 'Nom de la playlist', disabled: scope !== 'set',
            onchange: (e: Event) => { setName = (e.target as HTMLInputElement).value; void render(); } })) : null,
        h('label', {}, h('input', { type: 'radio', name: 'scope', checked: scope === 'all', onchange: () => { scope = 'all'; void render(); } }), ` Tous les morceaux analysés (${doneResults().length})`),
        selection.length ? h('label', {}, h('input', { type: 'radio', name: 'scope', checked: scope === 'selection',
          onchange: () => { scope = 'selection'; void render(); } }), ' Morceaux sélectionnés') : null,
        currentPath ? h('label', {}, h('input', { type: 'radio', name: 'scope', checked: scope === 'current', onchange: () => { scope = 'current'; void render(); } }), ' Morceau affiché seulement') : null,
        target === 'rekordbox' || adapter.via === 'rekordbox'
          ? h('label', {}, h('input', { type: 'checkbox', checked: opts.memoryCues, onchange: (e: Event) => { opts.memoryCues = (e.target as HTMLInputElement).checked; void render(); } }), ' Ajouter des memory cues aux mêmes positions')
          : null,
        h('label', { title: 'Ajoute les informations d’énergie au commentaire. Le commentaire existant est remplacé si l’écrasement est autorisé lors de l’import.' },
          h('input', { type: 'checkbox', checked: opts.commentTags !== false, onchange: (e: Event) => { opts.commentTags = (e.target as HTMLInputElement).checked; void render(); } }),
          ' Énergie, clé et voix dans le commentaire'),
        h('label', {}, 'Boucles : ',
          h('select', { onchange: (e: Event) => { opts.loops = (e.target as HTMLSelectElement).value as ExportOptions['loops']; void render(); } },
            ...([['accepted', 'validées uniquement'], ['all', 'toutes les suggestions'], ['none', 'aucune']] as const).map(([v, l]) => h('option', { value: v, selected: opts.loops === v }, l)))),
      ),
      inspector,
      h('h3', {}, 'Ce qui sera transféré'),
      h('ul', { class: 'summary' }, ...preview.lines.map((l) => h('li', { class: l.startsWith('⚠') ? 'note warn' : '' }, l))),
      h('h3', {}, 'Import dans le logiciel'),
      h('ol', { class: 'summary' }, ...adapter.howToImport.map((l) => h('li', {}, l))),
      h('p', { class: 'muted' }, 'CueKoda sauvegarde le fichier de destination s’il existe déjà.'),
      h('div', { class: 'dlg-actions' },
        closeBtn(dlg),
        h('button', {
          type: 'button',
          class: 'btn primary',
          disabled: !preview.readyPaths.length,
          onclick: async () => {
            if (request !== previewRequest || exporting) return;
            exporting = true;
            dlg.replaceChildren(
              h('h2', { id: 'dlg-export-title' }, 'Export en cours…'),
              h('div', { class: 'export-working', role: 'status' },
                h('progress', { 'aria-label': 'Export en cours…' }),
                h('span', {}, 'Création du fichier de collection…')),
            );
            try {
              const res = await api.exportCollection(adapter.id, preview.readyPaths, exportOptions);
              if (res.ok) {
                dlg.close();
                toast(`Exporté : ${res.file}${res.backup ? ` (ancien fichier sauvegardé : ${res.backup})` : ''}`, 8000);
                return;
              }
              if (!res.canceled) toast(`Erreur d’export : ${res.error}`, 8000);
            } catch (e) {
              toast(`Erreur d’export : ${String(e)}`, 8000);
            } finally {
              exporting = false;
              if (dlg.open) await render();
            }
          },
        }, `Exporter ${preview.readyPaths.length} morceau${preview.readyPaths.length === 1 ? '' : 'x'}…`),
      ),
    ];
    dlg.replaceChildren(...parts.filter((n): n is Node => n !== null));
  };
  void render().then(() => dlg.showModal());
}

// ================================================================= duplicates
export function openDuplicates() {
  const dlg = $<HTMLDialogElement>('dlg-dupes');
  const groups = findDuplicates(doneResults());
  const label = { exact: 'Doublon exact', encoding: 'Même enregistrement, autre encodage', version: 'Versions liées' } as const;
  const byPath = new Map(doneResults().map((r) => [r.path, r]));
  dlg.replaceChildren(
    h('h2', { id: 'dlg-dupes-title' }, 'Doublons et versions liées'),
    h('p', { class: 'muted' }, 'La détection de doublons préserve les fichiers à leur emplacement d’origine.'),
    groups.length
      ? h('div', { class: 'dupes' }, ...groups.map((g) =>
          h('section', { class: `dupe dupe-${g.kind}` },
            h('h3', {}, label[g.kind]),
            h('p', { class: 'muted' }, g.reason),
            h('table', { class: 'caps' }, h('tbody', {}, ...g.paths.map((p) => {
              const r = byPath.get(p);
              return h('tr', {},
                h('td', {}, r?.title ?? p),
                h('td', { class: 'muted' }, r ? `${r.codec ?? r.kind} · ${Math.round(r.bitrate / 1000)} kb/s · ${r.durationSec.toFixed(1)} s` : ''),
                h('td', { class: 'path' }, p),
                h('td', {}, h('button', { type: 'button', class: 'btn small ghost', onclick: () => api.revealInFolder(p) }, 'Afficher')),
              );
            }))),
          )))
      : h('p', {}, 'Aucun doublon trouvé parmi les morceaux analysés.'),
    h('div', { class: 'dlg-actions' }, closeBtn(dlg)),
  );
  dlg.showModal();
}

// ================================================================= shortcuts
export function openHelp() {
  const dlg = $<HTMLDialogElement>('dlg-help');
  const rows: [string, string][] = [
    ['1 / 2 / 3', 'Contrôle express · Écouter le début, le premier drop ou la fin'],
    ['T / V', 'Contrôle express · Placer le temps 1 ou valider et avancer'],
    ['[ / ]', 'Contrôle express · Décaler la grille de 10 ms'],
    ['Espace', 'Lecture / pause'],
    ['← / →', 'Reculer / avancer d’une mesure (Maj : un temps)'],
    ['↑ / ↓', 'Morceau précédent / suivant'],
    ['1 … 8', 'Aller au hot cue A … H'],
    ['Maj + 1 … 8', 'Poser le hot cue A … H à la position de lecture (calé sur le temps)'],
    ['⌘ / Ctrl + A', 'Sélectionner tous les morceaux affichés'],
    ['Maj + ↑ / ↓', 'Étendre la sélection dans la bibliothèque'],
    ['Suppr', 'Retirer les morceaux sélectionnés dans la bibliothèque, ou supprimer le cue sélectionné'],
    [', / .', 'Déplacer le cue sélectionné d’un temps (Maj : une mesure)'],
    ['C', 'Ajouter un cue à la position de lecture (premier pad libre, sinon memory cue)'],
    ['M', 'Ajouter une memory cue à la position de lecture'],
    ['L', 'Créer une boucle de 16 temps à la position de lecture'],
    ['+ / − / 0', 'Zoom avant / arrière / tout le morceau'],
    ['⌘Z / ⇧⌘Z', 'Annuler / rétablir'],
    ['⌘E', 'Exporter'],
    ['⌘ / Ctrl + F', 'Filtrer la bibliothèque'],
  ];
  dlg.replaceChildren(
    h('h2', { id: 'dlg-help-title' }, 'Raccourcis clavier'),
    h('table', { class: 'caps' }, h('tbody', {}, ...rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v))))),
    h('div', { class: 'dlg-actions' }, closeBtn(dlg)),
  );
  dlg.showModal();
}

// ================================================================= settings
const KINDS = Object.keys(CUE_KIND_LABEL) as CueKind[];
const LOOP_KINDS: [LoopKind, string][] = [['intro', 'Intro'], ['outro', 'Outro'], ['predrop', 'Avant le drop'], ['breakdown', 'Début de breakdown']];

export function openSettings(onChanged: () => void) {
  const dlg = $<HTMLDialogElement>('dlg-settings');
  const s = state.settings;
  const save = async (patch: Partial<typeof s>) => {
    state.settings = await api.setSettings(patch);
    onChanged();
  };

  const render = () => {
    const profile = allProfiles().find((p) => p.id === s.profileId) ?? allProfiles()[0];
    const editable = !profile.builtin;
    const set = <K extends keyof Profile>(k: K, v: Profile[K]) => {
      const list = s.customProfiles.map((p) => (p.id === profile.id ? sanitizeProfile({ ...p, [k]: v }) : p));
      void save({ customProfiles: list }).then(render);
    };
    const num = (k: 'minBpm' | 'maxBpm' | 'maxCues' | 'minCueSpacingBars' | 'transitionBars', label: string, min: number, max: number) =>
      h('label', { class: 'pf' }, label,
        h('input', { type: 'number', min, max, value: String(profile[k]), disabled: !editable, onchange: (e: Event) => set(k, Number((e.target as HTMLInputElement).value)) }));

    dlg.replaceChildren(
      h('h2', { id: 'dlg-settings-title' }, 'Réglages'),

      h('section', { class: 'set' },
        h('h3', {}, 'Profil DJ'),
        h('div', { class: 'hrow' },
          h('select', { 'aria-label': 'Profil', onchange: (e: Event) => void save({ profileId: (e.target as HTMLSelectElement).value }).then(render) },
            ...allProfiles().map((p) => h('option', { value: p.id, selected: p.id === profile.id }, p.name + (p.builtin ? '' : ' (perso)')))),
          h('button', {
            type: 'button', class: 'btn small',
            onclick: () => {
              const copy: Profile = { ...structuredClone(profile), id: `custom-${Date.now().toString(36)}`, name: `${profile.name} (perso)`, builtin: false };
              void save({ customProfiles: [...s.customProfiles, copy], profileId: copy.id }).then(render);
            },
          }, 'Dupliquer pour personnaliser'),
          editable
            ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => void save({ customProfiles: s.customProfiles.filter((p) => p.id !== profile.id), profileId: 'edm' }).then(render) }, 'Supprimer ce profil')
            : null,
        ),
        !editable ? h('p', { class: 'muted' }, 'Profil intégré (lecture seule) — dupliquez-le pour le modifier.') : null,
        h('div', { class: 'grid2' },
          editable ? h('label', { class: 'pf' }, 'Nom', h('input', { type: 'text', value: profile.name, onchange: (e: Event) => set('name', (e.target as HTMLInputElement).value) })) : null,
          num('minBpm', 'BPM min', 40, 200),
          num('maxBpm', 'BPM max', 60, 260),
          num('maxCues', 'Nombre de hot cues', 1, 8),
          num('minCueSpacingBars', 'Écart minimal (mesures)', 1, 32),
          num('transitionBars', 'Durée de transition (mesures)', 4, 64),
          h('label', { class: 'pf' }, 'Ordre des pads',
            h('select', { disabled: !editable, onchange: (e: Event) => set('slotOrder', (e.target as HTMLSelectElement).value as Profile['slotOrder']) },
              h('option', { value: 'chronological', selected: profile.slotOrder === 'chronological' }, 'chronologique (A = plus tôt)'),
              h('option', { value: 'priority', selected: profile.slotOrder === 'priority' }, 'par priorité (A = plus important)'),
              h('option', { value: 'template', selected: profile.slotOrder === 'template' }, 'pads fixes (A Intro, B Build 1, C Drop 1, D Break, E Build 2, F Drop 2, G Outro, H Mix Out)'))),
          h('label', { class: 'pf' }, 'Vocabulaire de structure',
            h('select', { disabled: !editable, onchange: (e: Event) => set('vocabulary', (e.target as HTMLSelectElement).value as Profile['vocabulary']) },
              h('option', { value: 'edm', selected: profile.vocabulary === 'edm' }, 'EDM (build, drop, breakdown)'),
              h('option', { value: 'generic', selected: profile.vocabulary === 'generic' }, 'générique (sans forcer de drop)'))),
          h('label', { class: 'pf check' }, h('input', { type: 'checkbox', checked: profile.memoryCues, disabled: !editable, onchange: (e: Event) => set('memoryCues', (e.target as HTMLInputElement).checked) }), ' Memory cues à l’export'),
        ),
        h('h4', {}, 'Types de cues : priorité, exclusion et couleur'),
        h('table', { class: 'caps kinds' },
          h('tbody', {}, ...[...profile.cuePriority, ...KINDS.filter((k) => !profile.cuePriority.includes(k))].map((k, i, arr) =>
            h('tr', {},
              h('td', {}, profile.cuePriority.includes(k) ? `${i + 1}.` : '—'),
              h('td', {}, CUE_KIND_LABEL[k]),
              h('td', {}, h('input', {
                type: 'color', value: hexOf(profile.colors[k] ?? DEFAULT_COLORS[k]), disabled: !editable, 'aria-label': `Couleur ${CUE_KIND_LABEL[k]}`,
                onchange: (e: Event) => set('colors', { ...profile.colors, [k]: rgbOf((e.target as HTMLInputElement).value) }),
              })),
              h('td', {}, h('label', {}, h('input', {
                type: 'checkbox', checked: profile.excludeKinds.includes(k), disabled: !editable,
                onchange: (e: Event) => set('excludeKinds', (e.target as HTMLInputElement).checked ? [...profile.excludeKinds, k] : profile.excludeKinds.filter((x) => x !== k)),
              }), ' exclure')),
              h('td', {},
                h('button', { type: 'button', class: 'btn small ghost', disabled: !editable || i === 0 || !profile.cuePriority.includes(k), 'aria-label': `Monter ${CUE_KIND_LABEL[k]}`,
                  onclick: () => { const p = [...profile.cuePriority]; const j = p.indexOf(k); [p[j - 1], p[j]] = [p[j], p[j - 1]]; set('cuePriority', p); } }, '↑'),
                h('button', { type: 'button', class: 'btn small ghost', disabled: !editable || !profile.cuePriority.includes(k) || profile.cuePriority.indexOf(k) === profile.cuePriority.length - 1, 'aria-label': `Descendre ${CUE_KIND_LABEL[k]}`,
                  onclick: () => { const p = [...profile.cuePriority]; const j = p.indexOf(k); [p[j + 1], p[j]] = [p[j], p[j + 1]]; set('cuePriority', p); } }, '↓'),
              ),
            ))),
        ),
        h('h4', {}, 'Boucles'),
        h('div', { class: 'hrow' },
          ...[4, 8, 16, 32, 64].map((b) => h('label', {}, h('input', { type: 'checkbox', checked: profile.loopBeats.includes(b), disabled: !editable,
            onchange: (e: Event) => set('loopBeats', (e.target as HTMLInputElement).checked ? [...profile.loopBeats, b] : profile.loopBeats.filter((x) => x !== b)) }), ` ${b} temps`)),
        ),
        h('div', { class: 'hrow' },
          ...LOOP_KINDS.map(([k, l]) => h('label', {}, h('input', { type: 'checkbox', checked: profile.loopKinds.includes(k), disabled: !editable,
            onchange: (e: Event) => set('loopKinds', (e.target as HTMLInputElement).checked ? [...profile.loopKinds, k] : profile.loopKinds.filter((x) => x !== k)) }), ` ${l}`)),
        ),
        h('p', { class: 'muted' }, 'Le profil s’applique aux prochaines analyses. La commande « Ré-analyser » l’applique aux morceaux existants et conserve les corrections manuelles.'),
      ),

      h('section', { class: 'set' },
        h('h3', {}, 'Performances'),
        h('label', { class: 'pf' }, `Analyses en parallèle : ${s.maxWorkers} / ${state.cores} cœurs`,
          h('input', { type: 'range', min: 1, max: state.cores, value: String(s.maxWorkers), onchange: (e: Event) => void save({ maxWorkers: Number((e.target as HTMLInputElement).value) }).then(render) })),
        h('p', { class: 'muted' }, 'Analyse locale uniquement (CPU) : aucun fichier n’est envoyé en ligne. Les résultats sont mis en cache : un fichier inchangé n’est pas ré-analysé.'),
      ),

      h('section', { class: 'set' },
        h('h3', {}, 'Dossiers surveillés'),
        h('ul', { class: 'watch' }, ...s.watchFolders.map((f) =>
          h('li', {},
            h('label', {}, h('input', { type: 'checkbox', checked: f.enabled, onchange: (e: Event) => void save({ watchFolders: s.watchFolders.map((x) => (x.path === f.path ? { ...x, enabled: (e.target as HTMLInputElement).checked } : x)) }).then(render) }), ` ${f.path}`),
            h('button', { type: 'button', class: 'btn small ghost', onclick: () => void save({ watchFolders: s.watchFolders.filter((x) => x.path !== f.path) }).then(render) }, 'Retirer'),
          ))),
        h('div', { class: 'hrow' },
          h('button', { type: 'button', class: 'btn small', onclick: async () => { state.settings = await api.addWatchFolder(); render(); } }, '+ Ajouter un dossier'),
          h('label', {}, h('input', { type: 'checkbox', checked: s.watchPaused, onchange: (e: Event) => void save({ watchPaused: (e.target as HTMLInputElement).checked }).then(render) }), ' Suspendre la surveillance'),
          h('label', {}, h('input', { type: 'checkbox', checked: s.autoAnalyzeWatched, onchange: (e: Event) => void save({ autoAnalyzeWatched: (e.target as HTMLInputElement).checked }).then(render) }), ' Analyser automatiquement les nouveaux fichiers'),
        ),
        h('p', { class: 'muted' }, 'Un fichier est pris en compte une fois sa copie terminée. Les fichiers sources ne sont jamais déplacés ni modifiés.'),
      ),

      h('section', { class: 'set' },
        h('h3', {}, 'Apprentissage à partir des corrections'),
        h('label', {}, h('input', { type: 'checkbox', checked: s.learningEnabled, onchange: (e: Event) => void save({ learningEnabled: (e.target as HTMLInputElement).checked }).then(render) }), ' Activer (statistiques locales)'),
        h('p', { class: 'muted' }, 'Un type de cue supprimé dans au moins 80 % des cas est exclu des suggestions après au moins cinq propositions.'),
        h('ul', { class: 'summary' }, ...(state.learning.length ? state.learning : ['Aucune correction enregistrée pour l’instant.']).map((l) => h('li', {}, l))),
        h('button', { type: 'button', class: 'btn small ghost', onclick: async () => { state.learning = await api.resetLearning(); render(); toast('Apprentissage réinitialisé'); } }, 'Réinitialiser l’apprentissage'),
      ),

      h('section', { class: 'set' },
        h('h3', {}, 'Mises à jour'),
        h('p', {}, `Version ${state.appVersion}${state.appBuild ? ` (build ${state.appBuild})` : ' (build de développement : pas de mise à jour automatique)'}`),
        h('label', {}, h('input', { type: 'checkbox', checked: s.autoUpdateCheck !== false, onchange: (e: Event) => void save({ autoUpdateCheck: (e.target as HTMLInputElement).checked }).then(render) }),
          ' Vérifier au démarrage s’il existe une nouvelle version'),
        h('p', { class: 'muted' }, 'La vérification des mises à jour contacte GitHub sans transmettre les données de la bibliothèque. L’installation requiert une confirmation et vérifie la taille et l’empreinte SHA-256. Sur macOS, l’ancienne version est placée dans la Corbeille.'),
        h('div', { class: 'hrow' },
          h('button', { type: 'button', class: 'btn small', onclick: async () => { await api.checkUpdate(); render(); } }, 'Vérifier maintenant'),
          h('span', { id: 'set-update-status' }, updateText(state.update)),
          state.update.state === 'available' ? h('button', { type: 'button', class: 'btn small primary', onclick: () => void api.installUpdate() }, 'Installer et redémarrer') : '',
        ),
      ),

      h('section', { class: 'set' },
        h('h3', {}, 'Langue / Language'),
        h('label', { class: 'pf' }, 'Langue de l’interface',
          h('select', { onchange: (e: Event) => { const language = (e.target as HTMLSelectElement).value as typeof s.language; void save({ language }).then(() => location.reload()); } },
            h('option', { value: 'system', selected: (s.language ?? 'system') === 'system' }, 'Système'),
            h('option', { value: 'fr', selected: s.language === 'fr' }, 'Français'),
            h('option', { value: 'en', selected: s.language === 'en' }, 'English'))),
        h('p', { class: 'muted' }, 'L’export conserve les noms des cues dans leur langue de saisie.'),
      ),

      h('section', { class: 'set' },
        h('h3', {}, 'Apparence'),
        h('label', { class: 'pf' }, 'Thème',
          h('select', { onchange: (e: Event) => { const theme = (e.target as HTMLSelectElement).value as typeof s.theme; applyTheme(theme); void save({ theme }); } },
            h('option', { value: 'dark', selected: s.theme === 'dark' }, 'Sombre'),
            h('option', { value: 'light', selected: s.theme === 'light' }, 'Clair'),
            h('option', { value: 'system', selected: s.theme === 'system' }, 'Système'))),
      ),
      h('div', { class: 'dlg-actions' }, closeBtn(dlg)),
    );
  };
  render();
  dlg.showModal();
}

// ================================================================= updates
export function updateText(u: UpdateStatus): string {
  switch (u.state) {
    case 'idle': return '';
    case 'checking': return 'Vérification…';
    case 'none': return u.currentBuild ? 'CueKoda est à jour.' : 'Build de développement : pas de comparaison possible.';
    case 'available': return `Nouvelle version disponible : ${u.info.version} (build ${u.info.build}).`;
    case 'downloading': return `Téléchargement ${Math.round(u.fraction * 100)} %…`;
    case 'installing': return 'Installation : CueKoda va redémarrer…';
    case 'manual': return u.message;
    case 'error': return u.message;
  }
}

/** Discreet header badge: only when there is something to do. */
export function renderUpdateBadge() {
  const el = $('update-badge');
  const u = state.update;
  const show = u.state === 'available' || u.state === 'downloading' || u.state === 'installing' || u.state === 'manual';
  el.hidden = !show;
  if (!show) return;
  el.replaceChildren(
    h('span', {}, u.state === 'available' ? `Mise à jour ${u.info.version} (build ${u.info.build})` : updateText(u)),
    u.state === 'available' ? h('button', { type: 'button', class: 'btn small primary', onclick: () => void api.installUpdate() }, 'Installer') : '',
    u.state === 'available' ? h('button', { type: 'button', class: 'btn small ghost', title: 'Voir ce qui change sur GitHub', onclick: () => api.openExternal(u.info.pageUrl) }, 'Notes') : '',
    u.state === 'available' ? h('button', { type: 'button', class: 'btn small ghost', 'aria-label': 'Plus tard', onclick: () => { el.hidden = true; } }, '✕') : '',
  );
  const st = document.getElementById('set-update-status');
  if (st) st.textContent = tr(updateText(u));
}

// ================================================================= mix order (suggestion only)
export function openSetOrder(o: {
  tracks: AnalysisResult[];
  listen: (a: AnalysisResult, b: AnalysisResult) => void;
  show: (path: string) => void;
  stop: () => void;
}) {
  const dlg = $<HTMLDialogElement>('dlg-order');
  const byPath = new Map(o.tracks.map((t) => [t.path, t]));
  let shape: ArcShape = 'rise';
  let start = '';
  let order: string[] = [];
  const compute = () => { order = suggestOrder(o.tracks, { shape, startPath: start || undefined }).steps.map((s) => s.path); };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    render();
  };
  const render = () => {
    const rows = order.map((p, i) => {
      const t = byPath.get(p)!;
      const prev = i > 0 ? byPath.get(order[i - 1])! : null;
      const link = prev ? pairScore(prev, t) : null;
      const weak = prev && link ? isWeakLink(link, tempoGapPct(prev.bpm, t.bpm).pct) : false;
      const b = (label: string, title: string, fn: () => void, disabled = false) =>
        h('button', { type: 'button', class: 'btn small ghost', title, 'aria-label': title, disabled, onclick: fn }, label);
      return h('tr', { class: weak ? 'weak' : '' },
        h('td', { class: 'c-num' }, String(i + 1)),
        h('td', {}, h('div', {}, t.title), h('div', { class: 'muted' }, t.artist)),
        h('td', { class: 'c-num' }, t.bpm.toFixed(t.bpm % 1 ? 1 : 0)),
        h('td', {}, h('span', { class: 'key', style: { background: camelotColor(t.key.camelot) } }, keyLabel(t.key))),
        h('td', { class: 'c-num' }, t.energy ? t.energy.score.toFixed(1) : '—'),
        h('td', { class: 'why' }, link
          ? h('span', {}, h('b', {}, `${link.score} `), weak ? h('span', { class: 'pill warn' }, 'difficile') : '', ' ',
              link.reasons.join(' · ') || 'aucun point commun', link.cautions.length ? h('span', { class: 'warn-text' }, ` ⚠ ${link.cautions.join(', ')}`) : '')
          : h('span', { class: 'muted' }, 'ouverture')),
        h('td', { class: 'acts' },
          prev ? b('🎧', `Écouter la transition ${prev.title} → ${t.title}`, () => o.listen(prev, t)) : '',
          b('↑', 'Monter', () => move(i, -1), i === 0),
          b('↓', 'Descendre', () => move(i, 1), i === order.length - 1),
          b('↗', 'Ouvrir le morceau', () => { o.show(p); }),
        ),
      );
    });
    const scores = order.slice(1).map((p, i) => pairScore(byPath.get(order[i])!, byPath.get(p)!).score);
    const mean = scores.length ? Math.round(scores.reduce((a, x) => a + x, 0) / scores.length) : 0;
    dlg.replaceChildren(
      h('h2', { id: 'dlg-order-title' }, 'Suggestion d’ordre de mix'),
      h('p', { class: 'muted' },
        `Une piste de départ pour ${order.length} morceau${order.length > 1 ? 'x' : ''} (ceux affichés dans la bibliothèque), pas une playlist imposée : `,
        'rien n’est modifié ni exporté. Écoute les transitions, réordonne, décide.'),
      h('div', { class: 'hrow' },
        h('label', { class: 'pf' }, 'Arc d’énergie ',
          h('select', { onchange: (e: Event) => { shape = (e.target as HTMLSelectElement).value as ArcShape; compute(); render(); } },
            ...(Object.keys(ARC_LABEL) as ArcShape[]).map((k) => h('option', { value: k, selected: k === shape }, ARC_LABEL[k])))),
        h('label', { class: 'pf' }, 'Ouverture ',
          h('select', { onchange: (e: Event) => { start = (e.target as HTMLSelectElement).value; compute(); render(); } },
            h('option', { value: '' }, 'au choix de CueKoda'),
            ...o.tracks.map((t) => h('option', { value: t.path, selected: t.path === start }, t.title)))),
        h('span', { class: 'muted' }, `Note moyenne des transitions : ${mean}/100`),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => {
          const text = order.map((p, i) => { const t = byPath.get(p)!; return `${i + 1}. ${t.artist ? `${t.artist} – ` : ''}${t.title} (${t.bpm.toFixed(1)} BPM, ${keyLabel(t.key)})`; }).join('\n');
          void navigator.clipboard.writeText(text).then(() => toast('Liste copiée'));
        } }, 'Copier la liste'),
        h('button', { type: 'button', class: 'btn small primary', title: 'Exporter les morceaux affichés en playlist dans l’ordre actuel',
          onclick: () => openExport(null, { name: `Set CueKoda ${new Date().toISOString().slice(0, 10)}`, paths: [...order] }) }, 'Exporter ce set…'),
      ),
      h('table', { class: 'caps order' },
        h('thead', {}, h('tr', {}, ...['#', 'Morceau', 'BPM', 'Clé', 'Énergie', 'Transition depuis le précédent', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, ...rows)),
      h('div', { class: 'dlg-actions' }, closeBtn(dlg)),
    );
  };
  compute();
  render();
  dlg.addEventListener('close', () => o.stop(), { once: true });
  dlg.showModal();
}
