import type { UpdateStatus } from '../shared/update';
import type { AnalysisResult } from '../core/types';
import type { Profile } from '../core/profiles';
import type { AdapterInfo, CueKodaApi, QueueState, Settings, TrackRecord } from '../shared/api';

declare global {
  interface Window {
    cuekoda: CueKodaApi;
  }
}

export const api = window.cuekoda;

export const state = {
  tracks: new Map<string, TrackRecord>(),
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

export const doneResults = (): AnalysisResult[] =>
  [...state.tracks.values()].filter((r) => r.status === 'done' && r.result).map((r) => r.result!);

export const allProfiles = (): Profile[] => [...state.builtinProfiles, ...(state.settings?.customProfiles ?? [])];

export function applyTheme(theme: Settings['theme']) {
  document.documentElement.dataset.theme = theme;
}

// ---- undo / redo of track edits (cues, loops, sections) -----------------------------
type Snapshot = { path: string; data: Pick<AnalysisResult, 'cues' | 'loops' | 'sections'> };
const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
const snap = (r: AnalysisResult): Snapshot => ({
  path: r.path,
  data: structuredClone({ cues: r.cues, loops: r.loops, sections: r.sections }),
});

export const history = {
  /** Call BEFORE mutating a track */
  push(r: AnalysisResult) {
    undoStack.push(snap(r));
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  },
  undo(): string | null {
    const s = undoStack.pop();
    if (!s) return null;
    const r = state.tracks.get(s.path)?.result;
    if (!r) return null;
    redoStack.push(snap(r));
    Object.assign(r, s.data);
    return s.path;
  },
  redo(): string | null {
    const s = redoStack.pop();
    if (!s) return null;
    const r = state.tracks.get(s.path)?.result;
    if (!r) return null;
    undoStack.push(snap(r));
    Object.assign(r, s.data);
    return s.path;
  },
  canUndo: () => undoStack.length > 0,
  canRedo: () => redoStack.length > 0,
};
