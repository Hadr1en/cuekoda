import { Bands, median, percentile, prefixSums, rangeMean, timeToFrame } from './dsp';
import type { Confidence, PhraseInfo, Section, SectionType, VocalInfo } from './types';

export interface BarFeatures {
  d0: number;
  barLen: number;
  nBars: number;
  energyDb: number[];
  brightDb: number[];
  /** Energy below 130 Hz (kick + sub bass) — the "weight" of the groove */
  lowDb: number[];
  kick: number[];
}

export function computeBarFeatures(bands: Bands, d0: number, barLen: number, durSec: number): BarFeatures {
  const nBars = Math.max(0, Math.floor((durSec - d0) / barLen));
  const total = new Float64Array(bands.frames);
  const bright = new Float64Array(bands.frames);
  for (let f = 0; f < bands.frames; f++) {
    total[f] = bands.eLow[f] + bands.eMid[f] + bands.eHigh[f];
    bright[f] = bands.eMid[f] + bands.eHigh[f];
  }
  const pT = prefixSums(total);
  const pB = prefixSums(bright);
  const pK = prefixSums(bands.fluxLow);
  const pL = prefixSums(bands.eLow);
  const energyDb: number[] = [];
  const brightDb: number[] = [];
  const lowDb: number[] = [];
  const kick: number[] = [];
  for (let b = 0; b < nBars; b++) {
    // Only frames lying fully inside the bar: a frame straddling the boundary would leak the
    // next section's attack into this bar (a kick is +40 dB over a silent low end).
    const t0 = d0 + b * barLen;
    const t1 = d0 + (b + 1) * barLen;
    const f0 = Math.ceil((t0 * bands.sr) / bands.hop);
    const f1 = Math.floor((t1 * bands.sr - bands.frameSize) / bands.hop) + 1;
    energyDb.push(10 * Math.log10(rangeMean(pT, f0, f1) + 1e-9));
    brightDb.push(10 * Math.log10(rangeMean(pB, f0, f1) + 1e-9));
    lowDb.push(10 * Math.log10(rangeMean(pL, f0, f1) + 1e-9));
    kick.push(rangeMean(pK, f0, f1));
  }
  return { d0, barLen, nBars, energyDb, brightDb, lowDb, kick };
}

/** First bar that carries real music (not silence / digital noise floor). */
export function firstAudibleBar(f: BarFeatures): number {
  if (f.nBars === 0) return 0;
  const ref = percentile(f.energyDb, 95);
  for (let b = 0; b < f.nBars; b++) if (f.energyDb[b] > ref - 35) return b;
  return 0;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const mean = (a: number[], i0: number, i1: number) => {
  const lo = Math.max(0, i0);
  const hi = Math.min(a.length, i1);
  if (hi <= lo) return 0;
  let s = 0;
  for (let i = lo; i < hi; i++) s += a[i];
  return s / (hi - lo);
};

interface Run {
  s: number;
  e: number; // exclusive
}

function runsOf(flags: boolean[], value: boolean, from: number): Run[] {
  const runs: Run[] = [];
  let s = -1;
  for (let i = from; i <= flags.length; i++) {
    const v = i < flags.length ? flags[i] === value : false;
    if (v && s < 0) s = i;
    if (!v && s >= 0) {
      runs.push({ s, e: i });
      s = -1;
    }
  }
  return runs;
}

function medianFilterNum(a: number[]): number[] {
  return a.map((v, i) => {
    const w = [a[Math.max(0, i - 1)], v, a[Math.min(a.length - 1, i + 1)]].sort((x, y) => x - y);
    return w[1];
  });
}

/** Linear regression r and slope of y over index. */
function trend(y: number[], i0: number, i1: number): { slope: number; r: number } {
  const n = i1 - i0;
  if (n < 3) return { slope: 0, r: 0 };
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const v = y[i0 + i];
    sx += i; sy += v; sxx += i * i; syy += v * v; sxy += i * v;
  }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 0 || vy <= 1e-9) return { slope: 0, r: 0 };
  return { slope: cov / vx, r: cov / Math.sqrt(vx * vy) };
}

