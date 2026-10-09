import { create } from "zustand";
import {
  applyOps,
  diffSnapshots,
  mergeTimeline,
  type Change,
  type Diff,
  type ProjectView,
  type Snapshot,
  type TimelineEvent,
  type TimelineKind,
} from "@muster-office/shared";
import { isTheme, isViewMode, loadPref, savePref, type Theme, type ViewMode } from "./lib/prefs";

export type ConnState = "connecting" | "live" | "reconnecting" | "offline";

export type Selection =
  | { type: "agent"; project: string; name: string }
  | { type: "lane"; project: string; slug: string }
  | { type: "desk"; project: string }
  | { type: "job"; id: string }
  | { type: "packet"; project: string; id: string }
  | { type: "project"; project: string }
  | { type: "door"; project: string };

export interface TimelineFilters {
  project: string; // "all" or slug
  agent: string; // "all" or name
  kinds: TimelineKind[]; // empty = all
}

export type BoardLayout = "table" | "kanban";

/** What changed in one flush, handed to the animation engine. */
export interface ChangeBatch {
  changes: Change[];
  /** A fresh snapshot replaced the state (first load or reconnect): fast-forward, do not replay. */
  reset: boolean;
  /** How many server diffs were folded into this batch. */
  diffs: number;
  at: number;
}

