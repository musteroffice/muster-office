import type { AgentStateOrUnknown, AgentView, Thinking } from "@muster-office/shared";
import type { Dir, Tile } from "./layout";
import type { Look, Pose } from "./sprites/types";
import { C } from "./palette";
import type { Step } from "./transitions";

/** What an actor looks like when it is simply *in* a lifecycle state (no transition playing). */

export type Emote = "none" | "dots" | "bang" | "zzz" | "spinner" | "check" | "error" | "paper" | "stamp-mark" | "boot";

export interface Steady {
  /** The actor is physically in the office. */
  present: boolean;
  /** Sitting at the chair (otherwise standing at the seat/stand spot). */
  sits: boolean;
  /** Translucent "ghost" rendering and how solid it is. */
  ghost: false | { min: number; max: number };
  pose: "type" | "idle" | "slump" | "alert" | "stand";
  emote: Emote;
  /** The monitor light on the desk. */
  screen: "off" | "on" | "dim" | "error" | "blueprint";
  smoke: boolean;
  /** Short badge text drawn under the nametag (never colour-only). */
  badge: string;
  badgeColor: string;
}

const STEADY: Record<AgentStateOrUnknown, Steady> = {
  planned: { present: false, sits: false, ghost: false, pose: "idle", emote: "none", screen: "blueprint", smoke: false, badge: "PLANNED", badgeColor: C.gray },
  launching: { present: true, sits: true, ghost: false, pose: "idle", emote: "dots", screen: "dim", smoke: false, badge: "LAUNCH", badgeColor: C.blue },
  running: { present: true, sits: true, ghost: false, pose: "type", emote: "none", screen: "on", smoke: false, badge: "RUN", badgeColor: C.green },
  silent: { present: true, sits: true, ghost: false, pose: "slump", emote: "zzz", screen: "dim", smoke: false, badge: "SILENT", badgeColor: C.yellow },
  nudged: { present: true, sits: true, ghost: false, pose: "alert", emote: "bang", screen: "on", smoke: false, badge: "NUDGED", badgeColor: C.orange },
  restarted: { present: true, sits: true, ghost: false, pose: "type", emote: "boot", screen: "on", smoke: false, badge: "REBOOT", badgeColor: C.blue },
  reported: { present: true, sits: true, ghost: false, pose: "idle", emote: "paper", screen: "on", smoke: false, badge: "REPORT", badgeColor: C.blue },
  verified: { present: true, sits: true, ghost: false, pose: "idle", emote: "check", screen: "on", smoke: false, badge: "VERIFIED", badgeColor: C.green },
  landed: { present: true, sits: true, ghost: false, pose: "idle", emote: "check", screen: "on", smoke: false, badge: "LANDED", badgeColor: C.green },
  closed: { present: false, sits: false, ghost: false, pose: "stand", emote: "none", screen: "off", smoke: false, badge: "CLOSED", badgeColor: C.gray },
  interrupted: { present: true, sits: true, ghost: { min: 0.28, max: 0.5 }, pose: "idle", emote: "none", screen: "off", smoke: false, badge: "INTERRUPTED", badgeColor: C.yellow },
  restoring: { present: true, sits: true, ghost: { min: 0.35, max: 0.85 }, pose: "idle", emote: "none", screen: "dim", smoke: false, badge: "RESTORING", badgeColor: C.blue },
  failed: { present: true, sits: true, ghost: false, pose: "slump", emote: "error", screen: "error", smoke: true, badge: "FAILED", badgeColor: C.red },
  unknown: { present: true, sits: true, ghost: false, pose: "idle", emote: "none", screen: "dim", smoke: false, badge: "?", badgeColor: C.gray },
};

export function steadyFor(state: AgentStateOrUnknown): Steady {
  return STEADY[state];
}

/** `claude-bridge/claude-opus-5-5` → `OPUS5.5`, `openai-codex/gpt-6.1-sol` → `GPT6.1`. */
export function modelAbbrev(model: string): string {
  const base = (model.split("/").pop() ?? model).replace(/^claude-/, "");
  const letters = /^[a-z]+/i.exec(base)?.[0] ?? base.slice(0, 4);
  const nums = base.match(/\d+(?:\.\d+)?/g) ?? [];
  const version = nums.length >= 2 && !nums[0]!.includes(".") && !nums[1]!.includes(".") ? `${nums[0]}.${nums[1]}` : (nums[0] ?? "");
  return `${letters.slice(0, 5)}${version}`.toUpperCase();
}

const THINK_TAG: Record<Thinking, string> = { off: "OFF", minimal: "MIN", low: "LO", medium: "MED", high: "HI", xhigh: "XHI", max: "MAX" };

export function nametag(agent: Pick<AgentView, "name" | "model" | "thinking">): { name: string; model: string } {
  return { name: agent.name.toUpperCase().slice(0, 10), model: `${modelAbbrev(agent.model)}${agent.thinking ? `·${THINK_TAG[agent.thinking]}` : ""}`.slice(0, 12) };
}

export interface Actor {
  key: string;
  kind: "agent" | "visitor";
  project: string;
  name: string;
  agent: AgentView | null;
  look: Look;
  /** Feet position in pixels. */
  x: number;
  y: number;
  dir: Dir;
  /** Where this actor sits or stands at rest. */
  seat: Tile | null;
  sitting: boolean;
  /** Shown state (what the animation has reached). */
  shown: AgentStateOrUnknown;
  /** Desired state from the latest data. */
  target: AgentStateOrUnknown;
  visible: boolean;
  alpha: number;
  pose: Pose;
  emote: Emote;
  emoteUntil: number;
  /** Seconds since the actor entered its shown state. */
  stateAge: number;
  screen: Steady["screen"];
  smoke: boolean;
  carrying: boolean;
  /** Spin / reboot effect remaining (ms). */
  spin: number;
  /** Materialize effect remaining (ms). */
  materialize: number;
  /** Walk animation phase accumulator. */
  walkT: number;
  /** Random per-actor phase so animations are not in lockstep. */
  phase: number;
  /** Timeline of queued steps (filled by transitions). */
  script: Step[];
  stepT: number;
  /** Timed pose that overrides the steady one (stamping, handing over a packet…). */
  override: Pose | null;
  /** State reached at the end of the current script. */
  pendingTarget: AgentStateOrUnknown;
  /** The first state has been placed; later changes animate. */
  primed: boolean;
  /** Sort order for stable drawing. */
  order: number;
}
