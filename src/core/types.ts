/**
 * CueKoda data model.
 *
 * Conventions:
 *  - `origin: 'auto'` = produced by the analysis engine (may be replaced by a re-analysis);
 *    `origin: 'user'` or `locked: true` = owned by the DJ, never overwritten automatically.
 *  - Confidence is qualitative (high / medium / low) until scores are calibrated on annotated data.
 *  - Tag / file metadata is kept apart from algorithmic results (`meta` vs the rest).
 */

/** Version of the analysis engine — bump when results can change, so cached analyses are recomputed. */
export const ENGINE_VERSION = '0.4.9';

export type Confidence = 'high' | 'medium' | 'low';
export type Origin = 'auto' | 'user';
export type RGB = [number, number, number];

/** Musical function of a cue — drives its colour and its priority in DJ profiles. */
export type CueKind =
  | 'intro'
  | 'groove'
  | 'vocal'
  | 'break'
  | 'build'
  | 'drop'
  | 'outro'
  | 'kickout'
  | 'mixin'
  | 'mixout'
  | 'custom';

/**
 * Specific landmark a cue was derived from (e.g. 'drop1' vs 'drop2'). Kept for traceability and tests.
 * Legacy pad roles of v0.1 are a subset of these.
 */
export type CueRole =
  | 'intro'
  | 'groove'
  | 'build1'
  | 'drop1'
  | 'break1'
  | 'build2'
  | 'drop2'
  | 'outro'
  | 'kickout'
  | 'mixin'
  | 'mixout'
  | 'vocal'
  | 'custom';

export interface HotCue {
  id: string;
  /** Pad 0..7 = A..H; −1 = memory cue (no pad: rekordbox memory cue, Traktor stored cue) */
  slot: number;
  role: CueRole;
  kind: CueKind;
  name: string;
  /** Position in seconds from the start of the file */
  timeSec: number;
  /** Bar index (0 based, relative to the grid's first downbeat) */
  bar: number;
  color: RGB;
  confidence: Confidence;
  /** Short human readable justification */
  reason: string;
  origin: Origin;
  locked?: boolean;
}

export type LoopKind = 'intro' | 'outro' | 'predrop' | 'breakdown' | 'custom';

export interface Loop {
  id: string;
  kind: LoopKind;
  name: string;
  startSec: number;
  /** Length in beats (4, 8, 16, 32 …) */
  beats: number;
  bar: number;
  confidence: Confidence;
  reason: string;
  origin: Origin;
  /** Only accepted loops are exported by default */
  accepted: boolean;
  locked?: boolean;
}

export type SectionType =
  | 'intro'
  | 'verse'
  | 'chorus'
  | 'break'
  | 'breakdown'
  | 'build'
  | 'drop'
  | 'instrumental'
  | 'outro'
  | 'section';

export interface Section {
  id: string;
  type: SectionType;
  /** Free label (defaults to the type's display name) */
  label: string;
  startBar: number;
  endBar: number;
  startSec: number;
  endSec: number;
  /** Mean energy 0..1 over the section */
  energy: number;
  confidence: Confidence;
  origin: Origin;
}

export interface PhraseInfo {
  /** Detected phrase length in bars (8, 16, 32) or null when the track has no regular phrasing */
  lengthBars: number | null;
  /** Bar index phrases are counted from */
  originBar: number;
  /** Share of strong section changes that land on a phrase boundary (0..1) */
  regularity: number;
  /** Bar indices of phrase starts (empty when lengthBars is null) */
  bars: number[];
}

export interface EnergyEvent {
  bar: number;
  timeSec: number;
  type: 'rise' | 'fall' | 'peak';
  /** Change on the 0..1 energy scale */
  delta: number;
}

export interface EnergyInfo {
  /** Algorithmic estimate on a 1..10 scale (comparable between tracks of this library) */
  score: number;
  /** Per-bar energy 0..1 */
  curve: number[];
  events: EnergyEvent[];
}

