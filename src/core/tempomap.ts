import { attackEnvelope, combScore, detrend } from './rhythm';
import { median, timeToFrame, type Bands } from './dsp';

/**
 * Tempo map for tracks whose tempo changes (spec §3.2). Only computed when the global grid was flagged
 * "variable": constant-tempo tracks keep their single, more precise grid.
 *
 *  1. Tempo + phase of every 64-beat segment, fitted independently (±8 % around the global tempo).
 *  2. Consecutive segments within 0.4 % are merged into constant-tempo runs; segments without a clear
 *     pulse (breakdowns) join the previous run.
 *  3. Each run gets a precise grid (finer tempo search, phase corrected on the attack envelope).
 *  4. The switch point between two runs is searched beat by beat: the position where grid A explains the
 *     attacks before it and grid B the attacks after it best.
 */
export interface TempoMarker {
  startSec: number;
  bpm: number;
  /** Position of this beat in the bar (1–4) — rekordbox "Battito" */
  beatInBar: number;
}

interface Grid {
  bpm: number;
  /** a beat time of this grid */
  anchor: number;
}

export function buildTempoMap(x: Float32Array, sr: number, bands: Bands, bpm: number, firstDownbeatSec: number): TempoMarker[] {
  const durSec = x.length / sr;
  const o = detrend(bands.onset, Math.round(bands.frameRate * 0.5));
  const fr = bands.frameRate;
  const global = combScore(o, fr, bpm).s;
  const segSec = (64 * 60) / bpm;

  // 1. local tempo per segment
  type Seg = { t0: number; t1: number; bpm: number; strong: boolean };
  const segs: Seg[] = [];
  for (let t0 = 0; t0 < durSec - segSec / 2; t0 += segSec) {
    const t1 = Math.min(durSec, t0 + segSec);
    const f0 = Math.max(0, Math.floor(timeToFrame(bands, t0)));
    const f1 = Math.floor(timeToFrame(bands, t1));
    let best = { bpm, s: -1 };
    for (let b = bpm * 0.92; b <= bpm * 1.08; b += 0.05) {
      const r = combScore(o, fr, b, f0, f1);
      if (r.s > best.s) best = { bpm: b, s: r.s };
    }
    segs.push({ t0, t1, bpm: best.bpm, strong: best.s >= 0.5 * global });
  }

  // 2. merge into constant-tempo runs
  type Run = { t0: number; t1: number; bpms: number[] };
  const runs: Run[] = [];
  for (const s of segs) {
    const last = runs[runs.length - 1];
    const lastBpm = last ? median(last.bpms) : 0;
    if (last && (!s.strong || Math.abs(s.bpm - lastBpm) / lastBpm <= 0.004)) {
      last.t1 = s.t1;
      if (s.strong) last.bpms.push(s.bpm);
    } else if (s.strong || !last) {
      runs.push({ t0: s.t0, t1: s.t1, bpms: s.strong ? [s.bpm] : [bpm] });
    }
  }
  if (runs.length < 2) return [];

  // 3. precise grid per run
  const env = attackEnvelope(x, sr);
  const strength = (t: number, half = 0.025) => {
    let m = 0;
    for (let n = Math.max(0, Math.round((t - half) * sr)); n < Math.min(env.length, Math.round((t + half) * sr)); n++) m = Math.max(m, env[n]);
    return m;
  };
  const grids: Grid[] = runs.map((r) => {
    const f0 = Math.max(0, Math.floor(timeToFrame(bands, r.t0)));
    const f1 = Math.floor(timeToFrame(bands, r.t1));
    const c = median(r.bpms);
    let best = { bpm: c, s: -1 };
    for (let b = c - 0.15; b <= c + 0.15; b += 0.005) {
      const res = combScore(o, fr, b, f0, f1);
      if (res.s > best.s) best = { bpm: b, s: res.s };
    }
    // phase: searched on the attack envelope (4 ms steps) — sharper than the frame-level estimate, and
    // the kick's attack dominates the off-beat hi-hats; then refined by the median offset of attacks
    const P = 60 / best.bpm;
    let anchor = r.t0;
    let bestS = -1;
    for (let ph = 0; ph < P; ph += 0.004) {
      let s = 0;
      for (let t = r.t0 + ph; t < r.t1; t += P) s += strength(t, 0.01);
      if (s > bestS) { bestS = s; anchor = r.t0 + ph; }
    }
    const offs: number[] = [];
    for (let t = anchor; t < r.t1; t += P) {
      const lo = Math.max(0, Math.round((t - 0.04) * sr));
      const hi = Math.min(env.length - 1, Math.round((t + 0.04) * sr));
      let bi = lo, bv = -1;
      for (let n = lo; n <= hi; n++) if (env[n] > bv) { bv = env[n]; bi = n; }
      offs.push(bi / sr - t);
    }
    if (offs.length >= 8) anchor += median(offs);
    // snap to round tempos when within 0.03 bpm (DAW-produced music)
    const round2 = Math.round(best.bpm * 2) / 2;
    return { bpm: Math.abs(round2 - best.bpm) <= 0.03 ? round2 : Math.round(best.bpm * 100) / 100, anchor };
  });

  // 4. switch points
  const beatsOf = (g: Grid, from: number, to: number) => {
    const P = 60 / g.bpm;
    const out: number[] = [];
    for (let t = g.anchor + Math.ceil((from - g.anchor) / P) * P; t < to; t += P) out.push(t);
    return out;
  };
  // first marker: the first clear attack of grid 0 is a bar start (beat 1) — the global downbeat is not
  // reliable when the tempo changes; markers start at the earliest grid beat ≥ 0
  const P0 = 60 / grids[0].bpm;
  const g0 = beatsOf(grids[0], 0, runs[0].t1);
  const strengths = g0.map((t) => strength(t, 0.01));
  const ref = median(strengths.filter((v) => v > 0));
  const firstIdx = Math.max(0, strengths.findIndex((v) => v >= 0.5 * ref));
  const markers: TempoMarker[] = [
    { startSec: g0[0] ?? 0, bpm: grids[0].bpm, beatInBar: (((-firstIdx) % 4) + 4) % 4 + 1 },
  ];
  void P0;
  void firstDownbeatSec;
  for (let i = 1; i < grids.length; i++) {
    const A = grids[i - 1], B = grids[i];
    const boundary = runs[i].t0;
    const win = 32 * (60 / B.bpm);
    const cands = beatsOf(B, Math.max(markers[markers.length - 1].startSec + 1, boundary - win), boundary + win);
    let best = cands[0] ?? boundary, bestScore = -Infinity;
    for (const c of cands) {
      // exactly 16 beats of each grid (a fixed duration would hold 15 or 16 beats and bias the sums);
      // narrow windows: the last beat of A and a beat of B can be only ~15 ms apart around the switch
      const sA = beatsOf(A, c - 20 * (60 / A.bpm), c).slice(-16).reduce((s, t) => s + strength(t, 0.01), 0);
      const sB = beatsOf(B, c, c + 20 * (60 / B.bpm)).slice(0, 16).reduce((s, t) => s + strength(t, 0.01), 0);
      if (sA + sB > bestScore) { bestScore = sA + sB; best = c; }
    }
    const prev = markers[markers.length - 1];
    const beatsBetween = Math.round((best - prev.startSec) / (60 / prev.bpm));
    markers.push({ startSec: best, bpm: B.bpm, beatInBar: ((prev.beatInBar - 1 + beatsBetween) % 4) + 1 });
  }
  return markers.map((m) => ({ ...m, startSec: Math.round(m.startSec * 1000) / 1000 }));
}
