import { isWalkable, type FloorLayout, type Tile } from "./layout";

/** A* over the tile grid, 4-connected. Returns the tiles after `from` up to and including `to`, or null. */
export function findPath(layout: Pick<FloorLayout, "w" | "h" | "blocked">, from: Tile, to: Tile): Tile[] | null {
  const { w, h } = layout;
  const inb = (t: Tile): boolean => t.x >= 0 && t.y >= 0 && t.x < w && t.y < h;
  if (!inb(from) || !inb(to)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  // The start and goal may sit on a blocked tile (a seat, the door): they are still legal endpoints.
  const ok = (x: number, y: number): boolean => isWalkable(layout, x, y) || (x === to.x && y === to.y) || (x === from.x && y === from.y);
  const key = (x: number, y: number): number => y * w + x;
  const g = new Map<number, number>();
  const prev = new Map<number, number>();
  const open: Array<{ x: number; y: number; f: number }> = [{ ...from, f: 0 }];
  g.set(key(from.x, from.y), 0);
  const heur = (x: number, y: number): number => Math.abs(x - to.x) + Math.abs(y - to.y);
  const closed = new Set<number>();
  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[best]!.f) best = i;
    const cur = open.splice(best, 1)[0]!;
    const ck = key(cur.x, cur.y);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (cur.x === to.x && cur.y === to.y) {
      const path: Tile[] = [];
      let k = ck;
      while (k !== key(from.x, from.y)) {
        path.push({ x: k % w, y: Math.floor(k / w) });
        k = prev.get(k)!;
      }
      return path.reverse();
    }
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!inb({ x: nx, y: ny }) || !ok(nx, ny)) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const ng = (g.get(ck) ?? 0) + 1;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        prev.set(nk, ck);
        open.push({ x: nx, y: ny, f: ng + heur(nx, ny) });
      }
    }
  }
  return null;
}

/** Direction of travel between two adjacent tiles (or the nearest axis for a diagonal). */
export function dirBetween(a: { x: number; y: number }, b: { x: number; y: number }): "down" | "up" | "left" | "right" {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}
