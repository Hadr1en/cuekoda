import type { Profile } from './profiles';
import type { StructureAnalysis } from './structure';
import type { Confidence, MixSuggestion, PhraseInfo, VocalInfo } from './types';
import { vocalPresence } from './vocals';

const LOWER: Record<Confidence, Confidence> = { high: 'medium', medium: 'low', low: 'low' };

/**
 * Adds what the vocal detector says about the window to a suggestion. A window with a clear voice
 * loses one confidence level: overlapping it with a sung passage of the other track clashes. 'unknown'
 * (no measurable harmonic content) adds nothing — absence of evidence is not presented as instrumental.
 */
export function withVocals(m: MixSuggestion, vocals: VocalInfo | undefined): MixSuggestion {
  if (!vocals) return m;
  const { presence } = vocalPresence(vocals, m.bar, m.bar + m.lengthBars);
  const text: Record<typeof presence, string> = {
    none: ', aucune voix détectée',
    light: ', voix possible (indice faible)',
    strong: ', voix nette — éviter de superposer avec un passage chanté',
    unknown: '',
  };
  return {
    ...m,
    vocals: presence,
    reason: m.reason + text[presence],
    confidence: presence === 'strong' ? LOWER[m.confidence] : m.confidence,
  };
}

/**
 * Mix In / Mix Out suggestions with a short justification. They are proposals for the DJ, built from
 * structure, phrases, energy, percussion and — when available — the (unvalidated) vocal detection:
 * windows with a clear voice are flagged and downgraded, and when the outro is sung an instrumental
 * tail is proposed as an extra exit point.
 */
