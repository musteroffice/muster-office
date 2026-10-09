/**
 * The demo world: a pure function of (tick, cycleStart). Given the same tick it always
 * produces the same documents, so the simulator is deterministic and testable. Documents are
 * built in the exact shapes pi-muster writes, then handed to the same Sink the filesystem uses.
 *
 * One cycle is LOOP ticks. Over a cycle the world walks every agent lifecycle state, a stalled
 * flow, a failed agent, blocked desk items, a lost job, a dead desk and WIP-limit queueing.
 */

export const LOOP = 84;

type Track<T> = ReadonlyArray<readonly [number, T]>;

function at<T>(track: Track<T>, k: number): T {
  let v = track[0]![1];
  for (const [t, value] of track) {
    if (t <= k) v = value;
    else break;
  }
  return v;
}
/** Tick of the most recent transition at or before `k`, or -1 when the value is the baseline. */
function since<T>(track: Track<T>, k: number): number {
  let last = -1;
  track.forEach(([t], i) => {
    if (t <= k && (i > 0 || t > 0)) last = t;
  });
  return last;
}

export interface Clock {
  /** Wall-clock ms when the demo started. Historical records are anchored here so they age smoothly. */
  epoch: number;
  /** Wall-clock ms at tick 0 of the current cycle. Events inside a cycle are anchored here. */
  cycleStart: number;
  tickMs: number;
}

