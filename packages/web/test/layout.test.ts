import { describe, expect, it } from "vitest";
import type { LaneView } from "@muster-office/shared";
import { assignSeats, isWalkable, layoutFloor, orderLanes, rectContains, FLOOR_W, TILE, type FloorLayout, type Tile } from "../src/office/layout";
import { dirBetween, findPath } from "../src/office/path";

function lane(slug: string, over: Partial<LaneView> = {}): LaneView {
  return {
    slug, kind: "work", label: slug, goal: "", state: "open", delivery: "none", deliveryAt: null, deliveryEvidence: null,
    deliveryHistory: [], deployLevel: null, deployRule: null, override: null, rank: null, archived: false, discarded: false,
    openedAt: null, closedAt: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", ...over,
  };
}
const lanes = (n: number): LaneView[] =>
  Array.from({ length: n }, (_, i) => lane(`lane-${String(i).padStart(2, "0")}`, { createdAt: new Date(Date.UTC(2026, 9, 1, i)).toISOString() }));

const reachable = (l: FloorLayout, to: Tile): boolean => findPath(l, l.door.entry, to) !== null;

describe("layoutFloor", () => {
  it("auto-places N lanes in two columns and grows the floor downwards", () => {
    const heights = [0, 1, 2, 3, 4, 5, 9, 12].map((n) => layoutFloor({ lanes: lanes(n) }).h);
    expect(heights[0]).toBe(heights[1]);
    expect(heights[1]).toBe(heights[2]); // 1 or 2 lanes: one row
    expect(heights[3]! - heights[2]!).toBe(9); // third lane starts a new row
    expect(heights[4]).toBe(heights[3]);
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]!);
    const l = layoutFloor({ lanes: lanes(5) });
    expect(l.w).toBe(FLOOR_W);
    expect(l.bays.map((b) => [b.col, b.row])).toEqual([[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]]);
  });

  it("keeps lane order stable when lane state changes", () => {
    const a = lanes(4);
    const b = a.map((l, i) => (i === 1 ? { ...l, state: "closed" as const, delivery: "proven" as const } : l));
    expect(orderLanes(a).map((l) => l.slug)).toEqual(orderLanes(b).map((l) => l.slug));
  });

  it("puts role lanes last and hides archived closed lanes", () => {
    const mixed = [lane("desk", { kind: "role", createdAt: "2026-01-01T00:00:00Z" }), lane("b"), lane("a", { createdAt: "2026-02-01T00:00:00Z" }), lane("gone", { state: "closed", archived: true })];
    expect(orderLanes(mixed).map((l) => l.slug)).toEqual(["a", "b", "desk"]);
  });

  it("gives every bay three desks that do not overlap and a delivery strip for work lanes only", () => {
    const l = layoutFloor({ lanes: [...lanes(3), lane("desk", { kind: "role" })] });
    const taken = new Set<string>();
    for (const bay of l.bays) {
      expect(bay.desks).toHaveLength(3);
      expect(bay.desks.filter((d) => d.main)).toHaveLength(1);
      for (const d of bay.desks) {
        for (let y = d.rect.y; y < d.rect.y + d.rect.h; y++) {
          for (let x = d.rect.x; x < d.rect.x + d.rect.w; x++) {
            const k = `${x},${y}`;
            expect(taken.has(k)).toBe(false);
            taken.add(k);
            expect(isWalkable(l, x, y)).toBe(false);
          }
        }
        expect(isWalkable(l, d.seat.x, d.seat.y)).toBe(true);
      }
      if (bay.lane.kind === "role") expect(bay.strip).toBeNull();
      else {
        expect(bay.pads.map((p) => p.stage)).toEqual(["landed", "deployed", "proven"]);
        for (const p of bay.pads) expect(rectContains(bay.strip!, p.rect.x, p.rect.y)).toBe(true);
      }
    }
  });

  it("makes every seat, stand spot, tray drop, queue spot and operator seat reachable from the door", () => {
    for (const n of [0, 1, 2, 3, 7, 12]) {
      const l = layoutFloor({ lanes: lanes(n) });
      for (const bay of l.bays) {
        for (const d of bay.desks) expect(reachable(l, d.seat), `${n} lanes: seat ${d.seat.x},${d.seat.y}`).toBe(true);
        for (const s of bay.stand) expect(reachable(l, s)).toBe(true);
      }
      for (const t of l.front.trays) expect(reachable(l, t.drop)).toBe(true);
      for (const s of l.front.seats) expect(reachable(l, s)).toBe(true);
      for (const s of l.front.stand) expect(reachable(l, s)).toBe(true);
      for (const q of l.queue) expect(reachable(l, q)).toBe(true);
    }
  });

  it("makes proposed pods impassable while everything else stays reachable", () => {
    const mixed = [...lanes(4), lane("idea-a", { state: "proposed", createdAt: "2026-10-02T00:00:00Z" }), lane("idea-b", { state: "proposed", createdAt: "2026-10-03T00:00:00Z" })];
    const l = layoutFloor({ lanes: mixed });
    const idea = l.bays.find((b) => b.lane.slug === "idea-a")!;
    for (const d of idea.desks) expect(isWalkable(l, d.seat.x, d.seat.y)).toBe(false);
    expect(isWalkable(l, idea.origin.x + 3, idea.origin.y + 3)).toBe(false); // the gap between desks
    expect(reachable(l, idea.stand[0]!)).toBe(true); // the aisle in front of it is still open
    for (const bay of l.bays.filter((b) => b.lane.state !== "proposed")) for (const d of bay.desks) expect(reachable(l, d.seat)).toBe(true);
    for (const t of l.front.trays) expect(reachable(l, t.drop)).toBe(true);
    for (const q of l.queue) expect(reachable(l, q)).toBe(true);
  });

  it("walls off the machine room and its racks, but not the lobby", () => {
    const l = layoutFloor({ lanes: lanes(2), rackSlots: 14 });
    expect(l.machine.racks).toHaveLength(14);
    for (const r of l.machine.racks) expect(isWalkable(l, r.rect.x, r.rect.y)).toBe(false);
    expect(findPath(l, l.door.entry, { x: l.machine.room.x + 1, y: l.machine.room.y + 6 })).toBeNull();
    expect(layoutFloor({ lanes: lanes(2) }).machine.racks).toHaveLength(7);
    expect(layoutFloor({ lanes: lanes(2), rackSlots: 99 }).machine.racks).toHaveLength(14);
  });

  it("places the door on the bottom wall and the spawn point inside it", () => {
    const l = layoutFloor({ lanes: lanes(2) });
    expect(l.door.rect.y).toBe(l.h - 1);
    expect(isWalkable(l, l.door.rect.x, l.door.rect.y)).toBe(true);
    expect(l.door.spawn.y).toBe((l.h - 1) * TILE);
  });
});

