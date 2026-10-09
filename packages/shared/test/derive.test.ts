import { describe, expect, it } from "vitest";
import {
  applyOps,
  backlog,
  buildDeskViews,
  deepEqual,
  deriveEvents,
  deskPiles,
  diffSnapshots,
  flowInfo,
  flowLine,
  formatAge,
  inFlight,
  isDeadDesk,
  laneDeployLevel,
  mergeTimeline,
  openSlots,
  rankOpen,
  seedTimeline,
  type AgentView,
  type JobView,
  type ProjectView,
} from "../src/index.js";
import { loadDesk, loadProject, minutes, NOW, snapshotOf, withDesk } from "./helpers.js";

describe("formatAge", () => {
  it("matches Muster's buckets", () => {
    expect(formatAge(0)).toBe("now");
    expect(formatAge(59_999)).toBe("now");
    expect(formatAge(60_000)).toBe("1m");
    expect(formatAge(3_599_000)).toBe("59m");
    expect(formatAge(3_600_000)).toBe("1h");
    expect(formatAge(86_400_000 * 3)).toBe("3d");
  });
});

describe("WIP and flow line", () => {
  const p = loadProject();

  it("computes in-flight and backlog lanes", () => {
    expect(inFlight(p).map((l) => l.slug)).toEqual(["auth-rework"]);
    expect(backlog(p).map((l) => l.slug)).toEqual(["billing-sync"]);
    expect(openSlots(p)).toBe(2);
  });

  it("prints Muster's flow line", () => {
    expect(flowLine(p, NOW)).toBe(
      "WIP 1/3 · 2 open · next: billing-sync · landed, not live: auth-rework 50m · oldest in flight 6h",
    );
  });

  it("marks a stalled lane as not flowing once nothing moved for flowStallMin", () => {
    const fresh = flowInfo(p, NOW);
    expect(fresh.notFlowing).toBe(false);
    const late = flowInfo(p, minutes(300));
    expect(late.stalled).toBe(true);
    expect(late.line.startsWith("⚠ not flowing · WIP 1/3")).toBe(true);
  });

  it("flags unlanded packets older than landWaitMin", () => {
    const withPacket: ProjectView = {
      ...p,
      packets: [{ ...p.packets[0]!, state: "reported", reportedAt: new Date(minutes(-45)).toISOString() }],
    };
    const info = flowInfo(withPacket, NOW);
    expect(info.unlanded).toBe(true);
    expect(info.notFlowing).toBe(true);
  });

  it("reports at-limit WIP and a disabled limit", () => {
    const lanes = ["a", "b", "c"].map((slug) => ({ ...p.lanes[0]!, slug, state: "open" as const }));
    expect(flowInfo({ ...p, lanes }, NOW)).toMatchObject({ wip: 3, atLimit: true, openSlots: 0 });
    const off = flowInfo({ ...p, policy: { ...p.policy, wipLimit: null }, lanes }, NOW);
    expect(off.atLimit).toBe(false);
    expect(off.line).toContain("WIP 3/off");
  });

  it("lets level 2+ deployed lanes leave WIP (and shows them as watching)", () => {
    const lane = { ...p.lanes[0]!, delivery: "deployed" as const };
    const level2 = { ...p, deploy: { ...p.deploy, level: 2 as const }, lanes: [lane, ...p.lanes.slice(1)] };
    expect(inFlight(level2)).toHaveLength(0);
    expect(flowInfo(level2, NOW).watching).toEqual(["auth-rework"]);
    const level1 = { ...p, lanes: [lane, ...p.lanes.slice(1)] };
    expect(inFlight(level1)).toHaveLength(1);
  });

  it("only lowers the effective lane deploy level", () => {
    expect(laneDeployLevel({ deployLevel: 0 }, 2)).toBe(0);
    expect(laneDeployLevel({ deployLevel: 3 }, 1)).toBe(1);
    expect(laneDeployLevel({ deployLevel: null }, 2)).toBe(2);
  });
});

describe("desk heat", () => {
  const p = withDesk(loadProject(), loadDesk());

  it("ranks blocked > approval > decision and weights by log age", () => {
    const piles = deskPiles(p.desk, NOW);
    expect(piles.map((x) => x.kind)).toEqual(["approval", "decision"]);
    const open = rankOpen(p.desk);
    expect(open.map((d) => d.id)).toEqual(["d2", "d3"]);
    const young = deskPiles(buildDeskViews(loadDesk()), NOW + 1);
    const old = deskPiles(buildDeskViews(loadDesk()), NOW + 86_400_000);
    expect(old[0]!.heat).toBeGreaterThan(young[0]!.heat);
    expect(old[0]!.tier).toBeGreaterThanOrEqual(young[0]!.tier);
  });

  it("weights blocked 3, approval 2, decision 1 at equal age", () => {
    const mk = (kind: string) => ({ id: kind, ts: new Date(NOW).toISOString(), from: "x", kind, title: kind, body: null, refs: [], resolves: null });
    const views = buildDeskViews([mk("decision"), mk("approval"), mk("blocked")] as never);
    const [blocked, approval, decision] = deskPiles(views, NOW);
    expect(blocked!.heat).toBe(3);
    expect(approval!.heat).toBe(2);
    expect(decision!.heat).toBe(1);
  });

  it("detects a dead desk: open items but no live desk agent", () => {
    expect(isDeadDesk(p)).toBe(false);
    const dead = { ...p, agents: p.agents.map((a): AgentView => (a.role === "desk" ? { ...a, state: "closed" } : a)) };
    expect(isDeadDesk(dead)).toBe(true);
    expect(isDeadDesk({ ...dead, desk: [] })).toBe(false);
  });
});

