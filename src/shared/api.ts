import type { CrateAction, CrateResponse, PrepCrate } from '../core/crates';
import type { AnalysisChanges, AnalysisComparison } from '../core/analysisComparison';
import type { KeyNotation } from '../core/key';
import type { AnalysisResult, Overrides } from '../core/types';
import type { Profile } from '../core/profiles';
import type { ExportOptions, ExportTargetId } from '../core/export/index';
import type { traktorPlan } from '../core/export/traktor';
import type { Peaks } from '../core/peaks';
import type { UpdateStatus } from './update';
import type { ImportedTrack } from '../core/import/collection';
import type { LangSetting } from './i18n';

export type TrackStatus = 'queued' | 'analyzing' | 'done' | 'error' | 'cancelled';

/** One entry of the persistent library. */
export interface TrackRecord {
  path: string;
  fileName: string;
  status: TrackStatus;
  /** 0..1 while analysing */
  progress?: number;
  stage?: string;
  error?: string;
  /** true when the last result came from the cache */
  cached?: boolean;
  result?: AnalysisResult;
  addedAt: number;
  /** Cues from the DJ's collection waiting for the analysis to finish (applied then removed) */
  imported?: ImportedTrack;
  /** The DJ checked this track (removes it from the "to review" list until it is re-analysed) */
  reviewedAt?: number;
  compareNext?: number;
  comparison?: { batch: number; changes: AnalysisChanges; edited?: boolean };
  /** The file is no longer at this path (moved / renamed / disk not connected) */
  missing?: boolean;
}

export interface ImportSummary {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  source?: 'rekordbox' | 'traktor';
  /** tracks of the collection found in CueKoda (or added) */
  matched: number;
  added: number;
  /** collection entries whose file was not found on this computer */
  notFound: number;
  cues: number;
  gridTaken: boolean;
}

export interface TrackEvent {
  path: string;
  record: TrackRecord;
}

export interface QueueState {
  pending: number;
  running: number;
  paused: boolean;
  maxWorkers: number;
}

export interface BatchSummary {
  done: number;
  cached: number;
  errors: number;
  cancelled: number;
  durationMs: number;
}

export interface WatchFolder {
  path: string;
  enabled: boolean;
}

export interface Settings {
  profileId: string;
  customProfiles: Profile[];
  maxWorkers: number;
  watchFolders: WatchFolder[];
  watchPaused: boolean;
  autoAnalyzeWatched: boolean;
  learningEnabled: boolean;
  exportOptions: ExportOptions;
  /** Dark by default (DJ use); 'system' follows the OS */
  theme: 'dark' | 'light' | 'system';
  keyNotation?: KeyNotation;
  /** Check GitHub for a new CueKoda build at start-up (only GitHub is contacted; installing needs a click) */
  autoUpdateCheck: boolean;
  /** Interface language ('system' follows the OS locale) */
  language?: LangSetting;
}

export interface WatchEvent {
  folder: string;
  message: string;
  level: 'info' | 'error';
}

export interface ExportPreview {
  lines: string[];
  readyPaths: string[];
}

export interface ExportResponse {
  ok: boolean;
  file?: string;
  backup?: string;
  canceled?: boolean;
  error?: string;
  exportOptions?: ExportOptions;
}

export interface AdapterInfo {
  id: ExportTargetId;
  name: string;
  tagline: string;
  via?: 'rekordbox' | 'traktor';
  formatName: string;
  capabilities: { field: string; support: 'yes' | 'partial' | 'no'; note: string }[];
  howToImport: string[];
}

export type TrackEdits = Pick<AnalysisResult, 'cues' | 'loops' | 'sections' | 'vocals'>;

export interface InitialState {
  tracks: TrackRecord[];
  crates: PrepCrate[];
  settings: Settings;
  builtinProfiles: Profile[];
  queue: QueueState;
  adapters: AdapterInfo[];
  learning: string[];
  cores: number;
  /** fileHash → date of the DJ-verified reference */
  references: Record<string, string>;
  appVersion: string;
  /** CI build number of this app (null for a dev build) */
  appBuild: number | null;
  update: UpdateStatus;
}

export interface AddedFile {
  path: string;
  fileName: string;
}

/** API exposed to the renderer by the preload script (window.cuekoda). */
export interface CueKodaApi {
  init(): Promise<InitialState>;
  pathsForFiles(files: File[]): string[];
  pick(kind: 'files' | 'folder'): Promise<string[]>;
  addPaths(paths: string[]): Promise<AddedFile[]>;
  updateCrates(action: CrateAction): Promise<CrateResponse>;
  onCrates(cb: (crates: PrepCrate[]) => void): void;
  /** Re-analyse; user edits are kept. force = ignore the cache (e.g. new engine version). */
  reanalyze(paths: string[], force?: boolean): Promise<number>;
  applyPreparationProfile(paths: string[]): Promise<{ applied: number; needsAnalysis: number }>;
  analysisComparison(path: string): Promise<AnalysisComparison | null>;
  restoreAnalysis(path: string): Promise<boolean>;
  /** Manual BPM / downbeat / key correction → re-analysis with those values, edits kept */
  setOverrides(path: string, overrides: Overrides): Promise<void>;
  /** Hand a completed edit to the library immediately. Disk writes are batched by the main process. */
  saveTrackEdits(path: string, fileHash: string | undefined, edits: Partial<TrackEdits>): boolean;
  removeTracks(paths: string[]): Promise<void>;
  clear(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(paths?: string[]): Promise<void>;
  retryErrors(): Promise<void>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  learningEvent(e: { type: 'deleted' | 'moved'; kind: string; beats?: number }): void;
  resetLearning(): Promise<string[]>;
  traktorPlan(path: string, loops: ExportOptions['loops']): Promise<ReturnType<typeof traktorPlan> | null>;
  exportPreview(format: AdapterInfo['id'], paths: string[], opts: ExportOptions): Promise<ExportPreview>;
  exportCollection(format: AdapterInfo['id'], paths: string[], opts: ExportOptions): Promise<ExportResponse>;
  /** Reads a rekordbox XML / Traktor NML collection: the DJ's cues become locked cues (read-only on the file) */
  importCollection(): Promise<ImportSummary>;
  setReviewed(paths: string[], reviewed: boolean): Promise<void>;
  addWatchFolder(): Promise<Settings>;
  /** Store the current (checked) state of a track as a reference for engine evaluation (spec §21) */
  saveReference(path: string, energyRating?: number): Promise<Record<string, string>>;
  exportReferences(): Promise<ExportResponse>;
  /** High-resolution waveform of one track (computed on demand) */
  peaks(path: string): Promise<Peaks | null>;
  revealInFolder(path: string): void;
  onTrack(cb: (e: TrackEvent) => void): void;
  onQueue(cb: (q: QueueState) => void): void;
  onSummary(cb: (s: BatchSummary) => void): void;
  onWatch(cb: (e: WatchEvent) => void): void;
  /** A library entry disappeared on the main side (its file was found again under another path) */
  onRemoved(cb: (e: { path: string; movedTo?: string }) => void): void;
  checkUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  openExternal(url: string): void;
  onUpdate(cb: (s: UpdateStatus) => void): void;
}
