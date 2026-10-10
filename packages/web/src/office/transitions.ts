import type { AgentStateOrUnknown } from "@muster-office/shared";
import type { Actor, Emote } from "./actors";
import { steadyFor } from "./actors";
import { TILE, type Dir, type FloorLayout, type Tile } from "./layout";
import { dirBetween, findPath } from "./path";
import type { Pose } from "./sprites/types";

/**
 * Per-actor animation. A transition between two lifecycle states becomes a *script*: a list of
 * steps (walk, sit, hand a packet over, spin, fade…). `advance()` runs a script against a time
 * budget. If scripts pile up (a burst of events), `fastForward()` runs them instantly.
 */

export type Step =
  | { k: "wait"; ms: number }
  | { k: "walkTo"; to: Tile; speed?: number }
  | { k: "walk"; path: Tile[]; i: number; speed: number }
  | { k: "face"; dir: Dir }
  | { k: "sit" }
  | { k: "stand" }
  | { k: "pose"; pose: Pose; ms: number }
  | { k: "emote"; emote: Emote; ms: number }
  | { k: "set"; patch: Partial<Pick<Actor, "visible" | "alpha" | "carrying" | "x" | "y" | "dir" | "smoke" | "screen">> }
  | { k: "call"; fn: (env: Env) => void }
  | { k: "fade"; to: number; ms: number; from?: number }
  | { k: "spin"; ms: number }
  | { k: "materialize"; ms: number };

export interface Env {
  layout: FloorLayout;
  /** Tell the scene about something that happened (packet dropped, stamp, sparks…). */
  emit(event: SceneEvent): void;
}

export type SceneEvent =
  | { t: "drop-packet"; actor: Actor }
  | { t: "sparks"; x: number; y: number; n: number; color?: string }
  | { t: "stamp"; actor: Actor };

export const WALK_SPEED = 3.4; // tiles per second
const WALK_FPS = 9;

export const feet = (t: Tile, sitting: boolean): { x: number; y: number } => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + (sitting ? 14 : 15) });
export const tileOf = (a: { x: number; y: number }): Tile => ({ x: Math.floor(a.x / TILE), y: Math.floor((a.y - 1) / TILE) });

/** Rough duration of a script in ms (used to decide when to fast-forward). */
export function scriptDuration(script: readonly Step[], speed = WALK_SPEED): number {
  let ms = 0;
  for (const s of script) {
    switch (s.k) {
      case "wait":
      case "pose":
      case "emote":
      case "fade":
      case "spin":
      case "materialize":
        ms += s.ms;
        break;
      case "walk":
        ms += ((s.path.length - s.i) / (s.speed || speed)) * 1000;
        break;
      case "walkTo":
        ms += 6000; // unknown until planned: assume a long walk
        break;
      default:
        break;
    }
  }
  return ms;
}

/* ---------------------------------------------------------------- the planner */

export interface PlanCtx {
  layout: FloorLayout;
  /** Where the actor sits/stands at rest, or null when it has no place. */
  home: Tile | null;
  homeSitting: boolean;
  /** Drop tile in front of the packet tray. */
  packetDrop: Tile;
  doorEntry: Tile;
  doorSpawn: { x: number; y: number };
  /** Whether a human-visible walk is allowed (false: reduced motion or fast-forward). */
  walking: boolean;
}

const enter = (ctx: PlanCtx): Step[] => {
  if (!ctx.home) return [{ k: "set", patch: { visible: true, alpha: 1 } }];
  if (!ctx.walking) {
    const f = feet(ctx.home, ctx.homeSitting);
    return [{ k: "set", patch: { visible: true, alpha: 1, x: f.x, y: f.y } }, ...(ctx.homeSitting ? [{ k: "sit" } as Step] : [])];
  }
  return [
    { k: "set", patch: { visible: true, alpha: 1, x: ctx.doorSpawn.x, y: ctx.doorSpawn.y, dir: "up" } },
    { k: "walkTo", to: ctx.doorEntry },
    { k: "walkTo", to: ctx.home },
    ...(ctx.homeSitting ? [{ k: "sit" } as Step] : [{ k: "face", dir: "down" } as Step]),
  ];
};

