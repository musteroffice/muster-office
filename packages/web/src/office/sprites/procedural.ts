import type { Role } from "@muster-office/shared";
import { C, HAIRS, SHIRTS, SKINS, hash, shade } from "../palette";
import type { Dir } from "../layout";
import type { Hat, Look, Pose, PropName, SpriteSet } from "./types";

/**
 * Procedural pixel art. Every sprite is a small pixel array (strings of palette keys) that is
 * composed from parts at first use and cached. Nothing here loads an image.
 *
 * Keys: O outline · H hair · S skin · E eye · M mouth · T shirt · t shirt shade · A accent ·
 *       P pants · p pants shade · B shoes · W white · K near-black · G gold · V visor green · L wig/light
 */

export const FW = 16;
export const FH = 24;

/* ----------------------------------------------------------------------- parts */

const HEAD_F = [
  "....OOOOOOOO....",
  "...OHHHHHHHHO...",
  "...OHHHHHHHHO...",
  "...OHSSSSSSHO...",
  "...OSSSSSSSSO...",
  "...OSESSSSESO...",
  "...OSSSSSSSSO...",
  "....OSSMMSSO....",
  ".....OOSSOO.....",
];
const HEAD_F_BLINK = [...HEAD_F.slice(0, 5), "...OSOSSSSOSO...", ...HEAD_F.slice(6)];
const HEAD_F_WIDE = [...HEAD_F.slice(0, 5), "...OEESSSSEEO...", ...HEAD_F.slice(6, 7), "....OSSMMSSO....", ".....OOSSOO....."];
const HEAD_B = [
  "....OOOOOOOO....",
  "...OHHHHHHHHO...",
  "...OHHHHHHHHO...",
  "...OHHHHHHHHO...",
  "...OHHHHHHHHO...",
  "...OHHHHHHHHO...",
  "...OHHHHHHHHO...",
  "....OHHHHHHO....",
  ".....OOSSOO.....",
];
const HEAD_R = [
  "....OOOOOOO.....",
  "...OHHHHHHHO....",
  "...OHHHHHHHHO...",
  "...OHHHHSSSSO...",
  "...OHHHSSSSSSO..",
  "...OHHHSSSESSO..",
  "...OHHHSSSSSSO..",
  "....OHHSSSMSO...",
  ".....OOSSOO.....",
];

const BODY_F = [
  "...OTTTTTTTTO...",
  "...OTTTTTTTTO...",
  "...OTTTAATTTO...",
  "...OTTTAATTTO...",
  "...OTtTTTTtTO...",
  "...OTTTTTTTTO...",
  "....OPPPPPPO....",
];
const BODY_B = [
  "...OTTTTTTTTO...",
  "...OTTTTTTTTO...",
  "...OTTTTTTTTO...",
  "...OTTTTTTTTO...",
  "...OTtTTTTtTO...",
  "...OTTTTTTTTO...",
  "....OPPPPPPO....",
];
const BODY_R = [
  "....OTTTTTTO....",
  "....OTTTTTTO....",
  "....OTTTTATO....",
  "....OTTTTTTO....",
  "....OTtTTTTO....",
  "....OTTTTTTO....",
  "....OPPPPPPO....",
];

const ARM_L = ["OT", "OT", "OT", "OT", "OS", "OS"];
const ARM_R = ["TO", "TO", "TO", "TO", "SO", "SO"];
const ARM_SIDE = ["OT", "OT", "OT", "OS", "OS"];

const LEGS_F = [
  "....PPP..PPP....",
  "....PPP..PPP....",
  "....PpP..PpP....",
  "....PPP..PPP....",
  "...BBBB..BBBB...",
  "...BBBB..BBBB...",
];
const LEGS_F_A = [
  "....PPP..PPP....",
  "....PPP..PPP....",
  "....PpP..PpP....",
  "....BBB..PPP....",
  "........BBBB....",
  "................",
];
const LEGS_F_B = [
  "....PPP..PPP....",
  "....PPP..PPP....",
  "....PpP..PpP....",
  "....PPP..BBB....",
  "...BBBB.........",
  "................",
];
const LEGS_R = [
  "......PPPP......",
  "......PPPP......",
  "......PpPP......",
  "......PPPP......",
  "......BBBBB.....",
  "......BBBBB.....",
];
const LEGS_R_A = [
  "......PPPP......",
  ".....PP..PP.....",
  "....PP....PP....",
  "....PP....PP....",
  "...BBB....BBBB..",
  "................",
];
const LEGS_R_B = [
  "......PPPP......",
  ".....PPPP.......",
  ".....PPPP.......",
  ".....PPPP.......",
  "....BBBBB.......",
  "................",
];

