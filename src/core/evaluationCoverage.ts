import type { Reference } from './evaluate';
import { BEATPORT_GENRES, beatportGenre, type GenreFamily, type RhythmMode } from './genres';

export const COVERAGE_TARGET_TRACKS = 180;

export interface EvaluationCoverage {
  tracks: number;
  genres: string[];
  genreFamilies: Record<GenreFamily, number>;
  missingBeatportGenres: string[];
  rhythms: Record<RhythmMode, number>;
  vocalStyles: Record<string, number>;
  bpmBands: Record<string, number>;
  scenarios: Record<string, number>;
  annotations: { grid: number; key: number; cues: number; sections: number; vocals: number; energy: number };
  targetMet: boolean;
}

const BPM_BANDS = [
  { name: '<80', accepts: (bpm: number) => bpm < 80 },
  { name: '80–99', accepts: (bpm: number) => bpm >= 80 && bpm < 100 },
  { name: '100–119', accepts: (bpm: number) => bpm >= 100 && bpm < 120 },
  { name: '120–129', accepts: (bpm: number) => bpm >= 120 && bpm < 130 },
  { name: '130–149', accepts: (bpm: number) => bpm >= 130 && bpm < 150 },
  { name: '150–179', accepts: (bpm: number) => bpm >= 150 && bpm < 180 },
  { name: '≥180', accepts: (bpm: number) => bpm >= 180 },
] as const;

export function evaluationCoverage(refs: Reference[]): EvaluationCoverage {
  const genres = [...new Set(refs.map((ref) => ref.genre?.trim()).filter((genre): genre is string => !!genre))].sort();
  const familyNames: GenreFamily[] = ['mainstage', 'house', 'techno', 'trance', 'hard-dance', 'drum-and-bass', 'bass', 'global', 'open-format'];
  const rhythmNames: RhythmMode[] = ['four-on-floor', 'broken', 'half-time', 'open'];
  const genreFamilies = Object.fromEntries(familyNames.map((name) => [name, 0])) as Record<GenreFamily, number>;
  const rhythms = Object.fromEntries(rhythmNames.map((name) => [name, 0])) as Record<RhythmMode, number>;
  const coveredParents = new Set<string>();
  for (const ref of refs) {
    const matched = beatportGenre(ref.genre);
    if (matched) coveredParents.add(matched.name);
    const family = ref.genreFamily ?? matched?.family;
    const rhythm = ref.rhythm ?? matched?.rhythm;
    if (family) genreFamilies[family]++;
    if (rhythm) rhythms[rhythm]++;
  }
  const missingBeatportGenres = BEATPORT_GENRES.map(({ name }) => name).filter((name) => !coveredParents.has(name));
  const bpmBands = Object.fromEntries(BPM_BANDS.map(({ name }) => [name, 0]));
  for (const ref of refs) {
    if (ref.bpm) {
      const band = BPM_BANDS.find(({ accepts }) => accepts(ref.bpm!));
      if (band) bpmBands[band.name]++;
    }
  }
  const scenarios = Object.fromEntries(['steady', 'variable', 'live', 'edit'].map((name) => [name, refs.filter((ref) => ref.scenario === name).length]));
  const vocalStyles = Object.fromEntries(['instrumental', 'sung', 'rap-spoken', 'chops', 'mixed', 'unknown']
    .map((name) => [name, refs.filter((ref) => ref.vocalStyle === name).length]));
  const annotations = {
    grid: refs.filter((ref) => ref.firstDownbeatSec !== undefined || ref.beats?.length).length,
    key: refs.filter((ref) => ref.key || ref.keyCamelot).length,
    cues: refs.filter((ref) => ref.cues?.length).length,
    sections: refs.filter((ref) => ref.sections?.length).length,
    vocals: refs.filter((ref) => ref.vocalSegments?.length).length,
    energy: refs.filter((ref) => ref.energyRating !== undefined).length,
  };
  const coveredBands = Object.values(bpmBands).filter((count) => count > 0).length;
  const coveredFamilies = Object.values(genreFamilies).filter((count) => count > 0).length;
  const coveredRhythms = Object.values(rhythms).filter((count) => count > 0).length;
  return {
    tracks: refs.length, genres, genreFamilies, missingBeatportGenres, rhythms, vocalStyles, bpmBands, scenarios, annotations,
    targetMet: refs.length >= COVERAGE_TARGET_TRACKS && coveredFamilies === familyNames.length
      && coveredRhythms === rhythmNames.length && coveredBands >= 6,
  };
}
