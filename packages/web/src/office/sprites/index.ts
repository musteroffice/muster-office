import { ProceduralSprites } from "./procedural";
import type { SpriteSet } from "./types";

let active: SpriteSet | null = null;

/** The sprite set the office draws with. Defaults to the procedural pixel art. */
export function getSpriteSet(): SpriteSet {
  active ??= new ProceduralSprites();
  return active;
}

/** Swap in another set (for example a PNG sprite sheet). Call before the first frame. */
export function setSpriteSet(set: SpriteSet): void {
  active = set;
}

export type { SpriteSet, Look, Pose, PropName } from "./types";
export { lookFor } from "./procedural";