/* Hats: [rows, y offset]. They overwrite the head. */
const HAT_TOP = [
  "....OOOOOOOO....",
  "....OKKKKKKO....",
  "....OKKKKKKO....",
  "..OOOGGGGGGOOO..",
  "..OKKKKKKKKKKO..",
];
const HAT_VISOR = [
  "....OOOOOOOO....",
  "...OVVVVVVVVO...",
  "..OVVVVVVVVVVO..",
  "..OOOOOOOOOOOO..",
];
const WIG_F = [
  "...OOLLLLLLOO...",
  "..OLLLLLLLLLLO..",
  "..OLLLLLLLLLLO..",
  "..OLLHSSSSHLLO..",
  "..OLLSSSSSSLLO..",
  "..OLLSESSESLLO..",
  "..OLLSSSSSSLLO..",
  "...OLOSMMSOLO...",
  "....OLOSSOLO....",
];
const BEANIE = [
  "....OOOOOOOO....",
  "...OAAAAAAAAO...",
  "...OTTTTTTTTO...",
  "...OOOOOOOOOO...",
];
const HEADSET_F = [
  "...KK......KK...",
  "..K..K....K..K..",
];

/* --------------------------------------------------------------------- composer */

type Pal = Record<string, string>;

function paletteFor(look: Look): Pal {
  return {
    O: C.ink,
    H: look.hair,
    S: look.skin,
    E: C.ink,
    M: "#a34a4a",
    T: look.shirt,
    t: shade(look.shirt, -28),
    A: look.accent,
    P: look.pants,
    p: shade(look.pants, -24),
    B: "#2a2438",
    W: C.white,
    K: "#23202e",
    G: C.gold,
    V: C.green,
    L: "#ece8f2",
  };
}

function blit(g: CanvasRenderingContext2D, rows: readonly string[], pal: Pal, ox: number, oy: number): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === "." || ch === " ") continue;
      const col = pal[ch];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(ox + x, oy + y, 1, 1);
    }
  });
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  return [c, g];
}

function drawHat(g: CanvasRenderingContext2D, look: Look, pal: Pal, dy: number, facing: Dir): void {
  switch (look.hat) {
    case "tophat":
      blit(g, HAT_TOP, pal, 0, dy);
      break;
    case "visor":
      blit(g, HAT_VISOR, pal, 0, 2 + dy);
      if (facing !== "up") blit(g, ["..OVVVVVVVVVVO..", "...OOOOOOOOOO..."], pal, 0, 6 + dy);
      // a small feather
      g.fillStyle = C.red;
      g.fillRect(12, 1 + dy, 1, 3);
      g.fillStyle = C.white;
      g.fillRect(13, 2 + dy, 1, 2);
      break;
    case "beanie":
      blit(g, BEANIE, pal, 0, 2 + dy);
      break;
    case "headset":
      blit(g, HEADSET_F, pal, 0, 4 + dy);
      if (facing === "down") {
        g.fillStyle = "#23202e";
        g.fillRect(4, 10 + dy, 3, 1);
        g.fillRect(3, 9 + dy, 1, 2);
      }
      break;
    default:
      break;
  }
}

function drawHead(g: CanvasRenderingContext2D, look: Look, pal: Pal, facing: Dir, dy: number, variant: "normal" | "blink" | "wide"): void {
  if (look.hat === "wig" && facing === "down") {
    blit(g, WIG_F, pal, 0, 2 + dy);
    if (variant === "blink") blit(g, ["..OLLOSSSSOSOLLO.."], pal, 0, 7 + dy);
    return;
  }
  const rows = facing === "up" ? HEAD_B : facing === "down" ? (variant === "blink" ? HEAD_F_BLINK : variant === "wide" ? HEAD_F_WIDE : HEAD_F) : HEAD_R;
  blit(g, rows, pal, 0, 2 + dy);
  if (look.hat === "wig" && facing !== "down") {
    // curls around the back of the head
    blit(g, ["..OLLLLLLLO.", ".OLLLLLLLLLO", ".OLLLLLO", "..OLLLLO"].map((r) => r.padEnd(16, ".")), pal, 0, 3 + dy);
  }
  drawHat(g, look, pal, dy, facing);
}

function body(facing: Dir): readonly string[] {
  return facing === "up" ? BODY_B : facing === "down" ? BODY_F : BODY_R;
}

