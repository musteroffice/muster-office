import type { AgentStateOrUnknown, DeskKind, LaneDelivery, OpenKind, Role } from "@muster-office/shared";

/** Presentation metadata shared by the Board, the side panel and the canvas badges. */
export type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "ghost";

export interface StateMeta {
  glyph: string;
  label: string;
  tone: Tone;
  /** One-line description for tooltips and the screen-reader log. */
  what: string;
}

export const STATE_META: Record<AgentStateOrUnknown, StateMeta> = {
  planned: { glyph: "◌", label: "planned", tone: "ghost", what: "Row exists; no process yet (empty chair, blueprint on the desk)" },
  launching: { glyph: "→", label: "launching", tone: "info", what: "Walking in; the pane is starting" },
  running: { glyph: "▶", label: "running", tone: "ok", what: "Working at the desk" },
  silent: { glyph: "z", label: "silent", tone: "warn", what: "No output for the nudge window" },
  nudged: { glyph: "!", label: "nudged", tone: "warn", what: "Owner sent a nudge" },
  restarted: { glyph: "↻", label: "restarted", tone: "info", what: "Restarted with /new and a re-prompt" },
  reported: { glyph: "▤", label: "reported", tone: "info", what: "Reported a packet to the desk" },
  verified: { glyph: "✔", label: "verified", tone: "ok", what: "Packet verified" },
  landed: { glyph: "⇥", label: "landed", tone: "ok", what: "Packet landed on the conveyor" },
  closed: { glyph: "×", label: "closed", tone: "ghost", what: "Left the office" },
  interrupted: { glyph: "≈", label: "interrupted", tone: "warn", what: "Pane gone; ghosted" },
  restoring: { glyph: "◐", label: "restoring", tone: "info", what: "Materialising back" },
  failed: { glyph: "✖", label: "failed", tone: "bad", what: "Launch or run failed" },
  unknown: { glyph: "?", label: "unknown", tone: "neutral", what: "A state this office does not know" },
};

export const ROLE_META: Record<Role | "unknown", { label: string; glyph: string }> = {
  worker: { label: "worker", glyph: "W" },
  boss: { label: "boss", glyph: "B" },
  hawk: { label: "hawk", glyph: "H" },
  judge: { label: "judge", glyph: "J" },
  desk: { label: "desk operator", glyph: "D" },
  unknown: { label: "unknown role", glyph: "?" },
};

export const DESK_KIND_META: Record<DeskKind, { glyph: string; label: string; tone: Tone }> = {
  blocked: { glyph: "⛔", label: "blocked", tone: "bad" },
  approval: { glyph: "✅", label: "approval", tone: "warn" },
  decision: { glyph: "❓", label: "decision", tone: "warn" },
  done: { glyph: "🏁", label: "done", tone: "ok" },
  fyi: { glyph: "📎", label: "fyi", tone: "neutral" },
};

export const OPEN_KIND_ORDER: readonly OpenKind[] = ["blocked", "approval", "decision"];

export const DELIVERY_STAGES: ReadonlyArray<{ stage: LaneDelivery; label: string }> = [
  { stage: "landed", label: "Landed" },
  { stage: "deployed", label: "Deployed" },
  { stage: "proven", label: "Proven" },
  { stage: "waived", label: "Waived" },
];

export const DEPLOY_LEVEL_META = [
  { name: "locked", gloss: "needs a resolved approval desk item" },
  { name: "prove", gloss: "green gate; live proof frees the slot" },
  { name: "ship-and-watch", gloss: "green gate + Rollback and Watch lines; deploy frees the slot" },
  { name: "jfdi", gloss: "green gate + Rollback line; no proof step" },
] as const;

export const RULE_LABEL: Record<string, string> = {
  "customer-facing": "customer-facing work caps at level 1",
  money: "money caps at level 1",
  "outbound-sends": "outbound sends cap at level 1",
  irreversible: "irreversible work caps at level 0",
  "shared-infra": "shared infrastructure caps at level 2",
  "slow-rollback": "slow rollback caps at level 1",
};
