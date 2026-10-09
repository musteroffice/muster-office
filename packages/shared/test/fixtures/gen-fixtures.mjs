// Generates fixtures that follow pi-muster's Schema exactly. Run: node gen-fixtures.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const iso = (m) => new Date(Date.parse("2026-10-09T12:00:00Z") + m * 60000).toISOString();
const profile = (label, model, thinking) => ({
  label,
  model,
  thinking,
  appendSystemPrompt: [],
  noSkills: true,
  skills: [],
  extensions: [],
  env: { ANTHROPIC_API_KEY: "sk-ant-SECRETSECRETSECRET1234567890", MUSTER_AGENT: "x" },
  compactAt: 200000,
});
const agent = (name, role, lane, state, label, model, thinking, extra = {}) => ({
  machine: "local",
  name,
  role,
  side: null,
  lane,
  cwd: `/home/dev/code/harbor-api/.clones/${name}`,
  clone: null,
  profile: profile(label, model, thinking),
  sessionId: `sess-${name}-0000000000`,
  sessionFile: `/home/dev/.pi/sessions/${name}.jsonl`,
  parentSessionFile: null,
  pane: { paneId: "p1", terminalId: "t1", tabId: "tab1", openedByMuster: true },
  owner: "sess-desk-0000000000",
  brief: "/home/dev/briefs/x.md",
  state,
  delivery: "proven",
  restarts: 0,
  restore: { cwd: "/x", argv: ["pi"], env: { OPENAI_API_KEY: "sk-live-RESTORESECRET00000000" } },
  createdAt: iso(-300),
  updatedAt: iso(-10),
  events: [{ type: "launch", at: iso(-290), detail: "launched" }],
  ...extra,
});
const lane = (slug, kind, state, extra = {}) => ({
  slug,
  kind,
  label: slug,
  goal: `goal of ${slug}`,
  writeScope: ["src/"],
  repo: null,
  base: null,
  generated: [],
  tabId: null,
  root: null,
  state,
  archived: false,
  createdAt: iso(-400),
  updatedAt: iso(-20),
  ...extra,
});
const packet = (id, laneSlug, agentName, state, extra = {}) => ({
  id,
  kind: "commit",
  lane: laneSlug,
  agent: agentName,
  artifact: null,
  report: `/home/dev/code/harbor-api/.brain/data/muster/reports/${laneSlug}/${agentName}-${id.slice(0, 12)}.svx`,
  checks: [{ name: "gate", outcome: "pass", detail: "ok" }],
  state,
  verification: null,
  landedAs: null,
  gate: null,
  supersedes: null,
  reportedAt: iso(-60),
  updatedAt: iso(-50),
  ...extra,
});
const project = {
  version: 1,
  writerSchemaVersion: 4,
  slug: "harbor-api",
  label: "Harbor API",
  dir: "/home/dev/code/harbor-api",
  outcome: "Ship the new auth flow",
  reviewTrigger: "weekly",
  boardType: "project",
  criticalPath: ["auth"],
  nextAction: "land auth-rework",
  headline: "Auth rework in flight",
  policy: { wipLimit: 3, comms: "intercom", deployLevel: 1 },
  mode: "herdr-workflow",
  spaceId: "space-1",
  sidebar: "owned",
  ephemeral: false,
  musterExtension: null,
  deskExtension: null,
  cadenceMinutes: 30,
  state: "active",
  lanes: [
    lane("auth-rework", "work", "open", {
      delivery: "landed",
      deliveryAt: iso(-50),
      deliveryEvidence: "merged abc",
      deliveryHistory: [{ stage: "landed", at: iso(-50), evidence: "merged abc" }],
      openedAt: iso(-380),
    }),
    lane("billing-sync", "work", "proposed", { rank: 1, delivery: "none" }),
    lane("desk", "role", "open", { delivery: "none" }),
  ],
  agents: [
    agent("desk", "desk", "desk", "running", "🐦 Yaffle · desk", "claude-bridge/claude-opus-5-5", "high"),
    agent("w-auth", "worker", "auth-rework", "reported", "🛠 Pico · worker", "openai-codex/gpt-6.1-sol", "medium"),
    agent("hawk-1", "hawk", "auth-rework", "silent", "🦅 Hawk · hawk", "claude-bridge/claude-opus-5-5", "high"),
  ],
  packets: [
    packet("a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0", "auth-rework", "w-auth", "committed", { landedAs: "abc1234" }),
  ],
  reviews: [],
  createdAt: iso(-500),
  updatedAt: iso(-5),
};
const w = (name, v) => writeFileSync(join(here, name), typeof v === "string" ? v : JSON.stringify(v, null, 2) + "\n");
w("project.valid.json", project);

