import * as fs from 'node:fs';
import * as path from 'node:path';

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
