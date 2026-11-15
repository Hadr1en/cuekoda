/**
 * Synthetic end-to-end test: renders EDM-like tracks with a known tempo, key and structure,
 * runs the real analysis pipeline on the WAV files and checks BPM / key / grid / cues.
 *   npm test
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { analyzeFile } from '../core/analyzer';
import { buildRekordboxXml } from '../core/export/rekordbox';
import { buildTraktorNml } from '../core/export/traktor';
import { AnalysisResult } from '../core/types';

const SR = 44100;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 * 2 - 1;
  };
}

type Section = {
  bars: number; kick: boolean; bass: boolean; hats: boolean; clap: boolean; pad: number; riser: boolean; level: number;
  /** Level of a synthetic sung-like voice (0 = none) */
  vocal: number;
};

export interface Spec {
  name: string;
  bpm: number;
  lead: number; // seconds of silence before the first beat
  chord: number[]; // Hz
  sections: Section[];
}

export function render(spec: Spec): Float32Array {
  const spb = (SR * 60) / spec.bpm;
  const totalBars = spec.sections.reduce((a, s) => a + s.bars, 0);
  const n = Math.floor(spec.lead * SR + totalBars * 4 * spb + SR);
  const x = new Float32Array(n);
  const noise = rng(1234);
  const lead = Math.floor(spec.lead * SR);

  let barStart = 0;
  for (const sec of spec.sections) {
    const nBeats = sec.bars * 4;
    const secStart = lead + barStart * 4 * spb;
    const secLen = sec.bars * 4 * spb;
    for (let b = 0; b < nBeats; b++) {
      const t = secStart + b * spb;
      const i0 = Math.floor(t);
      if (sec.kick) {
        const len = Math.floor(0.2 * SR);
        let ph = 0;
        for (let i = 0; i < len && i0 + i < n; i++) {
          const tt = i / SR;
          const f = 45 + 90 * Math.exp(-tt * 30);
          ph += (2 * Math.PI * f) / SR;
          x[i0 + i] += 0.9 * sec.level * Math.sin(ph) * Math.exp(-tt * 14) + (i < 40 ? 0.3 * noise() : 0);
        }
      }
      if (sec.hats) {
        const j0 = Math.floor(t + spb / 2);
        const len = Math.floor(0.035 * SR);
        let prev = 0;
        for (let i = 0; i < len && j0 + i < n; i++) {
          const v = noise();
          x[j0 + i] += 0.22 * sec.level * (v - prev) * Math.exp(-i / (0.008 * SR));
          prev = v;
        }
      }
      if (sec.clap && b % 4 === 2) {
        const len = Math.floor(0.12 * SR);
        for (let i = 0; i < len && i0 + i < n; i++) x[i0 + i] += 0.3 * sec.level * noise() * Math.exp(-i / (0.03 * SR));
      }
      if (sec.bass) {
        const j0 = Math.floor(t + spb * 0.5);
        const len = Math.floor(spb * 0.45);
        for (let i = 0; i < len && j0 + i < n; i++) {
          const tt = i / SR;
          const env = Math.min(1, i / 400) * Math.exp(-tt * 3);
          x[j0 + i] += 0.35 * sec.level * env * (Math.sin(2 * Math.PI * 55 * tt) + 0.3 * Math.sin(2 * Math.PI * 110 * tt));
        }
      }
    }
    if (sec.pad > 0) {
      const i0 = Math.floor(secStart);
      const end = Math.min(n, Math.floor(secStart + secLen));
      for (let i = i0; i < end; i++) {
        const tt = i / SR;
        let v = 0;
        for (const f of spec.chord) v += Math.sin(2 * Math.PI * f * tt);
        x[i] += sec.pad * v * 0.12;
      }
    }
    if (sec.vocal > 0) addVoice(x, Math.floor(secStart), Math.floor(secLen), spb, sec.vocal * sec.level, barStart);
    if (sec.riser) {
      const i0 = Math.floor(secStart);
      const end = Math.min(n, Math.floor(secStart + secLen));
      let prev = 0;
      for (let i = i0; i < end; i++) {
        const p = (i - i0) / (end - i0);
        const v = noise();
        x[i] += (v - prev) * 0.5 * p * p; // high-passed noise rising in level
        prev = v;
        x[i] += 0.12 * p * Math.sin(2 * Math.PI * (400 + 3000 * p * p) * (i / SR));
      }
    }
    barStart += sec.bars;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
  for (let i = 0; i < n; i++) x[i] = (x[i] / peak) * 0.85;
  return x;
}

/**
 * Sung-like synthetic voice: harmonic source whose pitch follows a melody with portamento between
 * notes, 5.5 Hz vibrato (±35 cents) and slow drift, shaped by vowel formants, one syllable per note.
 * It imitates the cues the detector relies on; it is NOT a real voice — passing on it proves the
 * mechanics, not the accuracy on real recordings.
 */
function addVoice(x: Float32Array, i0: number, len: number, spb: number, level: number, seedBar: number) {
  const melody = [220, 246.94, 261.63, 293.66, 329.63, 293.66, 261.63, 246.94];
  const durBeats = [1, 1, 2, 1, 1, 2];
  const vowels = [[700, 1200, 2600], [500, 1800, 2500], [450, 800, 2500]];
  const noise = rng(99 + seedBar);
  const end = Math.min(x.length, i0 + len);
  let t = i0;
  let k = seedBar * 3;
  let prevF = melody[k % melody.length];
  const phases = new Float64Array(40);
  while (t < end) {
    const f = melody[k % melody.length];
    const nLen = Math.floor(durBeats[k % durBeats.length] * spb);
    const vowel = vowels[k % vowels.length];
    const gap = Math.floor(0.05 * SR);
    for (let i = 0; i < nLen && t + i < end; i++) {
      const tt = i / SR;
      // portamento from the previous note (log domain), then vibrato fading in after 120 ms
      const glide = Math.min(1, tt / 0.07);
      const base = Math.log2(prevF) * (1 - glide) + Math.log2(f) * glide;
      const vib = (35 / 1200) * Math.min(1, Math.max(0, (tt - 0.12) / 0.15)) * Math.sin(2 * Math.PI * 5.5 * tt);
      const drift = (8 / 1200) * Math.sin(2 * Math.PI * 0.7 * ((t + i) / SR));
      const f0 = Math.pow(2, base + vib + drift);
      const env = Math.min(1, i / (0.025 * SR)) * Math.min(1, Math.max(0, (nLen - gap - i) / (0.05 * SR)));
      if (env <= 0) continue;
      let v = 0;
      const nh = Math.min(phases.length, Math.floor(5000 / f0));
      for (let h = 1; h <= nh; h++) {
        phases[h - 1] += (2 * Math.PI * h * f0) / SR;
        const fh = h * f0;
        let a = 0;
        for (let q = 0; q < 3; q++) a += 1 / (1 + ((fh - vowel[q]) / (90 + 40 * q)) ** 2);
        v += (a / Math.sqrt(h)) * Math.sin(phases[h - 1]);
      }
      // breathy consonant at the syllable start
      const cons = i < 0.02 * SR ? 0.3 * noise() : 0;
      x[t + i] += level * 0.22 * env * (v + cons);
    }
    prevF = f;
    t += nLen;
    k++;
  }
}

export function writeWav(file: string, x: Float32Array, right?: Float32Array) {
  const channels = right ? 2 : 1;
  const dataSize = x.length * channels * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  const pcm = (value: number) => Math.round(Math.max(-1, Math.min(1, value)) * 32767);
  for (let i = 0; i < x.length; i++) {
    const offset = 44 + i * channels * 2;
    buf.writeInt16LE(pcm(x[i]), offset);
    if (right) buf.writeInt16LE(pcm(right[i]), offset + 2);
  }
  fs.writeFileSync(file, buf);
}

export const S = (bars: number, o: Partial<Section>): Section => ({
  bars, kick: false, bass: false, hats: false, clap: false, pad: 0, riser: false, level: 1, vocal: 0, ...o,
});

export const SPECS: { spec: Spec; expect: { bpm: number; camelot: string; cues: Record<string, number>; tempoConf?: string } }[] = [
  {
    spec: {
      name: 'club-128-Aminor',
      bpm: 128,
      lead: 0.12,
      chord: [220, 261.63, 329.63],
      sections: [
        S(8, { pad: 0.6, hats: true, level: 0.6 }), // intro 0-7
        S(8, { pad: 0.8, riser: true, hats: true, level: 0.8 }), // build 8-15
        S(16, { kick: true, bass: true, hats: true, clap: true, pad: 1 }), // drop 16-31
        S(8, { pad: 0.7, level: 0.5 }), // breakdown 32-39
        S(8, { pad: 0.8, riser: true, level: 0.8 }), // build 40-47
        S(16, { kick: true, bass: true, hats: true, clap: true, pad: 1 }), // drop 48-63
        S(8, { kick: true, hats: true, pad: 0.3, level: 0.7 }), // outro 64-71
      ],
    },
    expect: { bpm: 128, camelot: '8A', cues: { intro: 0, build1: 8, drop1: 16, break1: 32, build2: 40, drop2: 48, outro: 64 } },
  },
  {
    spec: {
      name: 'fast-174-Cmajor',
      bpm: 174,
      lead: 0.31,
      chord: [261.63, 329.63, 392],
      sections: [
        S(8, { kick: true, hats: true, pad: 0.4, level: 0.6 }),
        S(16, { kick: true, bass: true, hats: true, clap: true, pad: 1 }),
        S(8, { pad: 0.7, level: 0.5 }),
        S(16, { kick: true, bass: true, hats: true, clap: true, pad: 1 }),
        S(8, { kick: true, hats: true, pad: 0.3, level: 0.7 }),
      ],
    },
    expect: { bpm: 174, camelot: '8B', tempoConf: 'medium', cues: { intro: 0, drop1: 8, break1: 24, drop2: 32, outro: 48 } },
  },
];

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuekoda-test-'));
  const results: AnalysisResult[] = [];
  let failures = 0;
  const check = (label: string, ok: boolean, detail: string) => {
    if (!ok) failures++;
    console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail}`);
  };

  for (const { spec, expect } of SPECS) {
    const file = path.join(dir, `${spec.name}.wav`);
    writeWav(file, render(spec));
    console.log(`\n▶ ${spec.name}`);
    const r = await analyzeFile(file);
    results.push(r);
    console.log(
      `   analysé en ${(r.analysisMs / 1000).toFixed(1)}s · ${r.bpm.toFixed(3)} BPM · ${r.key.camelot} ${r.key.musical} (conf ${r.key.confidence.toFixed(2)}) · grille ${r.grid.confidence.toFixed(2)}`,
    );
    const barLen = (4 * 60) / r.bpm;
    console.log('   cues: ' + r.cues.map((c) => `${'ABCDEFGH'[c.slot]}=${c.name}@bar${c.bar}(${c.timeSec.toFixed(2)}s)`).join('  '));
    if (r.warnings.length) console.log('   warnings: ' + r.warnings.join(' | '));

    check('BPM', Math.abs(r.bpm - expect.bpm) < 0.05, `${r.bpm.toFixed(3)} vs ${expect.bpm}`);
    check('Clé', r.key.camelot === expect.camelot, `${r.key.camelot} vs ${expect.camelot}`);
    // The first downbeat must sit on the lead-in offset (modulo one bar), within 15 ms.
    const dev = (((r.grid.firstDownbeatSec - spec.lead) % barLen) + barLen) % barLen;
    const devAbs = Math.min(dev, barLen - dev);
    check('Phase grille', devAbs < 0.015, `écart ${(devAbs * 1000).toFixed(1)} ms`);
    for (const [role, bar] of Object.entries(expect.cues)) {
      const c = r.cues.find((x) => x.role === role);
      // exact: a cue one bar off is one bar off in the DJ software
      check(`Cue ${role}`, !!c && c.bar === bar, c ? `bar ${c.bar} vs ${bar}` : 'absent');
    }

    // ---- v0.2 outputs ------------------------------------------------------------
    // 174 bpm: Essentia said 116.9, the grid decided → honest 'medium'
    check('Confiance tempo', r.tempo?.confidence === (expect.tempoConf ?? 'high'), `${r.tempo?.confidence}, stable=${!r.tempo?.variable}`);
    check('Tempo non variable', r.tempo?.variable === false, `${r.tempo?.localMin.toFixed(2)}–${r.tempo?.localMax.toFixed(2)}`);
    check('Loudness EBU R128', typeof r.loudness?.integratedLufs === 'number', `${r.loudness?.integratedLufs} LUFS, TP ${r.loudness?.truePeakDbtp} dBTP`);
    check('Score énergie 1–10', !!r.energy && r.energy.score >= 1 && r.energy.score <= 10, `${r.energy?.score}`);
    const secAt = (bar: number) => r.sections?.find((s) => s.startBar <= bar && bar < s.endBar);
    const dropE = secAt(expect.cues.drop1 ?? 16)?.energy ?? 0;
    const breakE = secAt(expect.cues.break1 ?? 32)?.energy ?? 1;
    check('Énergie drop > breakdown', dropE > breakE + 0.1, `${dropE.toFixed(2)} vs ${breakE.toFixed(2)}`);
    check(
      'Sections drop / breakdown',
      secAt(expect.cues.drop1 ?? 16)?.type === 'drop' && secAt(expect.cues.break1 ?? 32)?.type === 'breakdown',
      (r.sections ?? []).map((s) => `${s.label}@${s.startBar}`).join(' '),
    );
    check('Phrases régulières', !!r.phrases?.lengthBars && r.phrases.lengthBars >= 8, `${r.phrases?.lengthBars} mesures, régularité ${r.phrases?.regularity.toFixed(2)}`);
    const pre = r.loops?.find((l) => l.kind === 'predrop');
    check('Boucle pré-drop', !!pre && pre.bar === (expect.cues.drop1 ?? 16) - 1 && pre.beats === 4, pre ? `bar ${pre.bar}, ${pre.beats} temps` : 'absente');
    check('Cues avec confiance + raison', r.cues.every((c) => !!c.confidence && c.reason.length > 0), r.cues.map((c) => `${c.name}:${c.confidence}`).join(' '));
    check('Mix Out proposé', (r.mix?.mixOut.length ?? 0) > 0, r.mix?.mixOut.map((m) => `${m.bar}: ${m.reason}`).join(' | ') ?? '');
    // pads, risers, bass, drums: no voice must be invented
    check('Aucune voix inventée', !!r.vocals && r.vocals.segments.length === 0, r.vocals ? `${r.vocals.segments.length} segment(s), ${r.vocals.note ?? ''}` : 'absent');
  }

  // ---- vocal detection (§9): synthetic sung-like voice — proves the mechanics, not real-world accuracy
  {
    const spec: Spec = {
      name: 'vocal-124-Aminor',
      bpm: 124,
      lead: 0.2,
      chord: [220, 261.63, 329.63],
      sections: [
        S(8, { kick: true, hats: true, pad: 0.5, level: 0.7 }), // intro 0-7, instrumental
        S(8, { kick: true, bass: true, hats: true, clap: true, pad: 0.6 }), // groove 8-15, instrumental
        S(8, { kick: true, bass: true, hats: true, clap: true, pad: 0.6, vocal: 1 }), // sung 16-23
        S(8, { pad: 0.7, level: 0.6, vocal: 1 }), // sung break 24-31
        S(16, { kick: true, bass: true, hats: true, clap: true, pad: 1 }), // instrumental drop 32-47
        S(8, { kick: true, hats: true, pad: 0.3, level: 0.7 }), // outro 48-55
      ],
    };
    const file = path.join(dir, `${spec.name}.wav`);
    writeWav(file, render(spec));
    console.log(`\n▶ ${spec.name} (voix synthétique)`);
    const r = await analyzeFile(file);
    results.push(r);
    const v = r.vocals;
    console.log('   voix: ' + (v?.segments.map((g) => `${g.startBar}-${g.endBar} ${g.strength}/${g.confidence} (${g.score})`).join(' ') ?? 'absent'));
    console.log('   cues: ' + r.cues.map((c) => `${'ABCDEFGH'[c.slot]}=${c.name}@bar${c.bar}`).join('  '));
    const seg = v?.segments[0];
    check('Voix : un passage détecté', v?.segments.length === 1, `${v?.segments.length}`);
    check('Voix : début / fin à ±1 mesure', !!seg && Math.abs(seg.startBar - 16) <= 1 && Math.abs(seg.endBar - 32) <= 1, seg ? `${seg.startBar}-${seg.endBar} vs 16-32` : 'absent');
    check('Voix : rien dans le drop instrumental', !!v && v.present.slice(33).every((p) => !p), '');
    check('Voix : confiance jamais « forte », non validée', !!v && v.validated === false && v.segments.every((g) => g.confidence !== 'high'), `${v?.level}`);
    check('Pas de cue vocal par défaut (0/2 sur les corrections du DJ)', !r.cues.some((c) => c.kind === 'vocal'), '');
    // with a profile that re-enables vocal cues, the cue lands on the vocal entry
    const { findProfile } = await import('../core/profiles');
    const rv = await analyzeFile(file, { profile: { ...findProfile('edm'), id: 'edm-vocal', excludeKinds: [] } });
    const vc = rv.cues.find((c) => c.kind === 'vocal');
    check('Cue vocal à l’entrée de la voix (profil qui les active)', !!vc && vc.bar === 16 && vc.confidence === 'medium' && vc.reason.startsWith('Entrée de voix détectée'), vc ? `bar ${vc.bar} ${vc.confidence}` : 'absent');
    const out = r.mix?.mixOut[0];
    check('Mix Out instrumental signalé', out?.vocals === 'none' && out.reason.includes('aucune voix'), out ? `${out.bar}: ${out.reason}` : 'absent');
    const sec = r.sections?.find((x) => x.startBar <= 26 && 26 < x.endBar);
    check('Section chantée marquée', !!sec && sec.label.includes('voix'), (r.sections ?? []).map((x) => `${x.label}@${x.startBar}`).join(' '));
    const { vocalModelAvailable } = await import('../core/vocalModel');
    if (vocalModelAvailable()) {
      check('Voix : modèle local utilisé', !!v?.method.startsWith('voice_instrumental') && !!v.modelCurve, `${v?.method}`);
      // fallback: the heuristic alone must still find the same passage
      process.env.CUEKODA_VOCAL_MODEL = '0';
      const h = await analyzeFile(file);
      delete process.env.CUEKODA_VOCAL_MODEL;
      const hs = h.vocals?.segments[0];
      check('Voix : repli heuristique seule', h.vocals?.method === 'spectral-fluctuation-v1' && !!hs && Math.abs(hs.startBar - 16) <= 1 && Math.abs(hs.endBar - 32) <= 1, `${h.vocals?.method} ${hs ? `${hs.startBar}-${hs.endBar}` : 'absent'}`);
    } else {
      console.log('   SKIP  Voix : modèle local absent (models/voice_instrumental-musicnn-msd-2) — heuristique seule testée');
    }
  }

  // ---- tempo change: 32 bars at 124 bpm, then 32 bars at 128 bpm (spec §3.2) -------------------------
  {
    console.log('\n▶ changement de tempo (124 → 128 BPM)');
    check('Pas de marqueurs sur tempo fixe', results.every((r) => !r.tempoMap), results.map((r) => r.tempoMap?.length ?? 0).join(','));
    const part = (bpm: number, lead: number) =>
      render({ name: 'x', bpm, lead, chord: [220, 261.63, 329.63], sections: [S(32, { kick: true, bass: true, hats: true, clap: true, pad: 0.6 })] });
    const lead = 0.2;
    const a = part(124, lead);
    const cut = Math.round((lead + (32 * 4 * 60) / 124) * SR); // exactly the end of bar 32 at 124 bpm
    const b = part(128, 0);
    const x = new Float32Array(cut + b.length);
    x.set(a.subarray(0, cut), 0);
    x.set(b, cut);
    const file = path.join(dir, 'tempo-change-124-128.wav');
    writeWav(file, x);
    const r = await analyzeFile(file, { profileId: 'edm' });
    const m = r.tempoMap ?? [];
    console.log('   marqueurs : ' + m.map((k) => `${k.bpm} BPM @ ${k.startSec.toFixed(3)} s (temps ${k.beatInBar})`).join('  |  '));
    check('Tempo variable détecté', r.tempo?.variable === true, `${r.tempo?.localMin.toFixed(1)}–${r.tempo?.localMax.toFixed(1)}`);
    check('Deux marqueurs de tempo', m.length === 2, `${m.length}`);
    check('Tempos des segments', m.length === 2 && Math.abs(m[0].bpm - 124) < 0.2 && Math.abs(m[1].bpm - 128) < 0.2, m.map((k) => k.bpm).join(' → '));
    const change = cut / SR;
    check('Position du changement', m.length === 2 && Math.abs(m[1].startSec - change) < 0.05, `${m[1]?.startSec.toFixed(3)} s vs ${change.toFixed(3)} s`);
    check('Temps 1 des marqueurs', m.length === 2 && m[0].beatInBar === 1 && m[1].beatInBar === 1, m.map((k) => k.beatInBar).join(', '));
    const { buildRekordboxXml } = await import('../core/export/rekordbox');
    const xml = buildRekordboxXml([r], { memoryCues: false, loops: 'none' });
    check('Export rekordbox : un TEMPO par segment', (xml.match(/<TEMPO /g) ?? []).length === 2, `${(xml.match(/<TEMPO /g) ?? []).length} marqueurs`);
  }

  // ---- evaluation pipeline against a ground truth (spec §21) -----------------------------------
  {
    console.log('\n▶ évaluation contre une vérité terrain');
    const { evaluateTrack, summarize } = await import('../core/evaluate');
    const spec = SPECS[0].spec;
    const barSec = (4 * 60) / spec.bpm;
    const truth = {
      version: 1 as const, fileHash: '', path: '', fileName: spec.name, title: spec.name, createdAt: '', engineVersion: 'truth',
      bpm: spec.bpm, firstDownbeatSec: spec.lead, key: 'Am', keyCamelot: '8A',
      cues: Object.entries(SPECS[0].expect.cues).map(([role, bar]) => ({ kind: 'custom' as const, name: role, timeSec: spec.lead + bar * barSec })),
      sections: [0, 8, 16, 32, 40, 48, 64].map((bar) => ({ type: 'section' as const, label: '', startSec: spec.lead + bar * barSec })),
    };
    const e = evaluateTrack(results[0], truth);
    const sum = summarize([e]);
    check('Évaluation : BPM', Math.abs(e.bpm!.errorPct) < 0.05, `${e.bpm!.errorPct.toFixed(3)} %`);
    check('Évaluation : phase et temps 1', Math.abs(e.grid!.phaseErrorMs) < 15 && e.grid!.downbeatOk, `${e.grid!.phaseErrorMs.toFixed(1)} ms`);
    check('Évaluation : clé', e.key!.score === 1, `${e.key!.detected}`);
    check('Évaluation : cues (rappel)', e.cues!.recall === 1, `${e.cues!.matched}/${e.cues!.reference}, F1 ${sum.cueF1.toFixed(2)}`);
    check('Évaluation : sections (rappel)', e.sections!.recall === 1, `${e.sections!.matched}/${e.sections!.reference}, F1 ${sum.sectionF1.toFixed(2)}`);
  }

  // ---- prevent misleading analyses for silence, recover phase-cancelling stereo -------------
  {
    console.log('\n▶ silence et stéréo en opposition de phase');
    const silence = path.join(dir, 'silence.wav');
    writeWav(silence, new Float32Array(SR * 8));
    const error = await analyzeFile(silence).then(() => '', (e: Error) => e.message);
    check('Silence sans faux BPM ni tonalité', error.startsWith('Aucun signal audio exploitable'), error);
    const phase = path.join(dir, 'phase.wav');
    const left = render(SPECS[0].spec).subarray(0, SR * 32);
    writeWav(phase, left, left.map((sample) => -sample));
    const result = await analyzeFile(phase, { profileId: 'edm' });
    check('Stéréo en opposition de phase analysée à 128 BPM', Math.abs(result.bpm - 128) < 0.1, `${result.bpm} BPM`);
    check('Canal de secours signalé', result.warnings.some((w) => w.includes('canal gauche')), result.warnings.join(' · '));
  }

  // ---- CLI tempo bounds override their own side of the DJ profile ---------------------------
  {
    console.log('\n▶ bornes de tempo en ligne de commande');
    const cli = path.join(__dirname, '..', 'cli', 'cli.js');
    const file = path.join(dir, `${SPECS[1].spec.name}.wav`);
    const bpmWith = (profile: string, flag: string, value: string) => {
      const out = path.join(dir, `cli-${profile}`);
      execFileSync(process.execPath, [cli, file, '--profile', profile, flag, value, '--out', out]);
      const [result] = JSON.parse(fs.readFileSync(path.join(out, 'analysis.json'), 'utf8')) as AnalysisResult[];
      return result.bpm;
    };
    const upper = bpmWith('techno', '--max-bpm', '180');
    check('Borne haute explicite prise en compte', Math.abs(upper - 174) < 0.05, `${upper} BPM`);
    const lower = bpmWith('house', '--min-bpm', '90');
    check('Borne haute du profil conservée avec une borne basse explicite', Math.abs(lower - 87) < 0.05, `${lower} BPM`);
    const invalid = spawnSync(process.execPath, [cli, file, '--profile', 'house', '--max-bpm', '100'], { encoding: 'utf8' });
    check('Plage de tempo invalide signalée', invalid.status === 1 && invalid.stderr.includes('Plage de tempo invalide'), invalid.stderr.trim());
  }

  // ---- manual corrections drive the re-analysis --------------------------------------------
  {
    console.log('\n▶ corrections manuelles (overrides)');
    const f = path.join(dir, `${SPECS[0].spec.name}.wav`);
    const o = await analyzeFile(f, { profileId: 'edm', overrides: { bpm: 127.5, firstDownbeatSec: 0.5, key: 'Em' } });
    check('BPM imposé', o.bpm === 127.5 && o.tempo?.confidence === 'high', `${o.bpm}`);
    const barLen = (4 * 60) / 127.5;
    check('Premier temps imposé', Math.abs(o.grid.firstDownbeatSec - (0.5 % barLen)) < 1e-6, `${o.grid.firstDownbeatSec.toFixed(3)} s`);
    check('Clé imposée', o.key.camelot === '9A' && o.key.level === 'high', `${o.key.camelot} ${o.key.musical}`);
  }

  // ---- watch folder: a file copied in is reported once complete, existing files at start -----
  {
    console.log('\n▶ dossier surveillé');
    const { FolderWatcher } = await import('../main/watch');
    const wdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuekoda-watch-'));
    fs.copyFileSync(path.join(dir, `${SPECS[1].spec.name}.wav`), path.join(wdir, 'deja-la.wav'));
    const seen: string[] = [];
    const watchErrors: string[] = [];
    const w = new FolderWatcher((file) => seen.push(path.basename(file)), (_f, msg, level) => level === 'error' && watchErrors.push(msg));
    w.sync([{ path: wdir, enabled: true }], false);
    // simulate a slow copy: write in two chunks
    const src = fs.readFileSync(path.join(dir, `${SPECS[1].spec.name}.wav`));
    const target = path.join(wdir, 'nouveau.wav');
    fs.writeFileSync(target, src.subarray(0, src.length / 2));
    await new Promise((r) => setTimeout(r, 700));
    fs.appendFileSync(target, src.subarray(src.length / 2));
    fs.writeFileSync(path.join(wdir, 'notes.txt'), 'pas de l’audio');
    await new Promise((r) => setTimeout(r, 5000));
    w.close();
    check('Fichiers existants détectés au démarrage (une seule fois)', seen.filter((x) => x === 'deja-la.wav').length === 1, seen.join(', '));
    if (watchErrors.length && !seen.includes('nouveau.wav')) {
      // e.g. a sandbox refusing file-system notifications (EMFILE): cannot be tested here
      console.log(`   SKIP  Nouveau fichier signalé une fois copié  surveillance indisponible dans cet environnement (${watchErrors[0]})`);
    } else {
      check('Nouveau fichier signalé une fois copié', seen.filter((x) => x === 'nouveau.wav').length === 1, seen.join(', '));
    }
    check('Fichiers non audio ignorés', !seen.includes('notes.txt'), seen.join(', '));
    check('Source non modifiée', fs.statSync(target).size === src.length, `${fs.statSync(target).size} octets`);
  }

  // ---- batch queue with real worker threads: cache + corrupt file isolation -------------
  {
    const { AnalysisQueue } = await import('../main/queue');
    const { Worker } = await import('node:worker_threads');
    const cacheDir = path.join(dir, 'cache');
    const bad = path.join(dir, 'corrompu.mp3');
    fs.writeFileSync(bad, Buffer.from('this is not audio at all'.repeat(100)));
    const good = path.join(dir, `${SPECS[1].spec.name}.wav`);
    const runBatch = (files: string[]) =>
      new Promise<{ log: string[]; summary: { done: number; cached: number; errors: number } }>((resolve) => {
        const log: string[] = [];
        const q = new AnalysisQueue(
          () => new Worker(path.join(__dirname, '..', 'main', 'worker.js')) as never,
          {
            start: () => {},
            progress: () => {},
            result: (p, _r, cached) => log.push(`ok ${path.basename(p)}${cached ? ' cache' : ''}`),
            error: (p, m) => log.push(`err ${path.basename(p)}: ${m}`),
            cancelled: () => {},
            state: () => {},
            drained: (s) => {
              q.shutdown();
              resolve({ log, summary: s });
            },
          },
          () => ({ cacheDir }),
          2,
        );
        for (const f of files) q.enqueue({ path: f, options: { profileId: 'edm' }, force: false });
      });
    console.log('\n▶ file d’analyse (workers réels)');
    const first = await runBatch([bad, good]);
    check('Fichier corrompu isolé', first.log.some((l) => l.startsWith('err corrompu')) && first.log.some((l) => l.startsWith('ok fast')), first.log.join(' | '));
    const second = await runBatch([good]);
    check('Résultat repris du cache', second.log[0]?.endsWith('cache') && second.summary.cached === 1, second.log.join(' | '));
    for (const file of fs.readdirSync(cacheDir).filter((name) => name.endsWith('.json'))) {
      fs.writeFileSync(path.join(cacheDir, file), '{"interrompu":');
    }
    const third = await runBatch([good]);
    check('Cache illisible recalculé', third.summary.done === 1 && third.summary.cached === 0 && third.summary.errors === 0, third.log.join(' | '));

    const changing = path.join(dir, 'copie-en-cours.wav');
    fs.copyFileSync(good, changing);
    const result = await analyzeFile(changing, {
      profileId: 'edm',
      onProgress: (stage) => {
        if (stage === 'tempo') fs.appendFileSync(changing, Buffer.alloc(4));
      },
    }).then(() => '', (error: Error) => error.message);
    check('Fichier modifié pendant l’analyse détecté', /audio a changé/.test(result), result);
  }

  // Optional: dump results so scripts/preview.html can render the UI with real analysis data.
  if (process.env.CUEKODA_DUMP) {
    fs.writeFileSync(process.env.CUEKODA_DUMP, `window.__RESULTS__ = ${JSON.stringify(results)};`);
  }
  const rb = buildRekordboxXml(results);
  const nml = buildTraktorNml(results);
  fs.writeFileSync(path.join(dir, 'rekordbox.xml'), rb);
  fs.writeFileSync(path.join(dir, 'traktor.nml'), nml);
  console.log(`\nfichiers de test: ${dir}`);
  console.log(failures === 0 ? '\nTOUT PASSE' : `\n${failures} ÉCHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

if (require.main === module && path.basename(__filename) === 'run.js') {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
