import { TILE, isWalkable, type FloorLayout, type Tile } from "./layout";
import { hash } from "./palette";
import { findPath } from "./path";

/**
 * Biscuit, the office cat. Purely decorative: it is not an agent and carries no data, which is
 * why the tooltip says so. It wanders the lobby and the central corridor, grooms, naps (mostly at
 * night), startles when an agent fails, and can be petted by clicking it.
 */

export type CritterMode = "sit" | "walk" | "sleep" | "groom" | "startle";

export interface Critter {
  name: string;
  /** Feet, in pixels. */
  x: number;
  y: number;
  dir: "left" | "right";
  mode: CritterMode;
  /** Milliseconds spent in the current mode. */
  t: number;
  /** How long to stay in the current mode (ms); walking ends when the path does. */
  until: number;
  path: Tile[];
  speed: number;
  /** Hearts remaining to emit after a pet. */
  pet: number;
  phase: number;
}

/** Small deterministic RNG so a given project always starts the cat in the same place. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tiles the cat may choose: the lobby and the corridor between the bay columns. */
export function roamTiles(layout: FloorLayout): Tile[] {
  const out: Tile[] = [];
  for (let y = 6; y < layout.h - 2; y++) {
    for (let x = 5; x <= 26; x++) {
      const inCorridor = (x === 22 || x === 23) && y < layout.lobbyTop;
      const inLobby = y >= layout.lobbyTop + 1 && x >= 7;
      if (!(inCorridor || inLobby)) continue;
      if (!isWalkable(layout, x, y)) continue;
      out.push({ x, y });
    }
  }
  return out;
}

const centre = (t: Tile): { x: number; y: number } => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE - 2 });
const tileOfPx = (x: number, y: number): Tile => ({ x: Math.floor(x / TILE), y: Math.floor(y / TILE) });

export class CritterBrain {
  readonly critter: Critter;
  private roll: () => number;
  private spots: Tile[] = [];

  constructor(
    private layout: FloorLayout,
    seedKey: string,
  ) {
    this.roll = rng(hash(`cat:${seedKey}`));
    this.spots = roamTiles(layout);
    const start = this.spots.length ? this.spots[Math.floor(this.roll() * this.spots.length)]! : { x: 12, y: layout.lobbyTop + 7 };
    const p = centre(start);
    this.critter = { name: "Biscuit", x: p.x, y: p.y, dir: this.roll() < 0.5 ? "left" : "right", mode: "sit", t: 0, until: 2000, path: [], speed: 16, pet: 0, phase: this.roll() };
  }

  /** The floor was rebuilt: keep the cat if its tile is still open, otherwise set it down somewhere valid. */
  relayout(layout: FloorLayout): void {
    this.layout = layout;
    this.spots = roamTiles(layout);
    const c = this.critter;
    const here = tileOfPx(c.x, c.y);
    if (!isWalkable(layout, here.x, here.y) && this.spots.length) {
      const p = centre(this.spots[Math.floor(this.roll() * this.spots.length)]!);
      c.x = p.x;
      c.y = p.y;
      this.setMode("sit", 2500);
    } else if (c.mode === "walk") {
      this.setMode("sit", 1500);
    }
  }

  private setMode(mode: CritterMode, until: number): void {
    const c = this.critter;
    c.mode = mode;
    c.t = 0;
    c.until = until;
    if (mode !== "walk") c.path = [];
  }

  /** Reduced motion: a sleeping cat that never moves. */
  settle(): void {
    this.setMode("sleep", Infinity);
  }

  /** Motion is allowed again: wake from the settled nap. */
  wake(): void {
    if (this.critter.until === Infinity && this.critter.mode === "sleep") this.setMode("sit", 1500);
  }

  get settled(): boolean {
    return this.critter.until === Infinity && this.critter.mode === "sleep";
  }

  /** A click on the cat. */
  pet(): void {
    const c = this.critter;
    if (c.mode === "walk") this.setMode("sit", 2500);
    c.pet = 5;
  }

  /** Something alarming happened (an agent failed): jump, then bolt for a far corner. */
  startle(): void {
    const c = this.critter;
    if (c.mode === "startle") return;
    this.setMode("startle", 450);
  }

  private wander(fast: boolean): void {
    const c = this.critter;
    if (this.spots.length === 0) return this.setMode("sit", 4000);
    const from = tileOfPx(c.x, c.y);
    for (let attempt = 0; attempt < 6; attempt++) {
      const pick = this.spots[Math.floor(this.roll() * this.spots.length)]!;
      const d = Math.abs(pick.x - from.x) + Math.abs(pick.y - from.y);
      if (d < (fast ? 8 : 3) || d > (fast ? 40 : 18)) continue;
      const path = findPath(this.layout, from, pick);
      if (!path || path.length === 0) continue;
      c.path = path;
      c.speed = fast ? 46 : 15 + this.roll() * 6;
      this.setMode("walk", Infinity);
      c.path = path;
      return;
    }
    this.setMode("sit", 3000);
  }

