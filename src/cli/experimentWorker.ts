// One request per process. The Rust caller owns the private request directory.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { analyzeFile } from '../core/analyzer';
import { ADAPTERS } from '../core/export';
import { cueAt, newId } from '../core/cues';
import { DEFAULT_COLORS } from '../core/profiles';
import { mergeWithPrevious } from '../core/merge';
import { applyImport, parseRekordboxXml, parseTraktorNml } from '../core/import/collection';
import type { AnalysisResult } from '../core/types';

type Request =
  | { operation: 'analyze'; source: string; previous?: AnalysisResult }
  | { operation: 'cue'; track: AnalysisResult; slot: number; timeSec: number }
  | { operation: 'export'; format: 'xml' | 'nml' | 'm3u8'; track: AnalysisResult }
  | { operation: 'import'; format: 'xml' | 'nml'; collection: string; track: AnalysisResult };

function bootVolume() {
  if (process.platform !== 'darwin') return 'Macintosh HD';
  return fs.readdir('/Volumes').then(async (names) => {
    for (const name of names) {
      if (await fs.realpath(path.join('/Volumes', name)).catch(() => '') === '/') return name;
    }
    return 'Macintosh HD';
  }, () => 'Macintosh HD');
}

async function execute(request: Request): Promise<unknown> {
  switch (request.operation) {
    case 'analyze': {
      const track = await analyzeFile(await fs.realpath(request.source));
      return request.previous?.fileHash === track.fileHash ? mergeWithPrevious(track, request.previous) : track;
    }
    case 'cue': {
      const { track, slot, timeSec } = request;
      if (!Number.isInteger(slot) || slot < 0 || slot > 7 || !Number.isFinite(timeSec)
        || timeSec < 0 || timeSec > track.durationSec) throw new Error('Invalid cue position or pad');
      const current = track.cues.find((cue) => cue.slot === slot);
      if (current?.locked) throw new Error('The cue is locked');
      if (cueAt(track.cues, timeSec, current)) throw new Error('There is already a cue at this position');
      const bar = Math.round((timeSec - track.grid.firstDownbeatSec) * track.bpm / 240);
      if (current) Object.assign(current, { timeSec, bar, origin: 'user' });
      else track.cues.push({
        id: newId('c'), slot, role: 'custom', kind: 'custom', name: `Cue ${'ABCDEFGH'[slot]}`,
        timeSec, bar, color: DEFAULT_COLORS.custom, confidence: 'high',
        reason: 'Placé manuellement', origin: 'user',
      });
      track.cues.sort((a, b) => a.slot - b.slot);
      return track;
    }
    case 'export': {
      const id = { xml: 'rekordbox', nml: 'traktor', m3u8: 'serato' }[request.format];
      const adapter = ADAPTERS.find((target) => target.id === id);
      if (!adapter) throw new Error('Unsupported export format');
      return adapter.build([request.track], { memoryCues: true, loops: 'accepted', macVolume: await bootVolume() });
    }
    case 'import': {
      const tracks = request.format === 'xml'
        ? parseRekordboxXml(request.collection)
        : parseTraktorNml(request.collection, await bootVolume());
      const file = await fs.realpath(request.track.path);
      for (const track of tracks) {
        if (await fs.realpath(track.path).catch(() => '') === file) return applyImport(request.track, track);
      }
      throw new Error('The collection does not reference the selected audio file');
    }
  }
  throw new Error('Unknown experiment operation');
}

async function main() {
  const [directory] = process.argv.slice(2);
  if (!directory) throw new Error('Request directory is required');
  const request: Request = JSON.parse(await fs.readFile(path.join(directory, 'request.json'), 'utf8'));
  let response: unknown;
  try {
    response = { schemaVersion: 1, result: await execute(request) };
  } catch (error) {
    response = { schemaVersion: 1, error: error instanceof Error ? error.message : String(error) };
  }
  await fs.writeFile(path.join(directory, 'response.json'), JSON.stringify(response), { flag: 'wx' });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