const changeListeners = new Set<(batch: ChangeBatch, snapshot: Snapshot) => void>();
export function onChanges(fn: (batch: ChangeBatch, snapshot: Snapshot) => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

interface OfficeStore {
  snapshot: Snapshot | null;
  conn: ConnState;
  /** Last time real data (snapshot/diff) arrived. Pings do not count. */
  lastDataAt: number;
  lastMessageAt: number;
  timeline: TimelineEvent[];
  /** Screen-reader announcements, newest last. */
  announcements: Array<{ id: number; text: string }>;

  view: ViewMode;
  project: string | null;
  selection: Selection | null;
  showBodies: boolean;
  theme: Theme;
  dayNight: boolean;
  timelineOpen: boolean;
  boardLayout: BoardLayout;
  filters: TimelineFilters;

  setConn(c: ConnState): void;
  touchMessage(): void;
  applySnapshot(s: Snapshot): void;
  applyDiffs(diffs: Diff[]): void;
  setView(v: ViewMode): void;
  selectProject(slug: string): void;
  select(s: Selection | null): void;
  setShowBodies(v: boolean): void;
  setTheme(t: Theme): void;
  setDayNight(v: boolean): void;
  setTimelineOpen(v: boolean): void;
  setBoardLayout(l: BoardLayout): void;
  setFilters(f: Partial<TimelineFilters>): void;
}

/** A stable empty list for selectors: returning a fresh [] each call breaks useSyncExternalStore. */
export const EMPTY = [] as never[];

const TIMELINE_CAP = 500;
let announceId = 0;

function pickProject(projects: readonly ProjectView[], current: string | null): string | null {
  if (current && projects.some((p) => p.slug === current)) return current;
  const rich = projects.find((p) => p.agents.length > 0) ?? projects[0];
  return rich?.slug ?? null;
}

function describe(c: Change): string | null {
  switch (c.t) {
    case "agent":
      return c.to && c.from !== c.to ? `${c.name} is now ${c.to}` : null;
    case "desk":
      return c.change === "added" ? `New ${c.kind} on the desk` : c.change === "resolved" ? `Desk ${c.kind} resolved` : null;
    case "lane":
      return c.to && c.from && c.from.delivery !== c.to.delivery ? `Lane ${c.slug} delivery ${c.to.delivery}` : null;
    case "job":
      return c.to && c.from !== c.to ? `Job ${c.to}` : null;
    default:
      return null;
  }
}

export const useOffice = create<OfficeStore>()((set, get) => ({
  snapshot: null,
  conn: "connecting",
  lastDataAt: Date.now(),
  lastMessageAt: Date.now(),
  timeline: [],
  announcements: [],

  view: loadPref<ViewMode>("view", "office", isViewMode),
  project: loadPref<string | null>("project", null, (v): v is string | null => v === null || typeof v === "string"),
  selection: null,
  showBodies: loadPref("showBodies", false),
  theme: loadPref<Theme>("theme", "system", isTheme),
  dayNight: loadPref("dayNight", true),
  timelineOpen: loadPref("timelineOpen", true),
  boardLayout: loadPref<BoardLayout>("boardLayout", "table", (v): v is BoardLayout => v === "table" || v === "kanban"),
  filters: { project: "all", agent: "all", kinds: [] },

  setConn: (conn) => set({ conn }),
  touchMessage: () => set({ lastMessageAt: Date.now() }),

  applySnapshot(s) {
    const prev = get().snapshot;
    let changes: Change[] = [];
    if (prev) {
      // Reconnect: derive what differs so the engine can fast-forward to the new truth.
      changes = applyOps(prev, diffSnapshots(prev, s), { seq: s.seq, now: s.now }).changes;
    }
    set((st) => ({
      snapshot: s,
      conn: "live",
      lastDataAt: Date.now(),
      lastMessageAt: Date.now(),
      timeline: mergeTimeline(st.timeline, s.timeline, TIMELINE_CAP),
      project: pickProject(s.projects, st.project),
    }));
    const batch: ChangeBatch = { changes, reset: true, diffs: 0, at: Date.now() };
    for (const fn of changeListeners) fn(batch, s);
  },

  applyDiffs(diffs) {
    const st = get();
    if (!st.snapshot || diffs.length === 0) return;
    let snap = st.snapshot;
    const changes: Change[] = [];
    let events: TimelineEvent[] = [];
    for (const d of diffs) {
      const r = applyOps(snap, d.ops, { seq: d.seq, now: d.now });
      snap = r.snapshot;
      changes.push(...r.changes);
      events = events.concat(d.events);
    }
    const spoken = changes.map(describe).filter((x): x is string => x !== null).slice(-3);
    set((cur) => ({
      snapshot: snap,
      lastDataAt: Date.now(),
      lastMessageAt: Date.now(),
      timeline: mergeTimeline(cur.timeline, events, TIMELINE_CAP),
      project: pickProject(snap.projects, cur.project),
      announcements: spoken.length ? [...cur.announcements, ...spoken.map((text) => ({ id: ++announceId, text }))].slice(-8) : cur.announcements,
    }));
    const batch: ChangeBatch = { changes, reset: false, diffs: diffs.length, at: Date.now() };
    for (const fn of changeListeners) fn(batch, snap);
  },

  setView(view) {
    savePref("view", view);
    set({ view });
  },
  selectProject(slug) {
    savePref("project", slug);
    set({ project: slug, selection: null });
  },
  select: (selection) => set({ selection }),
  setShowBodies(showBodies) {
    savePref("showBodies", showBodies);
    set({ showBodies });
  },
  setTheme(theme) {
    savePref("theme", theme);
    set({ theme });
  },
  setDayNight(dayNight) {
    savePref("dayNight", dayNight);
    set({ dayNight });
  },
  setTimelineOpen(timelineOpen) {
    savePref("timelineOpen", timelineOpen);
    set({ timelineOpen });
  },
  setBoardLayout(boardLayout) {
    savePref("boardLayout", boardLayout);
    set({ boardLayout });
  },
  setFilters: (f) => set((st) => ({ filters: { ...st.filters, ...f } })),
}));

/** Selectors. */
export const selectProjectView = (s: OfficeStore): ProjectView | undefined =>
  s.snapshot?.projects.find((p) => p.slug === s.project);

export function isDegraded(s: Snapshot | null): boolean {
  if (!s) return false;
  return s.health.length > 0 || s.projects.some((p) => p.status === "degraded" || p.status === "missing");
}
