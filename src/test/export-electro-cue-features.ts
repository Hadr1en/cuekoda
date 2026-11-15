import { readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { analyzeFile } from '../core/analyzer';
import { loadDataset } from '../core/datasets';
import { decodeAudio } from '../core/decode';
import { analyseBands, decimate2 } from '../core/dsp';
import { landmarkFeatures } from '../core/electroCue';
import { analyzeStructure, computeBarFeatures } from '../core/structure';

const TYPES = ['drop', 'breakdown'] as const;
type MarkType = typeof TYPES[number];
type TrainingSource = 'raveform' | 'SSMe' | 'EDM-98';

interface TrainingAudio {
  id: string;
  path: string;
  duration: number;
  bpm?: number;
  marks: Record<MarkType, number[]>;
}

interface RaveformTrack {
  id: string;
  fold: number;
  duration: number;
}

interface TimedMarkManifest {
  source: 'SSMe' | 'EDM-98';
  tracks: {
    id: string;
    fileName: string;
    duration: number;
    split: string;
    marks: Record<MarkType, number[]>;
  }[];
}

function raveformTracks(annotationDir: string, audioDir: string, manifestPath: string): TrainingAudio[] {
  const trainingIds: string[] = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const tracks: RaveformTrack[] = JSON.parse(readFileSync(join(annotationDir, 'segments.json'), 'utf8'));
  const trainingTracks = new Map(tracks.filter(({ fold }) => fold >= 2 && fold <= 5)
    .map((track) => [track.id, track]));
  const { refs } = loadDataset('raveform', annotationDir, audioDir);

  const refsById = new Map(refs.map((ref) => [ref.fileName.slice(0, -extname(ref.fileName).length), ref]));
  return trainingIds.flatMap((id): TrainingAudio[] => {
    const ref = refsById.get(id);
    const track = trainingTracks.get(id);
    const sections = ref?.sections;
    if (!track || !ref?.bpm || !sections) return [];
    const times = (label: MarkType) => sections.filter((mark) => mark.label === label).map((mark) => mark.startSec);
    return [
      { id, path: ref.path, duration: track.duration, bpm: ref.bpm, marks: { drop: times('drop'), breakdown: times('breakdown') } },
    ];
  });
}

async function exportTrack(track: TrainingAudio, source: TrainingSource) {
  const result = await analyzeFile(track.path, { profileId: 'edm' });
  if (source === 'raveform') {
    if (!track.bpm || Math.abs(result.durationSec - track.duration) > 0.75 || Math.abs(result.bpm / track.bpm - 1) > 0.007) return;
  } else if (result.tempo?.confidence === 'low' || Math.abs(result.durationSec - track.duration) > 1) {
    return;
  }

  const { samples } = await decodeAudio(track.path, 44100);
  const bands = analyseBands(decimate2(samples), 22050);
  const d0 = result.grid.firstDownbeatSec;
  const barLen = 240 / result.bpm;
  const f = computeBarFeatures(bands, d0, barLen, result.durationSec);
  const structure = analyzeStructure(f);
  const features = landmarkFeatures(f, structure);

  // SSMe annotations are rounded to whole seconds. EDM-98 labels are finer but
  // the audio's origin can vary across encodings of an otherwise matching version.
  const tolerance = source === 'SSMe' ? 0.55
    : source === 'EDM-98' ? Math.min(0.23, 33 / result.bpm)
      : 45 / result.bpm;
  for (const type of TYPES) {
    const matchingBars = new Set<number>();
    const ambiguousBars = new Set<number>();
    for (const time of track.marks[type]) {
      const bar = Math.round((time - d0) / barLen);
      if (Math.abs(d0 + bar * barLen - time) <= tolerance) matchingBars.add(bar);
      else if (source !== 'raveform') {
        for (const index of [bar - 1, bar, bar + 1]) ambiguousBars.add(index);
      }
    }
    if (!matchingBars.size) continue;

    for (let bar = structure.origin + 3; bar < features.length - 3; bar++) {
      const target = matchingBars.has(bar) ? 1 : 0;
      if (!target && ambiguousBars.has(bar)) continue;
      console.log(JSON.stringify({ id: track.id, source, type, features: features[bar], target }));
    }
  }
}

async function run() {
  const [first, second, third] = process.argv.slice(2);
  if (!first || !second || !third) {
    throw new Error('Usage: export-electro-cue-features <raveform/structures> <audio> <training-ids.json> or --timed-marks <manifest.json> <audio>');
  }

  if (first === '--timed-marks') {
    const manifest: TimedMarkManifest = JSON.parse(readFileSync(second, 'utf8'));
    if (manifest.source !== 'SSMe' && manifest.source !== 'EDM-98') throw new Error('Unsupported timed annotation source');
    for (const row of manifest.tracks) {
      if (row.split !== 'train') continue;
      if (basename(row.fileName) !== row.fileName) throw new Error('Expected a file name without directories');
      await exportTrack({ ...row, path: join(third, row.fileName) }, manifest.source);
    }
  } else {
    for (const row of raveformTracks(first, second, third)) await exportTrack(row, 'raveform');
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
