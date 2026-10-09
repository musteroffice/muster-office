import { deployName, laneDeployLevel, type DeployLevel, type LaneView, type ProjectView } from "@muster-office/shared";
import { drawText, drawTextCentered, fit, textSprite, textWidth } from "./font";
import { TILE, WALL_H, rectPx, type Bay, type FloorLayout, type Rect } from "./layout";
import { C, mix, shade } from "./palette";

/**
 * Everything that only changes when the project's *structure* changes: the floor, wall, signs,
 * furniture, gates, delivery strips and machine room. It is rendered once per signature into a
 * "back" canvas plus a list of depth-sortable furniture sprites (desks, counter, racks), so the
 * per-frame work is just compositing.
 */

export interface Furniture {
  id: string;
  x: number;
  y: number;
  canvas: HTMLCanvasElement;
  /** Draw order: characters whose feet are above this are behind the piece. */
  sortY: number;
}

export interface StaticScene {
  w: number;
  h: number;
  back: HTMLCanvasElement;
  items: Furniture[];
}

function cv(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  return [c, g];
}
const rect = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void => {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};
const frame = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void => {
  rect(g, x, y, w, 1, color);
  rect(g, x, y + h - 1, w, 1, color);
  rect(g, x, y, 1, h, color);
  rect(g, x + w - 1, y, 1, h, color);
};
const dashed = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void => {
  g.fillStyle = color;
  for (let i = 0; i < w; i += 4) {
    g.fillRect(x + i, y, 2, 1);
    g.fillRect(x + i, y + h - 1, 2, 1);
  }
  for (let j = 0; j < h; j += 4) {
    g.fillRect(x, y + j, 1, 2);
    g.fillRect(x + w - 1, y + j, 1, 2);
  }
};

export function drawScaledText(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, scale: number, shadow?: string): void {
  const s = textSprite(text, color, shadow);
  g.drawImage(s, Math.round(x), Math.round(y), s.width * scale, s.height * scale);
}

/** Sky colour for a local hour 0..24: night, dawn, day, dusk. */
export function skyFor(hour: number): { top: string; bottom: string; night: number } {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5 || h >= 21) return { top: "#0e1330", bottom: C.skyNight, night: 1 };
  if (h < 7) {
    const t = (h - 5) / 2;
    return { top: mix("#0e1330", "#7aa6e0", t), bottom: mix(C.skyNight, C.skyDusk, 1 - Math.abs(t - 0.5) * 2 > 0.4 ? 0.7 : t), night: 1 - t };
  }
  if (h < 17) return { top: "#6fb4f2", bottom: C.skySun, night: 0 };
  if (h < 19) {
    const t = (h - 17) / 2;
    return { top: mix("#6fb4f2", "#d98a64", t), bottom: mix(C.skySun, C.skyDusk, t), night: 0 };
  }
  const t = (h - 19) / 2;
  return { top: mix("#d98a64", "#0e1330", t), bottom: mix(C.skyDusk, C.skyNight, t), night: t };
}

/* --------------------------------------------------------------------- pieces */

function drawFloor(g: CanvasRenderingContext2D, layout: FloorLayout): void {
  for (let y = WALL_H; y < layout.h; y++) {
    for (let x = 0; x < layout.w; x++) {
      const odd = (x + y) & 1;
      rect(g, x * TILE, y * TILE, TILE, TILE, odd ? C.floorA : C.floorB);
      // tile seams
      rect(g, x * TILE, y * TILE, TILE, 1, C.floorShade);
      rect(g, x * TILE, y * TILE, 1, TILE, C.floorShade);
    }
  }
  // Lobby carpet strip in front of the desk and a cooler floor in the machine room.
  const lt = layout.lobbyTop;
  for (let y = lt; y < layout.h - 1; y++) {
    for (let x = layout.machine.glassX + 1; x < layout.w - 1; x++) {
      rect(g, x * TILE, y * TILE, TILE, TILE, (x + y) & 1 ? "#6d7690" : "#646d87");
      rect(g, x * TILE, y * TILE, TILE, 1, "#4d5570");
      rect(g, x * TILE, y * TILE, 1, TILE, "#4d5570");
    }
  }
  const carpet = rectPx({ x: 11, y: lt + 6, w: 13, h: 3 });
  rect(g, carpet.x, carpet.y, carpet.w, carpet.h, C.rug);
  frame(g, carpet.x + 2, carpet.y + 2, carpet.w - 4, carpet.h - 4, C.rugLight);
}

