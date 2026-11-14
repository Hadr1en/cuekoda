import { newId } from './cues';
import type { Profile } from './profiles';
import type { StructureAnalysis } from './structure';
import type { Confidence, Loop } from './types';

/**
 * Smart Loops: grid- and phrase-aligned loop suggestions.
 *  - intro    : extend a rhythmic intro (longest allowed length that fits in the intro)
 *  - outro    : extend a rhythmic outro
 *  - predrop  : one bar right before a drop (to hold the tension)
 *  - breakdown: loop the start of the breakdown
 * Suggestions start un-accepted; only accepted loops are exported by default.
 */
export function suggestLoops(
  s: StructureAnalysis,
  profile: Profile,
  grid: { d0: number; barLen: number },
): Loop[] {
  const n = s.nBars;
  const loops: Loop[] = [];
  const allowed = [...profile.loopBeats].sort((a, b) => b - a);
  if (!allowed.length) return loops;
  const at = (role: string) => s.landmarks.find((l) => l.role === role)?.bar;
  const kickShare = (a: number, b: number) => {
    let k = 0, t = 0;
    for (let i = Math.max(0, a); i < Math.min(n, b); i++) { t++; if (s.kickBars[i]) k++; }
    return t ? k / t : 0;
  };
  const fit = (bars: number) => allowed.find((beats) => beats / 4 <= bars);
  const add = (kind: Loop['kind'], name: string, bar: number, beats: number, confidence: Confidence, reason: string) => {
    if (bar < 0 || bar >= n) return;
    loops.push({
      id: newId('l'),
      kind,
      name,
      bar,
      beats,
      startSec: Math.max(0, grid.d0 + bar * grid.barLen),
      confidence,
      reason,
      origin: 'auto',
      accepted: false,
    });
  };

  if (profile.loopKinds.includes('intro')) {
    const end = [at('groove'), at('build1'), at('drop1')].filter((b): b is number => b !== undefined).sort((a, b) => a - b)[0] ?? Math.min(n, s.origin + 32);
    // Start where the rhythm is already established (the groove, if the intro begins without kick)
    const start = s.kickBars[s.origin] ? s.origin : at('groove') ?? s.origin;
    const beats = fit(end - start);
    const ks = kickShare(start, start + (beats ?? 4) / 4);
    if (beats && ks >= 0.75) add('intro', 'Intro loop', start, beats, ks >= 0.95 ? 'high' : 'medium', `Prolonger l’intro rythmique (${beats} temps, kick sur ${Math.round(ks * 100)} % des mesures)`);
  }
  const outro = at('outro');
  if (profile.loopKinds.includes('outro') && outro !== undefined) {
    const beats = fit(n - outro);
    const ks = kickShare(outro, outro + (beats ?? 4) / 4);
    if (beats && ks >= 0.75) add('outro', 'Outro loop', outro, beats, ks >= 0.95 ? 'high' : 'medium', `Prolonger l’outro rythmique (${beats} temps)`);
  }
  if (profile.loopKinds.includes('predrop')) {
    for (const role of ['drop1', 'drop2']) {
      const d = at(role);
      const beats = allowed.includes(4) ? 4 : allowed[allowed.length - 1];
      if (d !== undefined && d - beats / 4 > s.origin) {
        add('predrop', role === 'drop1' ? 'Pre-drop loop' : 'Pre-drop loop 2', d - beats / 4, beats, 'medium', 'Tenir la tension juste avant le drop');
      }
    }
  }
  const br = at('break1');
  if (profile.loopKinds.includes('breakdown') && br !== undefined) {
    const beats = fit(8) ?? allowed[allowed.length - 1];
    add('breakdown', 'Breakdown loop', br, beats, 'low', 'Boucler le début du breakdown');
  }
  return loops;
}
