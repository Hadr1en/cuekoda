import type { AnalysisResult } from '../types';

const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();

/** Portable UTF-8 playlist. It references audio files and never writes their tags or a DJ database. */
export function buildM3u8(tracks: AnalysisResult[]): string {
  const lines = ['#EXTM3U'];
  for (const track of tracks) {
    const label = oneLine([track.artist, track.title].filter(Boolean).join(' - ') || track.fileName);
    lines.push(`#EXTINF:${Math.max(0, Math.round(track.durationSec))},${label}`);
    lines.push(oneLine(track.path));
  }
  return `${lines.join('\n')}\n`;
}
