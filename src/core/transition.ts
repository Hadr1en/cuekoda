import type { AnalysisResult, HotCue, MixSuggestion } from './types';

/**
 * Beatmatched transition preview A → B (spec "surprise" feature): where A starts handing over, where B
 * comes in, and how fast B must play so that its beats land on A's. Pure planning — playback is done by
 * the renderer with two audio elements (B pitch-preserved, so its key does not move).
 */
export interface TransitionPlan {
  /** A's mix-out point (bar-aligned): B starts here */
  outSec: number;
  /** B's mix-in point (bar-aligned) */
  inSec: number;
  /** B's playback rate (1 = original tempo) */
  rate: number;
  /** B's tempo as heard during the blend, in A's BPM */
  matchedBpm: number;
  /** Crossfade length, in A's seconds */
  fadeSec: number;
  fadeBars: number;
  /** Preview window on A's timeline */
  startASec: number;
  endASec: number;
  /** Human-readable explanation of the choices */
  notes: string[];
}

/** Largest tempo change a DJ would apply without it sounding wrong (±8 % = a standard pitch fader). */
export const MAX_RATE_CHANGE = 0.08;

const barLen = (t: AnalysisResult) => (4 * 60) / t.bpm;
const snapBar = (t: AnalysisResult, sec: number) => {
  const L = barLen(t);
  const d0 = t.grid.firstDownbeatSec;
  return Math.max(d0, d0 + Math.round((sec - d0) / L) * L);
};

/** Usable suggestion window attached to the chosen point (within one bar). */
const windowAt = (items: MixSuggestion[] | undefined, sec: number, bpm: number): number | undefined => {
  if (!items?.length) return undefined;
  const closest = [...items].sort((a, b) => Math.abs(a.timeSec - sec) - Math.abs(b.timeSec - sec))[0];
  return Math.abs(closest.timeSec - sec) <= 4 * 60 / bpm ? closest.lengthBars : undefined;
};

const standardFade = (available: number): number => [16, 8, 4, 2, 1].find((bars) => bars <= available) ?? 1;
const cueOf = (t: AnalysisResult, ...kinds: HotCue['kind'][]) => {
  for (const k of kinds) {
    const c = t.cues.filter((x) => x.kind === k).sort((a, b) => a.timeSec - b.timeSec);
    if (c.length) return c;
  }
  return [];
};

export function planTransition(
  a: AnalysisResult,
  b: AnalysisResult,
  opts: { fadeBars?: number; leadBars?: number; tailBars?: number } = {},
): TransitionPlan | { error: string } {
  const notes: string[] = [];
  // tempo: allow half / double time notation, then the smallest change
  const ks = [0.5, 1, 2];
  const k = ks.reduce((best, x) => (Math.abs(a.bpm - b.bpm * x) < Math.abs(a.bpm - b.bpm * best) ? x : best), 1);
  const rate = a.bpm / (b.bpm * k);
  if (Math.abs(rate - 1) > MAX_RATE_CHANGE) {
    return { error: `Écart de tempo trop grand (${a.bpm.toFixed(1)} → ${b.bpm.toFixed(1)} BPM) : il faudrait ${((rate - 1) * 100).toFixed(1)} %` };
  }
  if (k !== 1) notes.push(`B est noté en ${k === 2 ? 'demi' : 'double'}-tempo (${b.bpm.toFixed(1)} BPM)`);
  notes.push(`B joué à ${(rate * 100).toFixed(1)} % (${(b.bpm * k).toFixed(1)} → ${a.bpm.toFixed(1)} BPM), tonalité conservée`);

  // A: the DJ's Mix Out cue, else the suggestion, else the outro, else 32 bars before the end
  const LA = barLen(a);
  const outCue = cueOf(a, 'mixout', 'outro');
  let out = outCue.length ? outCue[outCue.length - 1].timeSec : a.mix?.mixOut?.[0]?.timeSec;
  let outWhy = outCue.length ? `cue ${outCue[outCue.length - 1].name}` : out !== undefined ? 'suggestion Mix Out' : '';
  if (out === undefined) { out = a.durationSec - 32 * LA; outWhy = '32 mesures avant la fin'; }
  out = snapBar(a, out);

  // B: the DJ's Mix In cue, else the suggestion, else the intro cue, else B's first downbeat
  const inCue = cueOf(b, 'mixin', 'intro');
  let inn = inCue.length ? inCue[0].timeSec : b.mix?.mixIn?.[0]?.timeSec;
  let inWhy = inCue.length ? `cue ${inCue[0].name}` : inn !== undefined ? 'suggestion Mix In' : '';
  if (inn === undefined) { inn = b.grid.firstDownbeatSec; inWhy = 'premier temps 1'; }
  inn = snapBar(b, inn);
  notes.push(`A sort à ${fmt(out)} (${outWhy}), B entre à ${fmt(inn)} (${inWhy})`);

  // Crossfade: never extend beyond the clean windows used by matching. The default preview uses
  // standard DJ phrase lengths (16 / 8 / 4 bars); an explicit caller length is only capped.
  const requestedFade = opts.fadeBars ?? 16;
  const outWindow = windowAt(a.mix?.mixOut, out, a.bpm);
  const inWindow = windowAt(b.mix?.mixIn, inn, b.bpm);
  const availableWindow = outWindow !== undefined && inWindow !== undefined ? Math.min(outWindow, inWindow) : undefined;
  let fadeBars = availableWindow === undefined
    ? requestedFade
    : opts.fadeBars === undefined ? standardFade(Math.min(requestedFade, availableWindow)) : Math.min(requestedFade, availableWindow);
  if (fadeBars < requestedFade && availableWindow !== undefined) notes.push(`fondu limité à ${fadeBars} mesures (fenêtre propre : ${availableWindow})`);
  const remainingBars = (a.durationSec - out) / LA;
  if (remainingBars <= 0) return { error: 'Aucune durée disponible après le point Mix Out' };
  while (fadeBars > 1 && out + fadeBars * LA > a.durationSec) fadeBars /= 2;
  if (fadeBars > remainingBars) fadeBars = remainingBars;
  if (fadeBars < requestedFade && (availableWindow === undefined || fadeBars < standardFade(Math.min(requestedFade, availableWindow)))) {
    notes.push(`fondu raccourci à ${Number(fadeBars.toFixed(2))} mesures (fin de A)`);
  }
  const fadeSec = fadeBars * LA;
  const startASec = Math.max(0, out - (opts.leadBars ?? 8) * LA);
  const endASec = Math.min(a.durationSec, out + fadeSec + (opts.tailBars ?? 4) * LA);
  return { outSec: out, inSec: inn, rate, matchedBpm: a.bpm, fadeSec, fadeBars, startASec, endASec, notes };
}

/** Where B should be (its own media time) when A is at `aSec`, once the blend has started. */
export function bTimeAt(plan: TransitionPlan, aSec: number): number {
  return plan.inSec + (aSec - plan.outSec) * plan.rate;
}

/** Equal-power crossfade gains at A time `aSec`. */
export function fadeGains(plan: TransitionPlan, aSec: number): { a: number; b: number } {
  const x = Math.min(1, Math.max(0, (aSec - plan.outSec) / plan.fadeSec));
  return { a: Math.cos((x * Math.PI) / 2), b: Math.sin((x * Math.PI) / 2) };
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}