function drawWall(g: CanvasRenderingContext2D, layout: FloorLayout, hour: number): void {
  const w = layout.w * TILE;
  const wallH = WALL_H * TILE;
  rect(g, 0, 0, w, wallH, C.wall);
  for (let x = 0; x < layout.w; x += 2) rect(g, x * TILE, 0, 1, wallH - 6, C.wallDark);
  rect(g, 0, 0, w, 3, C.wallDark);
  rect(g, 0, wallH - 8, w, 8, C.wallLight);
  rect(g, 0, wallH - 8, w, 1, C.trim);
  rect(g, 0, wallH - 2, w, 2, C.wallDark);
  // soft shadow where the wall meets the floor
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.fillRect(0, wallH, w, 3);

  const sky = skyFor(hour);
  for (const win of layout.wall.windows) {
    const p = rectPx(win);
    rect(g, p.x - 2, p.y + 6, p.w + 4, p.h + 4, C.wallDark);
    const grad = g.createLinearGradient(0, p.y + 8, 0, p.y + p.h + 8);
    grad.addColorStop(0, sky.top);
    grad.addColorStop(1, sky.bottom);
    g.fillStyle = grad;
    g.fillRect(p.x, p.y + 8, p.w, p.h);
    // skyline
    g.fillStyle = mix("#1a2036", sky.bottom, 0.25);
    const heights = [10, 18, 12, 24, 14, 20, 9, 16, 22, 11];
    for (let i = 0; i < p.w / 8; i++) g.fillRect(p.x + i * 8, p.y + 8 + p.h - heights[i % heights.length]!, 7, heights[i % heights.length]!);
    if (sky.night > 0.5) {
      g.fillStyle = "#fff";
      for (const [sx, sy] of [[6, 4], [22, 9], [40, 3], [58, 12], [70, 6], [30, 18]] as const) if (sx < p.w) g.fillRect(p.x + sx, p.y + 8 + sy, 1, 1);
      g.fillStyle = "#f3efe6";
      g.fillRect(p.x + p.w - 18, p.y + 12, 6, 6);
    } else {
      g.fillStyle = "#ffffff55";
      g.fillRect(p.x + 8, p.y + 14, 14, 3);
      g.fillRect(p.x + 12, p.y + 12, 8, 2);
      g.fillStyle = "#ffe9a8";
      g.fillRect(p.x + p.w - 20, p.y + 12, 7, 7);
    }
    rect(g, p.x + p.w / 2 - 1, p.y + 8, 2, p.h, C.wallDark);
    frame(g, p.x, p.y + 8, p.w, p.h, C.trim);
  }
}

function drawSign(g: CanvasRenderingContext2D, layout: FloorLayout, project: ProjectView): void {
  const p = rectPx(layout.wall.sign);
  rect(g, p.x, p.y + 6, p.w, p.h - 6, C.ink2);
  frame(g, p.x, p.y + 6, p.w, p.h - 6, C.gold);
  frame(g, p.x + 2, p.y + 8, p.w - 4, p.h - 10, C.goldDark);
  // hanging chains
  rect(g, p.x + 8, p.y, 2, 6, C.metalLight);
  rect(g, p.x + p.w - 10, p.y, 2, 6, C.metalLight);
  const label = fit(project.label.toUpperCase(), 24);
  const scale = textWidth(label) * 2 <= p.w - 16 ? 2 : 1;
  const lw = textWidth(label) * scale;
  drawScaledText(g, label, p.x + (p.w - lw) / 2, p.y + 13, C.white, scale, C.ink);
  const sub = fit((project.headline ?? project.nextAction ?? "").toUpperCase(), Math.floor((p.w - 12) / 4));
  drawTextCentered(g, sub, p.x + p.w / 2, p.y + p.h - 15, C.gold);
}

