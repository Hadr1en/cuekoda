import type { ExportOptions } from '../core/export/index';
import type { CueKind, LoopKind } from '../core/types';
import { CUE_KIND_LABEL, DEFAULT_COLORS, sanitizeProfile, type Profile } from '../core/profiles';
import { findDuplicates } from '../core/duplicates';
import type { AdapterInfo } from '../shared/api';
import { allProfiles, api, applyTheme, doneResults, state } from './state';
import { $, h, hexOf, rgbOf, toast } from './util';

const closeBtn = (dlg: HTMLDialogElement) =>
  h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Fermer');

// ================================================================= export
const SUPPORT_TEXT = { yes: '✓', partial: '≈', no: '✗' } as const;

export function openExport(currentPath: string | null) {
  const dlg = $<HTMLDialogElement>('dlg-export');
  let target: AdapterInfo['id'] = 'rekordbox';
  let scope: 'all' | 'current' = 'all';
  const opts: ExportOptions = { ...state.settings.exportOptions };

  const render = async () => {
    const adapter = state.adapters.find((a) => a.id === target)!;
    const paths = scope === 'current' && currentPath ? [currentPath] : doneResults().map((r) => r.path);
    const preview = await api.exportPreview(target, paths, opts);
    const parts: (Node | null)[] = [
      h('h2', { id: 'dlg-export-title' }, 'Exporter vers un logiciel DJ'),
      h(
        'div',
        { class: 'seg', role: 'radiogroup', 'aria-label': 'Logiciel cible' },
        ...state.adapters.map((a) =>
          h('label', { class: 'seg-item' },
            h('input', { type: 'radio', name: 'target', checked: a.id === target, onchange: () => { target = a.id; void render(); } }),
            ` ${a.name}`,
            h('span', { class: `pill ${a.status === 'available' ? (a.validated ? 'ok' : 'warn') : 'off'}` },
              a.status === 'available' ? (a.validated ? 'validé' : 'non validé') : 'indisponible'),
          ),
        ),
      ),
      h('p', { class: 'muted' }, `Format : ${adapter.formatName}`),
      adapter.status === 'available' && !adapter.validated
        ? h('p', { class: 'note warn' }, 'Format documenté et XML valide, mais l’import n’a pas encore été vérifié dans le logiciel lui-même. Testez d’abord sur quelques morceaux.')
        : null,
      h('table', { class: 'caps' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Donnée'), h('th', { scope: 'col' }, 'Transfert'), h('th', { scope: 'col' }, 'Détail'))),
        h('tbody', {}, ...adapter.capabilities.map((c) =>
          h('tr', {}, h('td', {}, c.field), h('td', { class: `sup-${c.support}` }, SUPPORT_TEXT[c.support]), h('td', { class: 'muted' }, c.note)))),
      ),
      adapter.status === 'available'
        ? h('fieldset', { class: 'opts' },
            h('legend', {}, 'Options'),
            h('label', {}, h('input', { type: 'radio', name: 'scope', checked: scope === 'all', onchange: () => { scope = 'all'; void render(); } }), ` Tous les morceaux analysés (${doneResults().length})`),
            currentPath ? h('label', {}, h('input', { type: 'radio', name: 'scope', checked: scope === 'current', onchange: () => { scope = 'current'; void render(); } }), ' Morceau affiché seulement') : null,
            target === 'rekordbox'
              ? h('label', {}, h('input', { type: 'checkbox', checked: opts.memoryCues, onchange: (e: Event) => { opts.memoryCues = (e.target as HTMLInputElement).checked; void render(); } }), ' Ajouter des memory cues aux mêmes positions')
              : null,
            h('label', {}, 'Boucles : ',
              h('select', { onchange: (e: Event) => { opts.loops = (e.target as HTMLSelectElement).value as ExportOptions['loops']; void render(); } },
                ...([['accepted', 'validées uniquement'], ['all', 'toutes les suggestions'], ['none', 'aucune']] as const).map(([v, l]) => h('option', { value: v, selected: opts.loops === v }, l)))),
          )
        : null,
      h('h3', {}, adapter.status === 'available' ? 'Ce qui sera transféré' : 'Pourquoi ce n’est pas disponible'),
      h('ul', { class: 'summary' }, ...preview.map((l) => h('li', {}, l))),
      h('h3', {}, 'Import dans le logiciel'),
      h('ol', { class: 'summary' }, ...adapter.howToImport.map((l) => h('li', {}, l))),
      h('p', { class: 'muted' }, 'Sécurité : CueKoda écrit un nouveau fichier de collection ; un fichier existant est d’abord sauvegardé à côté (.backup-…). Vos fichiers audio et votre bibliothèque DJ ne sont jamais modifiés directement.'),
      h('div', { class: 'dlg-actions' },
        closeBtn(dlg),
        h('button', {
          type: 'button',
          class: 'btn primary',
          disabled: adapter.status !== 'available' || !paths.length,
          onclick: async () => {
            const res = await api.exportCollection(target, paths, opts);
            if (res.ok) {
              dlg.close();
              toast(`Exporté : ${res.file}${res.backup ? ` (ancien fichier sauvegardé : ${res.backup})` : ''}`, 8000);
            } else if (!res.canceled) toast(`Erreur d’export : ${res.error}`, 8000);
          },
        }, `Exporter ${paths.length} morceau(x)…`),
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
    h('p', { class: 'muted' }, 'Aucun fichier n’est supprimé ni déplacé par CueKoda : comparez, puis décidez vous-même.'),
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
    ['Espace', 'Lecture / pause'],
    ['← / →', 'Reculer / avancer d’une mesure (Maj : un temps)'],
    ['↑ / ↓', 'Morceau précédent / suivant'],
    ['1 … 8', 'Aller au hot cue A … H'],
    ['Maj + 1 … 8', 'Poser le hot cue A … H à la position de lecture (calé sur le temps)'],
    ['Suppr', 'Supprimer le cue sélectionné'],
    [', / .', 'Déplacer le cue sélectionné d’un temps (Maj : une mesure)'],
    ['C', 'Ajouter un cue à la position de lecture (premier pad libre, sinon memory cue)'],
    ['M', 'Ajouter une memory cue à la position de lecture'],
    ['L', 'Créer une boucle de 16 temps à la position de lecture'],
    ['+ / − / 0', 'Zoom avant / arrière / tout le morceau'],
    ['⌘Z / ⇧⌘Z', 'Annuler / rétablir'],
    ['⌘E', 'Exporter'],
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
              h('option', { value: 'priority', selected: profile.slotOrder === 'priority' }, 'par priorité (A = plus important)'))),
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
        h('p', { class: 'muted' }, 'Le profil s’applique aux prochaines analyses. Utilisez « Ré-analyser » pour l’appliquer aux morceaux existants (vos corrections sont conservées).'),
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
        h('h3', {}, 'Apprentissage à partir de vos corrections'),
        h('label', {}, h('input', { type: 'checkbox', checked: s.learningEnabled, onchange: (e: Event) => void save({ learningEnabled: (e.target as HTMLInputElement).checked }).then(render) }), ' Activer (statistiques locales)'),
        h('p', { class: 'muted' }, 'Un type de cue que vous supprimez dans au moins 80 % des cas (sur 5 propositions ou plus) n’est plus proposé.'),
        h('ul', { class: 'summary' }, ...(state.learning.length ? state.learning : ['Aucune correction enregistrée pour l’instant.']).map((l) => h('li', {}, l))),
        h('button', { type: 'button', class: 'btn small ghost', onclick: async () => { state.learning = await api.resetLearning(); render(); toast('Apprentissage réinitialisé'); } }, 'Réinitialiser l’apprentissage'),
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
