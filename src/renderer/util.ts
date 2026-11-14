import type { Confidence, RGB } from '../core/types';

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Tiny element builder: h('div', { class: 'x', onclick: fn }, 'text', child) */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export const fmtTime = (t: number) => {
  const m = Math.floor(Math.max(0, t) / 60);
  const s = Math.max(0, t) - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};
export const fmtDur = (t: number) => fmtTime(t).replace(/\.\d$/, '');
export const fmtBpm = (b: number) => (Math.abs(b - Math.round(b)) < 0.005 ? String(Math.round(b)) : b.toFixed(2));
export const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
export const hexOf = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
export const rgbOf = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
export const LETTERS = 'ABCDEFGH';

export const CONF_LABEL: Record<Confidence, string> = {
  high: 'Confiance forte',
  medium: 'Confiance moyenne — vérification conseillée',
  low: 'Confiance faible — vérification nécessaire',
};

export function confBadge(c: Confidence | undefined, short = false): HTMLElement {
  const level = c ?? 'low';
  return h('span', { class: `conf conf-${level}`, title: CONF_LABEL[level] }, short ? '' : { high: 'forte', medium: 'moyenne', low: 'faible' }[level]);
}

export function camelotColor(k: string): string {
  const n = parseInt(k, 10);
  if (!n) return '#888';
  const minor = k.endsWith('A');
  return `hsl(${((n - 1) * 30 + 200) % 360}, ${minor ? 62 : 75}%, ${minor ? 62 : 70}%)`;
}

export function toFileUrl(p: string): string {
  let s = p.replace(/\\/g, '/');
  if (!s.startsWith('/')) s = '/' + s;
  return 'file://' + s.split('/').map(encodeURIComponent).join('/').replace(/%3A/i, ':');
}

/** Worst of several confidence levels (used for the library's overall indicator). */
export function worst(...levels: (Confidence | undefined)[]): Confidence {
  if (levels.includes('low') || levels.includes(undefined)) return 'low';
  if (levels.includes('medium')) return 'medium';
  return 'high';
}

/** Resolves a CSS colour token for canvas drawing (light-dark() is resolved through a real property). */
const probe = document.createElement('span');
probe.hidden = true;
document.body.appendChild(probe);
const colorCache = new Map<string, string>();
export function token(name: string): string {
  let c = colorCache.get(name);
  if (!c) {
    probe.style.color = `var(${name})`;
    c = getComputedStyle(probe).color;
    colorCache.set(name, c);
  }
  return c;
}
export const clearTokenCache = () => colorCache.clear();

// ---- announcements & toast (popover="manual" + live region) -------------------------
declare global {
  interface Document {
    ariaNotify?: (text: string, options?: { priority?: 'normal' | 'high' }) => void;
  }
}
export function announce(msg: string) {
  if (document.ariaNotify) return document.ariaNotify(msg);
  const el = $('announce');
  el.textContent = '';
  requestAnimationFrame(() => (el.textContent = msg));
}
let toastTimer: number | undefined;
export function toast(msg: string, ms = 4000) {
  const t = $('toast');
  $('toast-text').textContent = msg;
  announce(msg);
  if (!t.matches(':popover-open')) t.showPopover();
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.matches(':popover-open') && t.hidePopover(), ms);
}
export function initToast() {
  const t = $('toast');
  t.addEventListener('focusin', () => window.clearTimeout(toastTimer));
  t.addEventListener('focusout', () => {
    toastTimer = window.setTimeout(() => t.matches(':popover-open') && t.hidePopover(), 1500);
  });
}
