import { pairScore, tempoGapPct, type MatchResult } from './matching';
import type { AnalysisResult } from './types';

/**
 * Mix-order SUGGESTION for a given list of tracks. It is a starting point, never applied by itself:
 * building the set is the DJ's job. Each transition keeps the reasons of the matching (key, tempo,
 * energy, transition windows) so the DJ can judge it.
 *
 * Cost of an order = Σ (100 − transition score) + weight × |energy − energy arc target| per position.
 * Search: greedy from several starts, then local improvement (2-opt reversals + moving one track),
 * deterministic for a given input.
 */
export type ArcShape = 'rise' | 'waves' | 'free';

export const ARC_LABEL: Record<ArcShape, string> = {
  rise: 'Montée progressive (pic aux trois quarts, légère redescente)',
  waves: 'Vagues (montées et respirations)',
  free: 'Libre (seulement tonalité et tempo)',
};

export interface SetStep {
  path: string;
  title: string;
  artist: string;
  bpm: number;
  camelot: string;
  energy: number | null;
  /** energy the arc would like at this position (null for 'free') */
  target: number | null;
  /** transition from the previous track */
  link?: MatchResult;
  /** that transition is hard (see isWeakLink) */
  weak: boolean;
}

export interface SetPlan {
  steps: SetStep[];
  shape: ArcShape;
  /** mean transition score (0–100) */
  meanScore: number;
  /** hard transitions: score below 40 or a tempo gap a pitch fader cannot absorb (> 8 %) */
  weakLinks: number;
}

/** A transition is hard when the scores are low or the tempo gap exceeds a ±8 % pitch fader. */
export const isWeakLink = (link: MatchResult, gapPct: number) => link.score < 40 || gapPct > 8;

/** Arc shape at relative position p ∈ [0, 1] → energy quantile ∈ [0, 1]. */
export function arcQuantile(shape: ArcShape, p: number): number | null {
  if (shape === 'free') return null;
  if (shape === 'rise') return p < 0.75 ? 0.1 + 0.9 * (p / 0.75) : 1 - 0.5 * ((p - 0.75) / 0.25);
  return 0.5 - 0.4 * Math.cos(2 * Math.PI * 1.5 * p);
}

const ARC_WEIGHT = 8; // cost per energy point away from the arc (one key clash ≈ 4 energy points)
export const MAX_TRACKS = 80;

export function suggestOrder(tracks: AnalysisResult[], opts: { shape?: ArcShape; startPath?: string } = {}): SetPlan {
  const shape = opts.shape ?? 'rise';
  const list = [...tracks].sort((a, b) => a.path.localeCompare(b.path)).slice(0, MAX_TRACKS);
  const n = list.length;
  if (n === 0) return { steps: [], shape, meanScore: 0, weakLinks: 0 };

  const energies = list.map((t) => t.energy?.score ?? null);
  const known = energies.filter((e): e is number => e !== null).sort((a, b) => a - b);
  const med = known.length ? known[known.length >> 1] : 5;
  const E = energies.map((e) => e ?? med);
  const quant = (q: number) => (known.length ? known[Math.min(known.length - 1, Math.round(q * (known.length - 1)))] : med);
  const targets = Array.from({ length: n }, (_, k) => {
    const q = arcQuantile(shape, n === 1 ? 0 : k / (n - 1));
    return q === null ? null : quant(q);
  });

  const pairs: MatchResult[][] = list.map((a) => list.map((b) => (a === b ? (null as never) : pairScore(a, b))));
  const gaps = list.map((a) => list.map((b) => tempoGapPct(a.bpm, b.bpm).pct));
  // an unmixable tempo gap weighs like two key clashes: such tracks end up at the edges of the set
  const C = pairs.map((row, i) => row.map((m, j) => (m ? 100 - m.score + (gaps[i][j] > 8 ? 60 : 0) : 0)));
  const arc = (k: number, i: number) => (targets[k] === null ? 0 : ARC_WEIGHT * Math.abs(E[i] - targets[k]!));
  const cost = (o: number[]) => {
    let c = 0;
    for (let k = 0; k < o.length; k++) {
      c += arc(k, o[k]);
      if (k > 0) c += C[o[k - 1]][o[k]];
    }
    return c;
  };

  const fixed = opts.startPath ? list.findIndex((t) => t.path === opts.startPath) : -1;
  // starts: the fixed one, or the tracks closest to the arc's opening energy (all of them when few)
  const starts = fixed >= 0
    ? [fixed]
    : [...list.keys()].sort((a, b) => arc(0, a) - arc(0, b) || a - b).slice(0, Math.min(n, 12));

  let best: number[] = [];
  let bestCost = Infinity;
  for (const s of starts) {
    const order = [s];
    const used = new Set(order);
    while (order.length < n) {
      const k = order.length;
      const prev = order[k - 1];
      let pick = -1;
      let pc = Infinity;
      for (let j = 0; j < n; j++) {
        if (used.has(j)) continue;
        const c = C[prev][j] + arc(k, j);
        if (c < pc) { pc = c; pick = j; }
      }
      order.push(pick);
      used.add(pick);
    }
    const c = cost(order);
    if (c < bestCost) { bestCost = c; best = order; }
  }

  // local improvement; position 0 stays put when the DJ chose the opener
  const lo = fixed >= 0 ? 1 : 0;
  for (let pass = 0; pass < 40; pass++) {
    let improved = false;
    for (let i = lo; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const rev = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const c = cost(rev);
        if (c < bestCost - 1e-9) { best = rev; bestCost = c; improved = true; }
      }
    }
    for (let i = lo; i < n; i++) {
      for (let j = lo; j < n; j++) {
        if (i === j) continue;
        const o = [...best];
        const [x] = o.splice(i, 1);
        o.splice(j, 0, x);
        const c = cost(o);
        if (c < bestCost - 1e-9) { best = o; bestCost = c; improved = true; }
      }
    }
    if (!improved) break;
  }

  const steps: SetStep[] = best.map((i, k) => ({
    path: list[i].path,
    title: list[i].title,
    artist: list[i].artist,
    bpm: list[i].bpm,
    camelot: list[i].key.camelot,
    energy: energies[i],
    target: targets[k],
    link: k > 0 ? pairs[best[k - 1]][i] : undefined,
    weak: k > 0 ? isWeakLink(pairs[best[k - 1]][i], gaps[best[k - 1]][i]) : false,
  }));
  const links = steps.slice(1).map((s) => s.link!.score);
  return {
    steps,
    shape,
    meanScore: links.length ? Math.round(links.reduce((a, b) => a + b, 0) / links.length) : 0,
    weakLinks: steps.filter((s) => s.weak).length,
  };
}
