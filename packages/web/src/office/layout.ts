import type { LaneDelivery, LaneView } from "@muster-office/shared";

/**
 * Floor layout generator. Pure: lanes in, tile grid + objects + waypoints out.
 * All coordinates are in tiles (16 px each). The floor is a fixed 47 tiles wide and as tall as
 * its bays need. Bays fill two columns row-major, so N lanes grow the floor downwards.
 *
 *   y 0..4     back wall: windows, project sign, flow ticker
 *   y 6..      bays (22 × 9): headroom for name tags, chairs behind desks, delivery strip to the right
 *   y LT..LT+8 lobby: door + door queue (left), front desk (middle), machine room (right)
 */

export const TILE = 16;
export const FLOOR_W = 47;
export const WALL_H = 5;
export const BAY_W = 22;
export const BAY_H = 9;
export const BAY_X: readonly [number, number] = [1, 24];
export const FIRST_BAY_Y = 6;
export const LOBBY_H = 10;
export const MAX_RACKS = 14;
export const QUEUE_CAP = 12;

export interface Tile {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Dir = "down" | "up" | "left" | "right";

export interface DeskSpot {
  /** Desk body (tiles). The chair tile is directly above its middle. */
  rect: Rect;
  seat: Tile;
  main: boolean;
}

export interface Pad {
  stage: Extract<LaneDelivery, "landed" | "deployed" | "proven">;
  rect: Rect;
  /** Where a packet token sits on this pad (pixel centre). */
  centre: { x: number; y: number };
}

export interface Bay {
  lane: LaneView;
  index: number;
  col: number;
  row: number;
  origin: Tile;
  /** Whole clickable bay. */
  rect: Rect;
  sign: Rect;
  desks: DeskSpot[];
  /** Standing spots in the aisle for agents without a seat. */
  stand: Tile[];
  strip: Rect | null;
  pads: Pad[];
  belt: Rect | null;
  /** Deploy-level gate between the pod and the strip. */
  gate: Rect | null;
}

export interface Tray {
  kind: "packets" | "blocked" | "approval" | "decision";
  rect: Rect;
  /** Tile in front of the counter where someone drops an item. */
  drop: Tile;
}

export interface RackSlot {
  slot: number;
  rect: Rect;
}

export interface FloorLayout {
  w: number;
  h: number;
  /** Row-major, 1 = a character cannot stand here. */
  blocked: Uint8Array;
  lobbyTop: number;
  bays: Bay[];
  wall: {
    sign: Rect;
    ticker: Rect;
    windows: Rect[];
    light: { x: number; y: number };
  };
  front: {
    counter: Rect;
    seats: Tile[];
    trays: Tray[];
    skull: { x: number; y: number };
    /** Standing spots near the front desk for extra operators. */
    stand: Tile[];
  };
  door: { rect: Rect; entry: Tile; spawn: { x: number; y: number } };
  queue: Tile[];
  /** Decoration that also blocks its tile (potted plants). */
  decor: Tile[];
  machine: { room: Rect; glassX: number; racks: RackSlot[]; console: Rect };
}

export function idx(layout: Pick<FloorLayout, "w">, x: number, y: number): number {
  return y * layout.w + x;
}

export function isWalkable(layout: Pick<FloorLayout, "w" | "h" | "blocked">, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < layout.w && y < layout.h && layout.blocked[y * layout.w + x] === 0;
}

function fill(blocked: Uint8Array, w: number, r: Rect, v = 1): void {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) blocked[y * w + x] = v;
}

/** Stable order: work lanes first, role lanes last; older first; slug breaks ties. Archived+closed lanes are dropped. */
export function orderLanes(lanes: readonly LaneView[]): LaneView[] {
  return lanes
    .filter((l) => !(l.archived && l.state === "closed"))
    .slice()
    .sort((a, b) => Number(a.kind === "role") - Number(b.kind === "role") || Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.slug < b.slug ? -1 : 1));
}