const MIN = 60_000;
const tickTime = (c: Clock, tick: number): number => c.cycleStart + tick * c.tickMs;
const isoAt = (ms: number): string => new Date(ms).toISOString();

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hex(seed: number, len: number): string {
  const r = mulberry32(seed);
  let s = "";
  while (s.length < len) s += Math.floor(r() * 16).toString(16);
  return s;
}
function uuid(seed: number): string {
  const h = hex(seed, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/* ------------------------------------------------------------------ definitions */

type S = string;
interface AgentDef {
  name: string;
  role: "desk" | "hawk" | "boss" | "worker" | "judge";
  lane: string;
  label: string;
  model: string;
  thinking: string | null;
  states: Track<S>;
  /** Hidden (no row) until this tick. */
  appearsAt?: number;
  events?: ReadonlyArray<readonly [number, string, string]>;
  restarts?: Track<number>;
}
interface LaneDef {
  slug: string;
  kind: "work" | "role" | "retro";
  goal: string;
  state: Track<S>;
  delivery?: Track<S>;
  evidence?: Partial<Record<string, string>>;
  createdMinAgo: number;
  deployLevel?: number;
  deployRule?: string;
  archived?: boolean;
  rank?: number;
  override?: string;
}
interface PacketDef {
  agent: string;
  lane: string;
  seed: number;
  /** Tick at which the packet is reported; a negative number places it that many minutes in the past. */
  reported: number;
  states: Track<S>;
  landedAs?: string;
}
interface DeskLine {
  tick: number;
  id: string;
  from: string;
  kind: "decision" | "approval" | "blocked" | "done" | "fyi";
  title: string;
  body?: string;
  resolves?: string;
  /** For baseline lines: minutes before the cycle started. */
  minutesAgo?: number;
}
interface OwnerLine {
  tick: number;
  author: string;
  kind: string;
  text: string;
  lane?: string;
}
interface ProjectDef {
  slug: string;
  label: string;
  headline: string;
  nextAction: string;
  outcome: string;
  wipLimit: number | null;
  deployLevel?: number;
  vision?: string;
  createdMinAgo: number;
  lanes: LaneDef[];
  agents: AgentDef[];
  packets: PacketDef[];
  desk: DeskLine[];
  owner: OwnerLine[];
  deskSession: string;
}

const OPUS = "claude-bridge/claude-opus-5-5";
const SOL = "openai-codex/gpt-6.1-sol";
const SONNET = "claude-bridge/claude-sonnet-5-5";

const harbor: ProjectDef = {
  slug: "harbor-api",
  label: "Harbor API",
  headline: "Auth rework shipping; billing sync next",
  nextAction: "land auth-rework",
  outcome: "Ship the new auth flow without a regression",
  wipLimit: 3,
  vision: "# Harbor API\n\n## Deploy posture\nLevel: 2 (ship-and-watch)\nGreen gate plus Rollback and Watch lines free the slot.\n",
  createdMinAgo: 60 * 24 * 9,
  deskSession: "demo-yaffle-session",
  lanes: [
    {
      slug: "auth-rework",
      kind: "work",
      goal: "Replace the session middleware with signed, rotating tokens",
      state: [[0, "open"], [30, "closed"], [72, "open"]],
      delivery: [[0, "none"], [12, "landed"], [20, "deployed"], [26, "proven"], [72, "none"]],
      evidence: {
        landed: "merged a1b2c3d to main; gate green",
        deployed: "live on prod. Rollback: revert a1b2c3d. Watch: 5xx rate on /auth",
        proven: "login + refresh checked on prod for 10 minutes",
      },
      createdMinAgo: 60 * 7,
    },
    { slug: "billing-sync", kind: "work", goal: "Nightly invoice sync with the ledger", state: [[0, "open"]], delivery: [[0, "none"], [48, "landed"]], evidence: { landed: "merged 7c9e1f2" }, createdMinAgo: 60 * 3 },
    { slug: "search-index", kind: "work", goal: "Incremental reindex instead of full rebuilds", state: [[0, "open"]], createdMinAgo: 60 * 2, deployRule: "shared-infra", deployLevel: 2 },
    { slug: "notify-queue", kind: "work", goal: "Move email sends to a durable queue", state: [[0, "proposed"], [22, "open"], [70, "proposed"]], rank: 1, createdMinAgo: 60 * 5 },
    { slug: "mail-templates", kind: "work", goal: "Template previews in review", state: [[0, "proposed"]], rank: 2, createdMinAgo: 60 * 4 },
    { slug: "desk", kind: "role", goal: "Operator desk, hawk and judge", state: [[0, "open"]], createdMinAgo: 60 * 24 * 9 },
  ],
  agents: [
    { name: "yaffle", role: "desk", lane: "desk", label: "🐦 Yaffle · desk", model: OPUS, thinking: "high", states: [[0, "running"]] },
    {
      name: "kestrel",
      role: "hawk",
      lane: "desk",
      label: "🦅 Kestrel · hawk",
      model: OPUS,
      thinking: "high",
      states: [[0, "running"], [10, "interrupted"], [15, "restoring"], [19, "running"]],
      events: [[10, "pane_gone", "pane vanished; marked interrupted"], [15, "restore", "restore requested"], [19, "started", "back at work"]],
    },
    { name: "solon", role: "judge", lane: "desk", label: "⚖️ Solon · judge", model: OPUS, thinking: "high", states: [[0, "running"], [76, "closed"], [80, "launching"], [82, "running"]] },
    {
      name: "ada",
      role: "worker",
      lane: "auth-rework",
      label: "🛠 Ada · worker",
      model: SOL,
      thinking: "medium",
      states: [[0, "running"], [6, "reported"], [9, "verified"], [12, "landed"], [18, "running"], [30, "closed"], [74, "launching"], [76, "running"]],
      events: [[6, "report", "packet reported to the desk"], [9, "verify", "packet verified"], [12, "land", "landed as a1b2c3d"], [30, "close", "lane closed"]],
    },
    { name: "boss-b", role: "boss", lane: "auth-rework", label: "🎩 Bea · boss", model: OPUS, thinking: "high", states: [[0, "running"], [30, "closed"], [74, "launching"], [76, "running"]] },
    {
      name: "bram",
      role: "worker",
      lane: "billing-sync",
      label: "🔧 Bram · worker",
      model: SOL,
      thinking: "medium",
      states: [[0, "planned"], [4, "launching"], [6, "running"], [15, "silent"], [19, "nudged"], [23, "restarted"], [26, "running"], [40, "reported"], [43, "verified"], [48, "landed"], [62, "closed"]],
      restarts: [[0, 0], [23, 1]],
      events: [[15, "silent", "no output for 30m"], [19, "nudge", "sent esc and a note"], [23, "restart", "/new plus re-prompt"], [40, "report", "packet reported to the desk"]],
    },
    {
      name: "cleo",
      role: "worker",
      lane: "search-index",
      label: "🔍 Cleo · worker",
      model: SOL,
      thinking: "high",
      states: [[0, "running"], [56, "silent"], [60, "nudged"], [64, "restarted"], [67, "running"]],
      restarts: [[0, 1], [64, 2]],
    },
    {
      name: "nova",
      role: "worker",
      lane: "notify-queue",
      label: "📬 Nova · worker",
      model: SONNET,
      thinking: "low",
      appearsAt: 22,
      states: [[22, "planned"], [24, "launching"], [26, "running"], [66, "closed"]],
    },
  ],
  packets: [
    { agent: "ada", lane: "auth-rework", seed: 11, reported: 6, states: [[6, "reported"], [9, "verified"], [12, "committed"], [72, "committed"]], landedAs: "a1b2c3d" },
    { agent: "bram", lane: "billing-sync", seed: 12, reported: 40, states: [[40, "reported"], [43, "verified"], [48, "committed"]], landedAs: "7c9e1f2" },
  ],
  desk: [
    { tick: -1, id: "h-0", from: "ada", kind: "approval", title: "Approve the prod schema migration", body: "Adds a nullable `rotated_at` column to sessions. Reversible.", minutesAgo: 95 },
    { tick: -1, id: "h-00", from: "kestrel", kind: "fyi", title: "Nightly dependency audit: clean", minutesAgo: 300 },
    { tick: 2, id: "h-1", from: "ada", kind: "decision", title: "bcrypt or argon2id for password hashes?", body: "argon2id costs ~40ms per hash on the prod class machine.\nbcrypt is already in the lockfile." },
    { tick: 13, id: "h-2", from: "bram", kind: "blocked", title: "CI is red on main: flaky auth e2e", body: "The retry test fails 1 in 4 runs since the rotation change." },
    { tick: 21, id: "h-3", from: "yaffle", kind: "done", title: "Quarantined the flaky test; main is green", resolves: "h-2" },
    { tick: 27, id: "h-4", from: "ada", kind: "approval", title: "Ship auth-rework behind the new flag?" },
    { tick: 33, id: "h-5", from: "yaffle", kind: "done", title: "argon2id it is", resolves: "h-1" },
    { tick: 41, id: "h-6", from: "yaffle", kind: "done", title: "Flag approved for 10%", resolves: "h-4" },
    { tick: 52, id: "h-7", from: "yaffle", kind: "done", title: "Migration approved", resolves: "h-0" },
  ],
  owner: [
    { tick: 3, author: "ada", kind: "progress", text: "Token rotation compiles and passes unit tests", lane: "auth-rework" },
    { tick: 5, author: "ada", kind: "question", text: "Should refresh tokens survive a password change?\nI would revoke them, but the mobile client assumes they survive.", lane: "auth-rework" },
    { tick: 11, author: "bram", kind: "fyi", text: "Ledger sandbox responds slowly after 18:00", lane: "billing-sync" },
    { tick: 31, author: "ada", kind: "done", text: "auth-rework closed; evidence recorded", lane: "auth-rework" },
  ],
};

const lantern: ProjectDef = {
  slug: "lantern-web",
  label: "Lantern Web",
  headline: "Checkout blocked on payments sandbox",
  nextAction: "unblock checkout-ui",
  outcome: "Checkout redesign live for 100% of users",
  wipLimit: 3,
  deployLevel: 1,
  createdMinAgo: 60 * 24 * 20,
  deskSession: "demo-wren-session",
  lanes: [
    { slug: "checkout-ui", kind: "work", goal: "Single-page checkout with saved cards", state: [[0, "open"]], deployLevel: 0, deployRule: "money", createdMinAgo: 60 * 4 },
    { slug: "i18n-pass", kind: "work", goal: "Extract strings and add de/fr", state: [[0, "open"]], delivery: [[0, "none"], [17, "landed"], [58, "proven"]], evidence: { landed: "merged 51aa90e", proven: "de and fr render on prod" }, createdMinAgo: 60 * 3 },
    { slug: "a11y-audit", kind: "work", goal: "Keyboard and screen-reader audit", state: [[0, "draining"], [30, "closed"]], delivery: [[0, "none"], [30, "waived"]], evidence: { waived: "report only, nothing to deploy" }, createdMinAgo: 60 * 6 },
    { slug: "design-tokens", kind: "work", goal: "Shared color and spacing tokens", state: [[0, "proposed"], [34, "open"], [78, "proposed"]], rank: 1, createdMinAgo: 60 * 8 },
    { slug: "desk", kind: "role", goal: "Operator desk", state: [[0, "open"]], createdMinAgo: 60 * 24 * 20 },
  ],
  agents: [
    { name: "wren", role: "desk", lane: "desk", label: "🪶 Wren · desk", model: OPUS, thinking: "high", states: [[0, "running"]] },
    {
      name: "dina",
      role: "worker",
      lane: "checkout-ui",
      label: "🎨 Dina · worker",
      model: SOL,
      thinking: "medium",
      states: [[0, "running"], [8, "failed"], [22, "restoring"], [26, "running"]],
      events: [[8, "launch_failed", "model error: 429 rate limited, retries exhausted"], [22, "restore", "restore requested by the desk"]],
    },
    {
      name: "eli",
      role: "worker",
      lane: "i18n-pass",
      label: "🌍 Eli · worker",
      model: SOL,
      thinking: "medium",
      states: [[0, "launching"], [2, "running"], [11, "reported"], [14, "verified"], [17, "landed"], [60, "closed"]],
    },
    { name: "finn", role: "worker", lane: "a11y-audit", label: "♿ Finn · worker", model: SOL, thinking: "low", states: [[0, "running"], [30, "closed"], [76, "launching"], [78, "running"]] },
    { name: "gus", role: "worker", lane: "design-tokens", label: "🧩 Gus · worker", model: SOL, thinking: "medium", appearsAt: 34, states: [[34, "planned"], [36, "launching"], [38, "running"], [76, "closed"]] },
  ],
  packets: [
    { agent: "dina", lane: "checkout-ui", seed: 21, reported: -50, states: [[0, "reported"], [56, "committed"], [80, "reported"]], landedAs: "c0ffee1" },
    { agent: "eli", lane: "i18n-pass", seed: 22, reported: 11, states: [[11, "reported"], [14, "verified"], [17, "committed"]], landedAs: "51aa90e" },
  ],
  desk: [
    { tick: -1, id: "l-0", from: "dina", kind: "blocked", title: "Payments sandbox key is missing", body: "Checkout cannot be exercised end to end without the sandbox key.", minutesAgo: 190 },
    { tick: 9, id: "l-1", from: "eli", kind: "decision", title: "Ship fr and de together or stagger?" },
    { tick: 30, id: "l-2", from: "finn", kind: "approval", title: "Close a11y-audit as waived?" },
    { tick: 36, id: "l-3", from: "wren", kind: "done", title: "Stagger: de first", resolves: "l-1" },
    { tick: 37, id: "l-4", from: "wren", kind: "done", title: "Waived", resolves: "l-2" },
    { tick: 58, id: "l-5", from: "wren", kind: "done", title: "Sandbox key delivered", resolves: "l-0" },
  ],
  owner: [
    { tick: 7, author: "dina", kind: "blocked", text: "Still no sandbox key; stopping here", lane: "checkout-ui" },
    { tick: 12, author: "eli", kind: "done", text: "i18n extraction merged", lane: "i18n-pass" },
  ],
};

const quarry: ProjectDef = {
  slug: "quarry-batch",
  label: "Quarry Batch",
  headline: "Nobody is home",
  nextAction: "restart the desk",
  outcome: "Nightly batch under 20 minutes",
  wipLimit: 2,
  deployLevel: 3,
  createdMinAgo: 60 * 24 * 40,
  deskSession: "demo-quinn-session",
  lanes: [
    { slug: "ingest", kind: "work", goal: "Streaming ingest", state: [[0, "closed"]], delivery: [[0, "proven"]], evidence: { proven: "ran a full night on prod" }, createdMinAgo: 60 * 24 * 10 },
    { slug: "compact", kind: "work", goal: "Online compaction", state: [[0, "proposed"]], rank: 1, createdMinAgo: 60 * 24 * 3 },
  ],
  agents: [{ name: "quinn", role: "desk", lane: "ingest", label: "🦉 Quinn · desk", model: OPUS, thinking: "high", states: [[0, "closed"]] }],
  packets: [],
  desk: [{ tick: -1, id: "q-0", from: "quinn", kind: "blocked", title: "Nightly compaction OOMs the box", minutesAgo: 60 * 7 }],
  owner: [],
};

export const PROJECTS: readonly ProjectDef[] = [harbor, lantern, quarry];

/* -------------------------------------------------------------------- jobs */

interface JobDef {
  seed: number;
  repo: string;
  project: string;
  command: string;
  start: number | null; // null: before the cycle
  startMinAgo?: number;
  end?: number;
  outcome?: "finished" | "lost";
  exit?: number;
  base: { cpu: number; rss: number };
}
const JOBS: readonly JobDef[] = [
  { seed: 101, repo: "harbor-api", project: "harbor-api", command: "npm test -- --runInBand", start: null, startMinAgo: 3, base: { cpu: 110, rss: 1_100_000 } },
  { seed: 102, repo: "lantern-web", project: "lantern-web", command: "pnpm exec playwright test --project=chromium", start: 5, end: 15, outcome: "finished", exit: 0, base: { cpu: 180, rss: 1_900_000 } },
  { seed: 103, repo: "harbor-api", project: "harbor-api", command: "cargo build --release", start: 10, end: 26, outcome: "lost", base: { cpu: 260, rss: 2_400_000 } },
  { seed: 104, repo: "quarry-batch", project: "quarry-batch", command: "muster-heavy gate -- sh -c 'npm run check'", start: null, startMinAgo: 40, end: -1, outcome: "finished", exit: 1, base: { cpu: 0, rss: 0 } },
  { seed: 105, repo: "harbor-api", project: "harbor-api", command: "npx tsc -b && npx vitest run", start: 40, end: 70, outcome: "finished", exit: 0, base: { cpu: 380, rss: 3_200_000 } },
];

/* ----------------------------------------------------------------- builders */

const ownerOf = (p: ProjectDef): string => p.deskSession;

function agentRow(p: ProjectDef, a: AgentDef, k: number, c: Clock): Record<string, unknown> {
  const state = at(a.states, k);
  const last = since(a.states, k);
  const created = c.epoch - p.createdMinAgo * MIN;
  const updated = last >= 0 ? tickTime(c, last) : c.epoch - 10 * MIN;
  const events = (a.events ?? []).filter(([t]) => t <= k).map(([t, type, detail]) => ({ type, at: isoAt(tickTime(c, t)), detail }));
  return {
    machine: "local",
    name: a.name,
    role: a.role,
    side: null,
    lane: a.lane,
    cwd: `/demo/${p.slug}/.clones/${a.name}`,
    clone: null,
    profile: {
      label: a.label,
      model: a.model,
      thinking: a.thinking,
      appendSystemPrompt: [],
      noSkills: a.role === "worker",
      skills: [],
      extensions: [],
      env: { MUSTER_ROLE: a.role },
      compactAt: 200000,
    },
    sessionId: `demo-${a.name}-session`,
    sessionFile: null,
    parentSessionFile: null,
    pane: null,
    owner: ownerOf(p),
    brief: null,
    state,
    delivery: "proven",
    restarts: a.restarts ? at(a.restarts, k) : 0,
    restore: null,
    createdAt: isoAt(created),
    updatedAt: isoAt(updated),
    ...(events.length ? { events } : {}),
  };
}

function laneRow(p: ProjectDef, l: LaneDef, k: number, c: Clock): Record<string, unknown> {
  const state = at(l.state, k);
  const stateSince = since(l.state, k);
  const delivery = l.delivery ? at(l.delivery, k) : "none";
  const history: Array<{ stage: string; at: string; evidence: string }> = [];
  if (l.delivery) {
    for (const [t, stage] of l.delivery) {
      if (t <= k && stage !== "none") {
        const when = t === 0 ? c.epoch - 120 * MIN : tickTime(c, t); // baseline history is old
        history.push({ stage, at: isoAt(when), evidence: l.evidence?.[stage] ?? "" });
      }
    }
  }
  // After the loop wraps back to "none", the history belongs to the previous cycle.
  const live = delivery === "none" ? [] : history;
  const lastEntry = live.at(-1);
  const created = c.epoch - l.createdMinAgo * MIN;
  return {
    slug: l.slug,
    kind: l.kind,
    label: l.slug,
    goal: l.goal,
    writeScope: ["src/"],
    repo: null,
    base: null,
    generated: [],
    tabId: null,
    root: null,
    state,
    archived: l.archived ?? false,
    ...(l.deployLevel !== undefined ? { deployLevel: l.deployLevel } : {}),
    ...(l.deployRule ? { deployRule: l.deployRule } : {}),
    ...(l.override ? { override: l.override } : {}),
    ...(l.rank !== undefined ? { rank: l.rank } : {}),
    delivery,
    ...(lastEntry ? { deliveryAt: lastEntry.at, deliveryEvidence: lastEntry.evidence } : {}),
    deliveryHistory: live,
    ...(state === "open" || state === "draining" ? { openedAt: isoAt(created + 20 * MIN) } : {}),
    ...(state === "closed" ? { closedAt: isoAt(stateSince >= 0 ? tickTime(c, stateSince) : created + 60 * MIN) } : {}),
    createdAt: isoAt(created),
    updatedAt: isoAt(stateSince >= 0 ? tickTime(c, stateSince) : c.epoch - 5 * MIN),
  };
}

function packetRow(p: ProjectDef, d: PacketDef, k: number, c: Clock): Record<string, unknown> | null {
  const firstTick = d.reported >= 0 ? d.reported : 0;
  if (k < firstTick) return null;
  const id = hex(d.seed, 40);
  const state = at(d.states, k);
  const reportedAt = d.reported >= 0 ? tickTime(c, d.reported) : c.epoch + d.reported * MIN;
  const last = since(d.states, k);
  return {
    id,
    kind: "commit",
    lane: d.lane,
    agent: d.agent,
    artifact: null,
    report: `/demo/${p.slug}/.brain/data/muster/reports/${d.lane}/${d.agent}-${id.slice(0, 12)}.svx`,
    checks: [
      { name: "typecheck", outcome: "pass" },
      { name: "unit tests", outcome: "pass", detail: "412 passed" },
      { name: "gate", outcome: state === "reported" ? "skip" : "pass", detail: state === "reported" ? "not run yet" : "fleet gate green" },
    ],
    state,
    verification: state === "reported" ? null : { at: isoAt(tickTime(c, Math.max(last, 0))), checks: [{ name: "gate", outcome: "pass" }] },
    landedAs: state === "committed" ? (d.landedAs ?? null) : null,
    gate: null,
    supersedes: null,
    reportedAt: isoAt(reportedAt),
    updatedAt: isoAt(last >= 0 ? tickTime(c, last) : reportedAt),
  };
}

export function projectDocument(p: ProjectDef, k: number, c: Clock): string {
  const lanes = p.lanes.map((l) => laneRow(p, l, k, c));
  const agents = p.agents.filter((a) => (a.appearsAt ?? 0) <= k).map((a) => agentRow(p, a, k, c));
  const packets = p.packets.map((d) => packetRow(p, d, k, c)).filter((x): x is Record<string, unknown> => x !== null);
  return JSON.stringify({
    version: 1,
    writerSchemaVersion: 4,
    slug: p.slug,
    label: p.label,
    dir: `/demo/${p.slug}`,
    outcome: p.outcome,
    reviewTrigger: "weekly",
    boardType: "project",
    criticalPath: [],
    nextAction: p.nextAction,
    headline: p.headline,
    policy: { wipLimit: p.wipLimit, comms: "intercom", ...(p.deployLevel !== undefined ? { deployLevel: p.deployLevel } : {}) },
    mode: "herdr-workflow",
    spaceId: null,
    sidebar: "owned",
    ephemeral: false,
    musterExtension: null,
    deskExtension: null,
    cadenceMinutes: 30,
    state: "active",
    lanes,
    agents,
    packets,
    reviews: [],
    createdAt: isoAt(c.epoch - p.createdMinAgo * MIN),
    updatedAt: isoAt(c.epoch - 2 * MIN),
  });
}

/** UTF-8 byte length without Buffer or TextEncoder (shared code runs in the browser too). */
function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

export function registryDocument(c: Clock): string {
  return (
    PROJECTS.map((p) => JSON.stringify({ slug: p.slug, dir: `/demo/${p.slug}`, spaceId: null, ts: isoAt(c.epoch - p.createdMinAgo * MIN) })).join("\n") + "\n"
  );
}

export function visionDocument(p: ProjectDef): string | null {
  return p.vision ?? null;
}

export function deskLines(p: ProjectDef, k: number, c: Clock): string[] {
  return p.desk
    .filter((d) => d.tick <= k)
    .map((d) => {
      const ts = d.tick < 0 ? c.epoch - (d.minutesAgo ?? 10) * MIN : tickTime(c, d.tick);
      return JSON.stringify({
        id: d.id,
        ts: isoAt(ts),
        from: d.from,
        kind: d.kind,
        title: d.title,
        ...(d.body ? { body: d.body } : {}),
        ...(d.resolves ? { resolves: d.resolves } : {}),
      });
    });
}

export function ownerLines(p: ProjectDef, k: number, c: Clock): string[] {
  return p.owner
    .filter((o) => o.tick <= k)
    .map((o, i) => {
      const cid = hex(p.slug.length * 1000 + o.tick * 10 + i, 32);
      const author = `demo-${o.author}-session`;
      const owner = ownerOf(p);
      const prefix = o.kind === "question" || o.kind === "blocked" ? `@${owner} ` : "";
      return JSON.stringify({
        $type: "dev.muster.note.post",
        uri: `muster://${author}/dev.muster.note.post/${cid.slice(0, 18)}`,
        cid,
        author,
        createdAt: isoAt(tickTime(c, o.tick)),
        text: `${prefix}${o.text}`,
        kind: o.kind,
        project: p.slug,
        ...(o.lane ? { lane: o.lane } : {}),
        ...(prefix
          ? { facets: [{ index: { byteStart: 0, byteEnd: utf8Length(prefix.trimEnd()) }, features: [{ $type: "dev.muster.note.facet#mention", did: owner }] }] }
          : {}),
      });
    });
}

export function relayLines(k: number, c: Clock): string[] {
  const out: Array<[number, string]> = [];
  for (const p of PROJECTS) {
    for (const d of p.desk) {
      if (d.tick >= 0 && d.tick <= k) {
        out.push([d.tick, JSON.stringify({ ts: isoAt(tickTime(c, d.tick)), session: ownerOf(p), kind: "desk_note", project: p.slug, itemId: d.id.slice(0, 8), itemCount: 1, path: "queue", woke: d.kind !== "fyi" })]);
      }
    }
    for (const d of p.packets) {
      if (d.reported >= 0 && d.reported <= k) {
        out.push([d.reported, JSON.stringify({ ts: isoAt(tickTime(c, d.reported)), session: `demo-${d.agent}-session`, kind: "packet_report", project: p.slug, packetId: hex(d.seed, 40).slice(0, 12) })]);
      }
    }
    for (const o of p.owner) {
      if (o.tick <= k) {
        out.push([o.tick, JSON.stringify({ ts: isoAt(tickTime(c, o.tick)), session: `demo-${o.author}-session`, kind: "owner_note", project: p.slug, noteKind: o.kind, path: "queue" })]);
      }
    }
  }
  return out.sort((a, b) => a[0] - b[0]).map(([, line]) => line);
}

export interface JobDocs {
  /** job id -> JSON text (only jobs that exist at tick k). */
  jobs: Map<string, string>;
  samples: string;
}

export function jobDocuments(k: number, c: Clock, nowMs: number): JobDocs {
  const jobs = new Map<string, string>();
  const samples: Record<string, { cpuPercent: number; rssKB: number; peakRssKB: number; cpuSeconds: number }> = {};
  for (const j of JOBS) {
    const id = uuid(j.seed);
    const startedMs = j.start === null ? c.epoch - (j.startMinAgo ?? 10) * MIN : tickTime(c, j.start);
    if (j.start !== null && k < j.start) continue;
    const endTick = j.end;
    const ended = endTick !== undefined && (endTick < 0 || k >= endTick);
    const rnd = mulberry32(j.seed * 31 + k);
    const wave = Math.sin((k + j.seed) / 3);
    const cpu = Math.max(1, Math.round(j.base.cpu * (0.75 + 0.25 * wave + rnd() * 0.2)));
    const rss = Math.round(j.base.rss * (0.85 + 0.15 * Math.sin((k + j.seed) / 7) + rnd() * 0.05));
    const peak = Math.round(j.base.rss * 1.1);
    const common = {
      id,
      host: "demo-host",
      repo: j.repo,
      cwd: `/demo/${j.project}`,
      command: j.command,
      pid: 4000 + (j.seed % 900),
      startedAt: isoAt(startedMs),
      cpuPercent: ended ? Math.round(j.base.cpu * 0.2) : cpu,
      rssKB: ended ? 0 : rss,
      peakRssKB: peak,
      cpuSeconds: Math.round(((nowMs - startedMs) / 1000) * (j.base.cpu / 100)),
      sampledAt: null,
    };
    if (!ended) {
      jobs.set(id, JSON.stringify({ ...common, cpuPercent: 0, rssKB: 0, state: "running" }));
      samples[id] = { cpuPercent: cpu, rssKB: rss, peakRssKB: peak, cpuSeconds: common.cpuSeconds };
    } else {
      const finishedMs = endTick !== undefined && endTick >= 0 ? tickTime(c, endTick) : c.epoch - 25 * MIN;
      if (j.outcome === "lost") {
        jobs.set(id, JSON.stringify({ ...common, state: "lost", exit: null, lost: true, wallMs: finishedMs - startedMs, finishedAt: isoAt(finishedMs) }));
      } else {
        jobs.set(id, JSON.stringify({ ...common, state: "finished", exit: j.exit ?? 0, wallMs: finishedMs - startedMs, finishedAt: isoAt(finishedMs) }));
      }
    }
  }
  return { jobs, samples: JSON.stringify({ sampledAt: nowMs, jobs: samples }) };
}

export function reportDocument(project: string, packetId: string): string | null {
  const p = PROJECTS.find((x) => x.slug === project);
  const d = p?.packets.find((x) => hex(x.seed, 40).startsWith(packetId.slice(0, 12)));
  if (!p || !d) return null;
  return [
    "---",
    `title: "Packet ${packetId.slice(0, 12)} from ${d.agent}"`,
    `packet: "${hex(d.seed, 40)}"`,
    `lane: "${d.lane}"`,
    "---",
    "",
    `# Packet ${packetId.slice(0, 12)} from ${d.agent}`,
    "",
    "## Summary",
    "",
    "Demo report text. In a real install this is the worker's own write-up; the office only shows it when you turn on *show bodies*.",
    "",
    "## Checks",
    "",
    "| Check | Outcome |",
    "| --- | --- |",
    "| typecheck | pass |",
    "| unit tests | pass |",
  ].join("\n");
}
