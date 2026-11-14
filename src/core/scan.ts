import * as fs from 'node:fs';
import * as path from 'node:path';
import { AUDIO_EXTENSIONS } from './types';

/** Expands files and folders (recursively) into a de-duplicated list of audio file paths. */
export function collectAudioFiles(inputs: string[]): string[] {
  const out = new Set<string>();
  const walk = (p: string) => {
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(p);
      } catch {
        return;
      }
      for (const name of entries.sort()) {
        if (name.startsWith('.')) continue;
        walk(path.join(p, name));
      }
    } else if (st.isFile() && AUDIO_EXTENSIONS.includes(path.extname(p).toLowerCase())) {
      out.add(path.resolve(p));
    }
  };
  for (const i of inputs) walk(i);
  return [...out];
}
