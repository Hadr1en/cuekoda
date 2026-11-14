import type { Profile } from './profiles';
import { CUE_KIND_LABEL } from './profiles';
import type { Landmark, LandmarkRole } from './structure';
import type { Confidence, CueKind, CueRole, HotCue, MixSuggestion, VocalInfo } from './types';

/**
 * Smart Cue Engine.
 *  1. Candidates come from the analysis (landmarks, mix suggestions, vocal entries) — never from a
 *     fixed interval.
 *  2. The DJ profile filters (excluded kinds, learned suppressions), ranks (priority) and limits them.
 *  3. Cues closer than `minCueSpacingBars` to a better-ranked cue are dropped (no redundant markers).
 *  4. Pads are assigned chronologically (A = earliest) or by priority, names / colours by function.
 */

export interface CueCandidate {
  role: CueRole;
  kind: CueKind;
  bar: number;
  confidence: Confidence;
  reason: string;
}

const ROLE_KIND: Record<LandmarkRole, CueKind> = {
  intro: 'intro',
  groove: 'groove',
  build1: 'build',
  build2: 'build',
  drop1: 'drop',
  drop2: 'drop',
  break1: 'break',
  outro: 'outro',
  kickout: 'kickout',
};

let idCounter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/** At most this many vocal-entry candidates per track (the detector is not validated: stay sparse). */
const MAX_VOCAL_CANDIDATES = 2;

/**
 * Vocal entries: start of each vocal segment of ≥ 4 bars, snapped to the 4-bar grid of the phrase
 * origin when within one bar (the per-bar score is smoothed, so the edge can be a bar early/late).
 * Confidence is capped at 'medium' ('low' for weak evidence) — see core/vocals.ts.
 */
export function vocalCandidates(vocals: VocalInfo | undefined, phraseOrigin = 0): CueCandidate[] {
  if (!vocals) return [];
  return vocals.segments
    .filter((s) => s.endBar - s.startBar >= 4)
    .slice(0, MAX_VOCAL_CANDIDATES)
    .map((s) => {
      const rel = s.startBar - phraseOrigin;
      const q = Math.round(rel / 4) * 4;
      const bar = Math.abs(rel - q) <= 1 ? Math.max(0, phraseOrigin + q) : s.startBar;
      const len = s.endBar - s.startBar;
      return {
        role: 'vocal' as CueRole,
        kind: 'vocal' as CueKind,
        bar,
        confidence: (s.strength === 'strong' ? 'medium' : 'low') as Confidence,
        reason: `Entrée de voix détectée (${len} mesures${s.strength === 'strong' ? '' : ', indice faible'}) — détection heuristique non validée`,
      };
    });
}

export function cueCandidates(
  landmarks: Landmark[],
  mix: { mixIn: MixSuggestion[]; mixOut: MixSuggestion[] } | undefined,
  vocals?: VocalInfo,
  phraseOrigin = 0,
): CueCandidate[] {
  const c: CueCandidate[] = landmarks.map((l) => ({
    role: l.role,
    kind: ROLE_KIND[l.role],
    bar: l.bar,
    confidence: l.confidence,
    reason: l.reason,
  }));
  for (const m of mix?.mixIn ?? []) c.push({ role: 'mixin', kind: 'mixin', bar: m.bar, confidence: m.confidence, reason: m.reason });
  for (const m of mix?.mixOut ?? []) c.push({ role: 'mixout', kind: 'mixout', bar: m.bar, confidence: m.confidence, reason: m.reason });
  c.push(...vocalCandidates(vocals, phraseOrigin));
  return c;
}

const CONF_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

export function selectCues(
  candidates: CueCandidate[],
  profile: Profile,
  grid: { d0: number; barLen: number },
  suppressKinds: CueKind[] = [],
): HotCue[] {
  const excluded = new Set<CueKind>([...profile.excludeKinds, ...suppressKinds]);
  const prio = (k: CueKind) => {
    const i = profile.cuePriority.indexOf(k);
    return i < 0 ? 99 : i;
  };
  const ranked = candidates
    .filter((c) => !excluded.has(c.kind))
    .sort((a, b) => prio(a.kind) - prio(b.kind) || CONF_RANK[a.confidence] - CONF_RANK[b.confidence] || a.bar - b.bar);

  const kept: CueCandidate[] = [];
  for (const c of ranked) {
    if (kept.length >= profile.maxCues) break;
    if (kept.some((k) => Math.abs(k.bar - c.bar) < profile.minCueSpacingBars)) continue;
    kept.push(c);
  }

  const ordered = profile.slotOrder === 'chronological' ? [...kept].sort((a, b) => a.bar - b.bar) : kept;
  // Explicit names: number repeated kinds in time order (Drop 1, Drop 2 …)
  const count: Partial<Record<CueKind, number>> = {};
  for (const c of kept) count[c.kind] = (count[c.kind] ?? 0) + 1;
  const seen: Partial<Record<CueKind, number>> = {};
  const nameOf = new Map<CueCandidate, string>();
  for (const c of [...kept].sort((a, b) => a.bar - b.bar)) {
    seen[c.kind] = (seen[c.kind] ?? 0) + 1;
    nameOf.set(c, (count[c.kind] ?? 0) > 1 ? `${CUE_KIND_LABEL[c.kind]} ${seen[c.kind]}` : CUE_KIND_LABEL[c.kind]);
  }
  return ordered.map((c, slot) => ({
    id: newId('c'),
    slot,
    role: c.role,
    kind: c.kind,
    name: nameOf.get(c)!,
    bar: c.bar,
    timeSec: Math.max(0, grid.d0 + c.bar * grid.barLen),
    color: profile.colors[c.kind],
    confidence: c.confidence,
    reason: c.reason,
    origin: 'auto',
  }));
}
