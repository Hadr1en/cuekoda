import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectAudioFiles } from '../core/scan';
import { AUDIO_EXTENSIONS } from '../core/types';

/**
 * Watch folders: new audio files are reported once their size has stopped changing (copy finished).
 * Source files are only read — never moved, renamed or modified.
 */
export class FolderWatcher {
  private watchers = new Map<string, { watcher: fs.FSWatcher; pending: Map<string, NodeJS.Timeout> }>();
  /** path → size already reported (no duplicate notifications for the same file) */
  private reported = new Map<string, number>();

  constructor(
    private onFile: (file: string, folder: string) => void,
    private onEvent: (folder: string, message: string, level: 'info' | 'error') => void,
  ) {}

  /** Starts / stops watchers to match the given folder list. */
  sync(folders: { path: string; enabled: boolean }[], paused: boolean): void {
    const wanted = new Set(paused ? [] : folders.filter((f) => f.enabled).map((f) => f.path));
    for (const folder of this.watchers.keys()) if (!wanted.has(folder)) this.stop(folder);
    for (const folder of wanted) {
      if (this.watchers.has(folder)) continue;
      if (!fs.existsSync(folder)) {
        this.onEvent(folder, 'Dossier introuvable', 'error');
        continue;
      }
      try {
        const w = fs.watch(folder, { recursive: true }, (_evt, name) => {
          if (!name) return;
          const full = path.join(folder, name.toString());
          if (AUDIO_EXTENSIONS.includes(path.extname(full).toLowerCase())) this.checkStable(full, folder);
        });
        w.on('error', (e) => this.onEvent(folder, `Surveillance interrompue : ${e.message}`, 'error'));
        this.watchers.set(folder, { watcher: w, pending: new Map() });
        // files that arrived while the app was closed or the watch was paused
        for (const f of collectAudioFiles([folder])) this.checkStable(f, folder);
      } catch (e) {
        this.onEvent(folder, `Impossible de surveiller ce dossier : ${(e as Error).message}`, 'error');
      }
    }
  }

  /** Waits until the file size is stable over two checks 1.5 s apart (copy finished). */
  private checkStable(file: string, folder: string, lastSize = -1): void {
    const pending = this.watchers.get(folder)?.pending;
    if (!pending) return;
    const prev = pending.get(file);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      pending.delete(file);
      let size: number;
      try {
        const st = fs.statSync(file);
        if (!st.isFile()) return;
        size = st.size;
      } catch {
        return; // deleted or renamed meanwhile
      }
      if (this.reported.get(file) === size) return;
      if (size > 0 && size === lastSize) this.report(file, folder);
      else this.checkStable(file, folder, size);
    }, 1500);
    pending.set(file, t);
  }

  private report(file: string, folder: string): void {
    let size = -1;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (this.reported.get(file) === size) return;
    this.reported.set(file, size);
    this.onFile(file, folder);
  }

  private stop(folder: string): void {
    const w = this.watchers.get(folder);
    if (!w) return;
    this.watchers.delete(folder);
    w.watcher.close();
    for (const timer of w.pending.values()) clearTimeout(timer);
  }

  close(): void {
    for (const folder of this.watchers.keys()) this.stop(folder);
  }
}
