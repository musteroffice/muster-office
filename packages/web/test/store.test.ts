import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeProject, diffSnapshots, type Diff, type ProjectView, type Snapshot } from "@muster-office/shared";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixture = (n: string): string => readFileSync(fileURLToPath(new URL(`../../shared/test/fixtures/${n}`, import.meta.url)), "utf8");

function project(): ProjectView {
  const d = decodeProject(fixture("project.valid.json"));
  if (!d.ok) throw new Error(d.error);
  return d.value.project;
}
function snap(seq: number, p: ProjectView = project()): Snapshot {
  return { seq, now: 1_000 + seq, demo: false, noColor: false, version: "t", projects: [p], jobs: [], relay: { counts: {}, recent: [] }, timeline: [], health: [] };
}
function diffTo(prev: Snapshot, next: Snapshot): Diff {
  return { seq: next.seq, now: next.now, ops: diffSnapshots(prev, next), events: [] };
}
function withState(p: ProjectView, name: string, state: "landed" | "failed"): ProjectView {
  return { ...p, agents: p.agents.map((a) => (a.name === name ? { ...a, state } : a)) };
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CLOSED = 2;
  readyState = 1;
  onerror: (() => void) | null = null;
  private handlers = new Map<string, Array<(e: { data: string }) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: { data: string }) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  emit(type: string, data: unknown): void {
    for (const fn of this.handlers.get(type) ?? []) fn({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
  close(): void {
    this.readyState = 2;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: "visible", hidden: false });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("prefs", () => {
  it("falls back when localStorage is missing, throws, or holds junk", async () => {
    const { loadPref, savePref } = await import("../src/lib/prefs");
    expect(loadPref("x", 5)).toBe(5); // no window at all
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(loadPref("x", "d")).toBe("d");
    expect(() => savePref("x", 1)).not.toThrow();
    vi.stubGlobal("window", { localStorage: { getItem: () => "{not json", setItem: () => undefined } });
    expect(loadPref("x", true)).toBe(true);
    vi.stubGlobal("window", { localStorage: { getItem: () => '"a string"', setItem: () => undefined } });
    expect(loadPref("x", 3)).toBe(3); // wrong type
    expect(loadPref("x", "z")).toBe("a string");
  });

  it("persists the show-bodies toggle", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } });
    const { useOffice } = await import("../src/store");
    expect(useOffice.getState().showBodies).toBe(false);
    useOffice.getState().setShowBodies(true);
    expect(store.get("muster-office:showBodies")).toBe("true");
  });
});

describe("store", () => {
  it("applies a snapshot, picks a project, then batches diffs and hands changes to listeners", async () => {
    const { useOffice, onChanges } = await import("../src/store");
    const s0 = snap(1);
    const batches: Array<{ n: number; reset: boolean; diffs: number }> = [];
    onChanges((b) => batches.push({ n: b.changes.length, reset: b.reset, diffs: b.diffs }));
    useOffice.getState().applySnapshot(s0);
    expect(useOffice.getState().project).toBe("harbor-api");
    expect(useOffice.getState().conn).toBe("live");
    expect(batches[0]).toEqual({ n: 0, reset: true, diffs: 0 });

    const s1 = snap(2, withState(project(), "w-auth", "landed"));
    const s2 = snap(3, withState(project(), "hawk-1", "failed"));
    useOffice.getState().applyDiffs([diffTo(s0, s1), diffTo(s1, s2)]);
    const st = useOffice.getState().snapshot!;
    expect(st.seq).toBe(3);
    expect(st.projects[0]!.agents.find((a) => a.name === "hawk-1")?.state).toBe("failed");
    expect(batches[1]!.diffs).toBe(2);
    expect(batches[1]!.n).toBeGreaterThanOrEqual(2);
    expect(useOffice.getState().announcements.map((a) => a.text)).toContain("hawk-1 is now failed");
  });

  it("derives changes when a reconnect snapshot replaces existing state", async () => {
    const { useOffice, onChanges } = await import("../src/store");
    const seen: string[] = [];
    useOffice.getState().applySnapshot(snap(1));
    onChanges((b) => b.changes.forEach((c) => c.t === "agent" && seen.push(`${c.name}:${c.from}->${c.to}`)));
    useOffice.getState().applySnapshot(snap(9, withState(project(), "w-auth", "landed")));
    expect(seen).toEqual(["w-auth:reported->landed"]);
  });

  it("ignores diffs before the first snapshot", async () => {
    const { useOffice } = await import("../src/store");
    useOffice.getState().applyDiffs([{ seq: 2, now: 1, ops: [], events: [] }]);
    expect(useOffice.getState().snapshot).toBeNull();
  });
});

describe("SSE client", () => {
  it("goes live on a snapshot, batches diffs, and resyncs on a sequence gap", async () => {
    const { connectEvents } = await import("../src/sse");
    const { useOffice } = await import("../src/store");
    const stop = connectEvents("/events");
    const es = FakeEventSource.instances[0]!;
    expect(useOffice.getState().conn).toBe("connecting");

    const s0 = snap(1);
    es.emit("snapshot", s0);
    expect(useOffice.getState().conn).toBe("live");

    // Two diffs arrive inside the flush window: one store update.
    let renders = 0;
    const unsub = useOffice.subscribe(() => renders++);
    const s1 = snap(2, withState(project(), "w-auth", "landed"));
    const s2 = snap(3, withState(project(), "hawk-1", "failed"));
    es.emit("diff", diffTo(s0, s1));
    es.emit("diff", diffTo(s1, s2));
    expect(renders).toBe(0);
    vi.advanceTimersByTime(60);
    expect(renders).toBe(1);
    expect(useOffice.getState().snapshot?.seq).toBe(3);

    // A gap (seq 5 after 3) closes the stream and opens a new one.
    es.emit("diff", { seq: 5, now: 1, ops: [], events: [] });
    expect(es.readyState).toBe(2);
    vi.advanceTimersByTime(10);
    expect(FakeEventSource.instances).toHaveLength(2);
    unsub();
    stop();
  });

  it("does not treat pings as data, and reports reconnecting after an error", async () => {
    const { connectEvents } = await import("../src/sse");
    const { useOffice } = await import("../src/store");
    const stop = connectEvents("/events");
    const es = FakeEventSource.instances[0]!;
    es.emit("snapshot", snap(1));
    const dataAt = useOffice.getState().lastDataAt;
    vi.advanceTimersByTime(5_000);
    es.emit("ping", "1");
    expect(useOffice.getState().lastDataAt).toBe(dataAt);
    expect(useOffice.getState().lastMessageAt).toBeGreaterThan(dataAt);
    es.onerror?.();
    expect(useOffice.getState().conn).toBe("reconnecting");
    stop();
  });
});
