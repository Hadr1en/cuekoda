import type { AnalysisResult, HotCue, Loop, SectionType } from '../core/types';
import { getLang, tr } from '../shared/i18n';
import type { Peaks } from '../core/peaks';
import { LETTERS, rgb, token } from './util';

export interface WaveCallbacks {
  seek(t: number): void;
  /** done=false while dragging (live preview), true on release */
  cueMoved(cue: HotCue, timeSec: number, done: boolean): void;
  loopMoved(loop: Loop, startSec: number, done: boolean): void;
  cueSelected(cue: HotCue | null): void;
  viewChanged(): void;
}

const SECTION_TOKEN: Record<SectionType, string> = {
  intro: '--sec-intro',
  verse: '--sec-verse',
  chorus: '--sec-chorus',
  break: '--sec-break',
  breakdown: '--sec-break',
  build: '--sec-build',
  drop: '--sec-drop',
  instrumental: '--sec-verse',
  outro: '--sec-outro',
  section: '--sec-section',
};

/**
 * Interactive, zoomable waveform: sections band, energy curve, phrase / bar / beat grid, vocal
 * segments (tinted, with a strip at the top of the wave area), loops, hot cues (draggable, snapped to
 * the beat — Alt = free), playhead.
 * Wheel / pinch = zoom around the pointer, Shift+wheel or horizontal swipe = scroll.
 */
export class WaveView {
  track: AnalysisResult | null = null;
  peaks: Peaks | null = null;
  start = 0;
  end = 1;
  selectedCueId: string | null = null;
  private ctx: CanvasRenderingContext2D;
  private drag: { kind: 'cue'; cue: HotCue } | { kind: 'loop'; loop: Loop; offset: number } | null = null;
  private moved = false;
  // layout (CSS px)
  private readonly SEC_H = 18;
  private readonly FLAG = 15;