/** Judges wear a long robe: extend the torso colour over the legs. */
function robe(g: CanvasRenderingContext2D, look: Look, facing: Dir): void {
  if (look.role !== "judge") return;
  g.fillStyle = look.shirt;
  const x0 = facing === "left" || facing === "right" ? 5 : 3;
  const w = facing === "left" || facing === "right" ? 7 : 10;
  g.fillRect(x0, 18, w, 4);
  g.fillStyle = shade(look.shirt, -26);
  g.fillRect(x0, 21, w, 1);
  g.fillStyle = C.ink;
  g.fillRect(x0 - 1, 18, 1, 4);
  g.fillRect(x0 + w, 18, 1, 4);
}

function renderCharacter(look: Look, pose: Pose): HTMLCanvasElement {
  const [cv, g] = canvas(FW, FH);
  const pal = paletteFor(look);
  const flipped = "dir" in pose && pose.dir === "left";
  if (flipped) {
    g.translate(FW, 0);
    g.scale(-1, 1);
  }
  const dir: Dir = "dir" in pose ? (pose.dir === "left" ? "right" : pose.dir) : "down";
  const bob = (kind: string, frame: number): number => (kind === "walk" || kind === "carry" ? (frame % 2 === 1 ? -1 : 0) : 0);

  switch (pose.kind) {
    case "stand":
    case "walk":
    case "carry": {
      const frame = pose.kind === "stand" ? 0 : pose.frame % 4;
      const dy = bob(pose.kind, frame);
      const side = dir === "right";
      const legs = side
        ? frame === 1
          ? LEGS_R_A
          : frame === 3
            ? LEGS_R_B
            : LEGS_R
        : frame === 1
          ? LEGS_F_A
          : frame === 3
            ? LEGS_F_B
            : LEGS_F;
      blit(g, legs, pal, 0, 18);
      robe(g, look, dir);
      blit(g, body(dir), pal, 0, 11 + dy);
      const swing = frame === 1 ? 1 : frame === 3 ? -1 : 0;
      if (pose.kind === "carry") {
        // both arms forward holding a sheet
        if (side) blit(g, ARM_SIDE, pal, 7, 12 + dy);
        else {
          blit(g, ["OT", "OT", "TT"], pal, 1, 12 + dy);
          blit(g, ["TT", "TO", "TO"], pal, 13, 12 + dy);
          blit(g, ["SS", "SS"], pal, 2, 15 + dy);
          blit(g, ["SS", "SS"], pal, 12, 15 + dy);
        }
      } else if (side) {
        blit(g, ARM_SIDE, pal, 7 + swing * 2, 12 + dy);
      } else {
        blit(g, ARM_L, pal, 1, 12 + dy - swing);
        blit(g, ARM_R, pal, 13, 12 + dy + swing);
      }
      drawHead(g, look, pal, dir, dy, "normal");
      break;
    }
    case "sit": {
      blit(g, BODY_F, pal, 0, 11);
      // forearms rest on the desk; hands alternate when typing
      const hl = pose.frame === 1 ? 17 : 16;
      const hr = pose.frame === 2 ? 17 : 16;
      blit(g, ["OT", "OT", "OT", "OT"], pal, 1, 12);
      blit(g, ["TO", "TO", "TO", "TO"], pal, 13, 12);
      blit(g, ["OTTTTT", "OSSSSS"], pal, 2, hl - 1);
      blit(g, ["TTTTTO", "SSSSSO"], pal, 8, hr - 1);
      drawHead(g, look, pal, "down", 0, pose.frame === 0 ? "blink" : "normal");
      break;
    }
    case "slump": {
      blit(g, BODY_F, pal, 0, 11);
      blit(g, ARM_L, pal, 1, 13);
      blit(g, ARM_R, pal, 13, 13);
      drawHead(g, look, pal, "down", 3, "blink");
      break;
    }
    case "alert": {
      blit(g, BODY_F, pal, 0, 11);
      blit(g, ["OT", "OT", "OT", "OT"], pal, 1, 12);
      blit(g, ["TO", "TO", "TO", "TO"], pal, 13, 12);
      blit(g, ["OTTTTT", "OSSSSS"], pal, 2, 15);
      blit(g, ["TTTTTO", "SSSSSO"], pal, 8, 15);
      drawHead(g, look, pal, "down", -1, "wide");
      break;
    }
    case "stamp": {
      blit(g, LEGS_F, pal, 0, 18);
      robe(g, look, "down");
      blit(g, BODY_F, pal, 0, 11);
      blit(g, ARM_L, pal, 1, 12);
      if (pose.frame === 0) {
        // right arm raised with the stamp
        blit(g, ["TO", "TO", "TO", "SO", "SO"], pal, 13, 8);
        g.fillStyle = C.red;
        g.fillRect(12, 5, 4, 3);
        g.fillStyle = C.redDark;
        g.fillRect(13, 4, 2, 1);
      } else {
        blit(g, ["TO", "TO", "TO", "TO", "SO"], pal, 13, 13);
        g.fillStyle = C.red;
        g.fillRect(12, 18, 4, 2);
      }
      drawHead(g, look, pal, "down", 0, "normal");
      break;
    }
  }
  return cv;
}

