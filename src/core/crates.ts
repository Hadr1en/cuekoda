export interface PrepCrate {
  id: string;
  name: string;
  paths: string[];
}

export type CrateAction =
  | { type: 'create'; name: string; paths: string[] }
  | { type: 'rename'; id: string; name: string }
  | { type: 'delete'; id: string }
  | { type: 'add' | 'remove'; id: string; paths: string[] }
  | { type: 'move'; id: string; path: string; direction: -1 | 1 };

export interface CrateResponse {
  crates: PrepCrate[];
  id?: string;
  error?: string;
}

/** Applies a single operation to the latest saved list, keeping each crate in playlist order. */
export function applyCrateAction(
  crates: PrepCrate[], action: CrateAction, knownTrack: (path: string) => boolean, newId: () => string,
): CrateResponse {
  if (action.type === 'create' || action.type === 'rename') {
    const name = action.name.trim().slice(0, 80);
    if (!name) return { crates, error: 'Saisis le nom du bac.' };
    if (crates.some((c) => c.name.toLowerCase() === name.toLowerCase() && (action.type === 'create' || c.id !== action.id))) {
      return { crates, error: 'Un bac porte déjà ce nom.' };
    }
    if (action.type === 'create') {
      const id = newId();
      return { crates: [...crates, { id, name, paths: [...new Set(action.paths.filter(knownTrack))] }], id };
    }
    if (!crates.some((c) => c.id === action.id)) return { crates };
    return { crates: crates.map((c) => c.id === action.id ? { ...c, name } : c), id: action.id };
  }

  const current = crates.find((c) => c.id === action.id);
  if (!current) return { crates };
  if (action.type === 'delete') return { crates: crates.filter((c) => c !== current) };
  let paths = current.paths;
  switch (action.type) {
    case 'add':
      paths = [...new Set([...paths, ...action.paths.filter(knownTrack)])];
      break;
    case 'remove': {
      const removed = new Set(action.paths);
      paths = paths.filter((p) => !removed.has(p));
      break;
    }
    case 'move': {
      const index = paths.indexOf(action.path);
      const target = index + action.direction;
      if (index < 0 || target < 0 || target >= paths.length) return { crates, id: current.id };
      paths = [...paths];
      [paths[index], paths[target]] = [paths[target], paths[index]];
      break;
    }
  }
  return { crates: crates.map((c) => c === current ? { ...c, paths } : c), id: current.id };
}

/** Explicit removals and recognized library moves also update saved crates. */
export function replaceCratePaths(
  crates: PrepCrate[], remove: ReadonlySet<string>, movedTo?: string,
): PrepCrate[] {
  if (!crates.some((crate) => crate.paths.some((p) => remove.has(p)))) return crates;
  return crates.map((crate) => {
    if (!crate.paths.some((p) => remove.has(p))) return crate;
    const paths = crate.paths.flatMap((p) => remove.has(p) ? (movedTo ? [movedTo] : []) : [p]);
    return { ...crate, paths: [...new Set(paths)] };
  });
}