export type LandmarkRole = 'intro' | 'groove' | 'build1' | 'drop1' | 'break1' | 'build2' | 'drop2' | 'outro' | 'kickout';

export interface Landmark {
  role: LandmarkRole;
  bar: number;
  confidence: Confidence;
  reason: string;
}

export interface StructureAnalysis {
  /** First audible bar */
  origin: number;
  nBars: number;
  /** Phrase grid phase (bar index mod 8) */
  phraseOrigin: number;
  landmarks: Landmark[];
  /** Section changes (local maxima), strength relative to the strongest change (0..1) */
  changePoints: { bar: number; strength: number }[];
  /** Bars where the full groove plays (relative to the track's own peak level) */
  on: boolean[];
  /** Bars with kick / low-end percussive activity */
  kickBars: boolean[];
}

/**
 * Detects the landmarks of the track (intro, groove entry, build-ups, drops, breakdown, outro,
 * kick-out) from per-bar loudness / low end / brightness, snapped to phrase boundaries, each with
 * a qualitative confidence and a short justification.
 */
export function analyzeStructure(f: BarFeatures): StructureAnalysis {
  const n = f.nBars;
  const origin = firstAudibleBar(f);
  const out: StructureAnalysis = {
    origin,
    nBars: n,
    phraseOrigin: origin % 8,
    landmarks: [],
    changePoints: [],
    on: new Array(n).fill(true),
    kickBars: new Array(n).fill(false),
  };
  if (n < 4) return out;
  const bars: Partial<Record<LandmarkRole, number>> = { intro: origin };
  const ev: Partial<Record<LandmarkRole, { confidence: Confidence; reason: string }>> = {
    intro: { confidence: 'high', reason: 'Première mesure audible, calée sur le temps 1' },
  };
  const k90 = percentile(f.kick.slice(origin), 90) + 1e-9;
  out.kickBars = f.kick.map((k, b) => b >= origin && k >= 0.3 * k90);
  const finish = () => {
    for (const role of Object.keys(bars) as LandmarkRole[]) {
      const bar = bars[role]!;
      if (bar < 0 || bar >= n) continue;
      out.landmarks.push({ role, bar, ...(ev[role] ?? { confidence: 'medium', reason: '' }) });
    }
    out.landmarks.sort((a, b) => a.bar - b.bar);
    return out;
  };
  if (n - origin < 12) return finish();

  const eSlice = f.energyDb.slice(origin);
  const lSlice = f.lowDb.slice(origin);
  const e10 = percentile(eSlice, 10);
  const e90 = percentile(eSlice, 90);
  const e80 = percentile(eSlice, 80);
  const l10 = percentile(lSlice, 10);
  const l90 = percentile(lSlice, 90);

  // Robust (median) step between the 4 bars after and the 4 bars before a bar: a single
  // impact / pause bar cannot fake a section change.
  const med = (a: number[], i0: number, i1: number): number => {
    const s = a.slice(Math.max(0, i0), Math.min(a.length, i1)).sort((x, y) => x - y);
    return s.length ? s[s.length >> 1] : 0;
  };
  // Means give a sharp, exactly-located peak at a boundary; medians tell whether the change is
  // real (a plateau) or just a one-bar spike. Position from the mean, validity from the median.
  // One-bar jump: peaks exactly on the first bar of a new section (a 4-bar mean would peak early
  // when a riser ramps up into the drop).
  const lowStep = (b: number) => (b > 0 ? f.lowDb[b] - f.lowDb[b - 1] : 0);
  const energyStep = (b: number) => (b > 0 ? f.energyDb[b] - f.energyDb[b - 1] : 0);
  const lowStepMed = (b: number) => med(f.lowDb, b, b + 4) - med(f.lowDb, b - 4, b);
  const energyStepMed = (b: number) => med(f.energyDb, b, b + 4) - med(f.energyDb, b - 4, b);
  const nearMax = (fn: (b: number) => number, b: number) => {
    let m = -Infinity;
    for (let j = Math.max(0, b - 2); j <= Math.min(n - 1, b + 2); j++) m = Math.max(m, fn(j));
    return m;
  };

  // Phrase grid phase: section changes land on phrase starts (8 bars apart). Let the strongest
  // changes vote for their bar index mod 8, so the grid follows the music, not the file start.
  const change = new Array<number>(n).fill(0);
  let cMax = 0;
  for (let b = origin + 3; b < n - 3; b++) {
    const located = Math.abs(lowStep(b)) + Math.abs(energyStep(b));
    const valid = nearMax((j) => Math.abs(lowStepMed(j)) + Math.abs(energyStepMed(j)), b);
    change[b] = Math.min(located, valid);
    cMax = Math.max(cMax, change[b]);
  }
  if (process.env.CUEKODA_DEBUG) {
    console.error('# change[] ' + change.map((v, b) => (v >= 0.2 * cMax ? `${b}:${v.toFixed(1)}(L${lowStep(b).toFixed(1)}/E${energyStep(b).toFixed(1)})` : '')).filter(Boolean).join(' '));
  }
  const votes = new Array<number>(8).fill(0);
  for (let b = origin + 3; b < n - 3; b++) {
    if (change[b] < 0.4 * cMax) continue;
    let isMax = true;
    for (let j = b - 3; j <= b + 3 && isMax; j++) if (j !== b && change[j] > change[b]) isMax = false;
    if (isMax) votes[b % 8] += change[b];
  }
  for (let b = origin + 3; b < n - 3; b++) {
    if (change[b] < 0.2 * cMax || cMax <= 0) continue;
    let isMax = true;
    for (let j = b - 3; j <= b + 3 && isMax; j++) if (j !== b && change[j] > change[b]) isMax = false;
    if (isMax) out.changePoints.push({ bar: b, strength: change[b] / cMax });
  }
  const ranked = votes.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const po = ranked[0].v > 1.25 * ranked[1].v ? ranked[0].i : origin % 8; // phrase origin (mod 8)
  out.phraseOrigin = po;
  if (process.env.CUEKODA_DEBUG) console.error(`# phrase phase votes ${votes.map((v) => v.toFixed(1)).join(' ')} -> po=${po} (origin=${origin})`);

  const snap = (b: number): number => {
    const rel = b - po;
    const m8 = Math.round(rel / 8) * 8;
    if (Math.abs(rel - m8) <= 2) return Math.max(origin, po + m8);
    const m4 = Math.round(rel / 4) * 4;
    if (Math.abs(rel - m4) <= 1) return Math.max(origin, po + m4);
    return b;
  };

  // "on" = the full groove is playing. Judged relative to this track's own peak level (p90 of
  // loudness / low end), with hysteresis so a bar hovering near the limit does not flicker.
  // q <= 0: how far below the peak sections the bar is (low-end drops count 0.4 dB per dB).
  const q = medianFilterNum(f.energyDb.map((v, b) => Math.min(v - e90, 0.4 * (f.lowDb[b] - l90))));
  const on: boolean[] = new Array(n).fill(false);
  let state = false;
  for (let b = origin; b < n; b++) {
    if (!state && q[b] >= -2) state = true;
    else if (state && q[b] < -4) state = false;
    on[b] = state;
  }
  out.on = on;
  const offRuns = runsOf(on, false, origin).filter((r) => r.e - r.s >= 4);

  // Entries = bars where the groove (re)starts after an off-run.
  interface Entry {
    bar: number;
    jump: number;
    run: Run;
  }
  const entries: Entry[] = offRuns
    .filter((r) => r.e < n - 2)
    .map((r) => ({
      bar: r.e,
      jump: mean(f.energyDb, r.e, r.e + 4) - mean(f.energyDb, r.e - 4, r.e),
      run: r,
    }));

  const groove = entries.find((x) => x.run.s === origin && x.jump < 2.5 && x.bar - origin <= 40);

  // Drop candidates = the kick comes back after a gap, OR the sub/bass weight steps up
  // (covers tracks whose kick already plays during the intro).
  const steps: number[] = new Array(n).fill(0);
  for (let b = origin + 4; b < n - 4; b++) steps[b] = lowStep(b);
  const stepBars: number[] = [];
  for (let b = origin + 4; b < n - 4; b++) {
    if (steps[b] < 3) continue;
    if (nearMax(lowStepMed, b) < 3) continue; // one-bar spike, not a sustained change
    let isMax = steps[b] > steps[b - 1];
    for (let j = Math.max(origin + 4, b - 4); j <= Math.min(n - 5, b + 4) && isMax; j++) if (steps[j] > steps[b]) isMax = false;
    if (isMax) stepBars.push(b);
  }
  interface Cand {
    bar: number;
    run?: Run;
    confidence: Confidence;
    reason: string;
  }
  let cands: Cand[] = entries
    .filter((x) => x.jump >= 2.5)
    .map((x) => ({
      bar: x.bar,
      run: x.run,
      confidence: (x.jump >= 4 ? 'high' : 'medium') as Confidence,
      reason: `Le groove revient après ${x.run.e - x.run.s} mesures plus calmes (+${x.jump.toFixed(1)} dB)`,
    }));
  for (const sb of stepBars) {
    if (cands.some((c) => Math.abs(c.bar - sb) <= 5)) continue;
    const st = steps[sb];
    cands.push({
      bar: sb,
      confidence: st >= 6 ? 'high' : 'medium',
      reason: `Entrée de la basse / du kick (+${st.toFixed(1)} dB dans les graves)`,
    });
  }
  cands.sort((a, b) => a.bar - b.bar);
  // The gentle kick-in at the start of the track is the "groove", not a drop.
  if (groove) cands = cands.filter((c) => Math.abs(c.bar - groove.bar) > 3);

  let drop1: Cand | undefined = cands[0];
  // Last resort: the largest loudness step.
  if (!drop1) {
    let best = -1, bestJ = 3;
    for (let b = origin + 8; b < n - 8; b++) {
      const j = mean(f.energyDb, b, b + 4) - mean(f.energyDb, b - 4, b);
      if (j > bestJ) { bestJ = j; best = b; }
    }
    if (best >= 0) drop1 = { bar: best, confidence: 'low', reason: `Plus forte hausse de volume du morceau (+${bestJ.toFixed(1)} dB)` };
    if (drop1) cands = [drop1];
  }
  const floorFor = (c: Cand, lowest: number) => (c.run ? Math.max(lowest, c.run.s) : Math.max(lowest, c.bar - 32));

  const riseStart = (end: number, floor: number): { bar: number; confidence: Confidence; reason: string } | null => {
    // Fit a rising line over several window lengths; keep the longest one whose fit is
    // (almost) as good as the best, so a flat lead-in is not mistaken for part of the riser.
    // A window is a valid riser if it rises overall AND its first half is already rising
    // (otherwise it starts with a flat stretch that is not part of the build-up).
    const valid: { L: number; r: number }[] = [];
    for (const L of [32, 16, 8, 4]) {
      if (end - L < floor) continue;
      const all = trend(f.brightDb, end - L, end);
      const first = trend(f.brightDb, end - L, end - L / 2);
      if (all.slope >= 0.25 && all.r >= 0.6 && first.slope >= 0.12) valid.push({ L, r: all.r });
    }
    if (!valid.length) return null;
    const v = valid[0];
    return {
      bar: end - v.L,
      confidence: (v.r >= 0.85 && v.L >= 8 ? 'high' : 'medium') as Confidence,
      reason: `Montée continue de la brillance sur ${v.L} mesures avant le drop`,
    };
  };

  const grooveEv = { confidence: 'medium' as Confidence, reason: 'Entrée progressive du kick après une intro sans percussion' };
  if (drop1) {
    bars.drop1 = snap(drop1.bar);
    ev.drop1 = { confidence: drop1.confidence, reason: drop1.reason };
    if (groove) {
      bars.groove = snap(groove.bar);
      ev.groove = grooveEv;
    } else {
      const r = riseStart(drop1.bar, floorFor(drop1, origin));
      // a build that starts with the intro itself is not a separate landmark
      if (r && snap(r.bar) - origin >= 4) {
        bars.build1 = snap(r.bar);
        ev.build1 = { confidence: r.confidence, reason: r.reason };
      }
    }
  } else if (groove) {
    bars.groove = snap(groove.bar);
    ev.groove = grooveEv;
  }

  // Outro: after the last bar that is still at full energy.
  let lastFull = -1;
  for (let b = n - 1; b >= origin; b--) {
    if (mean(f.energyDb, b - 1, b + 1) >= e80 - 2.5) { lastFull = b; break; }
  }
  let outro = lastFull + 1;
  ev.outro = { confidence: 'medium', reason: 'Fin de la dernière section à pleine énergie' };
  if (n - outro < 4) {
    outro = n - 16;
    ev.outro = { confidence: 'low', reason: 'Pas de baisse d’énergie en fin de morceau : 16 dernières mesures' };
  }
  outro = snap(outro);
  const minOutro = (bars.drop2 ?? bars.drop1 ?? origin) + 8;
  if (outro < minOutro) outro = Math.min(n - 8, snap(minOutro));

  if (drop1) {
    const d1 = bars.drop1!;
    const breaks = offRuns.filter((r) => r.s >= d1 + 4 && r.s < outro - 2);
    const br = breaks[0];
    if (br) {
      bars.break1 = snap(br.s);
      const len = br.e - br.s;
      ev.break1 = {
        confidence: len >= 8 ? 'high' : 'medium',
        reason: `Le groove s’interrompt pendant ${len} mesures`,
      };
      const d2 = cands.find((c) => c.bar >= br.e - 1 && c.bar > d1 + 8);
      if (d2) {
        bars.drop2 = snap(d2.bar);
        ev.drop2 = { confidence: d2.confidence, reason: d2.reason };
        const r = riseStart(d2.bar, br.s);
        // the whole breakdown rising = the breakdown *is* the build: keep a single landmark
        if (r && snap(r.bar) - bars.break1 >= 4) {
          bars.build2 = snap(r.bar);
          ev.build2 = { confidence: r.confidence, reason: r.reason };
        }
      }
    } else {
      // No gap in the groove: the next big weight step is the second drop.
      const d2 = cands.find((c) => c.bar > d1 + 16);
      if (d2) {
        bars.drop2 = snap(d2.bar);
        ev.drop2 = { confidence: d2.confidence === 'high' ? 'medium' : 'low', reason: d2.reason };
      }
    }
  }
  if (outro > origin + 8) bars.outro = outro;

  // Kick-out: the groove leaves for good (DJ-tool tails).
  let lastOnEnd = -1;
  for (let b = n - 1; b >= origin; b--) if (on[b]) { lastOnEnd = b + 1; break; }
  if (lastOnEnd > 0 && bars.outro !== undefined && lastOnEnd > bars.outro + 8 && n - lastOnEnd >= 2) {
    bars.kickout = snap(lastOnEnd);
    ev.kickout = { confidence: 'medium', reason: 'Le groove s’arrête définitivement' };
  }

  return finish();
}

