import { cueCandidates, selectCues } from './cues';
import { breakBetweenDrops, refineElectroCues } from './electroCue';
import { suggestLoops } from './loops';
import { suggestMix } from './mix';
import type { Profile } from './profiles';
import { buildSections, type BarFeatures, type StructureAnalysis } from './structure';
import type { AnalysisResult, CueKind } from './types';

export interface PreparationData {
  feats: BarFeatures;
  structure: StructureAnalysis;
}

const fewCues = 'Structure peu marquée — peu de hot cues proposés';

export function prepareTrack(track: AnalysisResult, profile: Profile, suppressKinds?: CueKind[]): AnalysisResult {
  const { preparation, energy, phrases, vocals, durationSec: durSec } = track;
  if (!preparation || !energy || !phrases) return track;
  const { feats, structure } = preparation;
  const sections = buildSections(structure, feats, energy.curve, durSec, profile.vocabulary, vocals);
  const g = { d0: track.grid.firstDownbeatSec, barLen: 240 / track.bpm };
  const mix = suggestMix(structure, phrases, energy.curve, profile, g, vocals);
  const phraseOrigin = phrases.lengthBars ? phrases.originBar : structure.phraseOrigin;
  const compareBreaks = profile.cueRefinement === 'with-break-alternatives';
  const edmCues = profile.cueRefinement && !track.tempo?.variable
    && track.tempo?.confidence !== 'low';
  const { primary, alternate } = edmCues
    ? refineElectroCues(feats, structure, compareBreaks)
    : { primary: structure.landmarks, alternate: undefined };
  let cues = selectCues(cueCandidates(primary, mix, vocals, phraseOrigin), profile, g, suppressKinds);
  const preserveOtherCues = (alternative: typeof cues) => {
    if (cues.every((cue) => cue.kind === 'break' || alternative.some(
      (next) => next.kind === cue.kind && next.timeSec === cue.timeSec,
    ))) cues = alternative;
  };
  if (alternate) preserveOtherCues(selectCues(
    cueCandidates(alternate, mix, vocals, phraseOrigin), profile, g, suppressKinds,
  ));
  if (edmCues && compareBreaks) {
    const betweenDrops = breakBetweenDrops(feats, structure, cues, profile.minCueSpacingBars);
    if (betweenDrops) preserveOtherCues(selectCues([
      ...cues.filter((cue) => cue.kind !== 'break'),
      betweenDrops,
    ], profile, g, suppressKinds));
  }
  const loops = suggestLoops(structure, profile, g);

  const warnings = track.warnings.filter((warning) => warning !== fewCues);
  if (cues.length <= 1) warnings.push(fewCues);
  return { ...track, profileId: profile.id, warnings, sections, cues, loops, mix };
}