function drawTickerFrame(g: CanvasRenderingContext2D, layout: FloorLayout): void {
  const t = rectPx(layout.wall.ticker);
  rect(g, t.x, t.y + 3, t.w, 11, "#0b0c14");
  frame(g, t.x, t.y + 3, t.w, 11, C.metal);
  for (let x = t.x + 4; x < t.x + t.w; x += 12) rect(g, x, t.y + 2, 1, 1, C.metalLight);
  // the warning-light housing at the left end
  const l = layout.wall.light;
  rect(g, l.x - 5, l.y - 5, 10, 10, C.metalDark);
  frame(g, l.x - 5, l.y - 5, 10, 10, C.metal);
}

function stateTag(lane: LaneView): { text: string; color: string } {
  switch (lane.state) {
    case "open":
      return { text: lane.kind === "role" ? "ROLE" : "OPEN", color: lane.kind === "role" ? C.teal : C.green };
    case "draining":
      return { text: "DRAINING", color: C.yellow };
    case "proposed":
      return { text: lane.rank !== null ? `PROPOSED #${lane.rank}` : "PROPOSED", color: C.gray };
    case "closed":
      return { text: "CLOSED", color: C.gray };
    default:
      return { text: "?", color: C.gray };
  }
}

function drawBaySign(g: CanvasRenderingContext2D, bay: Bay): void {
  const p = rectPx(bay.sign);
  const dim = bay.lane.state === "proposed" || bay.lane.state === "closed";
  rect(g, p.x, p.y + 2, p.w, p.h - 3, dim ? C.metalDark : C.woodDark);
  frame(g, p.x, p.y + 2, p.w, p.h - 3, dim ? C.metal : C.woodLight);
  drawText(g, fit(bay.lane.label.toUpperCase(), 18), p.x + 4, p.y + 5, dim ? C.metalLight : C.white);
  const tag = stateTag(bay.lane);
  const tw = textWidth(tag.text);
  drawText(g, tag.text, p.x + p.w - tw - 4, p.y + 5, tag.color);
}

function drawRug(g: CanvasRenderingContext2D, bay: Bay): void {
  const x = bay.origin.x * TILE;
  const y = (bay.origin.y + 2) * TILE;
  const w = 11 * TILE;
  const h = 4 * TILE;
  const state = bay.lane.state;
  if (state === "proposed") {
    dashed(g, x + 2, y + 2, w - 4, h - 4, C.metalDark);
    return;
  }
  const base = bay.lane.kind === "role" ? "#3d6b73" : state === "closed" ? "#4a4660" : C.rug;
  rect(g, x + 2, y + 2, w - 4, h - 4, base);
  frame(g, x + 4, y + 4, w - 8, h - 8, shade(base, 24));
}

function drawChair(g: CanvasRenderingContext2D, sx: number, sy: number, lane: LaneView): void {
  const x = sx * TILE;
  const y = sy * TILE;
  const col = lane.state === "closed" ? C.metalDark : C.blueDark;
  rect(g, x + 2, y + 6, 12, 9, col);
  rect(g, x + 2, y + 6, 12, 1, shade(col, 30));
  rect(g, x + 3, y + 15, 10, 1, "#00000044");
  rect(g, x + 7, y + 13, 2, 3, C.metalDark);
}

