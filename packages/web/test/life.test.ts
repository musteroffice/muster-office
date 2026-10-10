import { describe, expect, it } from "vitest";
import {
  buildDeskViews,
  buildJobView,
  decodeDeskLine,
  decodeJob,
  decodeProject,
  decodeSamples,
  type AgentStateOrUnknown,
  type AgentView,
  type Change,
  type JobView,
  type ProjectView,
  type RawDeskItem,
  type Snapshot,
} from "@muster-office/shared";
import { PROJECTS, deskLines, jobDocuments, projectDocument } from "@muster-office/shared/demo";
import { CritterBrain, roamTiles } from "../src/office/critter";
import { ambientFor, qrs, traceAt, weatherFor } from "../src/office/fx";
import { isWalkable, layoutFloor } from "../src/office/layout";
import { OfficeWorld } from "../src/office/world";
import { alertsFor } from "../src/lib/alerts";

const T0 = Date.parse("2026-10-09T12:00:00Z");
const TICK = 2500;

function viewAt(slug: string, k: number): { project: ProjectView; jobs: JobView[]; now: number } {
  const clock = { epoch: T0, cycleStart: T0, tickMs: TICK };
  const def = PROJECTS.find((p) => p.slug === slug)!;
  const decoded = decodeProject(projectDocument(def, k, clock));
  if (!decoded.ok) throw new Error(decoded.error);
  const items = deskLines(def, k, clock).map(decodeDeskLine).filter((x): x is RawDeskItem => x !== null);
  const project: ProjectView = { ...decoded.value.project, desk: buildDeskViews(items), deploy: { level: 2, source: "default", notes: [] } };
  const now = T0 + k * TICK;
  const docs = jobDocuments(k, clock, now);
  const samples = decodeSamples(docs.samples);
  const jobs = [...docs.jobs.values()].map((t) => decodeJob(t)).filter((j) => j !== null).map((j) => buildJobView(j, samples, null));
  return { project, jobs, now };
}

describe("atmosphere", () => {
  it("darkens smoothly from dusk to night and lifts again at dawn", () => {
    expect(ambientFor(12).a).toBe(0);
    expect(ambientFor(23).a).toBeCloseTo(0.5, 5);
    expect(ambientFor(3).a).toBeCloseTo(0.5, 5);
    for (let h = 0; h < 24; h += 0.05) {
      const a = ambientFor(h).a;
      const b = ambientFor(h + 0.05).a;
      expect(Math.abs(a - b), `jump at ${h.toFixed(2)}h`).toBeLessThan(0.05);
    }
  });

  it("picks the same weather for a whole day, and rain on about one day in five", () => {
    const day = Date.parse("2026-03-04T08:00:00");
    expect(weatherFor(day)).toBe(weatherFor(day + 9 * 3600_000));
    let rain = 0;
    for (let d = 0; d < 365; d++) if (weatherFor(Date.parse("2026-01-01T12:00:00") + d * 86_400_000) === "rain") rain++;
    expect(rain).toBeGreaterThan(40);
    expect(rain).toBeLessThan(110);
  });

  it("draws a heartbeat that peaks once and is flat outside the beat", () => {
    expect(qrs(-0.1)).toBe(0);
    expect(qrs(0.7)).toBe(0);
    let peak = 0;
    for (let u = 0; u < 0.6; u += 0.005) peak = Math.max(peak, qrs(u));
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThanOrEqual(1.0001);
  });

  it("spikes the trace where an event landed, and marks failures as bad", () => {
    const spikes = [{ t: 100_000, amp: 1, bad: true }];
    const at = traceAt(spikes, 100_000 + 240, 0);
    expect(at.v).toBeGreaterThan(0.9);
    expect(at.bad).toBeGreaterThan(0.5);
    const earlier = traceAt(spikes, 100_000 + 240, 2); // two seconds earlier: nothing yet
    expect(earlier.bad).toBe(0);
  });
});

describe("Biscuit the cat", () => {
  const lanes = viewAt("harbor-api", 3).project.lanes;
  const layout = layoutFloor({ lanes });

  it("has somewhere to roam, all of it walkable", () => {
    const spots = roamTiles(layout);
    expect(spots.length).toBeGreaterThan(30);
    for (const t of spots) expect(isWalkable(layout, t.x, t.y)).toBe(true);
  });

  it("wanders, naps and grooms without ever standing in a wall or on furniture", () => {
    const brain = new CritterBrain(layout, "harbor-api");
    const seen = new Set<string>();
    for (let ms = 0; ms < 20 * 60_000; ms += 50) {
      brain.step(50, 23);
      const c = brain.critter;
      seen.add(c.mode);
      const tx = Math.floor(c.x / 16);
      const ty = Math.floor(c.y / 16);
      expect(isWalkable(layout, tx, ty), `${c.mode} at ${tx},${ty}`).toBe(true);
    }
    expect(seen.has("walk")).toBe(true);
    expect(seen.has("sleep")).toBe(true);
  });

  it("is deterministic for a given floor", () => {
    const a = new CritterBrain(layout, "x");
    const b = new CritterBrain(layout, "x");
    for (let i = 0; i < 4000; i++) {
      a.step(50, 12);
      b.step(50, 12);
    }
    expect(a.critter.x).toBe(b.critter.x);
    expect(a.critter.mode).toBe(b.critter.mode);
  });

  it("startles and bolts, can be petted, and settles under reduced motion", () => {
    const brain = new CritterBrain(layout, "y");
    brain.startle();
    expect(brain.critter.mode).toBe("startle");
    for (let i = 0; i < 20; i++) brain.step(50, 12);
    expect(brain.critter.mode).toBe("walk");
    expect(brain.critter.speed).toBeGreaterThan(40);

    brain.pet();
    expect(brain.critter.pet).toBe(5);
    let hearts = 0;
    for (let i = 0; i < 60; i++) if (brain.step(50, 12)) hearts++;
    expect(hearts).toBeGreaterThan(0);

    brain.settle();
    const { x, y } = brain.critter;
    for (let i = 0; i < 400; i++) brain.step(50, 12);
    expect(brain.critter.mode).toBe("sleep");
    expect(brain.critter.x).toBe(x);
    expect(brain.critter.y).toBe(y);
    brain.wake();
    expect(brain.critter.mode).toBe("sit");
  });
});