  constructor(
    private canvas: HTMLCanvasElement,
    private now: () => number,
    private cb: WaveCallbacks,
  ) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => (this.drag = null));
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  set(track: AnalysisResult | null, keepView = false) {
    const same = this.track?.path === track?.path;
    this.track = track;
    if (!same) this.peaks = null;
    if (!keepView || !same) {
      this.start = 0;
      this.end = track?.durationSec ?? 1;
    }
    this.draw();
  }

  get duration() {
    return this.track?.durationSec ?? 1;
  }

  // ---------------------------------------------------------------- view control
  zoom(factor: number, anchor = (this.start + this.end) / 2) {
    const span = Math.min(this.duration, Math.max(2, (this.end - this.start) / factor));
    const rel = (anchor - this.start) / (this.end - this.start || 1);
    this.start = anchor - rel * span;
    this.end = this.start + span;
    this.clamp();
    this.draw();
    this.cb.viewChanged();
  }
  pan(dt: number) {
    this.start += dt;
    this.end += dt;
    this.clamp();
    this.draw();
    this.cb.viewChanged();
  }
  fit() {
    this.start = 0;
    this.end = this.duration;
    this.draw();
    this.cb.viewChanged();
  }
  /** Keeps the playhead visible while playing. */
  follow(t: number) {
    const span = this.end - this.start;
    if (span >= this.duration - 0.01) return;
    if (t > this.end - span * 0.1 || t < this.start) {
      this.start = t - span * 0.25;
      this.end = this.start + span;
      this.clamp();
    }
  }
  private clamp() {
    const span = this.end - this.start;
    if (this.start < 0) {
      this.start = 0;
      this.end = span;
    }
    if (this.end > this.duration) {
      this.end = this.duration;
      this.start = Math.max(0, this.end - span);
    }
  }

  private x(t: number, w: number) {
    return ((t - this.start) / (this.end - this.start)) * w;
  }
  private t(clientX: number) {
    const r = this.canvas.getBoundingClientRect();
    return this.start + ((clientX - r.left) / r.width) * (this.end - this.start);
  }
  private beat() {
    return this.track ? 60 / this.track.bpm : 0.5;
  }
  snap(t: number) {
    if (!this.track) return t;
    const b = this.beat();
    const d0 = this.track.grid.firstDownbeatSec;
    return Math.max(0, d0 + Math.round((t - d0) / b) * b);
  }

  // ---------------------------------------------------------------- interaction
  private onWheel(e: WheelEvent) {
    if (!this.track) return;
    e.preventDefault();
    const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (horizontal) this.pan(((e.shiftKey ? e.deltaY : e.deltaX) / this.canvas.clientWidth) * (this.end - this.start));
    else this.zoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.02 : 0.0025)), this.t(e.clientX));
  }

  private hitCue(clientX: number, clientY: number): HotCue | null {
    if (!this.track) return null;
    const r = this.canvas.getBoundingClientRect();
    const y = clientY - r.top;
    if (y < this.SEC_H || y > this.SEC_H + this.FLAG + 4) return null;
    const w = r.width;
    const x = clientX - r.left;
    let best: HotCue | null = null;
    let bestD = 10;
    for (const c of this.track.cues) {
      const d = x - this.x(c.timeSec, w);
      if (d >= -3 && d <= this.FLAG + 2 && Math.abs(d) < bestD + this.FLAG) {
        if (!best || Math.abs(d) < bestD) {
          best = c;
          bestD = Math.abs(d);
        }
      }
    }
    return best;
  }

  private hitLoop(clientX: number, clientY: number): Loop | null {
    if (!this.track?.loops) return null;
    const r = this.canvas.getBoundingClientRect();
    const y = clientY - r.top;
    if (y < r.height - 16) return null; // loops are grabbed by their bottom bar
    const t = this.t(clientX);
    return this.track.loops.find((l) => t >= l.startSec && t <= l.startSec + l.beats * this.beat()) ?? null;
  }

  private onDown(e: PointerEvent) {
    if (!this.track || e.button !== 0) return;
    this.moved = false;
    const cue = this.hitCue(e.clientX, e.clientY);
    if (cue) {
      this.selectedCueId = cue.id;
      this.cb.cueSelected(cue);
      if (!cue.locked) {
        this.drag = { kind: 'cue', cue };
        this.canvas.setPointerCapture(e.pointerId);
      }
      this.draw();
      return;
    }
    const loop = this.hitLoop(e.clientX, e.clientY);
    if (loop && !loop.locked) {
      this.drag = { kind: 'loop', loop, offset: this.t(e.clientX) - loop.startSec };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    this.selectedCueId = null;
    this.cb.cueSelected(null);
    this.cb.seek(Math.max(0, Math.min(this.duration, this.t(e.clientX))));
  }

  private onMove(e: PointerEvent) {
    const cue = this.hitCue(e.clientX, e.clientY);
    this.canvas.style.cursor = this.drag ? 'grabbing' : cue ? (cue.locked ? 'not-allowed' : 'grab') : this.hitLoop(e.clientX, e.clientY) ? 'ew-resize' : 'pointer';
    if (!this.drag) return;
    this.moved = true;
    const raw = this.t(e.clientX);
    if (this.drag.kind === 'cue') {
      const t = e.altKey ? raw : this.snap(raw);
      this.cb.cueMoved(this.drag.cue, Math.max(0, Math.min(this.duration - 0.05, t)), false);
    } else {
      const raw0 = raw - this.drag.offset;
      const t = e.altKey ? raw0 : this.snapBar(raw0);
      this.cb.loopMoved(this.drag.loop, Math.max(0, t), false);
    }
    this.draw();
  }

  private snapBar(t: number) {
    if (!this.track) return t;
    const bar = this.beat() * 4;
    const d0 = this.track.grid.firstDownbeatSec;
    return Math.max(0, d0 + Math.round((t - d0) / bar) * bar);
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (!d || !this.moved) return;
    if (d.kind === 'cue') this.cb.cueMoved(d.cue, d.cue.timeSec, true);
    else this.cb.loopMoved(d.loop, d.loop.startSec, true);
    this.canvas.releasePointerCapture(e.pointerId);
  }

  // ---------------------------------------------------------------- drawing
  draw() {
    const r = this.track;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(10, Math.floor(this.canvas.clientWidth * dpr));
    const H = Math.max(10, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = W / dpr;
    const hgt = H / dpr;
    ctx.clearRect(0, 0, w, hgt);
    if (!r) return;
    const span = this.end - this.start;
    const top = this.SEC_H + this.FLAG + 2;
    const bottom = hgt - 16;
    const mid = (top + bottom) / 2;
    const amp = (bottom - top) / 2;

    // sections band
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const s of r.sections ?? []) {
      const x0 = Math.max(0, this.x(s.startSec, w));
      const x1 = Math.min(w, this.x(s.endSec, w));
      if (x1 <= 0 || x0 >= w) continue;
      ctx.fillStyle = token(SECTION_TOKEN[s.type]);
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0 - 1), this.SEC_H);
      if (x1 - x0 > 40) {
        ctx.fillStyle = token('--sec-text');
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, 0, x1 - x0 - 2, this.SEC_H);
        ctx.clip();
        ctx.fillText(tr(s.label) + (s.confidence === 'low' ? ' ?' : ''), x0 + 5, this.SEC_H / 2 + 1);
        ctx.restore();
      }
    }

    // grid: beats (zoomed in), bars, phrases
    const beat = 60 / r.bpm;
    const bar = beat * 4;
    const d0 = r.grid.firstDownbeatSec;
    const pxBeat = (beat / span) * w;
    const pxBar = pxBeat * 4;
    const firstBar = Math.max(0, Math.floor((this.start - d0) / bar));
    const lastBar = Math.ceil((this.end - d0) / bar);
    const barStep = pxBar >= 10 ? 1 : pxBar >= 3 ? 4 : 8;
    const phraseSet = new Set(r.phrases?.bars ?? []);
    for (let b = firstBar; b <= lastBar; b++) {
      const t = d0 + b * bar;
      const x = Math.round(this.x(t, w)) + 0.5;
      if (phraseSet.has(b)) {
        ctx.fillStyle = token('--wave-phrase');
        ctx.fillRect(x - 0.5, this.SEC_H, 1.5, hgt - this.SEC_H);
      } else if (b % barStep === 0) {
        ctx.fillStyle = b % (barStep * 4) === 0 ? token('--wave-grid-strong') : token('--wave-grid');
        ctx.fillRect(x - 0.5, top, 1, bottom - top);
      }
      if (pxBeat >= 8) {
        ctx.fillStyle = token('--wave-grid');
        for (let k = 1; k < 4; k++) ctx.fillRect(Math.round(this.x(t + k * beat, w)), mid - amp * 0.15, 1, amp * 0.3);
      }
    }

    // waveform (detailed peaks when available). 3 bands when the analysis has them, drawn like the DJ
    // software does: lows (blue), mids (amber), highs (white) layered from the largest down.
    const peakColor = token('--wave-peak');
    const lowColor = token('--wave-low');
    const bandColors = [token('--wave-band-low'), token('--wave-band-mid'), token('--wave-band-high')];
    const src = this.peaks;
    const three = src ? !!src.mid : !!(r.waveMid && r.waveHigh);
    for (let px = 0; px < w; px++) {
      const t0 = this.start + (px / w) * span;
      const t1 = this.start + ((px + 1) / w) * span;
      let a = 0, l = 0, m = 0, hi = 0;
      const take = (peak: number[], low: number[], mid: number[] | undefined, high: number[] | undefined, i0: number, i1: number) => {
        for (let i = i0; i < i1 && i < peak.length; i++) {
          if (peak[i] > a) a = peak[i];
          if (low[i] > l) l = low[i];
          if (mid && mid[i] > m) m = mid[i];
          if (high && high[i] > hi) hi = high[i];
        }
      };
      if (src) {
        const i0 = Math.floor(t0 * src.perSec);
        take(src.peak, src.low, src.mid, src.high, i0, Math.max(i0 + 1, Math.ceil(t1 * src.perSec)));
      } else {
        const n = r.wave.length;
        const i0 = Math.floor((t0 / r.durationSec) * n);
        take(r.wave, r.waveLow, r.waveMid, r.waveHigh, i0, Math.max(i0 + 1, Math.ceil((t1 / r.durationSec) * n)));
      }
      if (three) {
        // highs are physically small next to the lows: shown at 2× so hats / claps stay readable
        const layers = [[l, bandColors[0]], [m, bandColors[1]], [Math.min(a, hi * 2), bandColors[2]]] as [number, string][];
        layers.sort((x, y) => y[0] - x[0]);
        for (const [v, color] of layers) {
          const vv = Math.min(a, v);
          ctx.fillStyle = color;
          ctx.fillRect(px, mid - vv * amp, 1, vv * amp * 2);
        }
      } else {
        ctx.fillStyle = peakColor;
        ctx.fillRect(px, mid - a * amp, 1, a * amp * 2);
        ctx.fillStyle = lowColor;
        const ll = Math.min(a, l);
        ctx.fillRect(px, mid - ll * amp, 1, ll * amp * 2);
      }
    }

    // vocal segments (unvalidated detector: strong = solid strip, light = faded)
    for (const v of r.vocals?.segments ?? []) {
      const x0 = Math.max(0, this.x(v.startSec, w));
      const x1 = Math.min(w, this.x(v.endSec, w));
      if (x1 <= 0 || x0 >= w) continue;
      ctx.save();
      ctx.globalAlpha = v.strength === 'strong' ? 1 : 0.45;
      ctx.fillStyle = token('--wave-vocal-fill');
      ctx.fillRect(x0, top, x1 - x0, bottom - top);
      ctx.fillStyle = token('--wave-vocal');
      ctx.fillRect(x0, top, Math.max(2, x1 - x0), 4);
      if (x1 - x0 > 46) {
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(tr(v.strength === 'strong' ? 'voix' : 'voix ?'), x0 + 4, top + 11);
        ctx.font = '11px system-ui, sans-serif';
      }
      ctx.restore();
    }

    // energy curve (per bar)
    if (r.energy?.curve.length) {
      ctx.strokeStyle = token('--wave-energy');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      r.energy.curve.forEach((v, b) => {
        const x = this.x(d0 + (b + 0.5) * bar, w);
        const y = bottom - v * (bottom - top);
        if (b === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // loops
    for (const l of r.loops ?? []) {
      const x0 = this.x(l.startSec, w);
      const x1 = this.x(l.startSec + l.beats * beat, w);
      if (x1 < 0 || x0 > w) continue;
      ctx.fillStyle = l.accepted ? token('--wave-loop') : token('--wave-loop-suggested');
      ctx.fillRect(x0, top, x1 - x0, bottom - top);
      ctx.fillStyle = l.accepted ? token('--wave-loop-bar') : token('--wave-loop-bar-suggested');
      ctx.fillRect(x0, hgt - 14, Math.max(2, x1 - x0), 12);
      if (x1 - x0 > 50) {
        ctx.fillStyle = token('--sec-text');
        ctx.fillText(`${tr(l.name)} · ${l.beats}${getLang() === 'en' ? 'b' : 't'}`, x0 + 4, hgt - 8);
      }
    }

    // cues
    for (const c of [...r.cues].sort((a, b) => a.timeSec - b.timeSec)) {
      const x = Math.round(this.x(c.timeSec, w));
      if (x < -this.FLAG || x > w) continue;
      ctx.fillStyle = rgb(c.color);
      ctx.fillRect(x, this.SEC_H, c.id === this.selectedCueId ? 3 : 2, hgt - this.SEC_H - 16);
      ctx.fillRect(x, this.SEC_H, this.FLAG, this.FLAG);
      ctx.fillStyle = '#0b0c10';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(c.slot >= 0 && c.slot < 8 ? LETTERS[c.slot] : '•', x + 4, this.SEC_H + this.FLAG / 2 + 1);
      if (c.id === this.selectedCueId) {
        ctx.strokeStyle = token('--wave-playhead');
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 1, this.SEC_H - 1, this.FLAG + 2, this.FLAG + 2);
      }
      if (c.locked) {
        ctx.fillStyle = token('--wave-playhead');
        ctx.fillText('🔒', x + this.FLAG + 2, this.SEC_H + this.FLAG / 2 + 1);
      }
    }
    ctx.font = '11px system-ui, sans-serif';

    // playhead
    const px = this.x(this.now(), w);
    if (px >= 0 && px <= w) {
      ctx.fillStyle = token('--wave-playhead');
      ctx.fillRect(Math.round(px), this.SEC_H, 1.5, hgt - this.SEC_H);
    }
  }
}

/** Overview strip under the detailed view: whole track + visible window. */
export function drawOverview(canvas: HTMLCanvasElement, r: AnalysisResult | null, view: { start: number; end: number }, now: number) {
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(10, Math.floor(canvas.clientWidth * dpr));
  const H = Math.max(10, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = W / dpr, hgt = H / dpr;
  ctx.clearRect(0, 0, w, hgt);
  if (!r) return;
  const n = r.wave.length;
  ctx.fillStyle = token('--wave-peak');
  for (let x = 0; x < w; x++) {
    const a = r.wave[Math.min(n - 1, Math.floor((x / w) * n))] * hgt * 0.45;
    ctx.fillRect(x, hgt / 2 - a, 1, a * 2);
  }
  ctx.fillStyle = token('--wave-vocal');
  for (const v of r.vocals?.segments ?? []) {
    const x0 = (v.startSec / r.durationSec) * w;
    ctx.globalAlpha = v.strength === 'strong' ? 1 : 0.45;
    ctx.fillRect(x0, hgt - 3, Math.max(1, (v.endSec / r.durationSec) * w - x0), 3);
  }
  ctx.globalAlpha = 1;
  for (const c of r.cues) {
    ctx.fillStyle = rgb(c.color);
    ctx.fillRect((c.timeSec / r.durationSec) * w, 0, 2, hgt);
  }
  ctx.fillStyle = token('--wave-window');
  const x0 = (view.start / r.durationSec) * w;
  const x1 = (view.end / r.durationSec) * w;
  ctx.fillRect(x0, 0, Math.max(2, x1 - x0), hgt);
  ctx.fillStyle = token('--wave-playhead');
  ctx.fillRect((now / r.durationSec) * w, 0, 1, hgt);
}