function drawGhostDesk(g: CanvasRenderingContext2D, r: Rect): void {
  const p = rectPx(r);
  dashed(g, p.x + 1, p.y + 2, p.w - 2, p.h - 2, C.metal);
  // dotted chair outline behind
  dashed(g, p.x + 16 + 2, p.y - 14, 12, 12, C.metalDark);
}

/** A desk as its own sprite (so it sorts against characters). 3 tiles wide. */
function deskSprite(main: boolean, state: LaneView["state"]): HTMLCanvasElement {
  const W = 3 * TILE;
  const top = 12; // headroom for the monitor
  const [c, g] = cv(W, 32 + top);
  const dim = state === "closed";
  const wood = dim ? C.metalDark : C.woodLight;
  const front = dim ? "#3a3f55" : C.wood;
  // desk top surface
  rect(g, 0, top, W, 14, wood);
  rect(g, 0, top, W, 1, shade(wood, 30));
  rect(g, 0, top + 13, W, 1, shade(wood, -30));
  // front face
  rect(g, 0, top + 14, W, 16, front);
  rect(g, 0, top + 14, W, 1, shade(front, -30));
  rect(g, 2, top + 30, 3, 2, C.woodDark);
  rect(g, W - 5, top + 30, 3, 2, C.woodDark);
  // drawer
  rect(g, 6, top + 18, W - 12, 9, shade(front, -14));
  frame(g, 6, top + 18, W - 12, 9, shade(front, -34));
  rect(g, W / 2 - 3, top + 22, 6, 1, C.gold);
  // monitor (we see its back): body, stand, little logo
  const mw = main ? 20 : 15;
  const mh = main ? 14 : 11;
  const mx = Math.round((W - mw) / 2);
  rect(g, mx, top - mh + 6, mw, mh, C.metalDark);
  frame(g, mx, top - mh + 6, mw, mh, C.ink);
  rect(g, mx + mw / 2 - 1, top + 6, 3, 2, C.ink);
  rect(g, mx + mw / 2 - 2, top - mh + 6 + Math.floor(mh / 2) - 1, 4, 3, dim ? C.metal : C.metalLight);
  // keyboard + mug
  rect(g, mx + 2, top + 9, mw - 4, 2, C.ink2);
  if (main) {
    rect(g, 3, top + 3, 4, 5, C.white);
    rect(g, 7, top + 4, 1, 3, C.white);
    // desk lamp
    rect(g, W - 8, top + 3, 2, 6, C.metalDark);
    rect(g, W - 11, top, 6, 3, C.yellow);
  }
  return c;
}

function frontDeskSprite(width: number): HTMLCanvasElement {
  const W = width * TILE;
  const top = 8;
  const [c, g] = cv(W, 32 + top);
  rect(g, 0, top, W, 14, C.woodLight);
  rect(g, 0, top, W, 2, shade(C.woodLight, 34));
  rect(g, 0, top + 14, W, 18, C.wood);
  rect(g, 0, top + 14, W, 1, C.woodDark);
  for (let x = 8; x < W - 8; x += 24) {
    rect(g, x, top + 18, 18, 10, shade(C.wood, -14));
    frame(g, x, top + 18, 18, 10, C.woodDark);
    rect(g, x + 8, top + 22, 3, 1, C.gold);
  }
  rect(g, 0, top + 30, W, 2, C.woodDark);
  frame(g, 0, top, W, 14, C.woodDark);
  return c;
}

function trayBody(g: CanvasRenderingContext2D, x: number, y: number, kind: string): void {
  const tone = kind === "blocked" ? C.red : kind === "approval" ? C.orange : kind === "decision" ? C.yellow : C.blue;
  rect(g, x, y + 4, 30, 8, shade(C.metalDark, -6));
  rect(g, x, y + 4, 30, 1, C.metalLight);
  rect(g, x + 2, y + 6, 26, 5, "#12141f");
  rect(g, x, y + 10, 30, 2, tone);
  frame(g, x, y + 4, 30, 8, C.ink);
}

