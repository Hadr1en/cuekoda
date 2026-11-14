/** Per-beat band levels around given times:  node dist/test/beat-diag.js <file> <bpm> <d0> <t1> [t2…] */
import { decodeToMono } from '../core/decode';
import { analyseBands, decimate2, prefixSums, rangeMean } from '../core/dsp';
async function main() {
  const [file, bpmS, d0S, ...ts] = process.argv.slice(2);
  const bpm = Number(bpmS), d0 = Number(d0S), P = 60 / bpm;
  const x = decimate2(await decodeToMono(file, 44100));
  const b = analyseBands(x, 22050);
  const pL = prefixSums(b.eLow), pM = prefixSums(b.eMid), pH = prefixSums(b.eHigh);
  const fi = (t: number) => Math.ceil((t * b.sr) / b.hop), fe = (t: number) => Math.floor((t * b.sr - b.frameSize) / b.hop) + 1;
  const db = (p: Float64Array, t: number) => (10 * Math.log10(rangeMean(p, fi(t), fe(t + P)) + 1e-9)).toFixed(1).padStart(6);
  for (const tS of ts) {
    const t = Number(tS);
    const k0 = Math.round((t - d0) / P);
    console.log(`\n# around ${t}s (beat ${k0}, bar ${(k0 / 4).toFixed(2)})`);
    for (let k = k0 - 6; k <= k0 + 6; k++) {
      const tk = d0 + k * P;
      console.log(`${tk.toFixed(3)}  beat-in-bar ${((k % 4) + 4) % 4 + 1}  low ${db(pL, tk)}  mid ${db(pM, tk)}  high ${db(pH, tk)}${Math.abs(tk - t) < 0.05 ? '  <== ref' : ''}`);
    }
  }
}
main();