export function layoutFloor(input: { lanes: readonly LaneView[]; rackSlots?: number }): FloorLayout {
  const lanes = orderLanes(input.lanes);
  const rows = Math.max(1, Math.ceil(lanes.length / 2));
  const lobbyTop = FIRST_BAY_Y + rows * BAY_H + 1;
  const h = lobbyTop + LOBBY_H;
  const w = FLOOR_W;
  const blocked = new Uint8Array(w * h);

  // Walls and borders.
  fill(blocked, w, { x: 0, y: 0, w, h: WALL_H });
  fill(blocked, w, { x: 0, y: 0, w: 1, h });
  fill(blocked, w, { x: w - 1, y: 0, w: 1, h });
  fill(blocked, w, { x: 0, y: h - 1, w, h: 1 });

  const bays: Bay[] = lanes.map((lane, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const bx = BAY_X[col]!;
    const by = FIRST_BAY_Y + row * BAY_H;
    const isWork = lane.kind !== "role";
    const deskXs = [0, 4, 8];
    const desks: DeskSpot[] = deskXs.map((dx, i) => ({
      rect: { x: bx + dx, y: by + 4, w: 3, h: 2 },
      seat: { x: bx + dx + 1, y: by + 3 },
      main: i === 1,
    }));
    for (const d of desks) fill(blocked, w, d.rect);
    // A proposed lane is only a dotted outline of a desk: nobody walks through it.
    if (lane.state === "proposed") fill(blocked, w, { x: bx, y: by + 1, w: 11, h: 5 });
    // The sign row is decoration, not floor.
    fill(blocked, w, { x: bx, y: by, w: 11, h: 1 });

    const stand: Tile[] = [1, 3, 5, 7, 9].map((dx) => ({ x: bx + dx, y: by + 6 }));

    let strip: Rect | null = null;
    let belt: Rect | null = null;
    let gate: Rect | null = null;
    const pads: Pad[] = [];
    if (isWork) {
      strip = { x: bx + 13, y: by + 3, w: 8, h: 2 };
      belt = { x: bx + 13, y: by + 4, w: 8, h: 1 };
      gate = { x: bx + 11, y: by + 3, w: 2, h: 2 };
      fill(blocked, w, strip);
      fill(blocked, w, gate);
      const stages: Pad["stage"][] = ["landed", "deployed", "proven"];
      stages.forEach((stage, i) => {
        const x = bx + 13 + i * 3;
        pads.push({ stage, rect: { x, y: by + 3, w: 2, h: 2 }, centre: { x: (x + 1) * TILE, y: (by + 4) * TILE - 2 } });
      });
    }
    return {
      lane,
      index,
      col,
      row,
      origin: { x: bx, y: by },
      rect: { x: bx, y: by, w: BAY_W - 1, h: 6 },
      sign: { x: bx, y: by, w: 11, h: 1 },
      desks,
      stand,
      strip,
      pads,
      belt,
      gate,
    };
  });

  // Front desk.
  const counter: Rect = { x: 11, y: lobbyTop + 4, w: 13, h: 2 };
  fill(blocked, w, counter);
  const trayKinds: Tray["kind"][] = ["packets", "blocked", "approval", "decision"];
  const trays: Tray[] = trayKinds.map((kind, i) => {
    const x = 12 + i * 3;
    return { kind, rect: { x, y: lobbyTop + 4, w: 2, h: 1 }, drop: { x, y: lobbyTop + 6 } };
  });
  const seats: Tile[] = [
    { x: 13, y: lobbyTop + 3 },
    { x: 20, y: lobbyTop + 3 },
  ];
  const frontStand: Tile[] = [
    { x: 10, y: lobbyTop + 3 },
    { x: 24, y: lobbyTop + 3 },
    { x: 9, y: lobbyTop + 6 },
    { x: 25, y: lobbyTop + 6 },
  ];

  // Door and the queue that waits beside it.
  const doorRect: Rect = { x: 3, y: h - 1, w: 2, h: 1 };
  fill(blocked, w, doorRect, 0);
  const entry: Tile = { x: 3, y: h - 2 };
  const queue: Tile[] = [];
  for (const x of [1, 2]) for (let k = 0; k < 6; k++) queue.push({ x, y: lobbyTop + 7 - k });
  queue.length = Math.min(queue.length, QUEUE_CAP);

  // Plants: one in each gutter between the bay columns, one by the door and one by the glass wall.
  const decor: Tile[] = [];
  for (let r = 0; r < rows; r++) decor.push({ x: 22, y: FIRST_BAY_Y + r * BAY_H + 2 });
  decor.push({ x: 6, y: lobbyTop + 1 }, { x: 26, y: lobbyTop + 1 }, { x: 9, y: h - 3 });
  for (const d of decor) blocked[d.y * w + d.x] = 1;

  // Machine room.
  const glassX = 27;
  fill(blocked, w, { x: glassX, y: lobbyTop, w: 1, h: LOBBY_H - 1 });
  fill(blocked, w, { x: glassX, y: lobbyTop - 1, w: w - 1 - glassX, h: 1 }); // the room has a back wall too
  const slots = Math.min(MAX_RACKS, Math.max(7, input.rackSlots ?? 7));
  const racks: RackSlot[] = [];
  for (let s = 0; s < slots; s++) {
    const r = Math.floor(s / 7);
    const rect: Rect = { x: 29 + (s % 7) * 2, y: lobbyTop + 1 + r * 4, w: 2, h: 3 };
    racks.push({ slot: s, rect });
    fill(blocked, w, rect);
  }
  const consoleRect: Rect = { x: 33, y: lobbyTop + 4 + (slots > 7 ? 0 : 1), w: 5, h: 1 };
  if (slots <= 7) fill(blocked, w, consoleRect);

  return {
    w,
    h,
    blocked,
    lobbyTop,
    bays,
    wall: {
      sign: { x: 12, y: 0, w: 23, h: 3 },
      ticker: { x: 3, y: 3, w: 41, h: 1 },
      windows: [
        { x: 1, y: 0, w: 5, h: 3 },
        { x: 41, y: 0, w: 5, h: 3 },
      ],
      light: { x: 1.5 * TILE, y: 3.5 * TILE },
    },
    front: { counter, seats, trays, skull: { x: 24 * TILE, y: (lobbyTop + 3) * TILE }, stand: frontStand },
    door: { rect: doorRect, entry, spawn: { x: 4 * TILE, y: (h - 1) * TILE } },
    queue,
    decor,
    machine: { room: { x: glassX + 1, y: lobbyTop, w: w - 2 - glassX, h: LOBBY_H - 1 }, glassX, racks, console: consoleRect },
  };
}

