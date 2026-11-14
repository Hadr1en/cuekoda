import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Small JSON persistence: atomic writes (tmp file + rename), debounced saves, tolerant reads
 * (a corrupt file is moved aside instead of crashing the app).
 */
export class JsonStore<T> {
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private file: string,
    public data: T,
  ) {
    try {
      if (fs.existsSync(file)) this.data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      try {
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        /* ignore */
      }
    }
  }

  save(delayMs = 800): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delayMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

/** Copies an existing file aside before it is overwritten; returns the backup path. */
export function backupIfExists(file: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = `${file}.backup-${stamp}`;
  fs.copyFileSync(file, backup);
  return backup;
}

/**
 * The library: a small index (library.json, no analysis data) plus one file per analysed track
 * (results/<id>.json). A save rewrites the index and only the results that changed — with thousands of
 * tracks the old single file (waveforms included) was rewritten in full after every edit.
 * A result counts as changed when its object was replaced (analysis, edit from the UI, import) or when
 * touch(path) says it was modified in place.
 */
export class LibraryStore<R extends object, T extends { path: string; result?: R }> {
  data: { version: 2; tracks: Record<string, T> } = { version: 2, tracks: {} };
  private written = new WeakSet<object>();
  private touched = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private readonly resultsDir: string;

  constructor(private file: string) {
    this.resultsDir = path.join(path.dirname(file), 'results');
    let raw: { version?: number; tracks?: Record<string, T & { hasResult?: boolean }> } = {};
    try {
      if (fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      try {
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        /* ignore */
      }
    }
    for (const [p, rec] of Object.entries(raw.tracks ?? {})) {
      const { hasResult, ...r } = rec;
      const t = r as unknown as T;
      if (raw.version === 2 && hasResult) {
        try {
          t.result = JSON.parse(fs.readFileSync(this.resultFile(p), 'utf8'));
          this.written.add(t.result as object);
        } catch {
          /* result file lost: the track is simply re-analysed (cache) */
        }
      }
      // version 1: the result is inline → not in `written`, so the first save moves it to its own file
      this.data.tracks[p] = t;
    }
  }

  resultFile(p: string): string {
    return path.join(this.resultsDir, `${createHash('sha1').update(p).digest('hex').slice(0, 24)}.json`);
  }

  /** A result was modified in place (not replaced): write it at the next save. */
  touch(p: string): void {
    this.touched.add(p);
  }

  save(delayMs = 800): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delayMs);
  }

  /** Number of result files written by the last flush (tests / smoke report). */
  lastWritten = 0;

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(this.resultsDir, { recursive: true });
    const index: Record<string, unknown> = {};
    this.lastWritten = 0;
    for (const [p, t] of Object.entries(this.data.tracks)) {
      const { result, ...rest } = t;
      index[p] = { ...rest, hasResult: !!result };
      if (result && (!this.written.has(result) || this.touched.has(p))) {
        const f = this.resultFile(p);
        fs.writeFileSync(`${f}.tmp`, JSON.stringify(result));
        fs.renameSync(`${f}.tmp`, f);
        this.written.add(result);
        this.lastWritten++;
      }
    }
    this.touched.clear();
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 2, tracks: index }));
    fs.renameSync(tmp, this.file);
  }
}