/* ------------------------------------------------------------------------ props */

const PAPER = [
  ".OOOOO.",
  "OWWWWWO",
  "OWKKKWO",
  "OWWWWWO",
  "OWKKKWO",
  "OWWWWWO",
  "OWKKWWO",
  ".OOOOO.",
];
const BLUEPRINT = [
  "OOOOOOOO",
  "OBBBBBBO",
  "OBWWBWBO",
  "OBWBBWBO",
  "OBWWBWBO",
  "OBBBBBBO",
  "OOOOOOOO",
];
const SKULL = [
  "..WWWW..",
  ".WWWWWW.",
  "WWKWWKWW",
  "WWKWWKWW",
  ".WWWWWW.",
  "..WKKW..",
  "..WWWW..",
];
const CHECK = ["......G", ".....GG", "G...GG.", "GG.GG..", ".GGG...", "..G...."];
const BANG = [
  "..OOOOOO..",
  ".OWWWWWWO.",
  "OWWWRRWWWO",
  "OWWWRRWWWO",
  "OWWWRRWWWO",
  "OWWWWWWWWO",
  "OWWWRRWWWO",
  ".OWWWWWWO.",
  "..OOOOOO..",
  "....OO....",
];
const DOTS = [
  "..OOOOOOOO..",
  ".OWWWWWWWWO.",
  "OWWKWKWKWWWO",
  ".OWWWWWWWWO.",
  "..OOOOOOOO..",
  "....OO......",
];
const SPARK = [".Y.", "YWY", ".Y."];

function fromRows(rows: readonly string[], pal: Record<string, string>): HTMLCanvasElement {
  const w = Math.max(...rows.map((r) => r.length));
  const [c, g] = canvas(w, rows.length);
  blit(g, rows, pal, 0, 0);
  return c;
}

const PROP_PAL: Record<string, string> = { O: C.ink, W: C.white, K: C.grayDark, R: C.red, G: C.green, B: C.blue, Y: C.yellow };

function makeProp(name: PropName, variant: number): HTMLCanvasElement {
  switch (name) {
    case "paper":
      return fromRows(PAPER, PROP_PAL);
    case "blueprint":
      return fromRows(BLUEPRINT, PROP_PAL);
    case "skull":
      return fromRows(SKULL, { W: C.white, K: C.ink });
    case "check":
      return fromRows(CHECK, PROP_PAL);
    case "bubble-bang":
      return fromRows(BANG, PROP_PAL);
    case "bubble-dots": {
      const [c, g] = canvas(12, 6);
      blit(g, DOTS, PROP_PAL, 0, 0);
      // light up one of the three dots
      g.fillStyle = C.blue;
      g.fillRect(3 + (variant % 3) * 2, 2, 1, 1);
      return c;
    }
    case "spark":
      return fromRows(SPARK, PROP_PAL);
    case "stamp": {
      const [c, g] = canvas(12, 8);
      g.strokeStyle = C.red;
      g.fillStyle = C.red;
      g.fillRect(0, 0, 12, 1);
      g.fillRect(0, 7, 12, 1);
      g.fillRect(0, 0, 1, 8);
      g.fillRect(11, 0, 1, 8);
      g.fillRect(2, 3, 8, 2);
      return c;
    }
    case "smoke": {
      const r = 2 + (variant % 3);
      const [c, g] = canvas(r * 2 + 1, r * 2 + 1);
      g.fillStyle = "#4a4658";
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + 1) g.fillRect(x + r, y + r, 1, 1);
      g.fillStyle = "#6a6580";
      g.fillRect(r - 1, r - 1, 1, 1);
      return c;
    }
    case "ghost-scan": {
      const [c, g] = canvas(FW, FH);
      g.fillStyle = "#9ff";
      for (let y = 0; y < FH; y += 2) g.fillRect(0, y, FW, 1);
      return c;
    }
  }
}

