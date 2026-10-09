import {
  AGENT_STATES,
  DEPLOY_LEVELS,
  DEPLOY_RULES,
  DONE_LIVE_CUTOFF_MS,
  KNOWN_WRITER_SCHEMA,
  LANE_DELIVERY,
  LANE_KINDS,
  LANE_STATES,
  MODES,
  PACKET_STATES,
  PROJECT_STATES,
  ROLES,
  THINKING_LEVELS,
  type DeployLevel,
  type LaneDelivery,
} from "../enums.js";
import type {
  AgentEventView,
  AgentView,
  CheckView,
  LaneDeliveryEntry,
  LaneView,
  PacketView,
  PolicyView,
  ProjectView,
} from "../view.js";
import {
  Issues,
  arr,
  basename,
  bool,
  clean,
  isRec,
  ms,
  num,
  numOrNull,
  pick,
  shortId,
  str,
  strOrNull,
  tryParse,
  type Rec,
} from "./util.js";

export interface AgentSession {
  agent: string;
  sessionId: string;
  owner: string;
}

export interface DecodedProject {
  /** `desk` and `owner` are empty here; the model fills them from the queues. */
  project: ProjectView;
  /** Server-side only. Never copied into a view. */
  sessions: AgentSession[];
  /** packet id -> report path as written in the catalog. Untrusted; server-side only. */
  reportPaths: Record<string, string>;
}

export type ProjectDecode = { ok: true; value: DecodedProject } | { ok: false; error: string };

const DEFAULT_WIP = 3;
const DEFAULT_STALL_MIN = 120;
const DEFAULT_LAND_WAIT_MIN = 30;
const DEFAULT_NUDGE_MIN = 30;
const DEFAULT_RESTART_MIN = 60;
const EVENTS_KEPT = 40;

