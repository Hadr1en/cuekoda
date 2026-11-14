import type { CueKind, LoopKind, RGB } from './types';

/**
 * DJ style profiles are plain data (no per-genre code): the cue / loop / mix engines read
 * these settings. Users can clone a built-in profile into a custom one and edit every field.
 */
export interface Profile {
  id: string;
  name: string;
  builtin: boolean;
  /** Tempo folding window (max must be ≤ 2 × min) */
  minBpm: number;
  maxBpm: number;
  /** Maximum number of hot cues to place (1..8) */
  maxCues: number;
  /** Cue kinds by priority — when there are more candidates than pads, the first ones win */
  cuePriority: CueKind[];
  /** Cue kinds never suggested */
  excludeKinds: CueKind[];
  colors: Record<CueKind, RGB>;
  /** Pad ordering: chronological (A = earliest) or by priority (A = most important) */
  slotOrder: 'chronological' | 'priority';
  /** Minimum distance between two cues, in bars */
  minCueSpacingBars: number;
  /** Loop lengths offered, in beats */
  loopBeats: number[];
  loopKinds: LoopKind[];
  /** Preferred transition length in bars (mix windows) */
  transitionBars: number;
  /** 'edm' names sections intro/build/drop/breakdown/outro; 'generic' avoids forcing an EDM shape */
  vocabulary: 'edm' | 'generic';
  /** Write each hot cue also as a memory cue (rekordbox) */
  memoryCues: boolean;
}

/** Initial palette from the specification: green intro, blue vocal, yellow break, violet build, red drop, cyan outro. */
export const DEFAULT_COLORS: Record<CueKind, RGB> = {
  intro: [40, 226, 20],
  groove: [140, 220, 80],
  vocal: [48, 110, 255],
  break: [255, 210, 0],
  build: [160, 90, 255],
  drop: [255, 40, 40],
  outro: [0, 210, 220],
  kickout: [150, 160, 170],
  mixin: [255, 255, 255],
  mixout: [255, 140, 0],
  custom: [222, 68, 207],
};

export const CUE_KIND_LABEL: Record<CueKind, string> = {
  intro: 'Intro',
  groove: 'Groove',
  vocal: 'Vocal',
  break: 'Break',
  build: 'Build',
  drop: 'Drop',
  outro: 'Outro',
  kickout: 'Kick out',
  mixin: 'Mix In',
  mixout: 'Mix Out',
  custom: 'Cue',
};

const base = {
  builtin: true,
  maxCues: 8,
  excludeKinds: [] as CueKind[],
  colors: DEFAULT_COLORS,
  slotOrder: 'chronological' as const,
  minCueSpacingBars: 4,
  memoryCues: true,
};

export const BUILTIN_PROFILES: Profile[] = [
  {
    ...base,
    id: 'edm',
    name: 'EDM',
    minBpm: 90,
    maxBpm: 180,
    cuePriority: ['drop', 'build', 'break', 'intro', 'outro', 'groove', 'mixout', 'kickout', 'mixin', 'vocal'],
    loopBeats: [4, 8, 16, 32],
    loopKinds: ['intro', 'predrop', 'outro'],
    transitionBars: 16,
    vocabulary: 'edm',
  },
  {
    ...base,
    id: 'house',
    name: 'House',
    minBpm: 110,
    maxBpm: 135,
    cuePriority: ['intro', 'groove', 'outro', 'mixin', 'mixout', 'break', 'drop', 'build', 'kickout', 'vocal'],
    loopBeats: [16, 32],
    loopKinds: ['intro', 'outro'],
    transitionBars: 32,
    vocabulary: 'edm',
  },
  {
    ...base,
    id: 'techhouse',
    name: 'Tech House',
    minBpm: 115,
    maxBpm: 135,
    cuePriority: ['intro', 'groove', 'break', 'drop', 'outro', 'mixin', 'mixout', 'build', 'kickout', 'vocal'],
    loopBeats: [8, 16, 32],
    loopKinds: ['intro', 'outro', 'predrop'],
    transitionBars: 32,
    vocabulary: 'edm',
  },
  {
    ...base,
    id: 'techno',
    name: 'Techno',
    minBpm: 115,
    maxBpm: 160,
    maxCues: 6,
    cuePriority: ['intro', 'groove', 'break', 'outro', 'mixin', 'mixout', 'drop', 'kickout', 'build', 'vocal'],
    loopBeats: [16, 32],
    loopKinds: ['intro', 'outro'],
    transitionBars: 32,
    minCueSpacingBars: 8,
    vocabulary: 'generic',
  },
  {
    ...base,
    id: 'trance',
    name: 'Trance',
    minBpm: 120,
    maxBpm: 150,
    cuePriority: ['drop', 'build', 'break', 'intro', 'outro', 'groove', 'mixout', 'mixin', 'kickout', 'vocal'],
    loopBeats: [8, 16, 32],
    loopKinds: ['intro', 'predrop', 'outro'],
    transitionBars: 32,
    vocabulary: 'edm',
  },
  {
    ...base,
    id: 'hiphop',
    name: 'Hip-Hop',
    minBpm: 70,
    maxBpm: 140,
    cuePriority: ['vocal', 'drop', 'break', 'intro', 'outro', 'mixin', 'mixout', 'groove'],
    excludeKinds: ['kickout', 'build'],
    loopBeats: [4, 8],
    loopKinds: ['intro', 'outro'],
    transitionBars: 8,
    minCueSpacingBars: 2,
    vocabulary: 'generic',
    memoryCues: false,
  },
  {
    ...base,
    id: 'openformat',
    name: 'Open Format',
    minBpm: 80,
    maxBpm: 160,
    cuePriority: ['intro', 'drop', 'break', 'vocal', 'outro', 'mixin', 'mixout', 'groove', 'build'],
    loopBeats: [4, 8, 16],
    loopKinds: ['intro', 'outro'],
    transitionBars: 16,
    vocabulary: 'generic',
  },
];

export const CUSTOM_TEMPLATE: Profile = { ...BUILTIN_PROFILES[0], id: 'custom', name: 'Custom', builtin: false };

export function findProfile(id: string | undefined, custom: Profile[] = []): Profile {
  return [...custom, ...BUILTIN_PROFILES].find((p) => p.id === id) ?? BUILTIN_PROFILES[0];
}

/** Ensures a (possibly user-edited) profile is usable. */
export function sanitizeProfile(p: Profile): Profile {
  const minBpm = Math.max(40, Math.min(200, p.minBpm || 90));
  let maxBpm = Math.max(minBpm + 10, Math.min(260, p.maxBpm || 180));
  if (maxBpm > minBpm * 2) maxBpm = minBpm * 2; // folding window cannot exceed one octave
  return {
    ...p,
    minBpm,
    maxBpm,
    maxCues: Math.max(1, Math.min(8, Math.round(p.maxCues || 8))),
    minCueSpacingBars: Math.max(1, Math.min(32, Math.round(p.minCueSpacingBars || 4))),
    colors: { ...DEFAULT_COLORS, ...(p.colors ?? {}) },
    loopBeats: (p.loopBeats ?? []).filter((b) => [4, 8, 16, 32, 64].includes(b)),
  };
}