/** The bay for a lane slug, if it is on the floor. */
export function bayOf(layout: FloorLayout, slug: string): Bay | undefined {
  return layout.bays.find((b) => b.lane.slug === slug);
}

export const rectContains = (r: Rect, tx: number, ty: number): boolean => tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;

export function rectPx(r: Rect): { x: number; y: number; w: number; h: number } {
  return { x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE };
}

/**
 * Seat assignment for the agents of one lane. The one writer (worker) gets the main chair,
 * the rest take side chairs in a fixed order; anyone left over stands in the aisle.
 */
export function assignSeats(
  bay: Bay,
  agents: ReadonlyArray<{ name: string; role: string; createdAt: string }>,
): Map<string, { seat: Tile; sitting: boolean }> {
  const order = (r: string): number => ({ worker: 0, boss: 1, judge: 2, hawk: 3, desk: 4 })[r] ?? 5;
  const sorted = agents.slice().sort((a, b) => order(a.role) - order(b.role) || Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.name < b.name ? -1 : 1));
  const seatOrder = [bay.desks[1]!, bay.desks[0]!, bay.desks[2]!];
  const out = new Map<string, { seat: Tile; sitting: boolean }>();
  sorted.forEach((a, i) => {
    const desk = seatOrder[i];
    if (desk) out.set(a.name, { seat: desk.seat, sitting: true });
    else out.set(a.name, { seat: bay.stand[(i - seatOrder.length) % bay.stand.length]!, sitting: false });
  });
  return out;
}
