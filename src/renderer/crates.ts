import type { CrateAction, PrepCrate } from '../core/crates';
import { tr } from '../shared/i18n';
import { api, state } from './state';
import { $, h, toast } from './util';

export function openCrates(opts: {
  selected: string[];
  active?: string;
  update: (crates: PrepCrate[]) => void;
  show: (id: string) => void;
  export: (crate: PrepCrate) => void;
}) {
  const dlg = $<HTMLDialogElement>('dlg-crates');
  if (dlg.open) return;
  let active = opts.active ?? state.crates[0]?.id;
  let saving = false;
  const PAGE_SIZE = 20;
  let page = 0;
  let draft = '';
  let message = '';

  async function act(action: CrateAction, focus?: string) {
    if (saving) return;
    saving = true;
    try {
      const res = await api.updateCrates(action);
      if (res.error) message = res.error;
      else {
        message = '';
        if (res.id) active = res.id;
        opts.update(res.crates);
        if (action.type === 'create') { draft = ''; page = 0; }
        if (action.type === 'move') {
          const index = res.crates.find((c) => c.id === action.id)?.paths.indexOf(action.path) ?? -1;
          if (index >= 0) page = Math.floor(index / PAGE_SIZE);
        }
      }
    } catch {
      message = 'Impossible d’enregistrer le bac.';
    } finally {
      saving = false;
      render();
      if (focus) {
        const match = Array.from(dlg.querySelectorAll<HTMLElement>('[data-focus]'))
          .find((el) => el.dataset.focus === focus && !el.matches(':disabled'));
        (match ?? dlg.querySelector<HTMLElement>('[data-focus="new"]'))?.focus();
      }
    }
  }

  function render() {
    const crates = state.crates;
    const crate = crates.find((c) => c.id === active) ?? crates[0];
    active = crate?.id;
    const paths = crate?.paths ?? [];
    page = Math.min(page, Math.max(0, Math.ceil(paths.length / PAGE_SIZE) - 1));
    const tracks = paths.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const remaining = opts.selected.filter((p) => !paths.includes(p));
    const make = h('input', { value: draft, maxLength: 80, placeholder: 'Nom du nouveau bac', 'aria-label': 'Nom du nouveau bac',
      'data-focus': 'new', oninput: (e: Event) => { draft = (e.target as HTMLInputElement).value; } });
    const button = (label: string | Node, onclick: () => void, attrs: Record<string, unknown> = {}) =>
      h('button', { type: 'button', class: 'btn small ghost', onclick, ...attrs }, label);
    const open = (fn: () => void) => { dlg.close(); fn(); };
    const title = crate && h('input', { value: crate.name, maxLength: 80, 'aria-label': 'Nom du bac' });

    dlg.replaceChildren(h('div', {},
      h('h2', { id: 'dlg-crates-title' }, 'Bacs de préparation'),
      h('form', { class: 'hrow crate-create', onsubmit: (e: Event) => {
        e.preventDefault();
        void act({ type: 'create', name: draft, paths: opts.selected }, 'new');
      }},
      make, h('button', { type: 'submit', class: 'btn small' }, opts.selected.length ? 'Créer avec la sélection' : 'Créer un bac')),
      h('p', { role: 'status', class: 'muted' }, message),
      h('div', { class: 'crate-layout' },
        h('div', { class: 'crate-sidebar', 'aria-label': 'Bacs enregistrés' }, ...crates.map((item) =>
          button(document.createTextNode(item.name), () => { active = item.id; page = 0; render(); }, {
            'aria-pressed': String(item.id === active), title: item.name,
          }),
        )),
        crate && title ? h('section', { class: 'crate-content', 'aria-label': 'Morceaux du bac' },
          h('form', { class: 'hrow', onsubmit: (e: Event) => {
            e.preventDefault();
            void act({ type: 'rename', id: crate.id, name: title.value });
          } }, title, h('button', { type: 'submit', class: 'btn small ghost' }, 'Renommer')),
          h('div', { class: 'hrow' },
            remaining.length ? button('Ajouter la sélection', () => void act({ type: 'add', id: crate.id, paths: remaining })) : null,
            button('Afficher dans la bibliothèque', () => open(() => opts.show(crate.id))),
            button('Exporter le bac…', () => open(() => opts.export(crate)), { disabled: !paths.length }),
          ),
          !paths.length ? h('p', { class: 'muted' }, 'Ce bac est vide.') : null,
          h('ol', { class: 'crate-tracks', start: page * PAGE_SIZE + 1 }, ...tracks.map((path, i) => {
            const record = state.tracks.get(path);
            const label = [record?.result?.title || record?.fileName || path.split(/[\\/]/).pop(), record?.result?.artist].filter(Boolean).join(' — ');
            const index = page * PAGE_SIZE + i;
            return h('li', {},
              h('span', { title: label }, document.createTextNode(label)),
              h('div', { class: 'hrow' },
                button('↑', () => void act({ type: 'move', id: crate.id, path, direction: -1 }, `up:${path}`),
                  { disabled: index === 0, 'data-focus': `up:${path}`, 'aria-label': 'Monter le morceau' }),
                button('↓', () => void act({ type: 'move', id: crate.id, path, direction: 1 }, `down:${path}`),
                  { disabled: index + 1 >= paths.length, 'data-focus': `down:${path}`, 'aria-label': 'Descendre le morceau' }),
                button('×', () => void act({ type: 'remove', id: crate.id, paths: [path] }), { 'aria-label': 'Retirer du bac' }),
              ),
            );
          })),
          paths.length > PAGE_SIZE ? h('div', { class: 'hrow' },
            button('Précédent', () => { page--; render(); }, { disabled: page === 0 }),
            button('Suivant', () => { page++; render(); }, { disabled: (page + 1) * PAGE_SIZE >= paths.length }),
          ) : null,
          button('Supprimer le bac', () => {
            if (confirm(tr('Supprimer ce bac de préparation ?'))) void act({ type: 'delete', id: crate.id });
          }),
        ) : null,
      ),
      h('div', { class: 'dlg-actions' }, button('Fermer', () => dlg.close())),
    ));
  }

  render();
  dlg.showModal();
}
