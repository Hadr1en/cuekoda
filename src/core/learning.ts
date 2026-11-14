import type { CueKind } from './types';

/**
 * Learning from corrections — deliberately simple, transparent statistics (no opaque model):
 * how often each cue kind was suggested, deleted or moved. A kind the DJ deletes almost every
 * time is no longer suggested. Everything is local and can be reset.
 */
export interface KindStats {
  suggested: number;
  deleted: number;
  moved: number;
  /** Sum of manual shifts, in beats (positive = later) */
  shiftBeats: number;
}

export interface LearningStats {
  version: 1;
  kinds: Partial<Record<CueKind, KindStats>>;
}

export const MIN_SAMPLES = 5;
export const SUPPRESS_RATE = 0.8;

export const emptyStats = (): LearningStats => ({ version: 1, kinds: {} });

const get = (s: LearningStats, k: CueKind): KindStats =>
  (s.kinds[k] ??= { suggested: 0, deleted: 0, moved: 0, shiftBeats: 0 });

export function recordSuggested(s: LearningStats, kinds: CueKind[]): void {
  for (const k of kinds) get(s, k).suggested++;
}
export function recordDeleted(s: LearningStats, kind: CueKind): void {
  get(s, kind).deleted++;
}
export function recordMoved(s: LearningStats, kind: CueKind, beats: number): void {
  const st = get(s, kind);
  st.moved++;
  st.shiftBeats += beats;
}

/** Kinds deleted in ≥ 80 % of at least 5 suggestions. */
export function suppressedKinds(s: LearningStats): CueKind[] {
  return (Object.entries(s.kinds) as [CueKind, KindStats][])
    .filter(([, v]) => v.suggested >= MIN_SAMPLES && v.deleted / v.suggested >= SUPPRESS_RATE)
    .map(([k]) => k);
}

/** Human readable summary for the settings panel. */
export function describe(s: LearningStats): string[] {
  return (Object.entries(s.kinds) as [CueKind, KindStats][])
    .filter(([, v]) => v.suggested > 0)
    .map(([k, v]) => {
      const del = Math.round((v.deleted / v.suggested) * 100);
      const avg = v.moved ? ` · déplacé ${v.moved}× (moy. ${(v.shiftBeats / v.moved).toFixed(1)} temps)` : '';
      return `${k} : proposé ${v.suggested}×, supprimé ${del} %${avg}`;
    });
}