export interface TempoInfo {
  method?: 'essentia' | 'deep-rhythm' | 'manual';
  bpm: number;
  confidence: Confidence;
  /** true when local tempo varies by more than ~1 % across the track */
  variable: boolean;
  /** Local tempo range measured over track segments */
  localMin: number;
  localMax: number;
  /** Plausible alternatives (half / double / initial estimate) for one-click correction */
  alternatives: number[];
  /** A half-time grid also supported by acoustic evidence. The DJ can choose which pulse to use. */
  competingBpm?: number;
  /** Unfolded initial estimate, before fitting the grid */
  rawEstimate: number;
}

export interface KeyAlternative {
  camelot: string;
  musical: string;
  openKey: string;
  /** Share of the votes 0..1, when the same estimator provided a comparable score */
  weight?: number;
}

export interface KeyResult {
  method?: 'profiles' | 'openkeyscan' | 'manual';
  /** e.g. "8A" */
  camelot: string;
  /** e.g. "Am" */
  musical: string;
  /** Open Key notation e.g. "1m" */
  openKey: string;
  /** Strength of the leading candidate on a 0..1 scale */
  confidence: number;
  level?: Confidence;
  /** Several keys are plausible: shown as such instead of a falsely precise answer */
  ambiguous?: boolean;
  alternatives?: KeyAlternative[];
  /**
   * Probable key changes (e.g. a key lift for the last chorus): a stretch of ≥ 60 s whose own key differs
   * clearly from the main key. Unvalidated: shown as a hint, never exported as the track key.
   */
  changes?: KeyChange[];
}

export interface KeyChange {
  startSec: number;
  endSec: number;
  camelot: string;
  musical: string;
  openKey: string;
}

export interface LoudnessInfo {
  /** EBU R128 integrated loudness (ffmpeg ebur128 filter) */
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDbtp: number | null;
  /** RMS of the mono mix (dBFS) */
  rmsDb: number;
  /** Peak-to-RMS ratio of the mono mix (dB) — a simple dynamics indicator */
  crestDb: number;
}

export interface MixSuggestion {
  timeSec: number;
  bar: number;
  /** Length of the usable window in bars */
  lengthBars: number;
  reason: string;
  confidence: Confidence;
  /** Vocal content of the window according to the (unvalidated) vocal detector */
  vocals?: 'none' | 'light' | 'strong' | 'unknown';
}

export interface VocalSegment {
  startBar: number;
  /** exclusive */
  endBar: number;
  startSec: number;
  endSec: number;
  /** Mean per-bar score 0..1 over the segment */
  score: number;
  /** 'strong' = clear, prominent voice; 'light' = weaker evidence (backing vocals, chops, or a false positive) */
  strength: 'strong' | 'light';
  /** Never 'high' while the detector is not validated on annotated material */
  confidence: Confidence;
  /** 'user' = placed or corrected by the DJ */
  origin?: Origin;
}

/** Vocal detection (spec §9) — local spectral heuristic, see core/vocals.ts. */
export interface VocalInfo {
  /** Detector id, e.g. 'voice_instrumental-musicnn-msd-2+spectral-fluctuation-v1' or 'spectral-fluctuation-v1' (fallback) */
  method: string;
  runtime?: 'onnx' | 'wasm';
  /** false until measured against verified annotations */
  validated: boolean;
  /** Per-bar vocal score 0..1 (smoothed) */
  curve: number[];
  /** Per-bar presence after hysteresis */
  present: boolean[];
  segments: VocalSegment[];
  /** Share of the audible bars with vocals (0..1) */
  coverage: number;
  /** Share of frames with measurable harmonic content (400 Hz–4 kHz); too low = detection uninformative */
  tonalShare: number;
  /** false = nothing to judge (heuristic alone on non-harmonic audio): presence reported as 'unknown' */
  informative?: boolean;
  /** Per-bar P(voice) of the local model (when it ran) and the heuristic score, for transparency */
  modelCurve?: number[];
  heuristicCurve?: number[];
  /** Overall reliability of the detection for this track */
  level: Confidence;
  note?: string;
  /** true once the DJ edited the vocal parts: re-analysis keeps their segments */
  edited?: boolean;
}

