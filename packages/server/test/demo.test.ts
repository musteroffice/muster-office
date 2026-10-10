import { describe, expect, it } from "vitest";
import { AGENT_STATES, flowInfo, inFlight, backlog, isDeadDesk, type Snapshot } from "@automicvault/shared";
import { OfficeModel } from "../src/model.js";
import { DemoSource } from "../src/demo/source.js";
import { LOOP } from "@automicvault/shared/demo";

const T0 = Date.parse("2026-10-09T12:00:00Z");

/** Legal agent transitions from pi-muster `src/machines.ts` (docs/data-contract.md §3). */
const LEGAL: Record<string, string[]> = {
  planned: ["launching", "closed"],
  launching: ["running", "failed", "interrupted"],
  running: ["silent", "reported", "interrupted", "failed", "closed"],
  silent: ["nudged", "running", "reported", "interrupted", "failed", "closed"],
  nudged: ["restarted", "running", "reported", "interrupted", "failed", "closed"],
  restarted: ["running", "silent", "reported", "interrupted", "failed", "closed"],
  reported: ["reported", "running", "verified", "landed", "interrupted", "closed"],
  verified: ["reported", "landed", "interrupted", "running", "closed"],
  landed: ["reported", "interrupted", "running", "closed"],
  interrupted: ["launching", "running", "restoring", "closed"],
  restoring: ["running", "failed", "interrupted"],
  failed: ["launching", "restoring", "running", "closed"],
  closed: ["launching", "restoring"],
};

function runCycle(now: () => number = () => T0): { snaps: Snapshot[]; model: OfficeModel } {
  const model = new OfficeModel({ demo: true });
  const demo = new DemoSource({ tickMs: 0, now });
  void demo.start(model);
  const snaps: Snapshot[] = [];
  for (let i = 0; i < LOOP; i++) {
    model.flush();
    snaps.push(model.getSnapshot());
    demo.step();
  }
  return { snaps, model };
}

describe("demo simulator", () => {
  const { snaps } = runCycle();

  it("visits every one of the 13 agent lifecycle states in one cycle", () => {
    const seen = new Set<string>();
    for (const s of snaps) for (const p of s.projects) for (const a of p.agents) seen.add(a.state);
    expect([...seen].sort()).toEqual([...AGENT_STATES].sort());
  });

  it("only makes legal agent transitions inside a cycle", () => {
    const bad: string[] = [];
    for (let i = 1; i < snaps.length; i++) {
      for (const p of snaps[i]!.projects) {
        for (const a of p.agents) {
          const before = snaps[i - 1]!.projects.find((x) => x.slug === p.slug)?.agents.find((x) => x.name === a.name);
          if (before && before.state !== a.state && !LEGAL[before.state]?.includes(a.state)) bad.push(`${p.slug}/${a.name}: ${before.state} → ${a.state} @${i}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("contains a failed agent, a blocked open desk item, a lost job and a finished job", () => {
    expect(snaps.some((s) => s.projects.some((p) => p.agents.some((a) => a.state === "failed")))).toBe(true);
    expect(snaps.some((s) => s.projects.some((p) => p.desk.some((d) => d.kind === "blocked" && d.open)))).toBe(true);
    expect(snaps.some((s) => s.jobs.some((j) => j.lost))).toBe(true);
    expect(snaps.some((s) => s.jobs.some((j) => j.state === "finished" && j.exit === 0))).toBe(true);
    expect(snaps.some((s) => s.jobs.some((j) => j.state === "finished" && j.exit === 1))).toBe(true);
    expect(snaps.some((s) => s.jobs.filter((j) => j.state === "running").length >= 2)).toBe(true);
  });

  it("shows a stalled / not-flowing project and a flowing one", () => {
    const states = snaps.map((s) => s.projects.map((p) => flowInfo(p, T0).notFlowing));
    expect(states.some((row) => row.some(Boolean))).toBe(true);
    expect(states.some((row) => row.some((x) => !x))).toBe(true);
    const lantern = snaps[0]!.projects.find((p) => p.slug === "lantern-web")!;
    expect(flowInfo(lantern, T0).notFlowing).toBe(true);
  });

  it("holds WIP at the limit with a backlog (door queue), then frees a slot", () => {
    const harborAt = (i: number) => snaps[i]!.projects.find((p) => p.slug === "harbor-api")!;
    const early = harborAt(1);
    expect(inFlight(early)).toHaveLength(3);
    expect(flowInfo(early, T0).atLimit).toBe(true);
    expect(backlog(early).length).toBeGreaterThanOrEqual(2);
    const freed = harborAt(21);
    expect(inFlight(freed).length).toBeLessThan(3);
  });

  it("walks the delivery pipeline landed → deployed → proven and records a waiver", () => {
    const stages = new Set<string>();
    for (const s of snaps) for (const p of s.projects) for (const l of p.lanes) stages.add(l.delivery);
    expect([...stages].sort()).toEqual(["deployed", "landed", "none", "proven", "waived"]);
  });

  it("has a dead desk (open item, no live desk agent) and a live desk", () => {
    const quarry = snaps[5]!.projects.find((p) => p.slug === "quarry-batch")!;
    expect(isDeadDesk(quarry)).toBe(true);
    expect(isDeadDesk(snaps[5]!.projects.find((p) => p.slug === "harbor-api")!)).toBe(false);
  });

  it("covers each deploy posture level 0..3 across lanes", () => {
    const first = snaps[3]!.projects;
    const levels = new Set<number>();
    for (const p of first) {
      for (const l of p.lanes.filter((x) => x.kind === "work")) levels.add(l.deployLevel !== null ? Math.min(l.deployLevel, p.deploy.level) : p.deploy.level);
    }
    expect([...levels].sort()).toEqual([0, 1, 2, 3]);
  });

  it("is deterministic: identical clock ⇒ identical snapshots", () => {
    const again = runCycle().snaps;
    const strip = (s: Snapshot) => JSON.stringify({ projects: s.projects, jobs: s.jobs, relay: s.relay });
    expect(again.map(strip)).toEqual(snaps.map(strip));
  });

  it("emits diffs through the model for each state change (same pipeline as the filesystem)", () => {
    const model = new OfficeModel({ demo: true });
    const demo = new DemoSource({ tickMs: 0, now: () => T0 });
    void demo.start(model);
    const seen: string[] = [];
    model.subscribe((d) => {
      for (const o of d.ops) if (o.op === "put" && o.coll === "agents") seen.push(`${(o.item as { name: string }).name}:${(o.item as { state: string }).state}`);
    });
    for (let i = 0; i < 20; i++) {
      demo.step();
      model.flush();
    }
    expect(seen).toContain("ada:reported");
    expect(seen).toContain("dina:failed");
    expect(seen).toContain("bram:launching");
  });

  it("loops: the world after a full cycle matches the start", () => {
    const model = new OfficeModel({ demo: true });
    const demo = new DemoSource({ tickMs: 0, now: () => T0 });
    void demo.start(model);
    const state = () => model.getSnapshot().projects.flatMap((p) => p.agents.map((a) => `${p.slug}/${a.name}:${a.state}`)).sort();
    const first = state();
    for (let i = 0; i < LOOP; i++) demo.step();
    model.flush();
    expect(state()).toEqual(first);
  });
});
