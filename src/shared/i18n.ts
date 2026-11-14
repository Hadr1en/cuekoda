/**
 * Display-time translation (French is the source language). The analysis engine and the stored data
 * stay in French — cue names written to DJ software are the DJ's data and are never translated —
 * and the UI translates what it shows: exact strings first, then patterns for generated sentences
 * (numbers, track names…), then compound texts joined with " · " or " ; ".
 */
import { EN_EXACT, EN_PATTERNS } from './i18n-en';

export type Lang = 'fr' | 'en';
export type LangSetting = Lang | 'system';

let lang: Lang = 'fr';

export function resolveLang(setting: LangSetting | undefined, systemLocale: string): Lang {
  if (setting === 'fr' || setting === 'en') return setting;
  return systemLocale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
export const setLang = (l: Lang) => { lang = l; };
export const getLang = () => lang;

const SEPARATORS = [' · ', ' ; ', ' — '];

export function translate(s: string, to: Lang = lang): string {
  if (to === 'fr' || !s || !/[A-Za-zÀ-ÿ]/.test(s)) return s;
  const exact = EN_EXACT[s];
  if (exact !== undefined) return exact;
  // keep surrounding spaces / punctuation that the dictionary does not carry
  const m = /^(\s*)([\s\S]*?)([\s:.…]*)$/.exec(s)!;
  if (m[2] !== s) {
    const core = EN_EXACT[m[2]];
    if (core !== undefined) return m[1] + core + m[3];
  }
  for (const [re, rep] of EN_PATTERNS) {
    if (re.test(s)) return s.replace(re, rep as never);
  }
  for (const sep of SEPARATORS) {
    if (s.includes(sep)) {
      const parts = s.split(sep);
      const out = parts.map((p) => translate(p, to));
      if (out.some((p, i) => p !== parts[i])) return out.join(sep);
    }
  }
  return s;
}

/** Shorthand used by the UI */
export const tr = (s: string) => translate(s);
