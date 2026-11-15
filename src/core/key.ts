import type { KeyResult } from './types';

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

export type KeyNotation = 'camelot' | 'openKey';

const openKeyNumber = (camelotNumber: number) => ((camelotNumber + 4) % 12) + 1;

export function formatKey(key: Pick<KeyResult, 'camelot' | 'openKey'>, notation: KeyNotation = 'camelot'): string {
  if (notation !== 'openKey') return key.camelot;
  if (key.openKey) return key.openKey;
  const code = /^(1[0-2]|[1-9])([AB])$/.exec(key.camelot);
  return code ? `${openKeyNumber(Number(code[1]))}${code[2] === 'A' ? 'm' : 'd'}` : '';
}

export function keyFromTonic(tonic: string, scale: 'major' | 'minor', confidence: number): KeyResult | null {
  const semi = SEMITONE[tonic];
  if (semi === undefined) return null;
  const major = scale === 'major';
  const n = major ? CAMELOT_MAJOR[semi] : CAMELOT_MINOR[semi];
  // Open Key: 1d = C major, 1m = A minor ... = Camelot number shifted by 7 (8B -> 1d, 8A -> 1m)
  const open = openKeyNumber(n);
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

export interface KeyVote {
  tonic: string;
  scale: 'major' | 'minor';
  strength: number;
}

/** Combine votes for the same key, including enharmonic names, from three profile families. */
export function electronicKeyFromVotes(segments: readonly KeyVote[], gate: KeyVote, minor: KeyVote): KeyResult {
  const scores = new Map<string, { key: KeyResult; weight: number; families: Set<string> }>();
  const strength = (vote: KeyVote) => Number.isFinite(vote.strength) ? Math.max(0.05, Math.min(1, vote.strength)) : 0;
  const add = (vote: KeyVote, family: string, weight: number) => {
    const key = keyFromTonic(vote.tonic, vote.scale, 0);
    const value = strength(vote) * weight;
    if (!key || value <= 0) return;
    const entry = scores.get(key.camelot) ?? { key, weight: 0, families: new Set<string>() };
    entry.families.add(family);
    entry.weight += value;
    scores.set(key.camelot, entry);
  };
  const segmentCount = Math.max(1, segments.length);
  for (const vote of segments) add(vote, 'edma', 1 / segmentCount);
  add(gate, 'bgate', 1);
  const gateKey = keyFromTonic(gate.tonic, gate.scale, 0);
  const minorKey = keyFromTonic(minor.tonic, minor.scale, 0);
  // The EDM-minor profile is useful for the tonic but tends to choose the minor mode.
  const relativeMinor = gate.scale === 'major' && minor.scale === 'minor' && gateKey && minorKey
    && gateKey.camelot.slice(0, -1) === minorKey.camelot.slice(0, -1);
  add(minor, 'edmm', relativeMinor ? 0.65 : 1.5);
  const ranked = [...scores.values()].sort((a, b) => b.weight - a.weight);
  const first = ranked[0];
  if (!first) return { camelot: '', musical: '', openKey: '', confidence: 0, level: 'low', ambiguous: true };
  const total = ranked.reduce((sum, entry) => sum + entry.weight, 0);
  const share = first.weight / total;
  const runnerUp = ranked[1]?.weight ?? 0;
  const mean = segments.reduce((sum, vote) => sum + strength(vote), 0) / segmentCount;
  const ambiguous = share < 0.55 || runnerUp / first.weight > 0.70;
  const high = !ambiguous && first.families.size === 3 && share >= 0.8 && mean >= 0.85;
  return {
    ...first.key,
    confidence: share * Math.min(1, mean / 0.6),
    level: ambiguous ? 'low' : high ? 'high' : 'medium',
    ambiguous,
    alternatives: ranked.slice(1)
      .filter(({ weight }) => weight / total >= 0.15).slice(0, 3)
      .map(({ key, weight }) => ({ camelot: key.camelot, musical: key.musical, openKey: key.openKey, weight: weight / total })),
  };
}
