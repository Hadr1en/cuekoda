import type { AnalysisResult } from './types';

type GridTrack = Pick<AnalysisResult, 'bpm' | 'grid' | 'durationSec' | 'tempoMap'>;

export interface GridBeat {
  timeSec: number;
  downbeat: boolean;
}

/** Enumerates the audible timeline with one beat per marker boundary, using the new segment's meter. */
export function gridBeats(track: GridTrack): GridBeat[] {
  const markers = track.tempoMap?.length
    ? track.tempoMap
    : [{ startSec: track.grid.firstDownbeatSec, bpm: track.bpm, beatInBar: 1 }];
  const epsilon = 1e-9;
  const beats: GridBeat[] = [];
  if (!Number.isFinite(track.durationSec)) return beats;
  for (const [index, marker] of markers.entries()) {
    if (!Number.isFinite(marker.bpm) || marker.bpm <= 0 || !Number.isFinite(marker.startSec)) continue;
    const period = 60 / marker.bpm;
    const startSec = index === 0 ? 0 : Math.max(0, marker.startSec);
    const endSec = Math.min(track.durationSec, markers[index + 1]?.startSec ?? track.durationSec);
    const first = Math.ceil((startSec - marker.startSec - epsilon) / period);
    for (let beat = first; ; beat++) {
      const timeSec = marker.startSec + beat * period;
      if (timeSec >= endSec - epsilon) break;
      beats.push({ timeSec: Math.max(0, timeSec), downbeat: (marker.beatInBar - 1 + beat) % 4 === 0 });
    }
  }
  return beats;
}

/** Index of the first beat at or after the requested time, or beats.length. */
export function beatIndex(beats: readonly GridBeat[], timeSec: number): number {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (beats[mid].timeSec < timeSec) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function nearestBeat(beats: readonly GridBeat[], timeSec: number): number {
  const next = beatIndex(beats, timeSec);
  const before = beats[next - 1];
  const after = beats[next];
  if (!before) return next;
  if (!after) return next - 1;
  return timeSec - before.timeSec < after.timeSec - timeSec ? next - 1 : next;
}

/** Starts an audition at a nearby measure boundary, with room for four measures where possible. */
export function gridAudition(beats: readonly GridBeat[], durationSec: number, aroundSec: number) {
  const fullClipBeats = 16;
  let best = -1;
  let delta = Infinity;
  for (let i = 0; i < beats.length; i++) {
    if (!beats[i].downbeat || (best >= 0 && i + fullClipBeats > beats.length)) continue;
    const distance = Math.abs(beats[i].timeSec - aroundSec);
    if (distance < delta) { best = i; delta = distance; }
  }
  if (best < 0) return { start: 0, end: Math.min(durationSec, beats[fullClipBeats]?.timeSec ?? durationSec) };
  const start = Math.max(0, beats[best].timeSec - 0.045);
  return { start, end: Math.min(durationSec, beats[best + fullClipBeats]?.timeSec ?? durationSec) };
}
