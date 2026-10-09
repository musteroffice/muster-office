import type { AgentStateOrUnknown, DeskKind, HeavyState } from "./enums.js";
import type {
  AgentView,
  DeskItemView,
  HealthIssue,
  JobView,
  LaneView,
  OwnerNoteView,
  PacketView,
  ProjectView,
  RelayView,
  Snapshot,
  TimelineEvent,
} from "./view.js";

/**
 * Wire protocol. The server sends one `snapshot` per connection, then `diff`
 * messages made of keyed upsert/delete ops. The same `applyOps` runs in the
 * server tests and in the browser store, so they cannot disagree.
 */

export type ProjectMeta = Omit<ProjectView, "lanes" | "agents" | "packets" | "desk" | "owner">;

export interface CollectionItems {
  lanes: LaneView;
  agents: AgentView;
  packets: PacketView;
  desk: DeskItemView;
  owner: OwnerNoteView;
}
export type CollectionName = keyof CollectionItems;

export const COLLECTIONS: readonly CollectionName[] = ["lanes", "agents", "packets", "desk", "owner"];

const KEY: { [C in CollectionName]: (item: CollectionItems[C]) => string } = {
  lanes: (i) => i.slug,
  agents: (i) => i.name,
  packets: (i) => i.id,
  desk: (i) => i.id,
  owner: (i) => i.uri,
};

export function keyOf<C extends CollectionName>(coll: C, item: CollectionItems[C]): string {
  return (KEY[coll] as (i: CollectionItems[C]) => string)(item);
}

export type Op =
  | { op: "project.put"; project: ProjectMeta }
  | { op: "project.del"; slug: string }
  | { [C in CollectionName]: { op: "put"; coll: C; project: string; item: CollectionItems[C] } }[CollectionName]
  | { op: "del"; coll: CollectionName; project: string; key: string }
  | { op: "job.put"; job: JobView }
  | { op: "job.del"; id: string }
  | { op: "relay"; relay: RelayView }
  | { op: "health"; health: HealthIssue[] };

export interface Diff {
  seq: number;
  now: number;
  ops: Op[];
  events: TimelineEvent[];
}

/** What changed, in terms the animation engine cares about. */
export type Change =
  | { t: "project"; slug: string; change: "added" | "removed" }
  | { t: "agent"; project: string; name: string; from: AgentStateOrUnknown | null; to: AgentStateOrUnknown | null; agent: AgentView | null }
  | {
      t: "lane";
      project: string;
      slug: string;
      from: { state: string; delivery: string } | null;
      to: { state: string; delivery: string } | null;
    }
  | { t: "packet"; project: string; id: string; lane: string; agent: string; from: string | null; to: string | null }
  | { t: "desk"; project: string; id: string; kind: DeskKind; change: "added" | "resolved" | "removed" }
  | { t: "job"; id: string; project: string | null; from: HeavyState | null; to: HeavyState | null };

