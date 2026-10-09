import type {
  AgentStateOrUnknown,
  DeployLevel,
  DeployRule,
  DeskKind,
  HeavyState,
  LaneDelivery,
  LaneKind,
  LaneStateOrUnknown,
  Mode,
  OwnerKind,
  PacketStateOrUnknown,
  ProjectStateOrUnknown,
  Role,
  Thinking,
} from "./enums.js";

/**
 * View models: what the server sends to the browser. Every field is an explicit
 * allow-list copy of a decoded Muster record. Bodies (desk/owner/report text),
 * env vars, session files, pane ids and restore commands are never part of a view.
 */

export interface PolicyView {
  wipLimit: number | null;
  flowStallMin: number;
  landWaitMin: number;
  nudgeAfterMin: number;
  restartAfterMin: number | null;
  deployLevel: DeployLevel | null;
  comms: string;
}

export interface DeployPosture {
  level: DeployLevel;
  source: "VISION.md" | "policy" | "default";
  notes: string[];
}

export interface AgentEventView {
  type: string;
  at: string;
  detail: string;
}

export interface AgentView {
  name: string;
  role: Role | "unknown";
  lane: string;
  /** Parent agent name when this is a design-only side desk. */
  sideOf: string | null;
  /** Launch label by convention "<emoji> <Callsign> · <role>". */
  label: string;
  model: string;
  thinking: Thinking | null;
  state: AgentStateOrUnknown;
  /** The raw state string when `state === "unknown"`. */
  rawState?: string;
  /** First-turn proof of the launch prompt (not lane delivery). */
  delivery: string;
  restarts: number;
  machine: string;
  sessionShort: string;
  createdAt: string;
  updatedAt: string;
  /** Last 40 events, oldest first. */
  events: AgentEventView[];
}

export interface LaneDeliveryEntry {
  stage: LaneDelivery;
  at: string;
  evidence: string;
}

export interface LaneView {
  slug: string;
  kind: LaneKind | "unknown";
  label: string;
  goal: string;
  state: LaneStateOrUnknown;
  delivery: LaneDelivery;
  deliveryAt: string | null;
  deliveryEvidence: string | null;
  deliveryHistory: LaneDeliveryEntry[];
  /** Per-lane override (only ever lowers the project level). */
  deployLevel: DeployLevel | null;
  deployRule: DeployRule | null;
  override: string | null;
  rank: number | null;
  archived: boolean;
  discarded: boolean;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CheckView {
  name: string;
  outcome: "pass" | "fail" | "skip" | "unknown";
  detail?: string;
}

export interface PacketView {
  id: string;
  short: string;
  kind: "commit" | "artifact" | "unknown";
  lane: string;
  agent: string;
  state: PacketStateOrUnknown;
  reportedAt: string;
  updatedAt: string;
  landedAs: string | null;
  attested: boolean;
  evidence: string | null;
  supersedes: string | null;
  checks: CheckView[];
  gate: { host: string; durationMs: number } | null;
  verifiedAt: string | null;
  /** Basename of the report file, never its path. */
  reportName: string | null;
}

export interface DeskItemView {
  id: string;
  ts: string;
  from: string;
  kind: DeskKind;
  title: string;
  hasBody: boolean;
  refCount: number;
  resolves: string | null;
  /** Open = decision/approval/blocked with no later resolving line. */
  open: boolean;
  /** The id of the line that resolved this item, when any. */
  resolvedBy: string | null;
}

export interface OwnerNoteView {
  uri: string;
  id: string;
  ts: string;
  kind: OwnerKind | "unknown";
  /** Agent name when the author session resolves through a catalog, else a short session id. */
  author: string;
  title: string;
  hasBody: boolean;
  lane: string | null;
  replyTo: string | null;
  delivery: string | null;
}

export type ProjectStatus = "ok" | "degraded" | "missing" | "desk-only";

export interface ProjectView {
  slug: string;
  label: string;
  dir: string;
  state: ProjectStateOrUnknown;
  headline: string | null;
  nextAction: string;
  outcome: string;
  mode: Mode | "unknown";
  policy: PolicyView;
  deploy: DeployPosture;
  lanes: LaneView[];
  agents: AgentView[];
  packets: PacketView[];
  desk: DeskItemView[];
  owner: OwnerNoteView[];
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  /** Why the project is degraded or missing; empty when ok. */
  issues: string[];
  /** Non-degrading remarks (newer writer schema, etc.). */
  notes: string[];
}

export interface JobView {
  id: string;
  host: string;
  repo: string;
  /** Slug of the project this job belongs to, when it can be inferred. */
  project: string | null;
  /** Command with obvious secrets redacted and capped at 300 chars. */
  command: string;
  state: HeavyState;
  startedAt: string;
  finishedAt: string | null;
  cpuPercent: number;
  rssKB: number;
  peakRssKB: number;
  cpuSeconds: number;
  wallMs: number | null;
  exit: number | null;
  lost: boolean;
  sampledAt: number | null;
}

export interface RelayEventView {
  ts: string;
  kind: string;
  project: string;
  session: string;
  itemCount: number | null;
  path: string | null;
  woke: boolean | null;
  noteKind: string | null;
}

export interface RelayView {
  counts: Record<string, number>;
  /** Newest last; capped at 100. */
  recent: RelayEventView[];
}

export type TimelineKind = "agent" | "lane" | "delivery" | "packet" | "desk" | "owner" | "job" | "relay" | "system";
export type Severity = "info" | "ok" | "warn" | "error";

export interface TimelineEvent {
  /** Stable across snapshot seeding and live diffs, so merges dedupe. */
  id: string;
  /** Epoch ms of the underlying fact (not the time the server noticed). */
  ts: number;
  kind: TimelineKind;
  project: string | null;
  agent: string | null;
  lane: string | null;
  text: string;
  severity: Severity;
}

export interface HealthIssue {
  source: string;
  message: string;
}

export interface Snapshot {
  /** Monotonic diff sequence number this snapshot is current as of. */
  seq: number;
  /** Server clock when built (epoch ms). */
  now: number;
  demo: boolean;
  noColor: boolean;
  version: string;
  projects: ProjectView[];
  jobs: JobView[];
  relay: RelayView;
  /** Newest last. */
  timeline: TimelineEvent[];
  health: HealthIssue[];
}