describe("the world reacts to events", () => {
  function fresh(): { w: OfficeWorld; now: number } {
    const w = new OfficeWorld({ reducedMotion: false });
    const v = viewAt("harbor-api", 3);
    w.sync(v.project, v.jobs, v.now, true);
    return { w, now: v.now };
  }
  const agentChange = (to: AgentStateOrUnknown): Change => ({ t: "agent", project: "harbor-api", name: "ada", from: "running", to, agent: null as AgentView | null });

  it("labels a state change, spikes the pulse, and scares the cat when someone fails", () => {
    const { w } = fresh();
    expect(w.actors.get("ada")!.visible).toBe(true);
    w.applyChanges([agentChange("failed")], false);
    expect(w.popups.map((p) => p.text)).toEqual(["FAILED"]);
    expect(w.pulse).toHaveLength(1);
    expect(w.pulse[0]!.bad).toBe(true);
    expect(w.critter!.mode).toBe("startle");
  });

  it("does not stack labels on one agent faster than they can be read", () => {
    const { w } = fresh();
    w.applyChanges([agentChange("silent"), agentChange("failed")], false);
    expect(w.popups).toHaveLength(1);
  });

  it("throws confetti when a lane is proven, and stays quiet on a snapshot or under reduced motion", () => {
    const { w } = fresh();
    const slug = w.layout.bays.find((b) => b.pads.length > 0)!.lane.slug;
    const proven: Change = { t: "lane", project: "harbor-api", slug, from: { state: "open", delivery: "deployed" }, to: { state: "open", delivery: "proven" } };
    w.applyChanges([proven], true);
    expect(w.particles.filter((p) => p.kind === "confetti")).toHaveLength(0);
    w.applyChanges([proven], false);
    expect(w.particles.filter((p) => p.kind === "confetti").length).toBeGreaterThan(20);
    expect(w.popups.some((p) => p.text === "PROVEN")).toBe(true);

    const calm = new OfficeWorld({ reducedMotion: true });
    const v = viewAt("harbor-api", 3);
    calm.sync(v.project, v.jobs, v.now, true);
    calm.applyChanges([proven], false);
    expect(calm.particles).toHaveLength(0);
    expect(calm.popups).toHaveLength(0);
    expect(calm.critter!.mode).toBe("sleep");
  });

  it("finds the cat under the pointer, and fades popups away", () => {
    const { w, now } = fresh();
    const c = w.critter!;
    expect(w.hitTest(c.x, c.y - 5)).toEqual({ type: "critter" });
    w.applyChanges([agentChange("failed")], false);
    let t = now;
    for (let i = 0; i < 60; i++) w.step(50, (t += 50)); // 3 s
    expect(w.popups).toHaveLength(0);
  });
});

describe("alerts", () => {
  const snap = (p: ProjectView): Snapshot => ({ projects: [p], jobs: [], now: T0, seq: 1, health: [], timeline: [], demo: true, noColor: false }) as unknown as Snapshot;
  const p = viewAt("harbor-api", 3).project;
  const after = snap(p);

  it("only interrupts for things worth a look", () => {
    const quiet: Change[] = [{ t: "agent", project: p.slug, name: "ada", from: "launching", to: "running", agent: null }];
    expect(alertsFor(quiet, after, after)).toEqual([]);
    const bad: Change[] = [
      { t: "agent", project: p.slug, name: "ada", from: "running", to: "failed", agent: null },
      { t: "agent", project: p.slug, name: "bea", from: "running", to: "silent", agent: null },
    ];
    const out = alertsFor(bad, after, after);
    expect(out.map((a) => a.tone)).toEqual(["bad", "warn"]);
    expect(out[0]!.focus).toEqual({ type: "agent", name: "ada" });
  });

  it("announces proven deliveries and lost jobs, worst first, three at most", () => {
    const changes: Change[] = [
      { t: "lane", project: p.slug, slug: "auth-rework", from: { state: "open", delivery: "deployed" }, to: { state: "open", delivery: "proven" } },
      { t: "job", id: "abcdef0123", project: p.slug, from: "running", to: "lost" },
      { t: "agent", project: p.slug, name: "ada", from: "running", to: "failed", agent: null },
      { t: "agent", project: p.slug, name: "bea", from: "running", to: "interrupted", agent: null },
    ];
    const out = alertsFor(changes, after, after);
    expect(out).toHaveLength(3);
    expect(out[0]!.tone).toBe("bad");
    expect(out.map((a) => a.title)).not.toContain("Proven live"); // cut by the cap
  });
});
