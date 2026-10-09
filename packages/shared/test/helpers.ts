import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeskViews, decodeDeskLine, decodeProject, type ProjectView, type RawDeskItem, type Snapshot } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

export const fixture = (name: string): string => readFileSync(join(here, "fixtures", name), "utf8");

/** 2026-10-09T12:00:00Z, the fixtures' "now" (minute offset 0). */
export const NOW = Date.parse("2026-10-09T12:00:00Z");
export const minutes = (m: number): number => NOW + m * 60_000;

export function loadProject(name = "project.valid.json"): ProjectView {
  const d = decodeProject(fixture(name));
  if (!d.ok) throw new Error(d.error);
  return d.value.project;
}

export function loadDesk(name = "desk.valid.jsonl"): RawDeskItem[] {
  return fixture(name)
    .split("\n")
    .map(decodeDeskLine)
    .filter((x): x is RawDeskItem => x !== null);
}

export function snapshotOf(projects: ProjectView[], extra: Partial<Snapshot> = {}): Snapshot {
  return {
    seq: 1,
    now: NOW,
    demo: false,
    noColor: false,
    version: "test",
    projects,
    jobs: [],
    relay: { counts: {}, recent: [] },
    timeline: [],
    health: [],
    ...extra,
  };
}

export function withDesk(project: ProjectView, items: RawDeskItem[]): ProjectView {
  return { ...project, desk: buildDeskViews(items) };
}