const leave = (ctx: PlanCtx): Step[] => {
  if (!ctx.walking) return [{ k: "set", patch: { visible: false } }];
  return [
    { k: "stand" },
    { k: "walkTo", to: ctx.doorEntry },
    { k: "walkTo", to: { x: ctx.doorEntry.x, y: ctx.doorEntry.y + 1 } },
    { k: "fade", to: 0, ms: 260 },
    { k: "set", patch: { visible: false } },
  ];
};

const wasPresent = (s: AgentStateOrUnknown): boolean => steadyFor(s).present;

/**
 * Steps that take an actor from the shown state `from` to `to`. The steady appearance of `to`
 * (pose, emote, screen, smoke, ghost) is applied by the scene afterwards, so these steps only
 * describe the *motion* and one-off effects on the way there.
 */
export function planTransition(actor: Actor, from: AgentStateOrUnknown, to: AgentStateOrUnknown, ctx: PlanCtx): Step[] {
  const present = wasPresent(from);
  const goes = steadyFor(to);
  const steps: Step[] = [];

  // Appearing / disappearing.
  if (!goes.present) {
    if (present && actor.visible) steps.push(...leave(ctx));
    else steps.push({ k: "set", patch: { visible: false } });
    return steps;
  }
  if (!present || !actor.visible) {
    steps.push(...enter(ctx));
    if (to === "failed") steps.push({ k: "call", fn: () => undefined });
    if (to === "interrupted" || to === "restoring") steps.push({ k: "materialize", ms: 900 });
    return steps;
  }

  // Both present: motion depends on the destination.
  switch (to) {
    case "reported": {
      if (!ctx.home) break;
      if (ctx.walking) {
        steps.push(
          { k: "stand" },
          { k: "set", patch: { carrying: true } },
          { k: "walkTo", to: ctx.packetDrop },
          { k: "face", dir: "up" },
          { k: "pose", pose: { kind: "stand", dir: "up" }, ms: 380 },
          { k: "call", fn: (env) => env.emit({ t: "drop-packet", actor }) },
          { k: "set", patch: { carrying: false } },
          { k: "walkTo", to: ctx.home },
          { k: ctx.homeSitting ? "sit" : "face", dir: "down" } as Step,
        );
      } else {
        steps.push({ k: "call", fn: (env) => env.emit({ t: "drop-packet", actor }) });
      }
      break;
    }
    case "verified":
      steps.push({ k: "emote", emote: "check", ms: 900 });
      break;
    case "landed":
      steps.push({ k: "emote", emote: "check", ms: 900 });
      break;
    case "nudged":
      steps.push({ k: "pose", pose: { kind: "alert" }, ms: 700 }, { k: "emote", emote: "bang", ms: 1400 });
      break;
    case "restarted":
      steps.push({ k: "spin", ms: 1300 }, { k: "emote", emote: "boot", ms: 800 });
      break;
    case "failed":
      steps.push(
        { k: "pose", pose: { kind: "alert" }, ms: 350 },
        { k: "call", fn: (env) => env.emit({ t: "sparks", x: actor.x, y: actor.y - 14, n: 14, color: "#ff6b3a" }) },
      );
      break;
    case "interrupted":
      steps.push({ k: "fade", to: 0.4, ms: 500 });
      break;
    case "restoring":
      steps.push({ k: "materialize", ms: 1200 });
      break;
    case "running":
      if (from === "interrupted" || from === "restoring" || from === "failed") steps.push({ k: "fade", to: 1, ms: 600 });
      break;
    default:
      break;
  }
  return steps;
}

/* --------------------------------------------------------------- the executor */

export interface Runtime {
  env: Env;
}