describe("protocol: diff / apply", () => {
  const a = snapshotOf([withDesk(loadProject(), loadDesk())]);

  function mutate(): typeof a {
    const p = a.projects[0]!;
    const job: JobView = {
      id: "11111111-1111-4111-8111-111111111111", host: "h", repo: "harbor-api", project: "harbor-api", command: "npm test",
      state: "running", startedAt: new Date(NOW).toISOString(), finishedAt: null, cpuPercent: 10, rssKB: 1, peakRssKB: 1,
      cpuSeconds: 0, wallMs: null, exit: null, lost: false, sampledAt: null,
    };
    return {
      ...a,
      projects: [
        {
          ...p,
          agents: p.agents.map((x) => (x.name === "w-auth" ? { ...x, state: "landed" as const, updatedAt: new Date(NOW).toISOString() } : x)),
          lanes: p.lanes.filter((l) => l.slug !== "desk"),
          desk: [
            ...p.desk.map((d) => (d.id === "d2" ? { ...d, open: false, resolvedBy: "d9" } : d)),
            { id: "d9", ts: new Date(NOW).toISOString(), from: "x", kind: "done" as const, title: "ok", hasBody: false, refCount: 0, resolves: "d2", open: false, resolvedBy: null },
          ],
        },
      ],
      jobs: [job],
    };
  }

  it("round-trips: applyOps(a, diff(a, b)) === b", () => {
    const b = mutate();
    const ops = diffSnapshots(a, b);
    const { snapshot, changes } = applyOps(a, ops, { seq: b.seq, now: b.now });
    expect(deepEqual(snapshot.projects, b.projects)).toBe(true);
    expect(snapshot.jobs).toEqual(b.jobs);
    expect(changes).toContainEqual(expect.objectContaining({ t: "agent", name: "w-auth", from: "reported", to: "landed" }));
    expect(changes).toContainEqual(expect.objectContaining({ t: "desk", id: "d2", change: "resolved" }));
    expect(changes).toContainEqual(expect.objectContaining({ t: "desk", id: "d9", change: "added" }));
    expect(changes).toContainEqual(expect.objectContaining({ t: "lane", slug: "desk", to: null }));
    expect(changes).toContainEqual(expect.objectContaining({ t: "job", from: null, to: "running" }));
  });

  it("emits no ops for identical snapshots", () => {
    expect(diffSnapshots(a, { ...a, seq: 2 })).toEqual([]);
  });

  it("handles project add/remove", () => {
    const other = { ...loadProject(), slug: "other", label: "Other" };
    const b = snapshotOf([...a.projects, other]);
    const added = applyOps(a, diffSnapshots(a, b), { seq: 2, now: NOW });
    expect(added.snapshot.projects.map((p) => p.slug)).toEqual(["harbor-api", "other"]);
    expect(deepEqual(added.snapshot.projects, b.projects)).toBe(true);
    const removed = applyOps(added.snapshot, diffSnapshots(b, a), { seq: 3, now: NOW });
    expect(removed.snapshot.projects.map((p) => p.slug)).toEqual(["harbor-api"]);
  });

  it("derives timeline events for live changes and seeds history", () => {
    const b = mutate();
    const events = deriveEvents(a, b);
    expect(events.some((e) => e.kind === "agent" && /reported → landed/.test(e.text))).toBe(true);
    expect(events.some((e) => e.kind === "desk" && /resolved/.test(e.text))).toBe(true);
    expect(events.some((e) => e.kind === "job")).toBe(true);
    const seeded = seedTimeline(a);
    expect(seeded.length).toBeGreaterThan(5);
    expect(seeded.every((e, i, arr) => i === 0 || arr[i - 1]!.ts <= e.ts)).toBe(true);
    expect(seeded.some((e) => e.kind === "desk" && /blocked/.test(e.text))).toBe(true);
  });

  it("merges timelines with stable ids and a cap", () => {
    const a1 = [{ id: "x", ts: 1, kind: "system" as const, project: null, agent: null, lane: null, text: "1", severity: "info" as const }];
    const merged = mergeTimeline(a1, [...a1, { ...a1[0]!, id: "y", ts: 2 }]);
    expect(merged.map((e) => e.id)).toEqual(["x", "y"]);
    expect(mergeTimeline(merged, [{ ...a1[0]!, id: "z", ts: 3 }], 2).map((e) => e.id)).toEqual(["y", "z"]);
  });
});
