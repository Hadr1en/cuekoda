import { beatIndex, type GridBeat } from '../core/beatgrid';

/** Schedule short clicks ahead of playback using the audio clock, with a distinct first beat. */
export function metronome(audio: HTMLAudioElement, getBeats: () => readonly GridBeat[], isTransition: () => boolean) {
  let context: AudioContext | undefined;
  let enabled = false;
  let timer: number | undefined;
  let timeline: readonly GridBeat[] | undefined;
  let next = 0;
  const scheduled = new Set<OscillatorNode>();

  function clear() {
    timeline = undefined;
    for (const oscillator of scheduled) oscillator.stop();
    scheduled.clear();
  }

  function tick() {
    if (!context || audio.paused || audio.seeking || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || isTransition()) {
      if (timeline) clear();
      return;
    }
    const now = audio.currentTime;
    const rate = audio.playbackRate;
    const beats = getBeats();
    if (timeline !== beats) {
      clear();
      timeline = beats;
      next = beatIndex(beats, now - 0.02);
    }
    while (next < beats.length && beats[next].timeSec < now + 0.085 * rate) {
      const { downbeat, timeSec } = beats[next++];
      if (timeSec < now - 0.025) continue;
      const at = context.currentTime + Math.max(0, (timeSec - now) / rate);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = downbeat ? 1550 : 1050;
      gain.gain.setValueAtTime(downbeat ? 0.15 : 0.09, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.034);
      oscillator.connect(gain).connect(context.destination);
      oscillator.onended = () => {
        scheduled.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      scheduled.add(oscillator);
      oscillator.start(at);
      oscillator.stop(at + 0.036);
    }
  }

  function stop() {
    window.clearInterval(timer);
    timer = undefined;
    clear();
  }

  function start() {
    if (!enabled || audio.paused || timer !== undefined) return;
    timer = window.setInterval(tick, 25);
    tick();
  }

  audio.addEventListener('playing', start);
  for (const event of ['pause', 'waiting', 'ended', 'emptied']) audio.addEventListener(event, stop);
  for (const event of ['seeking', 'ratechange']) audio.addEventListener(event, clear);

  return async () => {
    enabled = !enabled;
    if (!enabled) stop();
    else {
      context ??= new AudioContext();
      try { await context.resume(); }
      catch (error) { enabled = false; throw error; }
      start();
    }
    return enabled;
  };
}