/** Run a script for `dtMs`. Returns true while the actor is still busy. */
export function advance(a: Actor, dtMs: number, rt: Runtime): boolean {
  let budget = dtMs;
  let guard = 0;
  while (a.script.length > 0 && guard++ < 64) {
    const s = a.script[0]!;
    switch (s.k) {
      case "set":
        Object.assign(a, s.patch);
        a.script.shift();
        a.stepT = 0;
        break;
      case "call":
        s.fn(rt.env);
        a.script.shift();
        a.stepT = 0;
        break;
      case "face":
        a.dir = s.dir;
        a.script.shift();
        break;
      case "sit": {
        const t = tileOf(a);
        const f = feet(t, true);
        a.x = f.x;
        a.y = f.y;
        a.sitting = true;
        a.dir = "down";
        a.script.shift();
        break;
      }
      case "stand": {
        if (a.sitting) {
          const t = tileOf(a);
          const f = feet(t, false);
          a.x = f.x;
          a.y = f.y;
          a.sitting = false;
        }
        a.script.shift();
        break;
      }
      case "walkTo": {
        const from = tileOf(a);
        const path = findPath(rt.env.layout, from, s.to);
        if (path === null || path.length === 0) {
          const f = feet(s.to, false);
          a.x = f.x;
          a.y = f.y;
          a.script.shift();
        } else {
          a.script[0] = { k: "walk", path, i: 0, speed: s.speed ?? WALK_SPEED };
        }
        break;
      }
      case "walk": {
        if (a.sitting) a.sitting = false;
        let remaining = budget;
        while (remaining > 0 && s.i < s.path.length) {
          const target = feet(s.path[s.i]!, false);
          const dx = target.x - a.x;
          const dy = target.y - a.y;
          const dist = Math.hypot(dx, dy);
          const step = (s.speed * TILE * remaining) / 1000;
          a.dir = dirBetween({ x: 0, y: 0 }, { x: dx, y: dy });
          if (dist <= step) {
            a.x = target.x;
            a.y = target.y;
            remaining -= (dist / (s.speed * TILE)) * 1000;
            s.i++;
          } else {
            a.x += (dx / dist) * step;
            a.y += (dy / dist) * step;
            remaining = 0;
          }
        }
        a.walkT += (budget - remaining) / 1000;
        budget = remaining;
        if (s.i >= s.path.length) {
          a.script.shift();
          a.stepT = 0;
        } else {
          return true;
        }
        break;
      }
      case "wait":
      case "pose":
      case "emote":
      case "fade":
      case "spin":
      case "materialize": {
        if (s.k === "pose") a.override = s.pose;
        if (s.k === "emote") {
          a.emote = s.emote;
          a.emoteUntil = s.ms;
        }
        if (s.k === "fade" && a.stepT === 0 && s.from === undefined) s.from = a.alpha;
        const left = s.ms - a.stepT;
        const use = Math.min(left, budget);
        a.stepT += use;
        budget -= use;
        if (s.k === "fade") a.alpha = (s.from ?? a.alpha) + (s.to - (s.from ?? a.alpha)) * Math.min(1, a.stepT / Math.max(1, s.ms));
        if (s.k === "spin") a.spin = s.ms - a.stepT;
        if (s.k === "materialize") a.materialize = s.ms - a.stepT;
        if (a.stepT >= s.ms) {
          if (s.k === "pose") a.override = null;
          if (s.k === "spin") a.spin = 0;
          if (s.k === "materialize") a.materialize = 0;
          a.script.shift();
          a.stepT = 0;
        } else {
          return true;
        }
        break;
      }
    }
    if (budget <= 0 && a.script[0] && !isInstant(a.script[0])) return true;
  }
  return a.script.length > 0;
}

function isInstant(s: Step): boolean {
  return s.k === "set" || s.k === "call" || s.k === "face" || s.k === "sit" || s.k === "stand" || s.k === "walkTo";
}

/** Run everything left in the script right now, ending at the final resting place. */
export function fastForward(a: Actor, rt: Runtime): void {
  let guard = 0;
  while (a.script.length > 0 && guard++ < 200) advance(a, 1_000_000, rt);
  a.override = null;
  a.spin = 0;
  a.materialize = 0;
  a.stepT = 0;
}

export function walkFrame(a: Pick<Actor, "walkT">): number {
  return Math.floor(a.walkT * WALK_FPS) % 4;
}
