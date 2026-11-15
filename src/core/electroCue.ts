import { percentile, prefixSums, rangeMean } from './dsp';
import weights from './electroCueModel.json';
import multiCorpusBreak from './electroBreakModel.json';
import type { CueCandidate } from './cues';
import type { HotCue } from './types';
import type { BarFeatures, Landmark, StructureAnalysis } from './structure';

export function landmarkFeatures(f: BarFeatures, s: StructureAnalysis): number[][] {
  const energy = f.energyDb;
  const low = f.lowDb;
  const bright = f.brightDb;
  const kick = f.kick.map((k) => Math.log1p(k));
  const inputs = [energy, low, bright, kick];
  const spreads = inputs.map((v) => {
    const tail = v.slice(s.origin);
    const min = percentile(tail, 10), max = percentile(tail, 90);
    return { min, span: Math.max(max - min, 0.01) };
  });
  const norm = inputs.map((v, i) => v.map((value) => {
    const { min, span } = spreads[i];
    return Math.max(-4, Math.min(4, (value - min) / span));
  }));
  const means = norm.map(prefixSums);
  const changes = new Map(s.changePoints.map((p) => [p.bar, p.strength]));
  const roll = (b: number) => ((b - s.phraseOrigin) % 4 + 4) % 4;
  return Array.from({ length: f.nBars }, (_, b) => {
    const row = [b / Math.max(f.nBars, 1), Math.min(b - s.origin, 40) / 40, changes.get(b) ?? 0, roll(b) === 0 ? 1 : 0];
    for (let k = 0; k < norm.length; k++) {
      const arr = norm[k];
      const prev = arr[Math.max(0, b - 1)];
      const next = arr[b];
      row.push(prev, next, next - prev);
      for (const span of [2, 4, 8]) {
        const past = rangeMean(means[k], Math.max(0, b - span), Math.max(1, b));
        const future = rangeMean(means[k], b, Math.min(f.nBars, b + span));
        row.push(past, future, future - past);
      }
      row.push(next - (arr[b + 1] ?? next), prev - (arr[b - 2] ?? prev));
    }
    return row;
  });
}

type CueModel = typeof weights.drop;

/** The model estimates the relative strength of a landmark at each bar. */
function landmarkScore(model: CueModel, features: number[]): number {
  let logit = model.intercept;
  for (const tree of model.trees) {
    let node = tree[0];
    while (node.length > 1) {
      const [feature, threshold, left, right] = node;
      node = tree[Math.fround(features[feature]) <= threshold ? left : right];
    }
    logit += node[0];
  }
  return 1 / (1 + Math.exp(-logit));
}

interface RankedBar {
  bar: number;
  score: number;
}

const cueReason = 'Repère électro proposé après comparaison des changements sur plusieurs mesures';

function rankAlternatives(
  scores: number[], origin: number, existing: Landmark[], occupied: Set<number>
): RankedBar[] {
  const ranked: RankedBar[] = [];
  for (let bar = origin + 3; bar < scores.length - 3; bar++) {
    if (!occupied.has(bar) && existing.every((cue) => Math.abs(cue.bar - bar) >= 4)) {
      ranked.push({ bar, score: scores[bar] });
    }
  }
  return ranked.sort((a, b) => b.score - a.score || a.bar - b.bar);
}

function recheckKind(
  existing: Landmark[], scores: number[], origin: number, floor: number, occupied: Set<number>
): { cues: Landmark[]; ranked: RankedBar[] } {
  const ranked = rankAlternatives(scores, origin, existing, occupied);
  const cues = [...existing];
  for (const [index, cue] of cues.entries()) {
    const alternative = ranked.find(({ bar }) => cues.every((old) => Math.abs(old.bar - bar) >= 4));
    if (alternative && alternative.score >= floor && alternative.score > scores[cue.bar] + 0.1) {
      cues[index] = { ...cue, bar: alternative.bar, confidence: 'medium', reason: cueReason };
    }
  }
  return { cues, ranked };
}

/** Reranks EDM cues and optionally offers a second breakdown using the same track features. */
export function refineElectroCues(
  f: BarFeatures, s: StructureAnalysis, compareBreakModels: boolean,
): { primary: Landmark[]; alternate?: Landmark[] } {
  if (f.nBars - s.origin < 16) return { primary: s.landmarks };
  const features = landmarkFeatures(f, s);
  const existingDrops = s.landmarks.filter(({ role }) => role === 'drop1' || role === 'drop2');
  const existingBreak = s.landmarks.filter(({ role }) => role === 'break1');
  const unchanged = s.landmarks.filter(({ role }) => role !== 'drop1' && role !== 'drop2' && role !== 'break1');

  const dropScores = features.map((row) => landmarkScore(weights.drop, row));
  const breakBars = new Set(existingBreak.map((cue) => cue.bar));
  const drops = recheckKind(existingDrops, dropScores, s.origin, 0.7, breakBars).cues
    .sort((a, b) => a.bar - b.bar)
    .map((cue, index): Landmark => ({ ...cue, role: existingDrops[index].role }));

  // Keep the drop positions available and require stronger evidence to add a new break.
  const dropBars = new Set(drops.map((cue) => cue.bar));
  const findBreaks = (model: CueModel) => {
    const scores = features.map((row) => landmarkScore(model, row));
    const breaks = recheckKind(existingBreak, scores, s.origin, 0.6, dropBars);
    const missing = breaks.ranked[0];
    if (breaks.cues.length === 0 && missing && missing.score >= 0.8) {
      breaks.cues.push({ role: 'break1', bar: missing.bar, confidence: 'medium', reason: cueReason });
    }
    return breaks.cues;
  };
  const sortedLandmarks = (breaks: Landmark[]) =>
    [...unchanged, ...drops, ...breaks].sort((a, b) => a.bar - b.bar);

  const breaks = findBreaks(weights.breakdown);
  const primary = sortedLandmarks(breaks);
  if (!compareBreakModels) return { primary };
  const alternateBreaks = findBreaks(multiCorpusBreak);
  const same = alternateBreaks.length === breaks.length && alternateBreaks.every((cue, i) => cue.bar === breaks[i].bar);
  return same ? { primary } : { primary, alternate: sortedLandmarks(alternateBreaks) };
}

/** Reposition the existing Break pad when a sustained, high-scoring break separates two drops. */
export function breakBetweenDrops(
  f: BarFeatures, structure: StructureAnalysis, cues: HotCue[], spacing: number,
): CueCandidate | undefined {
  const drops = cues.filter((cue) => cue.kind === 'drop').sort((a, b) => a.bar - b.bar);
  const current = cues.find((cue) => cue.kind === 'break');
  if (!current || drops.length !== 2) return;
  const first = drops[0].bar;
  const second = drops[1].bar;
  if ((current.bar > first && current.bar < second) || second - first < 8) return;

  const features = landmarkFeatures(f, structure);
  const low = prefixSums(f.lowDb);
  let candidate = -1;
  let best = 0.72;
  for (let bar = first + 4; bar <= second - 4 && bar < features.length - 3; bar++) {
    if (cues.some((cue) => cue.kind !== 'break' && Math.abs(cue.bar - bar) < spacing)) continue;
    if (rangeMean(low, bar - 4, bar) - rangeMean(low, bar, bar + 4) < 2) continue;
    const score = landmarkScore(multiCorpusBreak, features[bar]);
    if (score > best) { candidate = bar; best = score; }
  }
  if (candidate < 0) return;
  return {
    role: 'break1', kind: 'break', bar: candidate, confidence: 'medium',
    reason: 'Baisse d’énergie qui se prolonge entre les deux drops',
  };
}