function drawDeskArea(g: CanvasRenderingContext2D, layout: FloorLayout): void {
  const lt = layout.lobbyTop;
  // back wall decor behind the operators
  rect(g, 11 * TILE, lt * TILE, 13 * TILE, 2 * TILE, C.wallDark);
  frame(g, 11 * TILE, lt * TILE, 13 * TILE, 2 * TILE, C.trim);
  drawTextCentered(g, "THE DESK", 17.5 * TILE, lt * TILE + 6, C.gold, C.ink);
  drawTextCentered(g, "BLOCKED > APPROVAL > DECISION", 17.5 * TILE, lt * TILE + 20, C.metalLight);
  // door
  const d = rectPx(layout.door.rect);
  rect(g, d.x - 3, d.y - 20, d.w + 6, 24, C.woodDark);
  rect(g, d.x, d.y - 17, d.w, 21, "#0e0c18");
  rect(g, d.x + 1, d.y - 16, d.w - 2, 3, C.yellow);
  drawTextCentered(g, "ENTRANCE", d.x + d.w / 2, d.y - 28, C.metalLight);
  // queue markings
  g.fillStyle = "#00000022";
  for (const q of layout.queue) g.fillRect(q.x * TILE + 3, q.y * TILE + 12, 10, 2);
}

function drawMachineRoom(g: CanvasRenderingContext2D, layout: FloorLayout): void {
  const m = layout.machine;
  const room = rectPx(m.room);
  // back wall of the room
  rect(g, room.x, (layout.lobbyTop - 1) * TILE, room.w, TILE, C.wallDark);
  frame(g, room.x, (layout.lobbyTop - 1) * TILE, room.w, TILE, C.trim);
  drawTextCentered(g, "MACHINE ROOM  MUSTER-HEAVY", room.x + room.w / 2, (layout.lobbyTop - 1) * TILE + 6, C.metalLight);
  // glass wall
  const gx = m.glassX * TILE;
  const gy = layout.lobbyTop * TILE;
  const gh = (layout.h - 1 - layout.lobbyTop) * TILE;
  rect(g, gx + 5, gy, 6, gh, "#8fd0e044");
  rect(g, gx + 5, gy, 1, gh, C.glass);
  rect(g, gx + 10, gy, 1, gh, C.glass);
  for (let y = gy; y < gy + gh; y += 32) rect(g, gx + 4, y, 8, 2, C.metal);
  // cable trays on the floor
  g.fillStyle = "#00000033";
  g.fillRect(room.x + 4, (layout.lobbyTop + 4) * TILE + 4, room.w - 8, 3);
}

/* ------------------------------------------------------------------- the strip */

const LEVEL_COLOR = [C.red, C.yellow, C.green, C.blue] as const;
const RULE_GLYPH: Record<string, string> = { "customer-facing": "C", money: "$", "outbound-sends": "@", irreversible: "!", "shared-infra": "S", "slow-rollback": "R" };
const LEVEL_WORD = ["LOCKED", "PROVE", "SHIP", "JFDI"] as const;