/** Flame silhouette: tier controls height, frame makes the tongue lick. */
function makeFlame(tier: 1 | 2 | 3 | 4, frame: number): HTMLCanvasElement {
  const h = [0, 4, 7, 10, 14][tier]!;
  const w = [0, 4, 6, 8, 10][tier]!;
  const [c, g] = canvas(w + 2, h + 1);
  const mid = (w + 2) / 2;
  const palettes = [C.redDark, C.red, C.orange, C.yellow];
  for (let y = 0; y < h; y++) {
    const t = y / h; // 0 top .. 1 bottom
    const half = Math.max(0.5, (w / 2) * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.12)));
    const sway = Math.sin(frame * 1.6 + y * 0.7) * (1 - t) * 1.3;
    for (let layer = 0; layer < 4; layer++) {
      const hw = half * (1 - layer * 0.24);
      if (hw < 0.4) break;
      g.fillStyle = palettes[layer]!;
      const x0 = Math.round(mid + sway - hw);
      const x1 = Math.round(mid + sway + hw);
      g.fillRect(x0, y, Math.max(1, x1 - x0), 1);
    }
  }
  return c;
}

/* ------------------------------------------------------------------------- set */

export function lookFor(role: Role | "unknown", name: string): Look {
  const h = hash(name);
  const skin = SKINS[h % SKINS.length]!;
  const hair = HAIRS[(h >>> 3) % HAIRS.length]!;
  const base = { skin, hair };
  switch (role) {
    case "boss":
      return { id: `boss:${name}`, role, ...base, shirt: "#2c2c3c", accent: C.gold, pants: "#2c2c3c", hat: "tophat" };
    case "hawk":
      return { id: `hawk:${name}`, role, ...base, shirt: "#2f6b5a", accent: C.white, pants: "#3d4a3f", hat: "visor" };
    case "judge":
      return { id: `judge:${name}`, role, ...base, hair: "#d9d2c0", shirt: "#23202e", accent: C.white, pants: "#23202e", hat: "wig" };
    case "desk":
      return { id: `desk:${name}`, role, ...base, shirt: "#3a62b0", accent: C.white, pants: "#2c3452", hat: "headset" };
    case "worker":
    case "unknown":
    default: {
      const shirt = SHIRTS[(h >>> 7) % SHIRTS.length]!;
      return { id: `worker:${name}`, role, ...base, shirt, accent: shade(shirt, 50), pants: "#3d4466", hat: (h >>> 11) % 4 === 0 ? "beanie" : "none" };
    }
  }
}

export class ProceduralSprites implements SpriteSet {
  readonly name = "procedural";
  readonly frame = { w: FW, h: FH };
  private chars = new Map<string, HTMLCanvasElement>();
  private props = new Map<string, HTMLCanvasElement>();
  private flames = new Map<string, HTMLCanvasElement>();

  character(look: Look, pose: Pose): HTMLCanvasElement {
    const key = `${look.id}|${look.shirt}|${poseKey(pose)}`;
    let c = this.chars.get(key);
    if (!c) {
      c = renderCharacter(look, pose);
      this.chars.set(key, c);
    }
    return c;
  }

  prop(name: PropName, variant = 0): HTMLCanvasElement {
    const key = `${name}:${name === "smoke" || name === "bubble-dots" ? variant % 3 : 0}`;
    let c = this.props.get(key);
    if (!c) {
      c = makeProp(name, variant);
      this.props.set(key, c);
    }
    return c;
  }

  flame(tier: 1 | 2 | 3 | 4, frame: number): HTMLCanvasElement {
    const f = ((frame % 4) + 4) % 4;
    const key = `${tier}:${f}`;
    let c = this.flames.get(key);
    if (!c) {
      c = makeFlame(tier, f);
      this.flames.set(key, c);
    }
    return c;
  }
}

export function poseKey(p: Pose): string {
  switch (p.kind) {
    case "stand":
      return `stand:${p.dir}`;
    case "walk":
    case "carry":
      return `${p.kind}:${p.dir}:${p.frame % 4}`;
    case "sit":
      return `sit:${p.frame}`;
    case "stamp":
      return `stamp:${p.frame}`;
    default:
      return p.kind;
  }
}

/** Raw pixel arrays, exported so tests can check they are well-formed. */
export const PIXEL_ARRAYS: Record<string, readonly string[]> = {
  HEAD_F, HEAD_F_BLINK, HEAD_F_WIDE, HEAD_B, HEAD_R, BODY_F, BODY_B, BODY_R, LEGS_F, LEGS_F_A, LEGS_F_B, LEGS_R, LEGS_R_A, LEGS_R_B,
  HAT_TOP, HAT_VISOR, WIG_F, BEANIE, HEADSET_F,
};
export const PIXEL_ARRAY_WIDTH = FW;

export type { Hat };