export function suggestMix(
  s: StructureAnalysis,
  phrases: PhraseInfo,
  energyCurve: number[],
  profile: Profile,
  grid: { d0: number; barLen: number },
  vocals?: VocalInfo,
): { mixIn: MixSuggestion[]; mixOut: MixSuggestion[] } {
  const n = s.nBars;
  const mixIn: MixSuggestion[] = [];
  const mixOut: MixSuggestion[] = [];
  if (n - s.origin < 16) return { mixIn: [], mixOut: [] };
  const at = (role: string) => s.landmarks.find((l) => l.role === role)?.bar;
  const kickShare = (a: number, b: number) => {
    let k = 0, t = 0;
    for (let i = Math.max(0, a); i < Math.min(n, b); i++) { t++; if (s.kickBars[i]) k++; }
    return t ? k / t : 0;
  };
  const meanE = (a: number, b: number) => {
    let sum = 0, k = 0;
    for (let i = Math.max(0, a); i < Math.min(n, b); i++) { sum += energyCurve[i]; k++; }
    return k ? sum / k : 0;
  };
  const percussive = (a: number, b: number) => kickShare(a, b) >= 0.6;
  const want = profile.transitionBars;

  // ---- Mix In: the intro, up to the first big change
  const firstChange = [at('groove'), at('build1'), at('drop1')].filter((b): b is number => b !== undefined).sort((a, b) => a - b)[0] ?? n;
  const introLen = firstChange - s.origin;
  if (introLen >= 4) {
    const perc = percussive(s.origin, firstChange);
    const conf: Confidence = introLen >= want && perc ? 'high' : introLen >= 8 ? 'medium' : 'low';
    mixIn.push({
      timeSec: 0,
      bar: s.origin,
      lengthBars: introLen,
      confidence: conf,
      reason: `Début de l’intro — ${introLen} mesures ${perc ? 'rythmiques' : 'sans kick régulier'} avant le premier changement`,
    });
  }
  // Long intro: a later entry point one transition-length before the first change, on a phrase start
  if (introLen >= want * 2 && phrases.lengthBars) {
    const target = firstChange - want;
    const ph = phrases.bars.filter((b) => b <= target && b > s.origin).pop();
    if (ph !== undefined) {
      mixIn.push({
        timeSec: 0,
        bar: ph,
        lengthBars: firstChange - ph,
        confidence: 'medium',
        reason: `Entrée plus tardive : ${firstChange - ph} mesures avant le premier changement, début de phrase`,
      });
    }
  }
  const groove = at('groove');
  if (groove !== undefined && percussive(groove, firstChange === groove ? groove + 8 : firstChange)) {
    mixIn.push({
      timeSec: 0,
      bar: groove,
      lengthBars: Math.max(4, (at('drop1') ?? groove + 16) - groove),
      confidence: 'medium',
      reason: 'Entrée du kick : point d’entrée pour un mix rythmique',
    });
  }

  // ---- Mix Out: the outro, then N bars before the end on a phrase start
  const outro = at('outro');
  const lastE = meanE(n - 16, n);
  const peakE = Math.max(...energyCurve.slice(s.origin), 0.01);
  const trend = lastE < peakE * 0.8 ? 'énergie décroissante' : 'énergie maintenue';
  if (outro !== undefined && n - outro >= 4) {
    const perc = percussive(outro, n);
    const len = n - outro;
    mixOut.push({
      timeSec: 0,
      bar: outro,
      lengthBars: len,
      confidence: len >= want && perc ? 'high' : 'medium',
      reason: `Début de l’outro — ${len} mesures, ${perc ? 'kick présent' : 'peu de kick'}, ${trend}`,
    });
  }
  // Second exit point only when the outro is missing or shorter than the preferred transition.
  const before = n - want;
  const phraseBar = phrases.lengthBars ? phrases.bars.filter((b) => b <= before).pop() : undefined;
  let candidate = phraseBar ?? before;
  // Never right on a drop: at least 8 bars into the last drop.
  const lastDrop = Math.max(at('drop1') ?? -1, at('drop2') ?? -1);
  let onPhrase = phraseBar !== undefined;
  if (lastDrop >= 0 && candidate < lastDrop + 8) {
    candidate = Math.max(before, lastDrop + 8);
    candidate = s.origin + Math.ceil((candidate - s.origin) / 4) * 4;
    onPhrase = false;
  }
  const outroShort = outro === undefined || n - outro < want;
  if (outroShort && candidate > s.origin + 8 && candidate <= n - 4 && (outro === undefined || Math.abs(candidate - outro) >= 4)) {
    const perc = percussive(candidate, n);
    mixOut.push({
      timeSec: 0,
      bar: candidate,
      lengthBars: n - candidate,
      confidence: onPhrase && perc ? 'medium' : 'low',
      reason: `${n - candidate} mesures avant la fin${onPhrase ? ', début de phrase' : ''}, ${perc ? 'kick présent' : 'peu de kick'}, ${trend}`,
    });
  }
  // Sung exit window: propose the last instrumental stretch (≥ 8 bars, on a 4-bar boundary) instead.
  const outs = mixOut.map((m) => withVocals(m, vocals));
  if (vocals && outs.length && outs.every((m) => m.vocals === 'strong' || m.vocals === 'light') && outs.some((m) => m.vocals === 'strong')) {
    let b = n;
    while (b > s.origin && !vocals.present[b - 1]) b--;
    const tail = s.origin + Math.ceil((b - s.origin) / 4) * 4;
    if (n - tail >= 8 && tail > lastDrop + 8) {
      outs.push({
        timeSec: 0,
        bar: tail,
        lengthBars: n - tail,
        confidence: 'low',
        reason: `Fin instrumentale : ${n - tail} mesures sans voix détectée après le dernier passage chanté`,
        vocals: 'none',
      });
    }
  }
  const ins = mixIn.map((m) => withVocals(m, vocals));
  const timed = (m: MixSuggestion) => ({ ...m, timeSec: Math.max(0, grid.d0 + m.bar * grid.barLen) });
  return { mixIn: ins.map(timed), mixOut: outs.map(timed) };
}