function drawGate(g: CanvasRenderingContext2D, bay: Bay, level: DeployLevel, lane: LaneView): void {
  if (!bay.gate) return;
  const p = rectPx(bay.gate);
  const col = LEVEL_COLOR[level];
  // post
  rect(g, p.x + 2, p.y + 8, 5, 28, C.metalDark);
  frame(g, p.x + 2, p.y + 8, 5, 28, C.ink);
  rect(g, p.x + 3, p.y + 10, 3, 3, col);
  // arm: horizontal (closed) at level 0 .. vertical (open) at level 3
  g.save();
  g.translate(p.x + 7, p.y + 20);
  const angle = [0, -0.5, -1.1, -1.5][level]!;
  g.rotate(angle);
  for (let i = 0; i < 20; i++) {
    g.fillStyle = (i >> 2) % 2 === 0 ? C.white : C.red;
    g.fillRect(i, -1, 1, 3);
  }
  g.restore();
  // plate: level on the first line, name on the second
  rect(g, p.x + 4, p.y + 33, 27, 15, C.ink2);
  frame(g, p.x + 4, p.y + 33, 27, 15, col);
  drawText(g, `L${level}`, p.x + 7, p.y + 36, col);
  drawText(g, LEVEL_WORD[level], p.x + 7, p.y + 42, C.white);
  if (lane.deployRule) {
    rect(g, p.x + 24, p.y + 14, 9, 9, C.ink2);
    frame(g, p.x + 24, p.y + 14, 9, 9, C.gold);
    drawText(g, RULE_GLYPH[lane.deployRule] ?? "?", p.x + 27, p.y + 16, C.gold);
  }
  if (lane.override) {
    rect(g, p.x + 24, p.y + 24, 9, 9, C.ink2);
    frame(g, p.x + 24, p.y + 24, 9, 9, C.orange);
    drawText(g, "O", p.x + 27, p.y + 26, C.orange);
  }
}

function drawStrip(g: CanvasRenderingContext2D, bay: Bay): void {
  if (!bay.strip) return;
  const lane = bay.lane;
  const order = ["landed", "deployed", "proven"] as const;
  const reachedIdx = (order as readonly string[]).indexOf(lane.delivery);
  const waived = lane.delivery === "waived";
  const labels = ["LANDED", "DEPLOYED", waived ? "WAIVED" : "PROVEN"];
  const padColors = [C.blue, C.orange, waived ? C.gray : C.green];
  // belt body
  const b = rectPx(bay.belt!);
  rect(g, b.x, b.y + 4, b.w, 10, C.metalDark);
  rect(g, b.x, b.y + 3, b.w, 1, C.metalLight);
  rect(g, b.x, b.y + 14, b.w, 2, C.ink);
  bay.pads.forEach((pad, i) => {
    const p = rectPx(pad.rect);
    const lit = waived ? i === 2 : reachedIdx >= i;
    const base = padColors[i]!;
    rect(g, p.x, p.y + 6, p.w, p.h - 6, lit ? base : shade(base, -70));
    rect(g, p.x, p.y + 6, p.w, 3, lit ? shade(base, 40) : shade(base, -40));
    frame(g, p.x, p.y + 6, p.w, p.h - 6, C.ink);
    if (lit) {
      // little beacon
      rect(g, p.x + p.w / 2 - 2, p.y + 1, 4, 4, shade(base, 60));
      rect(g, p.x + p.w / 2 - 1, p.y + 2, 2, 2, C.white);
    }
    drawTextCentered(g, labels[i]!, p.x + p.w / 2, p.y - 8, lit ? C.white : C.metal);
  });
}

/* --------------------------------------------------------------------- the build */

export interface StaticInput {
  project: ProjectView;
  layout: FloorLayout;
  hour: number;
  /** Operators who sit at the front desk need the chair drawn there too. */
  frontSeats: number;
}