describe("findPath", () => {
  const open = { w: 5, h: 5, blocked: new Uint8Array(25) };

  it("finds a shortest 4-connected path", () => {
    const p = findPath(open, { x: 0, y: 0 }, { x: 4, y: 3 })!;
    expect(p).toHaveLength(7);
    expect(p.at(-1)).toEqual({ x: 4, y: 3 });
  });

  it("routes around walls and returns null when sealed off", () => {
    const wall = new Uint8Array(25);
    for (let y = 0; y < 4; y++) wall[y * 5 + 2] = 1;
    const detour = findPath({ w: 5, h: 5, blocked: wall }, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    expect(detour.some((t) => t.y === 4)).toBe(true);
    wall[4 * 5 + 2] = 1;
    expect(findPath({ w: 5, h: 5, blocked: wall }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull();
  });

  it("allows a blocked start or goal (a seat, the door) and handles trivial/invalid input", () => {
    const b = new Uint8Array(25);
    b[12] = 1;
    expect(findPath({ w: 5, h: 5, blocked: b }, { x: 0, y: 0 }, { x: 2, y: 2 })).not.toBeNull();
    expect(findPath(open, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
    expect(findPath(open, { x: -1, y: 0 }, { x: 1, y: 1 })).toBeNull();
    expect(findPath(open, { x: 0, y: 0 }, { x: 9, y: 9 })).toBeNull();
  });

  it("derives a facing from a step", () => {
    expect(dirBetween({ x: 1, y: 1 }, { x: 2, y: 1 })).toBe("right");
    expect(dirBetween({ x: 1, y: 1 }, { x: 0, y: 1 })).toBe("left");
    expect(dirBetween({ x: 1, y: 1 }, { x: 1, y: 0 })).toBe("up");
    expect(dirBetween({ x: 1, y: 1 }, { x: 1, y: 2 })).toBe("down");
  });
});

describe("assignSeats", () => {
  const bay = layoutFloor({ lanes: lanes(1) }).bays[0]!;
  const agent = (name: string, role: string, i = 0) => ({ name, role, createdAt: new Date(Date.UTC(2026, 9, 1, i)).toISOString() });

  it("gives the writer the main chair and everyone else the side chairs", () => {
    const seats = assignSeats(bay, [agent("hawk", "hawk", 0), agent("w", "worker", 5), agent("b", "boss", 1)]);
    expect(seats.get("w")?.seat).toEqual(bay.desks[1]!.seat);
    expect([...seats.values()].every((s) => s.sitting)).toBe(true);
    expect(new Set([...seats.values()].map((s) => `${s.seat.x},${s.seat.y}`)).size).toBe(3);
  });

  it("stands overflow agents in the aisle", () => {
    const seats = assignSeats(bay, ["a", "b", "c", "d", "e"].map((n, i) => agent(n, "worker", i)));
    const standing = [...seats.values()].filter((s) => !s.sitting);
    expect(standing).toHaveLength(2);
    expect(standing.every((s) => isWalkable(layoutFloor({ lanes: lanes(1) }), s.seat.x, s.seat.y))).toBe(true);
  });
});
