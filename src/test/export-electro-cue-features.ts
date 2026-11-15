import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { analyzeFile } from '../core/analyzer';
import { loadDataset } from '../core/datasets';
import { decodeAudio } from '../core/decode';
import { analyseBands, decimate2 } from '../core/dsp';
import { landmarkFeatures } from '../core/electroCue';
import { analyzeStructure, computeBarFeatures } from '../core/structure';

interface RaveformTrack {
  id: string;
  fold: number;
  duration: number;
}

async function run() {
  const [annotationDir, audioDir, manifestPath] = process.argv.slice(2);
  if (!annotationDir || !audioDir || !manifestPath) {
    throw new Error('Usage: export-electro-cue-features <raveform/structures> <audio> <training-ids.json>');
  }

  const trainingIds: string[] = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const tracks: RaveformTrack[] = JSON.parse(readFileSync(join(annotationDir, 'segments.json'), 'utf8'));
  const trainingTracks = new Map(tracks.filter(({ fold }) => fold >= 2 && fold <= 5)
    .map((track) => [track.id, track]));
  const { refs } = loadDataset('raveform', annotationDir, audioDir);

  const refsById = new Map(refs.map((ref) => [ref.fileName.slice(0, -extname(ref.fileName).length), ref]));
  for (const id of trainingIds) {
    const ref = refsById.get(id);
    const track = trainingTracks.get(id);
    if (!track || !ref?.bpm || !ref.sections) continue;

    const result = await analyzeFile(ref.path, { profileId: 'edm' });
    if (Math.abs(result.durationSec - track.duration) > 0.75 || Math.abs(result.bpm / ref.bpm - 1) > 0.007) continue;

    const { samples } = await decodeAudio(ref.path, 44100);
    const bands = analyseBands(decimate2(samples), 22050);
    const d0 = result.grid.firstDownbeatSec;
    const barLen = 240 / result.bpm;
    const f = computeBarFeatures(bands, d0, barLen, result.durationSec);
    const structure = analyzeStructure(f);
    const features = landmarkFeatures(f, structure);

    for (const type of ['drop', 'breakdown'] as const) {
      const starts = ref.sections.filter((mark) => mark.label === type).map((mark) => mark.startSec);
      const matchingBars = new Set<number>();
      for (const start of starts) {
        const bar = Math.round((start - d0) / barLen);
        if (Math.abs(d0 + bar * barLen - start) <= 45 / result.bpm) matchingBars.add(bar);
      }
      if (matchingBars.size === 0) continue;

      for (let bar = structure.origin + 3; bar < features.length - 3; bar++) {
        console.log(JSON.stringify({ id, type, features: features[bar], target: matchingBars.has(bar) ? 1 : 0 }));
      }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