export interface TrackInfo {
  path: string;
  fileName: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: string;
  durationSec: number;
  bitrate: number;
  sampleRate: number;
  sizeBytes: number;
  kind: string;
  /** File / tag metadata (not algorithmic) */
  channels?: number;
  codec?: string;
  container?: string;
  lossless?: boolean;
  /** BPM / key already written in the tags by another tool, if any */
  tagBpm?: number;
  tagKey?: string;
}

export interface BeatGrid {
  bpm: number;
  /** Time (s) of the first downbeat (beat 1 of a bar) */
  firstDownbeatSec: number;
  /** 0..1 how well the grid fits the audio over the whole track */
  confidence: number;
  downbeatConfidence?: Confidence;
}

/** Manual corrections that drive a re-analysis */
export interface Overrides {
  bpm?: number;
  firstDownbeatSec?: number;
  /** Musical key name, e.g. "F#m" */
  key?: string;
}

export interface AnalysisResult extends TrackInfo {
  engineVersion?: string;
  /** Cues / loops taken from the DJ's existing collection (rekordbox XML, Traktor NML) */
  importedFrom?: { source: 'rekordbox' | 'traktor'; cues: number; loops: number };
  /** SHA-256 of the file content (cache key + exact duplicate detection) */
  fileHash?: string;
  profileId?: string;
  bpm: number;
  tempo?: TempoInfo;
  grid: BeatGrid;
  key: KeyResult;
  loudness?: LoudnessInfo;
  energy?: EnergyInfo;
  phrases?: PhraseInfo;
  sections?: Section[];
  cues: HotCue[];
  loops?: Loop[];
  mix?: { mixIn: MixSuggestion[]; mixOut: MixSuggestion[] };
  /** Vocal presence per bar + segments (engine ≥ 0.3.0) */
  vocals?: VocalInfo;
  /** Chromagram per bar for duplicate / related-version detection (core/fingerprint.ts) */
  /** Tempo markers when the tempo changes (≥ 2 entries); absent for constant-tempo tracks (spec §3.2) */
  tempoMap?: import('./tempomap').TempoMarker[];
  fingerprint?: import('./fingerprint').Fingerprint;
  overrides?: Overrides;
  /** Overview waveform, 0..1 values */
  wave: number[];
  waveLow: number[];
  /** 3-band waveform (mids 150 Hz–2.5 kHz, highs above), same scale as `wave`; absent in older analyses */
  waveMid?: number[];
  waveHigh?: number[];
  /** Human readable warnings (low confidence, variable tempo, ...) */
  warnings: string[];
  analysisMs: number;
}

export interface AnalyzeOptions {
  /** Preferred BPM window: detected BPM is folded (x2 or /2) into [minBpm, maxBpm) */
  minBpm: number;
  maxBpm: number;
  /** Number of overview waveform points */
  wavePoints: number;
  /** DJ style profile id (see profiles.ts) */
  profileId?: string;
  /** Full profile object (takes precedence over profileId) */
  profile?: import('./profiles').Profile;
  overrides?: Overrides;
  /** Cue kinds the user keeps deleting (from learning.ts) */
  suppressKinds?: CueKind[];
  /** Progress callback (0..1) — used by worker threads */
  onProgress?: (stage: string, fraction: number) => void;
}

export const DEFAULT_OPTIONS: AnalyzeOptions = {
  minBpm: 90,
  maxBpm: 180,
  wavePoints: 1200,
};

export const AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.flac',
  '.aif',
  '.aiff',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.wma',
];