// Corrupt rows: the rest of the catalog must survive.
const corrupt = structuredClone(project);
corrupt.agents.push({ role: "worker", lane: "auth-rework" }, "garbage");
corrupt.lanes.push(42);
w("project.corrupt-rows.json", corrupt);

// Partial write: cut mid-document.
w("project.truncated.json", JSON.stringify(project, null, 2).slice(0, 900));

// Schema drift: newer writer, unknown enum values, extra fields, missing optional ones.
const drift = structuredClone(project);
drift.writerSchemaVersion = 9;
drift.futureField = { a: 1 };
drift.agents[1].state = "teleporting";
drift.agents[1].newThing = true;
drift.lanes[0].state = "hibernating";
drift.packets[0].state = "weird";
delete drift.policy;
w("project.drift.json", drift);

// Old catalog: lanes without `delivery` -> done-live backfill.
const old = structuredClone(project);
for (const l of old.lanes) {
  delete l.delivery;
  delete l.deliveryAt;
  delete l.deliveryEvidence;
  delete l.deliveryHistory;
}
old.packets = [
  packet("0ld0ld0ld0ld", "auth-rework", "w-auth", "committed", { updatedAt: "2026-10-01T00:00:00.000Z" }),
  packet("n3wn3wn3wn3w", "billing-sync", "w-auth", "committed", { updatedAt: "2026-10-08T00:00:00.000Z" }),
];
old.lanes.push(lane("old-done", "work", "closed"));
old.packets.push(packet("0ld2", "old-done", "w-auth", "committed", { updatedAt: "2026-10-02T00:00:00.000Z" }));
w("project.old-delivery.json", old);

w(
  "registry.jsonl",
  [
    JSON.stringify({ slug: "harbor-api", dir: "/old/path", spaceId: null, ts: iso(-900) }),
    "{not json",
    JSON.stringify({ slug: "harbor-api", dir: "/home/dev/code/harbor-api", spaceId: "space-1", ts: iso(-500) }),
    JSON.stringify({ slug: "lantern-web", dir: "/home/dev/code/lantern-web", spaceId: null, ts: iso(-400) }),
    JSON.stringify({ slug: 5, dir: "x" }),
    "",
  ].join("\n"),
);

const desk = (id, m, kind, title, extra = {}) =>
  JSON.stringify({ id, ts: iso(m), from: "w-auth", kind, title, ...extra });
w(
  "desk.valid.jsonl",
  [
    desk("d1", -300, "blocked", "CI is red on main", { body: "SECRET BODY: stack trace ..." }),
    desk("d2", -200, "approval", "Approve schema migration"),
    desk("d3", -100, "decision", "Pick queue lib", { refs: ["a.ts:1"] }),
    desk("d4", -90, "done", "CI fixed", { resolves: "d1" }),
    desk("d5", -80, "fyi", "FYI nightly done"),
    "",
  ].join("\n"),
);
w(
  "desk.corrupt.jsonl",
  [
    desk("d1", -300, "blocked", "ok one"),
    "{broken",
    JSON.stringify({ id: "x", ts: iso(0), from: "a", kind: "nonsense", title: "t" }),
    JSON.stringify({ id: "y", ts: iso(0), from: "a", kind: "fyi" }),
    "[1,2,3]",
    desk("d2", -200, "decision", "ok two"),
    '{"id":"torn","ts":"2026',
  ].join("\n"),
);

