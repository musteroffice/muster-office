import type { Dir } from "../layout";

/**
 * The sprite contract. The office draws only through this interface, so the procedural
 * sprites can be replaced by a PNG sprite sheet (see `docs/sprites.md`) without touching the
 * engine: implement `SpriteSet`, then call `setSpriteSet()` at startup.
 */

export type Hat = "none" | "tophat" | "visor" | "wig" | "headset" | "beanie";

export interface Look {
  /** Stable key for caching. */
  id: string;
  role: string;
  skin: string;
  hair: string;
  shirt: string;
  accent: string;
  pants: string;
  hat: Hat;
}

export type Pose =
  | { kind: "stand"; dir: Dir }
  | { kind: "walk"; dir: Dir; frame: number }
  | { kind: "carry"; dir: Dir; frame: number }
  | { kind: "sit"; frame: 0 | 1 | 2 }
  | { kind: "slump" }
  | { kind: "alert" }
  | { kind: "stamp"; frame: 0 | 1 };

export type PropName =
  | "paper"
  | "blueprint"
  | "stamp"
  | "skull"
  | "check"
  | "bubble-bang"
  | "bubble-dots"
  | "spark"
  | "smoke"
  | "ghost-scan";

export interface SpriteSet {
  readonly name: string;
  /** Character frame size in pixels. The anchor is the bottom-centre of the frame. */
  readonly frame: { w: number; h: number };
  /** One character pose. The returned canvas is cached and must not be mutated. */
  character(look: Look, pose: Pose): HTMLCanvasElement;
  /** A small prop or effect sprite. `variant` selects an animation frame where relevant. */
  prop(name: PropName, variant?: number): HTMLCanvasElement;
  /** A flame of height tier 1..4, animation frame 0..3. */
  flame(tier: 1 | 2 | 3 | 4, frame: number): HTMLCanvasElement;
}
