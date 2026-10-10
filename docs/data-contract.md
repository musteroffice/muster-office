# Data contract

Everything Automicvault reads, where it comes from, and what shape it has.
The source of truth is [`joelhooks/pi-muster`](https://github.com/joelhooks/pi-muster)
at commit `e415c70` (2026-10-09). File references below are to that repo.
Where this document and the task prompt disagreed, **the source won**; the
differences are listed at the end under [Differences from the brief](#differences-from-the-brief).

Automicvault is strictly read-only. It never writes, locks, renames or deletes
anything under a Muster path.

## 1. Path resolution

Muster has exactly one relocation knob for state: the home directory
(`process.env.HOME ?? os.homedir()`, e.g. `src/desk-feed-ext.ts:89`,
`src/switchboard-ext.ts:123`). There is no `XDG_*` support and no
`MUSTER_STATE_DIR`. The only other path overrides in the source are
`MUSTER_ROSTER` (roster, not consumed) and `MUSTER_DESK_REPORT_CSS` (not consumed).

| What | Path (relative to `home`) | Source |
| --- | --- | --- |
| Project registry | `.local/state/muster/projects.jsonl` | `src/registry.ts:14` |
| Project catalog | `<project.dir>/.brain/data/muster/project.json` | `src/store.ts:17-18` |
| Packet reports | `<project.dir>/.brain/data/muster/reports/<lane>/<agent>-<id12>.svx` (`.md` for old ones) | `src/ops.ts:696,3075` |
| VISION (deploy posture) | `<project.dir>/VISION.md` | `src/tokens.ts:74` |
| Desk queue | `.local/state/herdr-desk/<slug>.jsonl` | `src/desk.ts:14` |
| Owner queue | `.local/state/muster/owner-queue/<session>.jsonl` | `src/owner-queue.ts:23` |
| Heavy job record | `.local/state/muster/jobs/<uuid>.json` | `src/heavy-lock.ts:47-48` |
| Heavy sample cache | `.local/state/muster/jobs/samples.json` | `src/heavy-lock.ts:115` |
| Relay counters | `.local/state/muster/relay-events.jsonl` | `src/relay-events.ts:24` |

`home` resolves in this order in Automicvault: `--home <dir>` flag, then
`AUTOMICVAULT_HOME`, then `HOME`, then `os.homedir()`.

Files deliberately **not** read: `~/.config/muster/*` (roster, machines, network
config), `network-*` identity/peer files, `launches/`, `gates/`, `session-successors.jsonl`,
and every `*.reader`/`*.forward`/`*.comms-kick` sidecar next to the owner queues.
Those hold routing and identity material that the office does not need.

### Write/lock behaviour that matters to a reader

- `project.json` is written under a `<file>.lock` directory and replaced with an
  **atomic rename** of `<file>.<pid>.tmp` (`src/store.ts:59-76`). Watch the
  *directory*, not the inode, and tolerate a missing file for a moment.
- JSONL files are append-only, with torn trailing lines possible. A reader must
  only consume bytes up to the last `\n` (`src/switchboard.ts:95`,
  `src/owner-queue.ts` "ignore only malformed complete lines").
- `jobs/<id>.json` and `samples.json` are atomic JSON writes (temp + rename).
- Registry lines are appended only when a slug is new or moved; **newest wins per slug**
  (`readRegistry`, `src/registry.ts:23-36`); ephemeral projects are never registered.

## 2. Registry line (`projects.jsonl`)

```ts
{ slug: string; dir: string; spaceId: string | null; ts: string /* ISO */ }
```

Lines that fail `JSON.parse`, or lack string `slug`/`dir`, are skipped
(this is what Muster itself does).

## 3. `project.json` (the catalog)

`Project` = `ProjectFields` + the **done-live backfill transform** (`src/domain.ts:529-583`).
File format version is the literal `1`; `writerSchemaVersion` (optional int, currently `4`)
says which Muster wrote it and newer catalogs "remain readable".

```ts
Project {
  version: 1
  writerSchemaVersion?: int>=0
  slug: Slug                       // /^[a-z0-9][a-z0-9-]{0,63}$/
  label: string
  dir: string
  outcome: string
  reviewTrigger: string
  boardType: string                // default "project"
  criticalPath: string[]
  nextAction: string
  headline?: string | null         // sidebar headline; falls back to nextAction
  policy?: Policy
  mode: "herdr-workflow" | "rift-merge" | "pr-merge"
  spaceId: string | null
  sidebar: "owned" | "off"
  ephemeral: boolean
  musterExtension: string | null
  deskExtension: string | null
  cadenceMinutes: number | null
  state: "setup" | "active" | "reviewing" | "archived"
  lanes: Lane[]
  agents: AgentRow[]
  packets: Packet[]
  reviews: Review[]
  lastRetroAt?: ISO
  createdAt: ISO
  updatedAt: ISO
}
```

### Policy (`src/domain.ts:506-525`)

```ts
Policy {
  deployLevel?: 0|1|2|3
  wipLimit?: int>0 | null          // default 3; null disables the limit
  flowStallMin?: number>0          // default 120
  landWaitMin?: number>0           // default 30
  comms: "intercom" | "network"    // default "intercom"
  nudgeAfterMin?: number>0         // default 30
  restartAfterMin?: number>0 | null// default 60
  roles?: { desk?, hawk?, boss?, worker?, judge?: RolePolicy }
}
RolePolicy { model?, thinking?, compactAt?, noSkills?, skills? }
```

### Lane (`src/domain.ts:448-480`)

```ts
Lane {
  slug: Slug
  kind: "work" | "role" | "retro"
  label: string
  goal: string
  writeScope: string[]
  repo: string | null
  base: string | null              // default null
  generated: string[]
  tabId: string | null
  root: PaneBinding | null
  state: "proposed" | "open" | "draining" | "closed"
  closedAt?: ISO
  discarded?: boolean              // dropped from backlog, not finished work
  deployLevel?: 0|1|2|3            // per-lane override; only ever lowers
  deployRule?: "customer-facing"|"money"|"outbound-sends"|"irreversible"|"shared-infra"|"slow-rollback"
  delivery?: "none"|"landed"|"deployed"|"proven"|"waived"
  deliveryAt?: ISO
  deliveryEvidence?: string
  deliveryHistory?: { stage, at: ISO, evidence: string }[]
  override?: string                // Joel's words for a WIP override
  rank?: int
  openedAt?: ISO
  archived: boolean
  createdAt: ISO
  updatedAt: ISO
}
```

**Backfill** (`Project` transform): a lane with no `delivery` becomes `none` if it has no
committed packet; otherwise `proven` (evidence `before done-live`) when its newest committed
packet is older than `2026-10-05T04:14:03Z`, else `landed` (evidence
`delivery record missing (written by an older Muster); not proven`). Automicvault
reproduces this so old catalogs render the same way Muster shows them.

`DEPLOY_RULE_CAPS`: `customer-facing`/`money`/`outbound-sends`/`slow-rollback` ⇒ 1,
`irreversible` ⇒ 0, `shared-infra` ⇒ 2. Effective lane level =
`lane.deployLevel` if set and ≤ project level, else the project level
(`laneDeployLevel`, `src/tokens.ts:84`).

### AgentRow (`src/domain.ts:296-327`)

```ts
AgentRow {
  machine: string                  // default "local"
  intercomAddress?: string
  events?: { type: string; at: ISO; detail: string }[]
  name: AgentName                  // /^[a-z][a-z0-9_-]{0,31}$/
  role: "desk" | "hawk" | "boss" | "worker" | "judge"
  side: { parent: AgentName } | null   // design-only desk sharing its parent's lane
  lane: Slug
  cwd: string
  clone: { source, branch, base: {ref, sha} | null } | null
  profile: LaunchProfile           // label, model, thinking, env (!), skills, ...
  sessionId: SessionId
  sessionFile: string | null
  parentSessionFile: string | null
  pane: { paneId, terminalId, tabId, openedByMuster } | null
  owner: string
  brief: string | null
  state: AgentState
  delivery: "none" | "proven" | "unproven"   // first-turn delivery proof, NOT lane delivery
  restarts: number
  restore: { cwd, argv, env } | null
  createdAt: ISO
  updatedAt: ISO
}
LaunchProfile {
  label: string                    // "<emoji> <Callsign> · <role>" by convention
  model: string                    // e.g. "claude-bridge/claude-opus-5-5"
  thinking: "off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max" | null
  appendSystemPrompt: string[]; noSkills: boolean; skills: string[]; extensions: string[]
  env: Record<string,string>       // NEVER FORWARDED
  compactAt: int | null
}
```

> **Privacy:** `profile.env` and `restore.env` can hold tokens. The server's view
> mappers copy an explicit allow-list of fields and never spread a raw row. `cwd`,
> `sessionFile`, `pane`, `restore`, `clone.source` and `brief` paths are not forwarded.

`AgentState` (13 values, `src/domain.ts:188-202`):
`planned, launching, running, silent, nudged, restarted, reported, verified, landed, closed, interrupted, restoring, failed`.

Legal transitions (`src/machines.ts:100-121`), used to sanity-check demo data and the
animation planner:

```
planned      → launching | closed
launching    → running | failed | interrupted
running      → silent | running(restarted) | reported | interrupted | failed | closed
silent       → nudged | running | reported | interrupted | failed | closed
nudged       → restarted | running | reported | interrupted | failed | closed
restarted    → running | silent | reported | interrupted | failed | closed
reported     → reported | running | verified | landed | interrupted | closed
verified     → reported | landed | interrupted | running | closed
landed       → reported | interrupted | running | closed
interrupted  → launching | running | restoring | closed
restoring    → running | failed | interrupted
failed       → launching | restoring | running | closed
closed       → launching | restoring
```

`PROCESS_STATES` (a live Pi process is expected): `launching, running, silent, nudged, restarted, restoring`.
`LIVE_STATES`: process states + `reported, verified, landed, interrupted, failed`.

### Packet (`src/domain.ts:361-384`)

```ts
Packet {
  id: string                       // commit sha or sha256 of the artifact; "named by its hash"
  kind: "commit" | "artifact"
  lane: Slug
  agent: AgentName
  artifact: string | null
  report: string                   // path of the .svx/.md report
  checks: { name, outcome: "pass"|"fail"|"skip", detail? }[]
  state: "reported" | "verified" | "committed" | "rejected" | "no_changes"
  verification: { at, checks[] } | null
  landedAs: string | null
  attested?: boolean
  autolandCheckedAt?: ISO
  gate: { runId, host, tree, slot, durationMs, receipt } | null
  supersedes: string | null
  evidence?: string
  reportedAt: ISO
  updatedAt: ISO
}
```
Terminal packet states: `committed, rejected, no_changes`. A packet is *unlanded* otherwise.

### Reports

`reports/<lane>/<agent>-<id12>.svx` (MDsveX). Frontmatter keys: `title`, `packet`, `lane`.
Body sections: `# Packet …`, `## Summary`, `## Checks`, `## Deploy`, `## Live proof`,
`## Signals`, `## Notes`. Worker text is treated as **body** by the office: it is served
only on request (`GET /api/body?kind=report`) and only fetched by the UI after "show bodies".

## 4. Delivery, WIP and the flow line (derived, `src/tokens.ts`)

All derivations are pure functions in `packages/shared/src/derive/*` and are ported
one-for-one so the wall ticker prints exactly what Muster prints.

- `inFlight(project)`: lanes with `kind=work` and not (`delivery=deployed` and effective level ≥ 2),
  and (`state` is `open`/`draining`, **or** `state=closed` with `delivery` `landed`/`deployed`, archived or not).
- `backlog(project)`: `kind=work`, `state=proposed`, not archived, sorted by `rank` (unranked last) then `createdAt`.
- `openSlots` = `max(0, limit − inFlight)`; limit is `policy.wipLimit` (default 3, `null` = off).
- `flowLine` = `[⚠ not flowing · ]WIP n/limit · [k open · next: slug|backlog empty] · [retro: running slug] · landed, not live: <slug> <age>, … | none · [watching: …] · [oldest in flight <age>] · [last proven <age> ago] · [cycle <age>] · [n/wk]`
  - stalled ⇔ `inFlight > 0` and `now − max(lastMove, oldestCreatedAt) > flowStallMin` (default 120 min)
  - unlanded ⇔ any non-terminal packet reported more than `landWaitMin` (default 30 min) ago
  - `not flowing` ⇔ `stalled || unlanded`
  - age format: `<1m` → `now`, `Nm`, `Nh`, `Nd` (`formatAge`, `src/switchboard.ts:161`)
- Deploy posture level: `VISION.md` section wins over `policy.deployLevel`, default `1`.
  Section grammar: `## Deploy posture` then first line `Level: <0-3>[ (locked|prove|ship-and-watch|jfdi)]`
  (`decodeDeploySection`, `src/domain.ts:435`). Names: `0 locked, 1 prove, 2 ship-and-watch, 3 jfdi`.
  A malformed section is reported and falls back; a policy/VISION mismatch is noted.

## 5. Desk queue (`<slug>.jsonl`)

```ts
DeskItem {
  id: string; ts: ISO; from: string
  kind: "decision" | "approval" | "blocked" | "done" | "fyi"
  title: string
  body?: string                    // BODY: hidden by default
  refs?: string[]
  resolves?: string                // id of an earlier decision/approval/blocked item
}
```
*Open* items (`openDeskItems`, `src/tokens.ts:50`): `kind ∈ {decision, approval, blocked}` and no
later line has `resolves === item.id`. Rank (`src/switchboard.ts:20`): `blocked(0) < approval(1) < decision(2)`,
then oldest first. Flame weights from the README: blocked 3, approval 2, decision 1; logarithmic age adds height/heat.
Malformed or foreign lines are skipped. The file is a slug-named queue; **a queue may exist for a slug
that is not in the registry** (the Switchboard shows those too).

## 6. Owner queue (`owner-queue/<session>.jsonl`)

One file per *owner* session; each line is a `dev.muster.note.post` record
(`src/owner-lexicon.json`, `OwnerItem` in `src/domain.ts:122-139`):

```ts
OwnerItem {
  $type: "dev.muster.note.post"
  uri: string                      // muster://<author>/dev.muster.note.post/<tid>
  cid: string                      // 32 hex chars, truncated SHA-256 of canonical JSON
  author: SessionId                // the posting agent's session
  createdAt: ISO
  text: string                     // "[@<owner> ]<title>[\n<body>]"  (title ≤ 200 chars, body ≤ 4096 bytes)
  kind: "fyi" | "progress" | "done" | "question" | "blocked" | "action"
  project?: string                 // slug or directory; missing on legacy posts
  lane?: string
  refs?: string[]
  reply?: { root: {uri,cid}, parent: {uri,cid} }
  facets?: { index:{byteStart,byteEnd}, features:[{ $type: "dev.muster.note.facet#mention", did }] }[]
  delivery?: { status: "accepted"|"queued"|"delivered"|"acked"|"expired"|"failed", detail? }
  signed?: unknown
}
```
There is **no separate `title` field**: the title is the first line of `text` after stripping the
leading `@<session> ` mention prefix (`ownerPostText`, `src/owner-view.ts:56`); everything after the
first newline is the body. Legacy `delivery.status` values `sent→delivered`, `rejected|blocked|unavailable→failed`
are normalised on read (`decodeOwnerItem`). Sidecars next to the queue (`.reader`, `.forward`, `.comms-kick`) are ignored.
The author session is mapped to an agent name through the catalogs (`agents[].sessionId`).

## 7. muster-heavy jobs

`HeavyJob` (`src/domain.ts:17-31`), a union on `state`:

```ts
common { id: /^[a-f0-9-]{36}$/; host; repo; cwd; command; pid:int>0; startedAt: ISO; tmpdir?;
         cpuPercent; rssKB; peakRssKB; cpuSeconds; sampledAt: number | null }
{ state: "running" }
{ state: "finished"; exit: number; wallMs: number; finishedAt: ISO }
{ state: "lost"; exit: null; lost: true; wallMs: number; finishedAt: ISO }
```
`samples.json`: `{ sampledAt: number /* epoch ms */, jobs: { [id]: { cpuPercent, rssKB, peakRssKB, cpuSeconds } } }`,
refreshed at most every 5 s. For `running` jobs the office overlays the sample when its `sampledAt` is newer than
the job's own. `cpuPercent` is tree CPU and can exceed 100 (multi-core). A dead wrapper without an exit becomes `lost`
on the next Muster status pass, so a job can look `running` while its wrapper is gone; the office marks a running job
whose sample is older than 60 s as **stale**. Jobs are host-wide and keyed by `repo`, not by project slug; the office
maps a job to a project when `cwd` is inside `project.dir` or `repo === slug`.
The `command` is shown on hover **after secret redaction** (`redactCommand`).

## 8. Relay counters (`relay-events.jsonl`)

```ts
RelayEvent { ts: ISO; session: string; kind: RelayKind; project: string;
             packetId?; itemId?; noteKind?; woke?: boolean; path?: "queue"|"intercom"|"network"|"herdr-prompt"; itemCount?: number }
RelayKind = "packet_report" | "desk_note" | "desk_note_skipped_self" | "watch_retired" | "owner_note" | "owner_digest"
```
No bodies/titles/refs by construction (`relayEvent` projection, `src/relay-events.ts:22`). Unknown kinds are kept as strings.
The file is append-only and can grow; the office reads at most the trailing 4 MiB on first load and tails by byte offset after that.

## 9. Parsing rules shared by all readers

1. Strip nothing the source did not mandate; unknown fields are ignored, never an error.
2. A bad element never fails its container: a corrupt agent row skips that row, a corrupt line skips that line.
   Each skip adds an issue string and the project shows a **degraded** badge.
3. Unknown enum values are preserved as `"unknown"` (agent/lane/packet states) so the office still renders the entity.
4. Text is sanitised (ANSI escapes, C0/C1 controls and bidi overrides removed) and length-capped before it leaves the server.
5. Tailing resets (re-read from 0) when the `(dev, ino)` changes or the file shrinks.

## Differences from the brief

| Brief says | Source says |
| --- | --- |
| proposed lane is `open: false` | `Lane.state = "proposed"`; `open:false` is only a `lane_open` tool argument |
| desk queue ranked "blocked > approval > decision" | confirmed, and `done`/`fyi` are also valid kinds (never "open") |
| owner-queue records have titles | no `title` field; title = first line of `text` |
| relay kinds: `packet_report, desk_note, desk_note_skipped_self, watch_retired` | also `owner_note`, `owner_digest`; extra optional fields `noteKind`, `woke`, `path`, `itemCount` |
| agent "delivery" evidence | `AgentRow.delivery` is first-turn proof (`none/proven/unproven`); *lane* delivery is `none/landed/deployed/proven/waived` |
| "Packet carried by agents" | packets only name `lane` + `agent`; there is no "carried by" field |
| env overrides | only `HOME` relocates state; `MUSTER_ROSTER` exists but is not consumed |
| dead desk skull | Muster derives it from the live intercom session list, which is not on disk; the office approximates it from the catalog (no desk-role agent in a process state while items are open) |
| "agent state history" | `AgentRow.events[]` (`type, at, detail`) is the only per-agent history on disk |
| job → project | jobs carry `repo` and `cwd`, not a project slug |
