/**
 * Cue offset test between CueKoda and the DJ software (MP3 encoder delay, AAC priming).
 *   npm run offset-test [-- <output folder>]
 *
 * Builds the same click track (120 BPM, a sharp click on every beat from exactly 1.000 s, accent on beat 1)
 * as WAV, MP3 with a LAME header, MP3 without it and AAC/M4A, then:
 *  1. measures where CueKoda's decoder (ffmpeg) sees the first click in each file;
 *  2. writes a rekordbox XML and a Traktor NML with hot cues exactly on the clicks (1.000 s and 9.000 s).
 * Import both, zoom in on the first cue (rekordbox pad A, Traktor button 2, with AutoGrid on button 1).
 * The cue line must sit on the click's attack in EVERY file. A file where
 * it does not shows the offset the DJ software applies to that encoding (decoders disagree on the MP3
 * encoder delay, typically 0, ~26 or ~50 ms; AAC priming is 1024–2112 samples).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeAudio, ffmpegPath } from '../core/decode';
import { buildRekordboxXml } from '../core/export/rekordbox';
import { buildTraktorNml } from '../core/export/traktor';
import { keyFromMusical } from '../core/key';
import { DEFAULT_COLORS } from '../core/profiles';
import type { AnalysisResult } from '../core/types';

const SR = 44100;
const BPM = 120;
const T0 = 1.0; // first click (s)
const DUR = 40;

/** Mono 16-bit WAV: silence, then a 3 ms click (broadband) + a 40 ms low thump on every beat from T0. */
function clickWav(): Buffer {
  const n = SR * DUR;
  const pcm = new Int16Array(n);
  const beat = 60 / BPM;
  for (let k = 0; T0 + k * beat < DUR - 1; k++) {
    const start = Math.round((T0 + k * beat) * SR); // exact sample of the attack
    const amp = k % 4 === 0 ? 0.9 : 0.6;
    for (let i = 0; i < Math.round(0.04 * SR); i++) {
      const t = i / SR;
      const click = i < 0.003 * SR ? (i % 2 ? -1 : 1) * (1 - i / (0.003 * SR)) : 0;
      const thump = Math.sin(2 * Math.PI * 80 * t) * Math.exp(-t / 0.012);
      pcm[start + i] = Math.round(32767 * amp * Math.max(-1, Math.min(1, 0.6 * click + 0.5 * thump)));
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + n * 2, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(n * 2, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer)]);
}

/** Time (s) of the first sample above half the track's peak = the click attack as CueKoda decodes it. */
async function firstAttack(file: string): Promise<number> {
  const { samples } = await decodeAudio(file, SR);
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= 0.5 * peak) return i / SR;
  return NaN;
}

function track(file: string, title: string): AnalysisResult {
  const cue = (slot: number, t: number, name: string) => ({
    id: `c${slot}`, slot, role: 'custom' as const, kind: 'custom' as const, name, bar: Math.round((t - T0) / (240 / BPM)),
    timeSec: t, color: DEFAULT_COLORS.drop, confidence: 'high' as const, reason: '', origin: 'user' as const,
  });
  return {
    path: path.resolve(file), fileName: path.basename(file), title, artist: 'CueKoda offset test', album: '', genre: '', year: '',
    durationSec: DUR, bitrate: 0, sampleRate: SR, sizeBytes: fs.statSync(file).size, kind: `${path.extname(file).slice(1).toUpperCase()} File`,
    bpm: BPM, grid: { bpm: BPM, firstDownbeatSec: T0, confidence: 1 }, key: keyFromMusical('Am')!,
    cues: [cue(0, T0, 'Clic 1.000 s'), cue(1, T0 + 8, 'Clic 9.000 s')],
    wave: [], waveLow: [], warnings: [], analysisMs: 0,
  };
}

async function main() {
  const out = path.resolve(process.argv[2] ?? 'cuekoda-offset-test');
  fs.mkdirSync(out, { recursive: true });
  const wav = path.join(out, 'clic-reference.wav');
  fs.writeFileSync(wav, clickWav());
  const ff = ffmpegPath();
  const variants: { file: string; title: string; args: string[] }[] = [
    { file: 'clic-mp3-lame.mp3', title: 'Clic MP3 (en-tête LAME)', args: ['-c:a', 'libmp3lame', '-b:a', '320k'] },
    { file: 'clic-mp3-sans-entete.mp3', title: 'Clic MP3 (sans en-tête Xing/LAME)', args: ['-c:a', 'libmp3lame', '-b:a', '320k', '-write_xing', '0'] },
    { file: 'clic-aac.m4a', title: 'Clic AAC (M4A)', args: ['-c:a', 'aac', '-b:a', '256k'] },
  ];
  for (const v of variants) {
    const r = spawnSync(ff, ['-y', '-hide_banner', '-v', 'error', '-i', wav, ...v.args, path.join(out, v.file)]);
    if (r.status !== 0) throw new Error(`ffmpeg (${v.file}) : ${r.stderr.toString().slice(0, 300)}`);
  }
  const all = [{ file: path.basename(wav), title: 'Clic WAV (référence)' }, ...variants];
  console.log(`Premier clic placé à ${T0.toFixed(3)} s dans le fichier source. Vu par le décodeur de CueKoda :`);
  for (const v of all) {
    const t = await firstAttack(path.join(out, v.file));
    console.log(`  ${v.title.padEnd(36)} ${t.toFixed(4)} s  (écart ${((t - T0) * 1000).toFixed(1)} ms)`);
  }
  const tracks = all.map((v) => track(path.join(out, v.file), v.title));
  const opts = { memoryCues: false, loops: 'none' as const, commentTags: false, playlistName: 'CueKoda test de décalage' };
  fs.writeFileSync(path.join(out, 'test-decalage-rekordbox.xml'), buildRekordboxXml(tracks, opts, opts.playlistName));
  fs.writeFileSync(path.join(out, 'test-decalage-traktor.nml'), buildTraktorNml(tracks, opts));
  console.log(`
Fichiers écrits dans ${out}
À vérifier dans rekordbox puis dans Traktor (importer le XML / le NML comme un export CueKoda) :
  - ouvrir chaque morceau, zoomer sur « Clic 1.000 s » (pad A dans rekordbox, bouton 2 dans Traktor) ;
  - la ligne du cue doit tomber sur le début du clic pour les QUATRE fichiers, et la grille sur chaque clic ;
  - un fichier où le cue tombe avant ou après le clic révèle le décalage appliqué par le logiciel à cet encodage
    noter le fichier, le logiciel et l’écart.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