export function splitProject(p: ProjectView): ProjectMeta {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { lanes, agents, packets, desk, owner, ...meta } = p;
  return meta;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  for (const k of ak) {
    if (!(k in bo) || !deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

function diffCollection<C extends CollectionName>(
  coll: C,
  project: string,
  prev: readonly CollectionItems[C][],
  next: readonly CollectionItems[C][],
  ops: Op[],
): void {
  const prevMap = new Map(prev.map((i) => [keyOf(coll, i), i] as const));
  const seen = new Set<string>();
  for (const item of next) {
    const k = keyOf(coll, item);
    seen.add(k);
    const old = prevMap.get(k);
    if (!old || !deepEqual(old, item)) ops.push({ op: "put", coll, project, item } as Op);
  }
  for (const k of prevMap.keys()) if (!seen.has(k)) ops.push({ op: "del", coll, project, key: k });
}

/** Ops that turn `prev` into `next`. Projects/jobs are keyed by slug/id. */
export function diffSnapshots(prev: Snapshot | null, next: Snapshot): Op[] {
  const ops: Op[] = [];
  const prevProjects = new Map((prev?.projects ?? []).map((p) => [p.slug, p] as const));
  const seen = new Set<string>();
  for (const p of next.projects) {
    seen.add(p.slug);
    const old = prevProjects.get(p.slug);
    if (!old || !deepEqual(splitProject(old), splitProject(p))) ops.push({ op: "project.put", project: splitProject(p) });
    for (const coll of COLLECTIONS) {
      diffCollection(coll, p.slug, (old?.[coll] ?? []) as never[], p[coll] as never[], ops);
    }
  }
  for (const slug of prevProjects.keys()) if (!seen.has(slug)) ops.push({ op: "project.del", slug });

  const prevJobs = new Map((prev?.jobs ?? []).map((j) => [j.id, j] as const));
  const seenJobs = new Set<string>();
  for (const job of next.jobs) {
    seenJobs.add(job.id);
    const old = prevJobs.get(job.id);
    if (!old || !deepEqual(old, job)) ops.push({ op: "job.put", job });
  }
  for (const id of prevJobs.keys()) if (!seenJobs.has(id)) ops.push({ op: "job.del", id });

  if (!prev || !deepEqual(prev.relay, next.relay)) ops.push({ op: "relay", relay: next.relay });
  if (!prev || !deepEqual(prev.health, next.health)) ops.push({ op: "health", health: next.health });
  return ops;
}

function emptyProject(meta: ProjectMeta): ProjectView {
  return { ...meta, lanes: [], agents: [], packets: [], desk: [], owner: [] };
}

function upsert<T>(list: readonly T[], keyFn: (i: T) => string, item: T): T[] {
  const k = keyFn(item);
  const i = list.findIndex((x) => keyFn(x) === k);
  if (i < 0) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

export interface ApplyResult {
  snapshot: Snapshot;
  changes: Change[];
}

/** Apply ops immutably. `meta` carries the new seq/now. */
export function applyOps(snap: Snapshot, ops: readonly Op[], meta: { seq: number; now: number }): ApplyResult {
  const projects = new Map(snap.projects.map((p) => [p.slug, p] as const));
  const order = snap.projects.map((p) => p.slug);
  let jobs = snap.jobs;
  let relay = snap.relay;
  let health = snap.health;
  const changes: Change[] = [];

  for (const op of ops) {
    switch (op.op) {
      case "project.put": {
        const old = projects.get(op.project.slug);
        if (!old) {
          order.push(op.project.slug);
          changes.push({ t: "project", slug: op.project.slug, change: "added" });
        }
        projects.set(op.project.slug, { ...(old ?? emptyProject(op.project)), ...op.project });
        break;
      }
      case "project.del": {
        projects.delete(op.slug);
        const i = order.indexOf(op.slug);
        if (i >= 0) order.splice(i, 1);
        changes.push({ t: "project", slug: op.slug, change: "removed" });
        break;
      }
      case "put": {
        const p = projects.get(op.project);
        if (!p) break;
        const next = putItem(p, op, changes);
        projects.set(op.project, next);
        break;
      }
      case "del": {
        const p = projects.get(op.project);
        if (!p) break;
        projects.set(op.project, delItem(p, op.coll, op.key, changes));
        break;
      }
      case "job.put": {
        const old = jobs.find((j) => j.id === op.job.id);
        if (!old || old.state !== op.job.state) {
          changes.push({ t: "job", id: op.job.id, project: op.job.project, from: old?.state ?? null, to: op.job.state });
        }
        jobs = upsert(jobs, (j) => j.id, op.job);
        break;
      }
      case "job.del": {
        const old = jobs.find((j) => j.id === op.id);
        if (old) changes.push({ t: "job", id: op.id, project: old.project, from: old.state, to: null });
        jobs = jobs.filter((j) => j.id !== op.id);
        break;
      }
      case "relay":
        relay = op.relay;
        break;
      case "health":
        health = op.health;
        break;
    }
  }

  const snapshot: Snapshot = {
    ...snap,
    seq: meta.seq,
    now: meta.now,
    projects: order.map((slug) => projects.get(slug)).filter((p): p is ProjectView => p !== undefined),
    jobs,
    relay,
    health,
  };
  return { snapshot, changes };
}

function putItem(p: ProjectView, op: Extract<Op, { op: "put" }>, changes: Change[]): ProjectView {
  switch (op.coll) {
    case "agents": {
      const item = op.item as AgentView;
      const old = p.agents.find((a) => a.name === item.name);
      if (!old || old.state !== item.state) {
        changes.push({ t: "agent", project: p.slug, name: item.name, from: old?.state ?? null, to: item.state, agent: item });
      }
      return { ...p, agents: upsert(p.agents, (a) => a.name, item) };
    }
    case "lanes": {
      const item = op.item as LaneView;
      const old = p.lanes.find((l) => l.slug === item.slug);
      if (!old || old.state !== item.state || old.delivery !== item.delivery) {
        changes.push({
          t: "lane",
          project: p.slug,
          slug: item.slug,
          from: old ? { state: old.state, delivery: old.delivery } : null,
          to: { state: item.state, delivery: item.delivery },
        });
      }
      return { ...p, lanes: upsert(p.lanes, (l) => l.slug, item) };
    }
    case "packets": {
      const item = op.item as PacketView;
      const old = p.packets.find((x) => x.id === item.id);
      if (!old || old.state !== item.state) {
        changes.push({ t: "packet", project: p.slug, id: item.id, lane: item.lane, agent: item.agent, from: old?.state ?? null, to: item.state });
      }
      return { ...p, packets: upsert(p.packets, (x) => x.id, item) };
    }
    case "desk": {
      const item = op.item as DeskItemView;
      const old = p.desk.find((d) => d.id === item.id);
      if (!old) changes.push({ t: "desk", project: p.slug, id: item.id, kind: item.kind, change: "added" });
      else if (old.open && !item.open) changes.push({ t: "desk", project: p.slug, id: item.id, kind: item.kind, change: "resolved" });
      return { ...p, desk: upsert(p.desk, (d) => d.id, item) };
    }
    case "owner": {
      const item = op.item as OwnerNoteView;
      return { ...p, owner: upsert(p.owner, (o) => o.uri, item) };
    }
  }
}

function delItem(p: ProjectView, coll: CollectionName, key: string, changes: Change[]): ProjectView {
  switch (coll) {
    case "agents": {
      const old = p.agents.find((a) => a.name === key);
      if (old) changes.push({ t: "agent", project: p.slug, name: key, from: old.state, to: null, agent: null });
      return { ...p, agents: p.agents.filter((a) => a.name !== key) };
    }
    case "lanes": {
      const old = p.lanes.find((l) => l.slug === key);
      if (old) changes.push({ t: "lane", project: p.slug, slug: key, from: { state: old.state, delivery: old.delivery }, to: null });
      return { ...p, lanes: p.lanes.filter((l) => l.slug !== key) };
    }
    case "packets": {
      const old = p.packets.find((x) => x.id === key);
      if (old) changes.push({ t: "packet", project: p.slug, id: key, lane: old.lane, agent: old.agent, from: old.state, to: null });
      return { ...p, packets: p.packets.filter((x) => x.id !== key) };
    }
    case "desk": {
      const old = p.desk.find((d) => d.id === key);
      if (old) changes.push({ t: "desk", project: p.slug, id: key, kind: old.kind, change: "removed" });
      return { ...p, desk: p.desk.filter((d) => d.id !== key) };
    }
    case "owner":
      return { ...p, owner: p.owner.filter((o) => o.uri !== key) };
  }
}

/** Merge new timeline events into an existing list (deduped by id, sorted oldest→newest, capped). */
export function mergeTimeline(list: readonly TimelineEvent[], incoming: readonly TimelineEvent[], cap = 500): TimelineEvent[] {
  if (incoming.length === 0) return list as TimelineEvent[];
  const byId = new Map(list.map((e) => [e.id, e] as const));
  for (const e of incoming) byId.set(e.id, e);
  const merged = [...byId.values()].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

export type ServerMessage =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "diff"; diff: Diff };
