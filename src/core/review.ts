import { duplicateCueIds } from './cues';
import type { AnalysisResult } from './types';

export interface ReviewableTrack {
  status: 'queued' | 'analyzing' | 'done' | 'error' | 'cancelled';
  reviewedAt?: number;
  result?: AnalysisResult;
}

/** Reasons why a result should be checked by ear before export. */
export function reviewReasons(track: ReviewableTrack): string[] {
  if (track.reviewedAt) return [];
  if (track.status === 'error') return ['analyse en échec'];
  const result = track.result;
  if (!result) return [];

  const reasons: string[] = [];
  if (result.tempo?.confidence === 'low' || result.tempo?.competingBpm) reasons.push('tempo incertain');
  if (result.grid.downbeatConfidence === 'low') reasons.push('premier temps incertain');
  if (result.key.level === 'low' || result.key.ambiguous) reasons.push('tonalité incertaine');
  if (result.key.changes?.length) reasons.push('changement de tonalité');
  if (!result.sections?.length) reasons.push('structure absente');
  else if (result.sections.some((section) => section.confidence === 'low')) reasons.push('structure incertaine');
  if (result.cues.some((cue) => cue.origin === 'auto' && cue.confidence === 'low')) reasons.push('cues incertains');
  if (result.vocals?.level === 'low') reasons.push('voix incertaine');
  if (duplicateCueIds(result.cues).size) reasons.push('pads en double');
  return reasons;
}
