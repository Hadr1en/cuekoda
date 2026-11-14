import type { AnalysisResult } from './types';

/**
 * Track matching: helps prepare transitions, does not build a set. Each criterion is explained.
 * Score (0–100) = key (≤35) + tempo (≤35) + energy (≤15) + transition windows (≤15).
 */
export interface MatchResult {
  path: string;
  title: string;
  artist: string;
  score: number;
  reasons: string[];
  cautions: string[];
}

export type KeyRelation = 'same' | 'adjacent' | 'relative' | 'boost' | 'diagonal' | 'none';

function parseCamelot(k: string): { n: number; l: string } | null {
  const m = /^(\d{1,2})([AB])$/.exec(k);
  return m ? { n: Number(m[1]), l: m[2] } : null;
}

export function camelotRelation(a: string, b: string): KeyRelation {
  const x = parseCamelot(a);
  const y = parseCamelot(b);
  if (!x || !y) return 'none';
  const d = (((y.n - x.n) % 12) + 12) % 12; // steps clockwise from a to b
  if (x.l === y.l) {
    if (d === 0) return 'same';
    if (d === 1 || d === 11) return 'adjacent';
    if (d === 2) return 'boost';
    return 'none';
  }
  if (d === 0) return 'relative';
  if (d === 1 || d === 11) return 'diagonal';
  return 'none';
}

/** Smallest tempo gap in %, allowing half / double time. */
export function tempoGapPct(a: number, b: number): { pct: number; ratio: 1 | 2 | 0.5 } {
  const opts: { pct: number; ratio: 1 | 2 | 0.5 }[] = [1, 2, 0.5].map((r) => ({
    pct: (Math.abs(b * r - a) / a) * 100,
    ratio: r as 1 | 2 | 0.5,
  }));
  return opts.sort((p, q) => p.pct - q.pct)[0];
}

const KEY_TEXT: Record<KeyRelation, string> = {
  same: 'même tonalité',
  adjacent: 'tonalité voisine (±1 Camelot)',
  relative: 'relative majeure / mineure',
  boost: 'montée harmonique (+2, energy boost)',
  diagonal: 'relation diagonale (changement d’ambiance)',
  none: '',
};
const KEY_POINTS: Record<KeyRelation, number> = { same: 35, adjacent: 30, relative: 28, boost: 20, diagonal: 10, none: 0 };

export function matchTracks(from: AnalysisResult, library: AnalysisResult[], limit = 10): MatchResult[] {
  const out: MatchResult[] = [];
  for (const t of library) {
    if (t.path === from.path || (t.fileHash && t.fileHash === from.fileHash)) continue;
    const m = pairScore(from, t);
    if (m.score >= 40) out.push(m);
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** How well `t` follows `from` (0–100, explained). Shared by the matching and the mix-order suggestion. */
export function pairScore(from: AnalysisResult, t: AnalysisResult): MatchResult {
  {
    const reasons: string[] = [];
    const cautions: string[] = [];
    let score = 0;

    const rel = camelotRelation(from.key.camelot, t.key.camelot);
    score += KEY_POINTS[rel];
    if (rel !== 'none') reasons.push(`${KEY_TEXT[rel]} (${from.key.camelot} → ${t.key.camelot})`);
    if (t.key.ambiguous || from.key.ambiguous) cautions.push('tonalité incertaine');

    const gap = tempoGapPct(from.bpm, t.bpm);
    const half = gap.ratio !== 1 ? ` en ${gap.ratio === 2 ? 'double' : 'demi'}-tempo` : '';
    if (gap.pct <= 2) {
      score += 35;
      reasons.push(`BPM proche${half} (${t.bpm.toFixed(1)}, ${gap.pct.toFixed(1)} %)`);
    } else if (gap.pct <= 6) {
      score += 20;
      reasons.push(`BPM ajustable${half} (${gap.pct.toFixed(1)} % de pitch)`);
    } else {
      cautions.push(`écart de tempo ${gap.pct.toFixed(0)} %`);
    }

    if (from.energy && t.energy) {
      const d = t.energy.score - from.energy.score;
      if (Math.abs(d) <= 1) {
        score += 15;
        reasons.push('énergie similaire');
      } else if (d > 1 && d <= 2.5) {
        score += 10;
        reasons.push('montée d’énergie');
      } else if (d < -1 && d >= -2.5) {
        score += 6;
        reasons.push('redescente d’énergie');
      }
    }

    const out_ = from.mix?.mixOut[0];
    const in_ = t.mix?.mixIn[0];
    // Two clear voices on top of each other clash (vocal detection is unvalidated: caution, small penalty).
    if (out_?.vocals === 'strong' && in_?.vocals === 'strong') {
      score -= 5;
      cautions.push('voix détectée dans la sortie et dans l’entrée : éviter de superposer les deux passages chantés');
    }
    if (out_ && in_) {
      const win = Math.min(out_.lengthBars, in_.lengthBars);
      if (win >= 16) {
        score += 15;
        reasons.push(`fenêtres de transition longues (outro ${out_.lengthBars} / intro ${in_.lengthBars} mesures)`);
      } else if (win >= 8) {
        score += 8;
        reasons.push(`fenêtre de transition de ${win} mesures`);
      }
    }
    return { path: t.path, title: t.title, artist: t.artist, score, reasons, cautions };
  }
}