  private afterRest(hour: number): void {
    const night = hour >= 22 || hour < 6;
    const r = this.roll();
    if (r < (night ? 0.55 : 0.18)) this.setMode("sleep", 14000 + this.roll() * 22000);
    else if (r < (night ? 0.7 : 0.4)) this.setMode("groom", 2600 + this.roll() * 1200);
    else this.wander(false);
  }

  /** Advance by `dtMs`. Returns true on the frames it emits a heart. */
  step(dtMs: number, hour: number): boolean {
    const c = this.critter;
    c.t += dtMs;
    let heart = false;
    if (c.pet > 0 && c.mode !== "walk" && c.mode !== "startle") {
      c.pet -= dtMs / 260;
      if (Math.floor(c.pet) !== Math.floor(c.pet + dtMs / 260)) heart = true;
      if (c.pet <= 0) c.pet = 0;
    }
    switch (c.mode) {
      case "walk": {
        let budget = (c.speed * dtMs) / 1000;
        while (budget > 0 && c.path.length > 0) {
          const next = centre(c.path[0]!);
          const dx = next.x - c.x;
          const dy = next.y - c.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= budget) {
            c.x = next.x;
            c.y = next.y;
            budget -= dist;
            c.path.shift();
          } else {
            c.x += (dx / dist) * budget;
            c.y += (dy / dist) * budget;
            budget = 0;
          }
          if (Math.abs(dx) > 0.5) c.dir = dx > 0 ? "right" : "left";
        }
        if (c.path.length === 0) this.setMode("sit", 3000 + this.roll() * 5000);
        break;
      }
      case "startle":
        if (c.t >= c.until) this.wander(true);
        break;
      default:
        if (c.t >= c.until) this.afterRest(hour);
    }
    return heart;
  }
}

/* ------------------------------------------------------------------- sprites */

const FUR = "#d9893a";
const FUR_LIGHT = "#f0b878";
const FUR_DARK = "#a85f28";
const BIB = "#f6efe0";
const EYE = "#7ff09a";
const NOSE = "#e88aa0";
const EDGE = "#2a1a14";

type Rects = ReadonlyArray<readonly [number, number, number, number, string]>;

function paint(w: number, h: number, rects: Rects): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w + 2;
  c.height = h + 2;
  const g = c.getContext("2d")!;
  for (const [x, y, rw, rh, col] of rects) {
    g.fillStyle = col;
    g.fillRect(x + 1, y + 1, rw, rh);
  }
  // one-pixel outline around everything that was drawn
  const src = g.getImageData(0, 0, c.width, c.height);
  const out = g.createImageData(c.width, c.height);
  out.data.set(src.data);
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= c.width || y >= c.height ? 0 : src.data[(y * c.width + x) * 4 + 3]!);
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (at(x, y) > 0) continue;
      if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
        const i = (y * c.width + x) * 4;
        out.data[i] = 0x2a;
        out.data[i + 1] = 0x1a;
        out.data[i + 2] = 0x14;
        out.data[i + 3] = 255;
      }
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

/** Side view, facing right. `leg` 0/1 alternates the walk. */
function sideCat(leg: 0 | 1 | 2, tail: number): Rects {
  const tailY = [4, 3, 2][tail]!;
  return [
    // tail
    [0, tailY, 2, 5 - (tailY - 2), FUR_DARK],
    [0, tailY - 1, 2, 2, FUR],
    // body
    [2, 4, 9, 5, FUR],
    [2, 7, 9, 2, FUR_LIGHT],
    [4, 4, 1, 2, FUR_DARK],
    [7, 4, 1, 2, FUR_DARK],
    // head
    [10, 2, 6, 6, FUR],
    [10, 0, 2, 3, FUR],
    [14, 0, 2, 3, FUR],
    [11, 1, 1, 1, NOSE],
    [14, 1, 1, 1, NOSE],
    [14, 4, 1, 1, EYE],
    [15, 5, 1, 1, NOSE],
    [12, 6, 4, 2, BIB],
    // legs
    ...(leg === 0
      ? ([[3, 9, 2, 3, FUR_DARK], [5, 9, 2, 2, FUR], [9, 9, 2, 3, FUR_DARK], [11, 9, 2, 2, FUR]] as Rects)
      : leg === 1
        ? ([[2, 9, 2, 2, FUR], [5, 9, 2, 3, FUR_DARK], [8, 9, 2, 2, FUR], [11, 9, 2, 3, FUR_DARK]] as Rects)
        : ([[3, 9, 2, 3, FUR_DARK], [10, 9, 2, 3, FUR_DARK]] as Rects)),
  ];
}