/**
 * Phrase length: the largest of 32 / 16 / 8 bars on which the strong section changes line up.
 * Returns lengthBars = null when changes do not follow a regular phrase grid (no assumption).
 */
export function detectPhrases(s: StructureAnalysis): PhraseInfo {
  const strong = s.changePoints.filter((c) => c.strength >= 0.4);
  const none: PhraseInfo = { lengthBars: null, originBar: s.origin, regularity: 0, bars: [] };
  if (strong.length < 2) return none;
  const total = strong.reduce((a, c) => a + c.strength, 0);
  const fit = (L: number) => {
    let best = { p: 0, w: -1 };
    for (let p = 0; p < L; p++) {
      let w = 0;
      for (const c of strong) if ((((c.bar - p) % L) + L) % L === 0) w += c.strength;
      if (w > best.w) best = { p, w };
    }
    return { p: best.p, reg: best.w / total };
  };
  let chosen: { L: number; p: number; reg: number } | null = null;
  for (const L of [32, 16, 8]) {
    const r = fit(L);
    const need = 0.6; // at least 60 % of the change strength on the grid — otherwise no phrase claim
    if (r.reg >= need && strong.length >= (L === 32 ? 3 : 2)) {
      chosen = { L, ...r };
      break;
    }
  }
  if (!chosen) return { ...none, regularity: fit(8).reg };
  const { L, p, reg } = chosen;
  const first = p + L * Math.ceil((s.origin - p) / L);
  const bars: number[] = [];
  for (let b = first; b < s.nBars; b += L) bars.push(b);
  return { lengthBars: L, originBar: first, regularity: reg, bars };
}