function positive(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

export function decodePolicy(raw: unknown): PolicyView {
  const p: Rec = isRec(raw) ? raw : {};
  const wipRaw = p["wipLimit"];
  const restartRaw = p["restartAfterMin"];
  const nudge = positive(p["nudgeAfterMin"]) ?? DEFAULT_NUDGE_MIN;
  return {
    wipLimit: wipRaw === null ? null : (positive(wipRaw) ?? DEFAULT_WIP),
    flowStallMin: positive(p["flowStallMin"]) ?? DEFAULT_STALL_MIN,
    landWaitMin: positive(p["landWaitMin"]) ?? DEFAULT_LAND_WAIT_MIN,
    nudgeAfterMin: nudge,
    restartAfterMin: restartRaw === null ? null : Math.max(positive(restartRaw) ?? DEFAULT_RESTART_MIN, nudge),
    deployLevel: pick(DEPLOY_LEVELS, p["deployLevel"]) ?? null,
    comms: str(p["comms"], "intercom"),
  };
}

function decodeEvents(raw: unknown): AgentEventView[] {
  const out: AgentEventView[] = [];
  for (const e of arr(raw)) {
    if (!isRec(e)) continue;
    out.push({ type: clean(e["type"], 40), at: str(e["at"]), detail: clean(e["detail"], 200) });
  }
  return out.slice(-EVENTS_KEPT);
}

function decodeAgent(raw: unknown, issues: Issues, index: number): { view: AgentView; session: AgentSession } | null {
  if (!isRec(raw)) {
    issues.warn(`agents[${index}] is not an object; skipped`);
    return null;
  }
  const name = str(raw["name"]);
  const lane = str(raw["lane"]);
  if (!name || !lane) {
    issues.warn(`agents[${index}] lacks name/lane; skipped`);
    return null;
  }
  const profile = isRec(raw["profile"]) ? raw["profile"] : {};
  const stateRaw = raw["state"];
  const state = pick(AGENT_STATES, stateRaw);
  const side = isRec(raw["side"]) ? str(raw["side"]["parent"]) : "";
  const sessionId = str(raw["sessionId"]);
  const thinking = pick(THINKING_LEVELS, profile["thinking"]) ?? null;
  // Explicit allow-list: `profile.env`, `restore`, `cwd`, `pane`, session files are never copied.
  const view: AgentView = {
    name: clean(name, 32),
    role: pick(ROLES, raw["role"]) ?? "unknown",
    lane: clean(lane, 64),
    sideOf: side ? clean(side, 32) : null,
    label: clean(profile["label"], 80),
    model: clean(profile["model"], 80),
    thinking,
    state: state ?? "unknown",
    ...(state ? {} : { rawState: clean(stateRaw, 40) }),
    delivery: clean(raw["delivery"], 16) || "none",
    restarts: Math.max(0, Math.floor(num(raw["restarts"]))),
    machine: clean(raw["machine"], 40) || "local",
    sessionShort: shortId(sessionId, 8),
    createdAt: str(raw["createdAt"]),
    updatedAt: str(raw["updatedAt"]),
    events: decodeEvents(raw["events"]),
  };
  return { view, session: { agent: view.name, sessionId, owner: str(raw["owner"]) } };
}

function decodeDeliveryHistory(raw: unknown): LaneDeliveryEntry[] {
  const out: LaneDeliveryEntry[] = [];
  for (const e of arr(raw)) {
    if (!isRec(e)) continue;
    const stage = pick(LANE_DELIVERY, e["stage"]);
    if (!stage) continue;
    out.push({ stage, at: str(e["at"]), evidence: clean(e["evidence"], 300) });
  }
  return out;
}

interface RawPacketLite {
  lane: string;
  state: string;
  updatedAt: string;
}

/** Reproduces Muster's `Project` decode transform (done-live backfill) for lanes with no `delivery`. */
function backfillDelivery(
  slug: string,
  packets: readonly RawPacketLite[],
): { delivery: LaneDelivery; at: string | null; evidence: string | null; history: LaneDeliveryEntry[] } {
  const committed = packets.filter((p) => p.lane === slug && p.state === "committed");
  const times = committed.map((p) => ms(p.updatedAt)).filter((t) => t > 0);
  if (times.length === 0) return { delivery: "none", at: null, evidence: null, history: [] };
  const latest = Math.max(...times);
  const at = committed.find((p) => ms(p.updatedAt) === latest)?.updatedAt ?? new Date(latest).toISOString();
  const proven = latest < DONE_LIVE_CUTOFF_MS;
  const delivery: LaneDelivery = proven ? "proven" : "landed";
  const evidence = proven ? "before done-live" : "delivery record missing (written by an older Muster); not proven";
  return { delivery, at, evidence, history: [{ stage: delivery, at, evidence }] };
}

function decodeLane(raw: unknown, issues: Issues, index: number, packets: readonly RawPacketLite[]): LaneView | null {
  if (!isRec(raw)) {
    issues.warn(`lanes[${index}] is not an object; skipped`);
    return null;
  }
  const slug = str(raw["slug"]);
  if (!slug) {
    issues.warn(`lanes[${index}] lacks slug; skipped`);
    return null;
  }
  const stateRaw = raw["state"];
  const explicit = pick(LANE_DELIVERY, raw["delivery"]);
  const fill = explicit ? null : backfillDelivery(slug, packets);
  const deliveryAt = explicit ? strOrNull(raw["deliveryAt"]) : (fill?.at ?? null);
  const evidenceText = explicit
    ? raw["deliveryEvidence"] === undefined
      ? null
      : clean(raw["deliveryEvidence"], 400)
    : (fill?.evidence ?? null);
  // Muster falls back to a single entry built from deliveryAt when no history was ever recorded.
  const history: LaneDeliveryEntry[] = !explicit
    ? (fill?.history ?? [])
    : raw["deliveryHistory"] === undefined
      ? deliveryAt
        ? [{ stage: explicit, at: deliveryAt, evidence: evidenceText ?? "" }]
        : []
      : decodeDeliveryHistory(raw["deliveryHistory"]);
  return {
    slug: clean(slug, 64),
    kind: pick(LANE_KINDS, raw["kind"]) ?? "unknown",
    label: clean(raw["label"], 80) || slug,
    goal: clean(raw["goal"], 240),
    state: pick(LANE_STATES, stateRaw) ?? "unknown",
    delivery: explicit ?? fill?.delivery ?? "none",
    deliveryAt,
    deliveryEvidence: evidenceText,
    deliveryHistory: history,
    deployLevel: pick(DEPLOY_LEVELS, raw["deployLevel"]) ?? null,
    deployRule: pick(DEPLOY_RULES, raw["deployRule"]) ?? null,
    override: raw["override"] === undefined ? null : clean(raw["override"], 200),
    rank: numOrNull(raw["rank"]),
    archived: bool(raw["archived"]),
    discarded: bool(raw["discarded"]),
    openedAt: strOrNull(raw["openedAt"]),
    closedAt: strOrNull(raw["closedAt"]),
    createdAt: str(raw["createdAt"]),
    updatedAt: str(raw["updatedAt"]),
  };
}

function decodeChecks(raw: unknown): CheckView[] {
  const out: CheckView[] = [];
  for (const c of arr(raw)) {
    if (!isRec(c)) continue;
    const outcome = pick(["pass", "fail", "skip"] as const, c["outcome"]) ?? "unknown";
    const detail = c["detail"] === undefined ? undefined : clean(c["detail"], 160);
    out.push({ name: clean(c["name"], 80), outcome, ...(detail ? { detail } : {}) });
  }
  return out.slice(0, 40);
}

function decodePacket(raw: unknown, issues: Issues, index: number): PacketView | null {
  if (!isRec(raw)) {
    issues.warn(`packets[${index}] is not an object; skipped`);
    return null;
  }
  const id = str(raw["id"]);
  if (!id) {
    issues.warn(`packets[${index}] lacks id; skipped`);
    return null;
  }
  const verification = isRec(raw["verification"]) ? raw["verification"] : null;
  const gate = isRec(raw["gate"]) ? raw["gate"] : null;
  const report = strOrNull(raw["report"]);
  return {
    id: clean(id, 80),
    short: shortId(id, 12),
    kind: pick(["commit", "artifact"] as const, raw["kind"]) ?? "unknown",
    lane: clean(raw["lane"], 64),
    agent: clean(raw["agent"], 32),
    state: pick(PACKET_STATES, raw["state"]) ?? "unknown",
    reportedAt: str(raw["reportedAt"]),
    updatedAt: str(raw["updatedAt"]),
    landedAs: raw["landedAs"] === null || raw["landedAs"] === undefined ? null : clean(raw["landedAs"], 80),
    attested: bool(raw["attested"]),
    evidence: raw["evidence"] === undefined ? null : clean(raw["evidence"], 400),
    supersedes: strOrNull(raw["supersedes"]),
    checks: decodeChecks(raw["checks"]),
    gate: gate ? { host: clean(gate["host"], 60), durationMs: num(gate["durationMs"]) } : null,
    verifiedAt: verification ? strOrNull(verification["at"]) : null,
    reportName: report ? clean(basename(report), 120) : null,
  };
}

/** Decode the text of a `project.json`. Tolerates drift; fails only when no project can be identified. */
export function decodeProject(text: string): ProjectDecode {
  const raw = tryParse(text);
  if (raw === undefined) return { ok: false, error: "project.json is not valid JSON (partial write?)" };
  if (!isRec(raw)) return { ok: false, error: "project.json is not an object" };
  const slug = str(raw["slug"]);
  if (!slug) return { ok: false, error: "project.json has no slug" };

  const issues = new Issues();
  if (raw["version"] !== 1) issues.warn(`catalog version ${JSON.stringify(raw["version"])} is not 1; decoding best-effort`);
  const writer = raw["writerSchemaVersion"];
  if (typeof writer === "number" && writer > KNOWN_WRITER_SCHEMA) {
    issues.note(`written by newer Muster (schema ${writer} > ${KNOWN_WRITER_SCHEMA}); fields may be missing`);
  }

  const packetsRaw = Array.isArray(raw["packets"]) ? raw["packets"] : [];
  if (!Array.isArray(raw["packets"]) && raw["packets"] !== undefined) issues.warn("packets is not an array");
  const packetLite: RawPacketLite[] = packetsRaw.filter(isRec).map((p) => ({
    lane: str(p["lane"]),
    state: str(p["state"]),
    updatedAt: str(p["updatedAt"]),
  }));

  const lanes: LaneView[] = [];
  if (!Array.isArray(raw["lanes"])) issues.warn("lanes is not an array");
  arr(raw["lanes"]).forEach((l, i) => {
    const lane = decodeLane(l, issues, i, packetLite);
    if (lane) lanes.push(lane);
  });

  const agents: AgentView[] = [];
  const sessions: AgentSession[] = [];
  if (!Array.isArray(raw["agents"])) issues.warn("agents is not an array");
  arr(raw["agents"]).forEach((a, i) => {
    const d = decodeAgent(a, issues, i);
    if (d) {
      agents.push(d.view);
      sessions.push(d.session);
    }
  });

  const packets: PacketView[] = [];
  const reportPaths: Record<string, string> = {};
  packetsRaw.forEach((p, i) => {
    const d = decodePacket(p, issues, i);
    if (d) {
      packets.push(d);
      if (isRec(p) && typeof p["report"] === "string") reportPaths[d.id] = p["report"];
    }
  });

  const headline = raw["headline"];
  const project: ProjectView = {
    slug: clean(slug, 64),
    label: clean(raw["label"], 80) || slug,
    dir: clean(raw["dir"], 400),
    state: pick(PROJECT_STATES, raw["state"]) ?? "unknown",
    headline: typeof headline === "string" && headline.trim() ? clean(headline, 120) : null,
    nextAction: clean(raw["nextAction"], 200),
    outcome: clean(raw["outcome"], 300),
    mode: pick(MODES, raw["mode"]) ?? "unknown",
    policy: decodePolicy(raw["policy"]),
    deploy: { level: 1, source: "default", notes: [] },
    lanes,
    agents,
    packets,
    desk: [],
    owner: [],
    createdAt: str(raw["createdAt"]),
    updatedAt: str(raw["updatedAt"]),
    status: issues.issues.length > 0 ? "degraded" : "ok",
    issues: issues.issues,
    notes: issues.notes,
  };
  if (project.policy.deployLevel !== null) project.deploy = { level: project.policy.deployLevel as DeployLevel, source: "policy", notes: [] };
  return { ok: true, value: { project, sessions, reportPaths } };
}
