import type { AnalysisResult, AnalyzeOptions } from '../core/types';
import type { BatchSummary, QueueState } from '../shared/api';

/** Minimal surface of a worker_threads Worker (lets the queue be unit-tested with fakes). */
export interface WorkerLike {
  postMessage(m: unknown): void;
  on(event: 'message', cb: (m: WorkerMessage) => void): unknown;
  on(event: 'error', cb: (e: Error) => void): unknown;
  on(event: 'exit', cb: (code: number) => void): unknown;
  terminate(): unknown;
}

export type WorkerMessage =
  | { type: 'progress'; id: number; stage: string; fraction: number }
  | { type: 'result'; id: number; result: AnalysisResult; cached: boolean }
  | { type: 'error'; id: number; error: string };

export interface Job {
  path: string;
  options: Partial<AnalyzeOptions>;
  force: boolean;
}

export interface QueueHooks {
  start(path: string): void;
  progress(path: string, stage: string, fraction: number): void;
  result(path: string, result: AnalysisResult, cached: boolean): void;
  error(path: string, message: string): void;
  cancelled(path: string): void;
  state(s: QueueState): void;
  drained(s: BatchSummary): void;
}

interface Slot {
  worker: WorkerLike;
  job: (Job & { id: number }) | null;
}

/**
 * Batch analysis queue: parallel workers (configurable limit), pause / resume, cancellation,
 * per-file failures that never block the rest, and a summary when the batch drains.
 */
export class AnalysisQueue {
  private pending: Job[] = [];
  private slots: Slot[] = [];
  private nextId = 1;
  private paused = false;
  private batch: BatchSummary & { start: number } = { done: 0, cached: 0, errors: 0, cancelled: 0, durationMs: 0, start: 0 };
  private active = false;

  constructor(
    private factory: () => WorkerLike,
    private hooks: QueueHooks,
    private extra: () => { cacheDir: string },
    public maxWorkers = 2,
  ) {}

  state(): QueueState {
    return {
      pending: this.pending.length,
      running: this.slots.filter((s) => s.job).length,
      paused: this.paused,
      maxWorkers: this.maxWorkers,
    };
  }

  has(path: string): boolean {
    return this.pending.some((j) => j.path === path) || this.slots.some((s) => s.job?.path === path);
  }

  enqueue(job: Job): void {
    const i = this.pending.findIndex((j) => j.path === job.path);
    if (i >= 0) this.pending[i] = job;
    else if (!this.slots.some((s) => s.job?.path === job.path)) this.pending.push(job);
    if (!this.active) {
      this.active = true;
      this.batch = { done: 0, cached: 0, errors: 0, cancelled: 0, durationMs: 0, start: Date.now() };
    }
    this.pump();
  }

  pause(): void {
    this.paused = true;
    this.emit();
  }

  resume(): void {
    this.paused = false;
    this.pump();
  }

  setMaxWorkers(n: number): void {
    this.maxWorkers = Math.max(1, Math.round(n));
    this.pump();
  }

  /** Cancels the given paths (or everything): pending jobs are dropped, running ones are stopped. */
  cancel(paths?: string[]): void {
    const match = (p: string) => !paths || paths.includes(p);
    const dropped = this.pending.filter((j) => match(j.path));
    this.pending = this.pending.filter((j) => !match(j.path));
    for (const j of dropped) {
      this.batch.cancelled++;
      this.hooks.cancelled(j.path);
    }
    for (const s of [...this.slots]) {
      if (s.job && match(s.job.path)) {
        const p = s.job.path;
        s.job = null;
        this.dropSlot(s);
        this.batch.cancelled++;
        this.hooks.cancelled(p);
      }
    }
    this.pump();
  }

  shutdown(): void {
    this.pending = [];
    for (const s of [...this.slots]) this.dropSlot(s);
  }

  private dropSlot(s: Slot): void {
    const i = this.slots.indexOf(s);
    if (i >= 0) this.slots.splice(i, 1);
    try {
      s.worker.terminate();
    } catch {
      /* already gone */
    }
  }

  private spawn(): Slot {
    const slot: Slot = { worker: this.factory(), job: null };
    slot.worker.on('message', (m: WorkerMessage) => {
      const job = slot.job;
      if (!job || m.id !== job.id) return;
      if (m.type === 'progress') {
        this.hooks.progress(job.path, m.stage, m.fraction);
        return;
      }
      slot.job = null;
      if (m.type === 'result') {
        this.batch.done++;
        if (m.cached) this.batch.cached++;
        this.hooks.result(job.path, m.result, m.cached);
      } else {
        this.batch.errors++;
        this.hooks.error(job.path, m.error);
      }
      this.pump();
    });
    const crashed = (msg: string) => {
      const job = slot.job;
      slot.job = null;
      this.dropSlot(slot);
      if (job) {
        this.batch.errors++;
        this.hooks.error(job.path, msg);
      }
      this.pump();
    };
    slot.worker.on('error', (e: Error) => crashed(`analyse interrompue : ${e.message}`));
    slot.worker.on('exit', (code: number) => {
      if (slot.job) crashed(`le processus d’analyse s’est arrêté (code ${code})`);
    });
    this.slots.push(slot);
    return slot;
  }

  private pump(): void {
    // Retire excess workers as they become idle before assigning any pending work.
    if (this.slots.length > this.maxWorkers) {
      for (const slot of [...this.slots]) {
        if (this.slots.length <= this.maxWorkers) break;
        if (!slot.job) this.dropSlot(slot);
      }
    }
    while (!this.paused && this.pending.length) {
      let slot = this.slots.find((s) => !s.job);
      if (!slot && this.slots.length < this.maxWorkers) slot = this.spawn();
      if (!slot) break;
      const job = this.pending.shift()!;
      const id = this.nextId++;
      slot.job = { ...job, id };
      this.hooks.start(job.path);
      slot.worker.postMessage({ id, file: job.path, options: job.options, force: job.force, ...this.extra() });
    }
    this.emit();
    if (this.active && !this.pending.length && !this.slots.some((s) => s.job)) {
      this.active = false;
      const { start, ...rest } = this.batch;
      this.hooks.drained({ ...rest, durationMs: Date.now() - start });
    }
  }

  private emit(): void {
    this.hooks.state(this.state());
  }
}