export const SECTION_LABEL: Record<SectionType, string> = {
  intro: 'Intro',
  verse: 'Couplet',
  chorus: 'Refrain',
  break: 'Break',
  breakdown: 'Breakdown',
  build: 'Build-up',
  drop: 'Drop',
  instrumental: 'Instrumental',
  outro: 'Outro',
  section: 'Section',
};

/** Share of bars [a, b) covered by a *strong* vocal segment. */
function strongVocalShare(v: VocalInfo, a: number, b: number): number {
  if (b <= a) return 0;
  let k = 0;
  for (let i = a; i < b; i++) if (v.segments.some((g) => g.strength === 'strong' && g.startBar <= i && i < g.endBar)) k++;
  return k / (b - a);
}

/**
 * Verse / chorus labelling — only on strong evidence, and only on sections the structure could not
 * name (type 'section'): ≥ 2 such sections of ≥ 8 bars, each ≥ 75 % covered by strong vocal segments,
 * whose energies differ clearly (≥ 0.12). Louder ones → chorus, quieter ones → verse, confidence 'low'
 * (no repetition analysis, detector unvalidated). Otherwise nothing is renamed. Exported for tests.
 */
export function labelVocalSections(sections: Section[], vocals: VocalInfo | undefined): void {
  if (!vocals || vocals.level === 'low') return;
  const sung = sections.filter((x) => x.type === 'section' && x.endBar - x.startBar >= 8 && strongVocalShare(vocals, x.startBar, x.endBar) >= 0.75);
  if (sung.length < 2) return;
  const es = sung.map((x) => x.energy);
  const lo = Math.min(...es);
  const hi = Math.max(...es);
  if (hi - lo < 0.12) return;
  const mid = (lo + hi) / 2;
  let nv = 0, nc = 0;
  for (const x of sung) {
    const chorus = x.energy >= mid;
    x.type = chorus ? 'chorus' : 'verse';
    x.label = `${SECTION_LABEL[x.type]} ${chorus ? ++nc : ++nv}`;
    x.confidence = 'low';
  }
  // no number when there is only one of a kind
  for (const t of ['chorus', 'verse'] as const) {
    const of = sung.filter((x) => x.type === t);
    if (of.length === 1) of[0].label = SECTION_LABEL[t];
  }
}