export function buildStatic(input: StaticInput): StaticScene {
  const { layout, project } = input;
  const W = layout.w * TILE;
  const H = layout.h * TILE;
  const [back, g] = cv(W, H);
  const items: Furniture[] = [];

  drawFloor(g, layout);
  drawWall(g, layout, input.hour);
  drawSign(g, layout, project);
  drawTickerFrame(g, layout);
  drawDeskArea(g, layout);
  drawMachineRoom(g, layout);

  for (const bay of layout.bays) {
    drawRug(g, bay);
    drawBaySign(g, bay);
    const lane = bay.lane;
    if (lane.state === "proposed") {
      for (const d of bay.desks) drawGhostDesk(g, d.rect);
      continue;
    }
    for (const d of bay.desks) drawChair(g, d.seat.x, d.seat.y, lane);
    bay.desks.forEach((d, i) => {
      const p = rectPx(d.rect);
      items.push({ id: `desk:${lane.slug}:${i}`, x: p.x, y: p.y - 12, canvas: deskSprite(d.main, lane.state), sortY: p.y + p.h });
    });
    if (lane.kind !== "role") {
      drawStrip(g, bay);
      drawGate(g, bay, laneDeployLevel(lane, project.deploy.level), lane);
    }
    if (lane.state === "draining") {
      // a "wind down" banner is drawn dynamically with the dim overlay
    }
  }

  // front desk counter
  const cp = rectPx(layout.front.counter);
  items.push({ id: "front-desk", x: cp.x, y: cp.y - 8, canvas: frontDeskSprite(layout.front.counter.w), sortY: cp.y + cp.h });
  for (const s of layout.front.seats) {
    const x = s.x * TILE;
    const y = s.y * TILE;
    rect(g, x + 2, y + 6, 12, 9, C.blueDark);
    rect(g, x + 2, y + 6, 12, 1, shade(C.blueDark, 30));
  }
  // trays are drawn into the counter sprite position as separate small furniture so piles can sit above them
  for (const t of layout.front.trays) {
    const [tc, tg] = cv(32, 16);
    trayBody(tg, 1, 0, t.kind);
    const p = rectPx(t.rect);
    items.push({ id: `tray:${t.kind}`, x: p.x, y: p.y - 4, canvas: tc, sortY: cp.y + cp.h + 1 });
  }

  // racks
  for (const r of layout.machine.racks) {
    const p = rectPx(r.rect);
    const [rc, rg] = cv(32, 48);
    rect(rg, 0, 0, 32, 48, C.rackDark);
    frame(rg, 0, 0, 32, 48, C.ink);
    rect(rg, 1, 1, 30, 2, C.metal);
    for (let i = 0; i < 6; i++) {
      rect(rg, 3, 6 + i * 6, 26, 4, C.rackMid);
      rect(rg, 3, 6 + i * 6, 26, 1, shade(C.rackMid, 26));
    }
    rect(rg, 0, 46, 32, 2, "#00000066");
    items.push({ id: `rack:${r.slot}`, x: p.x, y: p.y, canvas: rc, sortY: p.y + p.h });
  }
  // console desk in the machine room
  if (layout.machine.console.w > 0 && layout.machine.racks.length <= 7) {
    const cr = rectPx(layout.machine.console);
    const [cc, cg] = cv(cr.w, 24);
    rect(cg, 0, 8, cr.w, 10, C.metal);
    rect(cg, 0, 18, cr.w, 6, C.metalDark);
    rect(cg, 4, 0, 24, 9, C.ink);
    frame(cg, 4, 0, 24, 9, C.metalLight);
    rect(cg, 6, 2, 20, 5, "#10353a");
    rect(cg, cr.w - 28, 2, 20, 7, C.ink);
    frame(cg, cr.w - 28, 2, 20, 7, C.metalLight);
    items.push({ id: "console", x: cr.x, y: cr.y - 8, canvas: cc, sortY: cr.y + cr.h });
  }

  return { w: W, h: H, back, items };
}

/** Everything that, when changed, requires the static scene to be rebuilt. */
export function staticSignature(project: ProjectView, layout: FloorLayout, hourBucket: number, rackSlots: number): string {
  const lanes = layout.bays.map((b) => {
    const l = b.lane;
    return `${l.slug}:${l.kind}:${l.state}:${l.delivery}:${l.deployLevel ?? "-"}:${l.deployRule ?? "-"}:${l.override ? 1 : 0}:${l.rank ?? "-"}:${l.label}`;
  });
  return [project.slug, project.label, project.headline ?? project.nextAction, project.deploy.level, hourBucket, rackSlots, lanes.join("|")].join("§");
}

export { deployName };
