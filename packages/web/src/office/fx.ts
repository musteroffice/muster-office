import { C, hash, mix } from "./palette";
import { PULSE, PULSE_INNER, rectPx, type FloorLayout } from "./layout";
import { skyFor } from "./render-static";

/**
 * Atmosphere: everything that makes the office feel lived in but carries no data of its own
 * (windows, weather, light, dust). Pure drawing helpers; the world and the renderer decide when to call them.
 */

const rect = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void => {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

/* ------------------------------------------------------------------ weather */

export type Weather = "clear" | "rain";

/** Deterministic per local calendar day: about one day in five is a rainy one. */
export function weatherFor(ms: number): Weather {
  const d = new Date(ms);
  return hash(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) % 5 === 0 ? "rain" : "clear";
}

/* ------------------------------------------------------------------ windows */

const HEIGHTS = [10, 18, 12, 24, 14, 20, 9, 16, 22, 11];
const STARS: ReadonlyArray<readonly [number, number]> = [[6, 4], [22, 9], [40, 3], [58, 12], [70, 6], [30, 18], [12, 15], [50, 20], [76, 14], [34, 7], [64, 2], [18, 3]];

/** The two windows on the back wall: sky, sun or moon, stars, clouds, rain and a skyline with lit offices. */
export function drawWindows(g: CanvasRenderingContext2D, layout: FloorLayout, hour: number, time: number, weather: Weather, reduced: boolean): void {
  const sky = skyFor(hour);
  const rain = weather === "rain";
  layout.wall.windows.forEach((win, wi) => {
    const p = rectPx(win);
    const ix = p.x;
    const iy = p.y + 8;
    const iw = p.w;
    const ih = p.h;
    g.save();
    g.beginPath();
    g.rect(ix, iy, iw, ih);
    g.clip();
    const grad = g.createLinearGradient(0, iy, 0, iy + ih);
    grad.addColorStop(0, rain ? mix(sky.top, "#586079", 0.7) : sky.top);
    grad.addColorStop(1, rain ? mix(sky.bottom, "#7a8196", 0.6) : sky.bottom);
    g.fillStyle = grad;
    g.fillRect(ix, iy, iw, ih);

    // stars with a slow twinkle, and now and then a shooting star
    if (sky.night > 0.35 && !rain) {
      STARS.forEach(([sx, sy], i) => {
        if (sx >= iw) return;
        const tw = reduced ? 0.85 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time / (500 + i * 70) + i * 1.9 + wi));
        g.globalAlpha = Math.min(1, sky.night) * tw;
        rect(g, ix + sx, iy + sy, 1, 1, "#ffffff");
        if (i % 4 === 0) rect(g, ix + sx - 1, iy + sy, 3, 1, "#ffffff55");
      });
      g.globalAlpha = 1;
      if (!reduced && sky.night > 0.7) {
        const cycle = 23000 + wi * 7000;
        const k = (time % cycle) / cycle;
        if (k < 0.03) {
          const u = k / 0.03;
          const sx = ix + 14 + u * 46;
          const sy = iy + 3 + u * 18;
          g.globalAlpha = 1 - u * 0.6;
          for (let i = 0; i < 7; i++) rect(g, sx - i * 1.3, sy - i * 0.7, 1, 1, i === 0 ? "#ffffff" : "#c8d4ff");
          g.globalAlpha = 1;
        }
      }
    }

    // sun by day, moon by night, on a shallow arc
    if (!rain) {
      const dayT = (hour - 6) / 12;
      if (dayT >= 0 && dayT <= 1) {
        const x = ix + 6 + dayT * (iw - 22);
        const y = iy + ih - 12 - Math.sin(Math.PI * dayT) * (ih - 26);
        rect(g, x + 2, y, 3, 7, "#ffe9a8");
        rect(g, x, y + 2, 7, 3, "#ffe9a8");
        rect(g, x + 1, y + 1, 5, 5, "#fff2c0");
        rect(g, x + 2, y + 2, 3, 3, "#fffbe6");
        if (!reduced && Math.floor(time / 600) % 2 === 0) {
          g.globalAlpha = 0.55;
          for (const [dx, dy] of [[-2, -2], [8, -2], [-2, 8], [8, 8], [3, -3], [3, 9]] as const) rect(g, x + dx, y + dy, 1, 1, "#ffe9a8");
          g.globalAlpha = 1;
        }
      } else {
        const mt = (hour >= 18 ? hour - 18 : hour + 6) / 12;
        const x = ix + 6 + Math.max(0, Math.min(1, mt)) * (iw - 20);
        const y = iy + ih - 14 - Math.sin(Math.PI * Math.max(0, Math.min(1, mt))) * (ih - 30);
        g.globalAlpha = Math.max(0.35, Math.min(1, sky.night));
        rect(g, x + 1, y, 4, 6, "#f3efe6");
        rect(g, x, y + 1, 6, 4, "#f3efe6");
        rect(g, x + 3, y + 1, 1, 2, "#cfc9bc");
        rect(g, x + 1, y + 3, 2, 1, "#cfc9bc");
        g.globalAlpha = 1;
      }
    }

    // clouds drift left to right and wrap
    const clouds = rain ? 4 : 3;
    for (let i = 0; i < clouds; i++) {
      const cw = 18 + ((i * 7 + wi * 5) % 11);
      const span = iw + cw + 12;
      const speed = reduced ? 0 : 2.2 + i * 0.9;
      const x = ((time / 1000) * speed + i * 31 + wi * 17) % span - cw;
      const y = iy + 3 + ((i * 11 + wi * 4) % 16);
      const col = rain ? "#7d8497" : sky.night > 0.5 ? "#2c3560" : mix("#ffffff", sky.bottom, 0.25 + sky.night * 0.3);
      g.globalAlpha = rain ? 0.9 : 0.62;
      rect(g, x + 4, y, cw - 8, 2, col);
      rect(g, x + 1, y + 2, cw - 2, 2, col);
      rect(g, x, y + 4, cw, 2, col);
      g.globalAlpha = 1;
    }

    // skyline; at night a few offices are lit and now and then one switches off
    const b = mix("#1a2036", sky.bottom, 0.25);
    for (let i = 0; i < iw / 8; i++) {
      const h = HEIGHTS[(i + wi * 3) % HEIGHTS.length]!;
      rect(g, ix + i * 8, iy + ih - h, 7, h, b);
      if (sky.night > 0.3) {
        for (let k = 0; k < 4; k++) {
          const hh = hash(`${wi}.${i}.${k}`);
          if (hh % 3 !== 0) continue;
          const lit = reduced ? true : (hh + Math.floor(time / 22000 + (hh % 7))) % 4 !== 0;
          if (!lit) continue;
          const wx = ix + i * 8 + 1 + (k % 2) * 3;
          const wy = iy + ih - h + 2 + Math.floor(k / 2) * 4;
          if (wy < iy + ih - 2) {
            g.globalAlpha = Math.min(1, sky.night + 0.1);
            rect(g, wx, wy, 2, 2, hh % 5 === 0 ? "#9ff0ff" : "#ffd878");
            g.globalAlpha = 1;
          }
        }
      }
    }

    // rain
    if (rain) {
      g.globalAlpha = 0.55;
      for (let i = 0; i < 26; i++) {
        const x = (i * 29 + wi * 11) % iw;
        const y = reduced ? (i * 13) % ih : ((time / 1000) * (60 + (i % 5) * 10) + i * 47) % (ih + 8) - 4;
        rect(g, ix + x, iy + y, 1, 3, "#c4d8ff");
      }
      g.globalAlpha = 1;
    }
    g.restore();
    // mullion and frame
    rect(g, p.x + p.w / 2 - 1, iy, 2, ih, C.wallDark);
    rect(g, p.x, iy, p.w, 1, C.trim);
    rect(g, p.x, iy + ih - 1, p.w, 1, C.trim);
    rect(g, p.x, iy, 1, ih, C.trim);
    rect(g, p.x + p.w - 1, iy, 1, ih, C.trim);
    // rain runs down the glass
    if (rain && !reduced) {
      g.globalAlpha = 0.35;
      for (let i = 0; i < 4; i++) rect(g, ix + 8 + i * 19, iy + ((time / 90 + i * 40) % ih), 1, 2, "#dfe9ff");
      g.globalAlpha = 1;
    }
  });
}