/**
 * Turns landmarks + significant change points into a timeline of sections. With the 'generic'
 * vocabulary, drops / breakdowns are not named as such (no EDM shape forced on other genres).
 * Verse / chorus are only proposed on strong vocal evidence (see labelVocalSections); sections with a
 * clear voice get a "· voix" suffix in their label.
 */
export function buildSections(
  s: StructureAnalysis,
  f: BarFeatures,
  energyCurve: number[],
  durSec: number,
  vocabulary: 'edm' | 'generic',
  vocals?: VocalInfo,
): Section[] {
  const n = s.nBars;
  if (n === 0) return [];
  type B = { bar: number; role: LandmarkRole | 'change'; confidence: Confidence };
  const bounds: B[] = s.landmarks.map((l) => ({ bar: l.bar, role: l.role, confidence: l.confidence }));
  if (!bounds.some((b) => b.bar === s.origin)) bounds.push({ bar: s.origin, role: 'intro', confidence: 'high' });
  for (const c of s.changePoints) {
    if (c.strength < 0.5) continue;
    if (bounds.some((b) => Math.abs(b.bar - c.bar) < 4)) continue;
    bounds.push({ bar: c.bar, role: 'change', confidence: c.strength >= 0.7 ? 'medium' : 'low' });
  }
  bounds.sort((a, b) => a.bar - b.bar);
  const meanE = (a: number, b: number) => {
    let sum = 0, k = 0;
    for (let i = Math.max(0, a); i < Math.min(b, energyCurve.length); i++) { sum += energyCurve[i]; k++; }
    return k ? sum / k : 0;
  };
  const maxE = Math.max(0.01, ...energyCurve.slice(s.origin));
  const counters: Partial<Record<SectionType, number>> = {};
  const out: Section[] = [];
  bounds.forEach((b, i) => {
    const endBar = i + 1 < bounds.length ? bounds[i + 1].bar : n;
    if (endBar <= b.bar) return;
    const energy = meanE(b.bar, endBar);
    let type: SectionType;
    let label = '';
    switch (b.role) {
      case 'intro': type = 'intro'; break;
      case 'groove': type = 'intro'; label = 'Intro (groove)'; break;
      case 'build1': case 'build2': type = 'build'; break;
      case 'drop1': case 'drop2': type = vocabulary === 'edm' ? 'drop' : 'section'; if (vocabulary !== 'edm') label = 'Section principale'; break;
      case 'break1': type = vocabulary === 'edm' ? 'breakdown' : 'break'; break;
      case 'outro': type = 'outro'; break;
      case 'kickout': type = 'outro'; label = 'Fin (sans kick)'; break;
      default: {
        type = 'section';
        const rel = energy / maxE;
        label = rel >= 0.8 ? 'Section (énergie haute)' : rel >= 0.5 ? 'Section' : 'Section calme';
      }
    }
    if (!label) {
      counters[type] = (counters[type] ?? 0) + 1;
      label = SECTION_LABEL[type];
    }
    out.push({
      id: `s${i}`,
      type,
      label,
      startBar: b.bar,
      endBar,
      startSec: Math.max(0, f.d0 + b.bar * f.barLen),
      endSec: i + 1 < bounds.length ? f.d0 + endBar * f.barLen : durSec,
      energy,
      confidence: b.confidence,
      origin: 'auto',
    });
  });
  // Number repeated types (Drop 1, Drop 2 …)
  for (const t of Object.keys(counters) as SectionType[]) {
    if ((counters[t] ?? 0) < 2) continue;
    let k = 0;
    for (const sec of out) if (sec.type === t && sec.label === SECTION_LABEL[t]) sec.label = `${SECTION_LABEL[t]} ${++k}`;
  }
  labelVocalSections(out, vocals);
  if (vocals && vocals.level !== 'low') {
    for (const sec of out) {
      if (sec.type !== 'verse' && sec.type !== 'chorus' && strongVocalShare(vocals, sec.startBar, sec.endBar) >= 0.5) sec.label += ' · voix';
    }
  }
  return out;
}

export { median };
