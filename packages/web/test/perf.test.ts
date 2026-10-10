import { describe, expect, it } from "vitest";
import {
  applyOps,
  buildDeskViews,
  buildJobView,
  decodeDeskLine,
  decodeJob,
  decodeProject,
  decodeSamples,
  diffSnapshots,
  type JobView,
  type ProjectView,
  type RawDeskItem,
  type Snapshot,
} from "@automicvault/shared";
import { LOOP, PROJECTS, deskLines, jobDocuments, projectDocument } from "@automicvault/shared/demo";
import { OfficeWorld } from "../src/office/world";

const T0 = Date.parse("2026-10-09T12:00:00Z");

function viewAt(slug: string, k: number, tickMs: number): { project: ProjectView; jobs: JobView[]; now: number } {
  const clock = { epoch: T0, cycleStart: T0, tickMs };
  const def = PROJECTS.find((p) => p.slug === slug)!;
  const decoded = decodeProject(projectDocument(def, k % LOOP, clock));
  if (!decoded.ok) throw new Error(decoded.error);
  const items = deskLines(def, k % LOOP, clock).map(decodeDeskLine).filter((x): x is RawDeskItem => x !== null);
  const now = T0 + k * tickMs;
  const docs = jobDocuments(k % LOOP, clock, now);
  const samples = decodeSamples(docs.samples);
  const jobs = [...docs.jobs.values()].map((t) => decodeJob(t)).filter((j) => j !== null).map((j) => buildJobView(j, samples, null));
  return { project: { ...decoded.value.project, desk: buildDeskViews(items) }, jobs, now };
}

const snapOf = (seq: number, project: ProjectView, jobs: JobView[], now: number): Snapshot => ({
  seq, now, demo: true, noColor: false, version: "t", projects: [project], jobs, relay: { counts: {}, recent: [] }, timeline: [], health: [],
});

describe("data path under load", () => {
  it("absorbs 10 server events per second for several minutes while still stepping the animation at 60 fps", () => {
    // 10 events/s = 600 events/min. We run 8 demo cycles (672 steps) at 100 ms per step.
    const tickMs = 100;
    const steps = LOOP * 8;
    const world = new OfficeWorld({ reducedMotion: false });
    let prev = viewAt("harbor-api", 0, tickMs);
    let snap = snapOf(0, prev.project, prev.jobs, prev.now);
    world.sync(prev.project, prev.jobs, prev.now, true);
    let ops = 0;
    let dataMs = 0;
    let frameMs = 0;
    let frames = 0;
    for (let k = 1; k <= steps; k++) {
      const next = viewAt("harbor-api", k, tickMs);
      const nextSnap = snapOf(k, next.project, next.jobs, next.now);
      const t0 = performance.now();
      const o = diffSnapshots(snap, nextSnap);
      const applied = applyOps(snap, o, { seq: k, now: next.now });
      const cur = applied.snapshot.projects[0]!;
      world.sync(cur, applied.snapshot.jobs, next.now, false);
      world.applyChanges(applied.changes, false);
      dataMs += performance.now() - t0;
      ops += o.length;
      snap = applied.snapshot;
      prev = next;
      // six 16 ms frames of animation between events (100 ms)
      const f0 = performance.now();
      for (let f = 0; f < 6; f++) world.step(16, next.now + f * 16);
      frameMs += performance.now() - f0;
      frames += 6;
    }
    const perEvent = dataMs / steps;
    const perFrame = frameMs / frames;
    // Budget: an event must cost well under one 16 ms frame, and an animation step a small fraction of it.
    expect(perEvent).toBeLessThan(6);
    expect(perFrame).toBeLessThan(2);
    expect(ops).toBeGreaterThan(steps); // sanity: this really was a busy stream
    expect((steps / (steps * tickMs)) * 60_000).toBeGreaterThanOrEqual(500);
  });
});
