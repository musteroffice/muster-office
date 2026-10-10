import type { ToastTone } from "../store";

/**
 * Optional, off by default: a few soft synthesised blips for alerts. No audio files, nothing to
 * download. The context is only created once the viewer turns sound on (a user gesture), which is
 * also what lets the browser allow later, unprompted playback.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a click handler so later alerts are allowed to play. */
export function unlockAudio(): void {
  audio();
}

function blip(c: AudioContext, at: number, freq: number, dur: number, type: OscillatorType, peak: number, slideTo?: number): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

export function playTone(kind: ToastTone | "click"): void {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.01;
  switch (kind) {
    case "ok":
      blip(c, t, 523.25, 0.12, "triangle", 0.09);
      blip(c, t + 0.09, 659.25, 0.12, "triangle", 0.09);
      blip(c, t + 0.18, 783.99, 0.22, "triangle", 0.1);
      break;
    case "bad":
      blip(c, t, 196, 0.28, "sawtooth", 0.07, 98);
      blip(c, t + 0.16, 164.8, 0.3, "sawtooth", 0.06, 82);
      break;
    case "warn":
      blip(c, t, 440, 0.1, "square", 0.04);
      blip(c, t + 0.14, 440, 0.12, "square", 0.04);
      break;
    case "info":
      blip(c, t, 659.25, 0.16, "sine", 0.07);
      break;
    case "click":
      blip(c, t, 880, 0.05, "sine", 0.05);
      break;
  }
}
