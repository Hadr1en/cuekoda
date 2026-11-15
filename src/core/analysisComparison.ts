import type { AnalysisResult } from './types';

export function comparisonPoint(r: AnalysisResult) {
  return {
    bpm: r.bpm, grid: r.grid, durationSec: r.durationSec, tempoMap: r.tempoMap,
    cues: r.cues.map(({ slot, kind, name, timeSec }) => ({ slot, kind, name, timeSec })),
  };
}

export type ComparisonPoint = ReturnType<typeof comparisonPoint>;

export function analysisChanges(before: ComparisonPoint, after: ComparisonPoint) {
  const bpm = Math.abs(before.bpm - after.bpm) >= 0.01;
  const oldMap = before.tempoMap ?? [];
  const newMap = after.tempoMap ?? [];
  const grid = Math.abs(before.grid.firstDownbeatSec - after.grid.firstDownbeatSec) >= 0.005
    || oldMap.length !== newMap.length || oldMap.some((marker, i) =>
      marker.beatInBar !== newMap[i].beatInBar
      || Math.abs(marker.startSec - newMap[i].startSec) >= 0.005
      || Math.abs(marker.bpm - newMap[i].bpm) >= 0.01);

  const order = (r: ComparisonPoint) => [...r.cues].sort((a, b) =>
    a.slot - b.slot || a.timeSec - b.timeSec || a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
  const a = order(before);
  const b = order(after);
  const cues = a.length !== b.length || a.some((c, i) =>
    c.slot !== b[i].slot || c.kind !== b[i].kind || c.name !== b[i].name || Math.abs(c.timeSec - b[i].timeSec) >= 0.01);
  return { bpm, grid, cues };
}

export type AnalysisChanges = ReturnType<typeof analysisChanges>;

export interface AnalysisComparison {
  before: ComparisonPoint;
  after: ComparisonPoint;
  changes: AnalysisChanges;
}