const owner = (cid, m, kind, text, extra = {}) =>
  JSON.stringify({
    $type: "dev.muster.note.post",
    uri: `muster://sess-w-auth-0000000000/dev.muster.note.post/${cid}`,
    cid,
    author: "sess-w-auth-0000000000",
    createdAt: iso(m),
    text,
    kind,
    ...extra,
  });
w(
  "owner.valid.jsonl",
  [
    owner(
      "c0ffee00c0ffee00c0ffee00c0ffee00",
      -120,
      "question",
      "@sess-desk-0000000000 Which branch?\nlong BODY with details that must stay hidden",
      {
        project: "harbor-api",
        lane: "auth-rework",
        facets: [
          {
            index: { byteStart: 0, byteEnd: 22 },
            features: [{ $type: "dev.muster.note.facet#mention", did: "sess-desk-0000000000" }],
          },
        ],
      },
    ),
    owner("deadbeefdeadbeefdeadbeefdeadbeef", -100, "progress", "Halfway there", { delivery: { status: "sent" } }),
    "not json",
    JSON.stringify({ $type: "other.thing", uri: "u", cid: "c", author: "a", createdAt: iso(0), text: "t", kind: "fyi" }),
    "",
  ].join("\n"),
);

const job = (id, state, extra) => ({
  id,
  host: "box",
  repo: "harbor-api",
  cwd: "/home/dev/code/harbor-api",
  command: "npm test",
  pid: 4242,
  startedAt: iso(-30),
  cpuPercent: 0,
  rssKB: 0,
  peakRssKB: 0,
  cpuSeconds: 0,
  sampledAt: null,
  state,
  ...extra,
});
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
w(
  "job-running.json",
  job(ID1, "running", {
    cpuPercent: 40,
    rssKB: 1000,
    peakRssKB: 2000,
    cpuSeconds: 5,
    sampledAt: 1000,
    command:
      "TOKEN=abc123456789 curl -H 'Authorization: Bearer abcdefghijklmnop' https://user:hunter2@host/x --api-key=s3cret npm test",
  }),
);
w("job-finished.json", job(ID2, "finished", { exit: 0, wallMs: 60000, finishedAt: iso(-29), cpuSeconds: 30 }));
w("job-lost.json", job(ID3, "lost", { exit: null, lost: true, wallMs: 1000, finishedAt: iso(-20) }));
w("samples.json", {
  sampledAt: 5000,
  jobs: { [ID1]: { cpuPercent: 250, rssKB: 3000, peakRssKB: 4000, cpuSeconds: 9 }, "not-a-uuid": { cpuPercent: 1 } },
});

const relay = (m, kind, extra = {}) =>
  JSON.stringify({ ts: iso(m), session: "sess-desk-0000000000", kind, project: "harbor-api", ...extra });
w(
  "relay.valid.jsonl",
  [
    relay(-50, "packet_report", { packetId: "a1b2" }),
    relay(-40, "desk_note", { itemId: "d1", itemCount: 2, path: "queue", woke: true }),
    relay(-30, "owner_note", { noteKind: "question" }),
    relay(-20, "brand_new_kind"),
    "garbage",
    JSON.stringify({ nokind: true }),
    "",
  ].join("\n"),
);
w("vision.good.md", "# Vision\n\nstuff\n\n## Deploy posture\nLevel: 2 (ship-and-watch)\nRollback + watch.\n\n## Other\nx\n");
w("vision.bad.md", "# V\n## Deploy posture\nLevel: 7 (nope)\n");
console.log("fixtures written");
