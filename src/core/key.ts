import { KeyResult } from './types';

const SEMITONE: Record<string, number> = {
  C: 0, 'B#': 0,
  'C#': 1, Db: 1,
  D: 2,
  'D#': 3, Eb: 3,
  E: 4, Fb: 4,
  F: 5, 'E#': 5,
  'F#': 6, Gb: 6,
  G: 7,
  'G#': 8, Ab: 8,
  A: 9,
  'A#': 10, Bb: 10,
  B: 11, Cb: 11,
};

/** Camelot number for each tonic semitone (0 = C) */
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1]; // C, Db, D, Eb, E, F, F#, G, Ab, A, Bb, B -> nB
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10]; // C, C#, D, Eb, E, F, F#, G, G#, A, Bb, B -> nA

const NAMES_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const NAMES_MINOR = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

export function keyFromTonic(tonic: string, scale: 'major' | 'minor', confidence: number): KeyResult | null {
  const semi = SEMITONE[tonic];
  if (semi === undefined) return null;
  const major = scale === 'major';
  const n = major ? CAMELOT_MAJOR[semi] : CAMELOT_MINOR[semi];
  // Open Key: 1d = C major, 1m = A minor ... = Camelot number shifted by 7 (8B -> 1d, 8A -> 1m)
  const open = ((n + 4) % 12) + 1;
  return {
    camelot: `${n}${major ? 'B' : 'A'}`,
    musical: major ? NAMES_MAJOR[semi] : NAMES_MINOR[semi],
    openKey: `${open}${major ? 'd' : 'm'}`,
    confidence,
  };
}

/** Traktor stores the key as an index: 0..11 = C..B major, 12..23 = Cm..Bm */
export function traktorKeyIndex(musical: string): number | null {
  const minor = musical.endsWith('m');
  const tonic = minor ? musical.slice(0, -1) : musical;
  const semi = SEMITONE[tonic];
  if (semi === undefined) return null;
  return minor ? 12 + semi : semi;
}

/** Builds a KeyResult from a musical name such as "F#m" or "Bb" (manual correction). */
export function keyFromMusical(musical: string, confidence = 1): KeyResult | null {
  const minor = musical.endsWith('m');
  return keyFromTonic(minor ? musical.slice(0, -1) : musical, minor ? 'minor' : 'major', confidence);
}

/** All 24 keys, in Camelot order (1A, 1B … 12A, 12B) — for the correction menu. */
export function allKeys(): KeyResult[] {
  const out: KeyResult[] = [];
  for (const n of NAMES_MINOR) out.push(keyFromMusical(n)!);
  for (const n of NAMES_MAJOR) out.push(keyFromMusical(n)!);
  return out.sort((a, b) => parseInt(a.camelot, 10) - parseInt(b.camelot, 10) || a.camelot.localeCompare(b.camelot));
}
