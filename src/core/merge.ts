import type { AnalysisResult, HotCue, Loop, Section } from './types';

/**
 * Re-analysis must never erase the DJ's work. Anything the user created, edited (origin 'user') or
 * locked is carried over; fresh automatic suggestions only fill the gaps.
 */
export function mergeWithPrevious(fresh: AnalysisResult, prev: AnalysisResult | undefined): AnalysisResult {
  if (!prev) return fresh;
  const keepCue = (c: HotCue) => c.origin === 'user' || c.locked;
  const keepLoop = (l: Loop) => l.origin === 'user' || l.locked || l.accepted;

  // --- cues: user / locked cues keep their pads; auto cues take the free pads, away from user cues
  const userCues = prev.cues.filter(keepCue);
  const usedSlots = new Set(userCues.map((c) => c.slot));
  const autoCues = fresh.cues
    .filter((c) => !userCues.some((u) => Math.abs(u.timeSec - c.timeSec) < 0.5 || u.kind === c.kind && u.role === c.role))
    .sort((a, b) => a.timeSec - b.timeSec);
  const freeSlots = [0, 1, 2, 3, 4, 5, 6, 7].filter((s) => !usedSlots.has(s));
  const placed = autoCues.slice(0, freeSlots.length).map((c, i) => ({ ...c, slot: freeSlots[i] }));
  const cues = [...userCues, ...placed].sort((a, b) => a.slot - b.slot);

  // --- loops: keep accepted / user loops, add new suggestions that do not overlap them
  const keptLoops = (prev.loops ?? []).filter(keepLoop);
  const loops = [
    ...keptLoops,
    ...(fresh.loops ?? []).filter((l) => !keptLoops.some((k) => Math.abs(k.startSec - l.startSec) < 0.5)),
  ];

  // --- sections: once edited by the user, the whole timeline is the user's
  const userSections = (prev.sections ?? []).some((s: Section) => s.origin === 'user');
  const sections = userSections ? prev.sections : fresh.sections;

  return { ...fresh, cues, loops, sections, overrides: fresh.overrides ?? prev.overrides };
}
