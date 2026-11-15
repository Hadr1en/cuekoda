import type { PrepCrate } from '../core/crates';
import type { UpdateStatus } from '../shared/update';
import { formatKey } from '../core/key';
import type { AnalysisResult } from '../core/types';
import type { Profile } from '../core/profiles';
import type { AdapterInfo, CueKodaApi, QueueState, Settings, TrackEdits, TrackRecord } from '../shared/api';

declare global {
  interface Window {
    cuekoda: CueKodaApi;
  }
}

export const api = window.cuekoda;

export const state = {
  tracks: new Map<string, TrackRecord>(),
  crates: [] as PrepCrate[],
  settings: null as unknown as Settings,
  builtinProfiles: [] as Profile[],
  adapters: [] as AdapterInfo[],
  learning: [] as string[],
  cores: 1,
  queue: { pending: 0, running: 0, paused: false, maxWorkers: 1 } as QueueState,
  selected: null as string | null,
  references: {} as Record<string, string>,
  appVersion: '',
  appBuild: null as number | null,
  update: { state: 'idle' } as UpdateStatus,
};

export const keyLabel = (key: Pick<AnalysisResult['key'], 'camelot' | 'openKey'>): string =>
  formatKey(key, state.settings?.keyNotation);

export const doneResults = (): AnalysisResult[] =>
  [...state.tracks.values()].filter((r) => r.status === 'done' && r.result).map((r) => r.result!);

export const allProfiles = (): Profile[] => [...state.builtinProfiles, ...(state.settings?.customProfiles ?? [])];

export function applyTheme(theme: Settings['theme']) {
  document.documentElement.dataset.theme = theme;
}

// Completed edits are sent immediately, including undo/redo. Only fields changed by the gesture
// cross the process boundary, so a newer analysis keeps its engine data and manual BPM/key overrides.
export const snapshotEdits = ({ cues, loops, sections, vocals }: AnalysisResult): TrackEdits =>
  structuredClone({ cues, loops, sections, vocals });

export function changedEdits(before: TrackEdits, after: TrackEdits): Partial<TrackEdits> {
  const changed = (key: keyof TrackEdits) => JSON.stringify(before[key]) !== JSON.stringify(after[key]);
  return {
    ...(changed('cues') ? { cues: after.cues } : {}),
    ...(changed('loops') ? { loops: after.loops } : {}),
    ...(changed('sections') ? { sections: after.sections } : {}),
    ...(changed('vocals') ? { vocals: after.vocals } : {}),
  };
}

type Snapshot = { path: string; fileHash?: string; before: TrackEdits; after: TrackEdits };
const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];

function restore(from: Snapshot[], to: Snapshot[], side: 'before' | 'after') {
  while (from.length) {
    const entry = from.pop()!;
    const r = state.tracks.get(entry.path)?.result;
    if (!r || r.fileHash !== entry.fileHash) continue;
    const previous = snapshotEdits(r);
    const changed = changedEdits(entry.before, entry.after);
    const target = entry[side];
    for (const key of Object.keys(changed) as (keyof TrackEdits)[]) {
      Object.assign(r, { [key]: structuredClone(target[key]) });
    }
    to.push(entry);
    return { r, previous };
  }
  return null;
}

export const history = {
  push(r: AnalysisResult, before: TrackEdits) {
    undoStack.push({ path: r.path, fileHash: r.fileHash, before, after: snapshotEdits(r) });
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  },
  undo: () => restore(undoStack, redoStack, 'before'),
  redo: () => restore(redoStack, undoStack, 'after'),
  canUndo: () => undoStack.length > 0,
  canRedo: () => redoStack.length > 0,
};
