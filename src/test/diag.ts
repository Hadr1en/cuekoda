/**
 * Tempo diagnostic for real files:  node dist/test/diag.js <file> [...]
 * Prints Essentia's tempo estimates and our own beat-grid score over 70-180 bpm (top peaks).
 */
import { decodeToMono } from '../core/decode';
import { analyseBands, decimate2 } from '../core/dsp';
import { estimateGrid, fitGridComb } from '../core/rhythm';

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Essentia, EssentiaWASM } = require('essentia.js');
  const e = new Essentia(EssentiaWASM);
  for (const file of process.argv.slice(2)) {
    const full = await decodeToMono(file, 44100);
    const dur = full.length / 44100;
    const seg = full.subarray(Math.floor(dur * 0.25 * 44100), Math.floor(dur * 0.25 * 44100) + 120 * 44100);
    const v = e.arrayToVector(seg);
    const multi = e.RhythmExtractor2013(v, 208, 'multifeature', 70).bpm;
    const degara = e.RhythmExtractor2013(v, 208, 'degara', 70).bpm;
    const perc = e.PercivalBpmEstimator(v).bpm;
    v.delete();
    const x = decimate2(full);
    const bands = analyseBands(x, 22050);
    const scores: { bpm: number; s: number }[] = [];
    for (let b = 70; b <= 180; b += 0.5) scores.push({ bpm: b, s: fitGridComb(bands, b, 0).score });
    const peaks = scores
      .filter((p, i) => i > 0 && i < scores.length - 1 && p.s >= scores[i - 1].s && p.s >= scores[i + 1].s)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6);
    console.log(`\n${file.split('/').pop()}  (${dur.toFixed(0)} s)`);
    console.log(`  essentia multifeature=${multi.toFixed(2)}  degara=${degara.toFixed(2)}  percival=${perc.toFixed(2)}`);
    console.log('  grid-score peaks: ' + peaks.map((p) => `${p.bpm.toFixed(1)}(${p.s.toFixed(2)})`).join('  '));
    for (const c of new Set([Math.round(multi), Math.round(degara), Math.round(perc), peaks[0].bpm].map((n) => Math.round(n * 2) / 2))) {
      const g = estimateGrid(x, 22050, bands, c);
      console.log(`  estimateGrid(start=${c}) -> ${g.bpm.toFixed(3)} bpm, grid confidence ${g.confidence.toFixed(2)}`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