/** Front-facing sit. `paw` raises one paw for grooming; `blink` closes the eyes. */
function sitCat(paw: boolean, blink: boolean, tail: number): Rects {
  return [
    [10, 7 + (tail % 2), 2, 4, FUR_DARK],
    [11, 6 + (tail % 2), 1, 2, FUR],
    // body
    [2, 7, 8, 6, FUR],
    [4, 8, 4, 5, BIB],
    // head
    [1, 1, 10, 7, FUR],
    [1, -1, 3, 3, FUR],
    [8, -1, 3, 3, FUR],
    [2, 0, 1, 1, NOSE],
    [9, 0, 1, 1, NOSE],
    ...(blink ? ([[3, 4, 2, 1, EDGE], [7, 4, 2, 1, EDGE]] as Rects) : ([[3, 3, 2, 2, EYE], [7, 3, 2, 2, EYE], [4, 3, 1, 2, EDGE], [8, 3, 1, 2, EDGE]] as Rects)),
    [5, 5, 2, 1, NOSE],
    [3, 6, 1, 1, FUR_DARK],
    [8, 6, 1, 1, FUR_DARK],
    // paws
    ...(paw ? ([[2, 10, 2, 3, FUR_LIGHT], [7, 2, 2, 4, FUR_LIGHT]] as Rects) : ([[2, 11, 3, 2, FUR_LIGHT], [7, 11, 3, 2, FUR_LIGHT]] as Rects)),
  ];
}

function sleepCat(breath: 0 | 1): Rects {
  return [
    [9, 7 - breath, 2, 3, FUR_DARK],
    [2, 4 - breath, 11, 6 + breath, FUR],
    [3, 7, 9, 3, FUR_LIGHT],
    [4, 4 - breath, 1, 2, FUR_DARK],
    [7, 4 - breath, 1, 2, FUR_DARK],
    [10, 5, 5, 5, FUR],
    [10, 3, 2, 3, FUR],
    [13, 3, 2, 3, FUR],
    [11, 7, 2, 1, EDGE],
    [14, 8, 1, 1, NOSE],
  ];
}

function startleCat(): Rects {
  // back arched, tail up, eyes wide
  return [
    [0, 1, 2, 6, FUR_DARK],
    [2, 2, 9, 5, FUR],
    [3, 0, 7, 3, FUR],
    [4, 0, 1, 2, FUR_DARK],
    [7, 0, 1, 2, FUR_DARK],
    [10, 3, 6, 6, FUR],
    [10, 1, 2, 3, FUR],
    [14, 1, 2, 3, FUR],
    [12, 4, 2, 2, "#ffffff"],
    [13, 5, 1, 1, EDGE],
    [15, 6, 1, 1, NOSE],
    [3, 7, 2, 4, FUR_DARK],
    [9, 7, 2, 4, FUR_DARK],
  ];
}

const cache = new Map<string, HTMLCanvasElement>();
function memo(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = cache.get(key);
  if (!c) {
    c = make();
    cache.set(key, c);
  }
  return c;
}

function flip(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext("2d")!;
  g.translate(c.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

/** The sprite for a cat state. Anchor: bottom-centre. Facing left is a mirror of facing right. */
export function catSprite(mode: CritterMode, dir: "left" | "right", timeMs: number, phase: number): HTMLCanvasElement {
  const t = timeMs / 1000 + phase * 10;
  let key: string;
  let make: () => HTMLCanvasElement;
  switch (mode) {
    case "walk": {
      const leg = (Math.floor(t * 6) % 2) as 0 | 1;
      key = `walk${leg}`;
      make = () => paint(16, 12, sideCat(leg, 1));
      break;
    }
    case "startle":
      key = "startle";
      make = () => paint(16, 11, startleCat());
      break;
    case "sleep": {
      const b = (Math.floor(t * 0.7) % 2) as 0 | 1;
      key = `sleep${b}`;
      make = () => paint(15, 10, sleepCat(b));
      break;
    }
    case "groom": {
      const paw = Math.floor(t * 3) % 2 === 0;
      key = `groom${paw ? 1 : 0}`;
      make = () => paint(12, 13, sitCat(paw, false, 0));
      break;
    }
    default: {
      const blink = (t % 5) < 0.18;
      const tail = Math.floor(t * 1.4) % 2;
      key = `sit${blink ? "b" : "o"}${tail}`;
      make = () => paint(12, 13, sitCat(false, blink, tail));
    }
  }
  const base = memo(key, make);
  if (mode === "sit" || mode === "groom") return base; // front view is symmetric enough
  return dir === "left" ? memo(`${key}:L`, () => flip(base)) : base;
}
