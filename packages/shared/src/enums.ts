/**
 * Enumerations mirrored from pi-muster `src/domain.ts` and `src/machines.ts`.
 * Unknown values seen on disk are mapped to "unknown" by the decoders so a
 * newer Muster never crashes the office.
 */

export const ROLES = ["desk", "hawk", "boss", "worker", "judge"] as const;
export type Role = (typeof ROLES)[number];

export const AGENT_STATES = [
  "planned",
  "launching",
  "running",
  "silent",
  "nudged",
  "restarted",
  "reported",
  "verified",
  "landed",
  "closed",
  "interrupted",
  "restoring",
  "failed",
] as const;
export type AgentState = (typeof AGENT_STATES)[number];
export type AgentStateOrUnknown = AgentState | "unknown";

/** States with a live Pi process Muster expects to be working. */
export const PROCESS_STATES: readonly AgentState[] = [
  "launching",
  "running",
  "silent",
  "nudged",
  "restarted",
  "restoring",
];
export const LIVE_STATES: readonly AgentState[] = [
  ...PROCESS_STATES,
  "reported",
  "verified",
  "landed",
  "interrupted",
  "failed",
];

export const LANE_KINDS = ["work", "role", "retro"] as const;
export type LaneKind = (typeof LANE_KINDS)[number];

export const LANE_STATES = ["proposed", "open", "draining", "closed"] as const;
export type LaneState = (typeof LANE_STATES)[number];
export type LaneStateOrUnknown = LaneState | "unknown";

export const LANE_DELIVERY = ["none", "landed", "deployed", "proven", "waived"] as const;
export type LaneDelivery = (typeof LANE_DELIVERY)[number];

export const PROJECT_STATES = ["setup", "active", "reviewing", "archived"] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];
export type ProjectStateOrUnknown = ProjectState | "unknown";

export const PACKET_STATES = ["reported", "verified", "committed", "rejected", "no_changes"] as const;
export type PacketState = (typeof PACKET_STATES)[number];
export type PacketStateOrUnknown = PacketState | "unknown";
export const TERMINAL_PACKET_STATES: readonly PacketState[] = ["committed", "rejected", "no_changes"];

export const DESK_KINDS = ["decision", "approval", "blocked", "done", "fyi"] as const;
export type DeskKind = (typeof DESK_KINDS)[number];
export const OPEN_KINDS = ["blocked", "approval", "decision"] as const;
export type OpenKind = (typeof OPEN_KINDS)[number];
/** Blocked work costs the most per hour, then approvals, then decisions. */
export const KIND_RANK: Readonly<Record<OpenKind, number>> = { blocked: 0, approval: 1, decision: 2 };
/** Flame weights from the Switchboard: blocked/approval/decision = 3/2/1. */
export const KIND_WEIGHT: Readonly<Record<OpenKind, number>> = { blocked: 3, approval: 2, decision: 1 };

export const OWNER_KINDS = ["fyi", "progress", "done", "question", "blocked", "action"] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Thinking = (typeof THINKING_LEVELS)[number];

export const DEPLOY_LEVELS = [0, 1, 2, 3] as const;
export type DeployLevel = (typeof DEPLOY_LEVELS)[number];
export const DEPLOY_NAMES = ["locked", "prove", "ship-and-watch", "jfdi"] as const;

export const DEPLOY_RULES = [
  "customer-facing",
  "money",
  "outbound-sends",
  "irreversible",
  "shared-infra",
  "slow-rollback",
] as const;
export type DeployRule = (typeof DEPLOY_RULES)[number];
export const DEPLOY_RULE_CAPS: Readonly<Record<DeployRule, DeployLevel>> = {
  "customer-facing": 1,
  money: 1,
  "outbound-sends": 1,
  irreversible: 0,
  "shared-infra": 2,
  "slow-rollback": 1,
};

export const MODES = ["herdr-workflow", "rift-merge", "pr-merge"] as const;
export type Mode = (typeof MODES)[number];

export const HEAVY_STATES = ["running", "finished", "lost"] as const;
export type HeavyState = (typeof HEAVY_STATES)[number];

/** Known relay kinds; unknown strings are preserved by the decoder. */
export const RELAY_KINDS = [
  "packet_report",
  "desk_note",
  "desk_note_skipped_self",
  "watch_retired",
  "owner_note",
  "owner_digest",
] as const;
export type RelayKind = (typeof RELAY_KINDS)[number];

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
/** Muster's own `done-live` rule: committed work older than this predates live proof. */
export const DONE_LIVE_CUTOFF_MS = Date.parse("2026-10-05T04:14:03Z");
/** Highest catalog `writerSchemaVersion` this office was written against. */
export const KNOWN_WRITER_SCHEMA = 4;

export function isOneOf<T extends string | number>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v);
}
