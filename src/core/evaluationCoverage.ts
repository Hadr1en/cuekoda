import type { Reference } from './evaluate';

export interface EvaluationCoverage {
  tracks: number;
  genres: string[];
  bpmBands: Record<string, number>;
  scenarios: Record<string, number>;
  annotations: { grid: number; key: number; cues: number; sections: number; vocals: number; energy: number };
  targetMet: boolean;
}

const BPM_BANDS = [
  { name: '<100', accepts: (bpm: number) => bpm < 100 },
  { name: '100–119', accepts: (bpm: number) => bpm >= 100 && bpm < 120 },
  { name: '120–129', accepts: (bpm: number) => bpm >= 120 && bpm < 130 },
  { name: '130–149', accepts: (bpm: number) => bpm >= 130 && bpm < 150 },
  { name: '≥150', accepts: (bpm: number) => bpm >= 150 },
] as const;

export function evaluationCoverage(refs: Reference[]): EvaluationCoverage {
  const genres = [...new Set(refs.map((ref) => ref.genre?.trim()).filter((genre): genre is string => !!genre))].sort();
  const bpmBands = Object.fromEntries(BPM_BANDS.map(({ name }) => [name, 0]));
  for (const ref of refs) {
    if (ref.bpm) {
      const band = BPM_BANDS.find(({ accepts }) => accepts(ref.bpm!));
      if (band) bpmBands[band.name]++;
    }
  }
  const scenarios = Object.fromEntries(['steady', 'variable', 'live', 'edit'].map((name) => [name, refs.filter((ref) => ref.scenario === name).length]));
  const annotations = {
    grid: refs.filter((ref) => ref.firstDownbeatSec !== undefined || ref.beats?.length).length,
    key: refs.filter((ref) => ref.key || ref.keyCamelot).length,
    cues: refs.filter((ref) => ref.cues?.length).length,
    sections: refs.filter((ref) => ref.sections?.length).length,
    vocals: refs.filter((ref) => ref.vocalSegments?.length).length,
    energy: refs.filter((ref) => ref.energyRating !== undefined).length,
  };
  const coveredBands = Object.values(bpmBands).filter((count) => count > 0).length;
  return { tracks: refs.length, genres, bpmBands, scenarios, annotations, targetMet: refs.length >= 100 && genres.length >= 5 && coveredBands >= 4 };
}