/** Dust motes drifting in the daylight under the windows. Positions are a pure function of time. */
export function drawMotes(g: CanvasRenderingContext2D, layout: FloorLayout, hour: number, time: number, weather: Weather): void {
  const sky = skyFor(hour);
  if (sky.night > 0.6 || weather === "rain") return;
  g.fillStyle = "#fff6d8";
  layout.wall.windows.forEach((win, wi) => {
    const p = rectPx(win);
    const dir = wi === 0 ? 1 : -1;
    for (let i = 0; i < 9; i++) {
      const ph = hash(`m${wi}${i}`) / 4294967295;
      const life = 14000 + ph * 9000;
      const k = ((time + ph * life) % life) / life;
      const x = p.x + p.w / 2 + dir * (k * 46) + Math.sin(time / (1200 + i * 130) + i) * 5 + (ph - 0.5) * p.w;
      const y = p.y + 62 + k * 70 + Math.sin(time / (900 + i * 90) + i * 2) * 3;
      g.globalAlpha = Math.sin(Math.PI * k) * 0.55 * (1 - sky.night);
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  });
  g.globalAlpha = 1;
}

/* ----------------------------------------------------------------- lighting */

export interface LightSpot {
  x: number;
  y: number;
  r: number;
  color: string;
  /** How much of the room's darkness it removes, 0..1. */
  power: number;
  /** Additive glow strength, 0..1. */
  glow: number;
}

export interface Ambient {
  a: number;
  r: number;
  g: number;
  b: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.max(0, Math.min(1, t));

/** The colour and strength of the room's darkness for a local hour. */
export function ambientFor(hour: number): Ambient {
  const h = ((hour % 24) + 24) % 24;
  const night = { r: 12, g: 20, b: 78 };
  if (h >= 21 || h < 5.5) return { a: 0.5, ...night };
  if (h < 7) {
    const t = (h - 5.5) / 1.5;
    return { a: lerp(0.5, 0, t), r: lerp(night.r, 120, t), g: lerp(night.g, 90, t), b: lerp(night.b, 160, t) };
  }
  if (h < 17.5) return { a: 0, r: 0, g: 0, b: 0 };
  if (h < 19.5) {
    const t = (h - 17.5) / 2;
    return { a: lerp(0, 0.2, t), r: lerp(235, 110, t), g: lerp(130, 70, t), b: lerp(70, 130, t) };
  }
  const t = (h - 19.5) / 1.5;
  return { a: lerp(0.2, 0.5, t), r: lerp(110, night.r, t), g: lerp(70, night.g, t), b: lerp(130, night.b, t) };
}

export class LightingPass {
  private mask: HTMLCanvasElement | null = null;
  private sprites = new Map<string, HTMLCanvasElement>();

  private sprite(r: number, color: string): HTMLCanvasElement {
    const rr = Math.max(3, Math.round(r));
    const key = `${rr}|${color}`;
    const hit = this.sprites.get(key);
    if (hit) return hit;
    if (this.sprites.size > 160) this.sprites.clear();
    const c = document.createElement("canvas");
    c.width = c.height = rr * 2;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(rr, rr, 0, rr, rr, rr);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, mix(color, "#000000", 0.0) + "99");
    grad.addColorStop(1, color + "00");
    g.fillStyle = grad;
    g.fillRect(0, 0, rr * 2, rr * 2);
    this.sprites.set(key, c);
    return c;
  }

  /** Darken the room, cut holes where lights are, then add coloured glow on top. */
  render(g: CanvasRenderingContext2D, w: number, h: number, amb: Ambient, dim: boolean, lights: readonly LightSpot[]): void {
    if (dim && amb.a > 0.01) {
      if (!this.mask || this.mask.width !== w || this.mask.height !== h) {
        this.mask = document.createElement("canvas");
        this.mask.width = w;
        this.mask.height = h;
      }
      const m = this.mask.getContext("2d")!;
      m.globalCompositeOperation = "source-over";
      m.globalAlpha = 1;
      m.clearRect(0, 0, w, h);
      m.fillStyle = `rgba(${Math.round(amb.r)},${Math.round(amb.g)},${Math.round(amb.b)},${amb.a.toFixed(3)})`;
      m.fillRect(0, 0, w, h);
      m.globalCompositeOperation = "destination-out";
      for (const l of lights) {
        if (l.power <= 0) continue;
        m.globalAlpha = Math.min(1, l.power);
        const s = this.sprite(l.r, "#ffffff");
        m.drawImage(s, Math.round(l.x - s.width / 2), Math.round(l.y - s.height / 2));
      }
      m.globalAlpha = 1;
      m.globalCompositeOperation = "source-over";
      g.drawImage(this.mask, 0, 0);
    }
    // Coloured glow: stronger when the room is dark, a faint bloom in daylight.
    const boost = 0.35 + 0.65 * Math.min(1, amb.a / 0.4);
    g.save();
    g.globalCompositeOperation = "lighter";
    for (const l of lights) {
      if (l.glow <= 0) continue;
      g.globalAlpha = Math.min(1, l.glow * boost);
      const s = this.sprite(l.r, l.color);
      g.drawImage(s, Math.round(l.x - s.width / 2), Math.round(l.y - s.height / 2));
    }
    g.restore();
    g.globalAlpha = 1;
  }
}

/* -------------------------------------------------------------------- pulse */

/** The "pulse" monitor on the back wall (geometry lives in layout.ts): an ECG that spikes with every event. */
export { PULSE, PULSE_INNER };

export interface PulseSpike {
  /** World time (ms) the event arrived. */
  t: number;
  amp: number;
  bad: boolean;
}

/** One heartbeat: P wave, QRS complex, T wave. `u` is seconds since the beat started. */
export function qrs(u: number): number {
  if (u < 0 || u > 0.6) return 0;
  if (u < 0.1) return 0.12 * Math.sin((Math.PI * u) / 0.1);
  if (u < 0.16) return 0;
  if (u < 0.2) return (-0.15 * (u - 0.16)) / 0.04;
  if (u < 0.24) return -0.15 + (1.15 * (u - 0.2)) / 0.04;
  if (u < 0.29) return 1 - (1.5 * (u - 0.24)) / 0.05;
  if (u < 0.33) return -0.5 + (0.5 * (u - 0.29)) / 0.04;
  if (u < 0.4) return 0;
  if (u < 0.56) return 0.22 * Math.sin((Math.PI * (u - 0.4)) / 0.16);
  return 0;
}

/** Value of the trace `ageS` seconds ago, plus how much of it is an error spike. */
export function traceAt(spikes: readonly PulseSpike[], time: number, ageS: number): { v: number; bad: number } {
  const t = time - ageS * 1000;
  let v = 0;
  let bad = 0;
  // a resting heartbeat every 2.4 s, small, so a quiet office still reads as alive
  const beat = (t / 1000) % 2.4;
  v += 0.28 * qrs(beat < 0 ? beat + 2.4 : beat);
  for (const s of spikes) {
    const u = (t - s.t) / 1000;
    if (u < 0 || u > 0.6) continue;
    const q = s.amp * qrs(u);
    v += q;
    if (s.bad) bad += Math.abs(q);
  }
  return { v, bad };
}
