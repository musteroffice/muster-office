import {
  buildDeskViews,
  buildJobView,
  buildOwnerView,
  clean,
  computeDeployPosture,
  decodeDeskLine,
  decodeJob,
  decodeOwnerLine,
  decodeProject,
  decodeRegistry,
  decodeRelayLine,
  decodeSamples,
  ownerId,
  matchJobProject,
  deriveEvents,
  diffSnapshots,
  mergeTimeline,
  seedTimeline,
  splitOwnerText,
  stripControl,
  type DecodedProject,
  type Diff,
  type HealthIssue,
  type JobView,
  type OwnerNoteView,
  type ProjectView,
  type RawDeskItem,
  type RawJob,
  type RawOwnerNote,
  type RegistryEntry,
  type RelayEventView,
  type SampleCache,
  type Snapshot,
  type TimelineEvent,
} from "@muster-office/shared";
import type { Sink } from "./sink.js";

export interface ModelOptions {
  now?: () => number;
  demo?: boolean;
  noColor?: boolean;
  version?: string;
  /** Debounce before a commit; events inside the window coalesce into one diff. */
  debounceMs?: number;
  /** A commit never waits longer than this under continuous input. */
  maxWaitMs?: number;
}

interface ProjectSlot {
  /** Raw text last seen; null = file absent. */
  text: string | null;
  decoded: DecodedProject | null;
  error: string | null;
  lastGood: DecodedProject | null;
}

const TIMELINE_CAP = 500;
const OWNER_VIEW_CAP = 100;
/** Per queue file, so a server left running for weeks does not grow without bound. */
const OWNER_NOTES_KEPT = 2000;
const JOBS_VIEW_CAP = 60;
const RELAY_RECENT_CAP = 100;
const BODY_CAP = 8_000;

/** Placeholder identifier for projects that exist only as a desk queue. */
const emptyPolicy = { wipLimit: 3, flowStallMin: 120, landWaitMin: 30, nudgeAfterMin: 30, restartAfterMin: 60, deployLevel: null, comms: "intercom" } as const;

/**
 * Pure in-memory model of everything the office shows. Sources push raw documents in
 * through the `Sink`; the model parses, builds allow-listed views, diffs against the last
 * published snapshot and notifies subscribers.
 */
export class OfficeModel implements Sink {
  private registry = new Map<string, RegistryEntry>();
  private projects = new Map<string, ProjectSlot>(); // key: dir
  private visions = new Map<string, string | null>(); // key: dir
  private desk = new Map<string, RawDeskItem[]>();
  private deskSkipped = new Map<string, number>();
  private owner = new Map<string, RawOwnerNote[]>(); // key: queue file (session)
  private jobs = new Map<string, RawJob>();
  private samples: SampleCache | null = null;
  private relayCounts: Record<string, number> = {};
  private relayRecent: RelayEventView[] = [];
  private sourceIssues = new Map<string, string>();

  private published: Snapshot | null = null;
  private timeline: TimelineEvent[] = [];
  private seq = 0;
  private isReady = false;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt = 0;
  private listeners = new Set<(diff: Diff) => void>();

  /** Server-side lookups rebuilt on each commit. */
  private reportIndex = new Map<string, string>(); // `${slug}\0${packetId}` -> catalog path
  private ownerIndex = new Map<string, RawOwnerNote>(); // public id -> note

  private readonly now: () => number;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;

  constructor(private readonly opts: ModelOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.debounceMs = opts.debounceMs ?? 40;
    this.maxWaitMs = opts.maxWaitMs ?? 250;
  }

  /* ------------------------------------------------------------------ Sink */

  setRegistry(text: string | null): void {
    const next = text === null ? new Map<string, RegistryEntry>() : decodeRegistry(text);
    const same =
      next.size === this.registry.size && [...next].every(([k, v]) => this.registry.get(k)?.dir === v.dir);
    this.registry = next;
    if (!same) this.touch();
  }

  setProject(dir: string, text: string | null): void {
    const existing = this.projects.get(dir);
    if (existing && existing.text === text) return;
    const slot: ProjectSlot = existing ?? { text, decoded: null, error: null, lastGood: null };
    slot.text = text;
    if (text === null) {
      slot.decoded = null;
      slot.error = null;
      slot.lastGood = null;
    } else {
      const r = decodeProject(text);
      if (r.ok) {
        slot.decoded = r.value;
        slot.lastGood = r.value;
        slot.error = null;
      } else {
        slot.decoded = null;
        slot.error = r.error;
      }
    }
    this.projects.set(dir, slot);
    this.touch();
  }

  setVision(dir: string, text: string | null): void {
    if (this.visions.has(dir) && this.visions.get(dir) === text) return;
    this.visions.set(dir, text);
    this.touch();
  }

  deskLines(slug: string, lines: readonly string[], reset: boolean): void {
    let items = reset ? [] : (this.desk.get(slug) ?? []);
    let skipped = reset ? 0 : (this.deskSkipped.get(slug) ?? 0);
    const added: RawDeskItem[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const item = decodeDeskLine(line);
      if (item) added.push(item);
      else skipped++;
    }
    if (added.length) items = [...items, ...added];
    else if (!reset && lines.length === 0) return;
    this.desk.set(slug, items);
    this.deskSkipped.set(slug, skipped);
    this.touch();
  }

  ownerLines(file: string, lines: readonly string[], reset: boolean): void {
    let notes = reset ? [] : (this.owner.get(file) ?? []);
    const added: RawOwnerNote[] = [];
    for (const line of lines) {
      const n = decodeOwnerLine(line);
      if (n) added.push(n);
    }
    if (added.length) notes = [...notes, ...added].slice(-OWNER_NOTES_KEPT);
    else if (!reset) return;
    this.owner.set(file, notes);
    this.touch();
  }

  setJob(id: string, text: string | null): void {
    if (text === null) {
      if (this.jobs.delete(id)) this.touch();
      return;
    }
    const job = decodeJob(text);
    if (!job) {
      this.sourceIssues.set(`job:${id.slice(0, 8)}`, "job record could not be decoded; ignored");
      this.touch();
      return;
    }
    this.sourceIssues.delete(`job:${id.slice(0, 8)}`);
    this.jobs.set(job.id, job);
    this.touch();
  }

  setSamples(text: string | null): void {
    this.samples = text === null ? null : decodeSamples(text);
    this.touch();
  }

  relayLines(lines: readonly string[], reset: boolean): void {
    if (reset) {
      this.relayCounts = {};
      this.relayRecent = [];
    }
    let any = reset;
    for (const line of lines) {
      const e = decodeRelayLine(line);
      if (!e) continue;
      this.relayCounts[e.kind] = (this.relayCounts[e.kind] ?? 0) + 1;
      this.relayRecent.push(e);
      any = true;
    }
    if (this.relayRecent.length > RELAY_RECENT_CAP) this.relayRecent = this.relayRecent.slice(-RELAY_RECENT_CAP);
    if (any) this.touch();
  }

  degraded(source: string, message: string | null): void {
    const had = this.sourceIssues.get(source);
    if (message === null) {
      if (this.sourceIssues.delete(source)) this.touch();
    } else if (had !== message) {
      this.sourceIssues.set(source, clean(message, 300));
      this.touch();
    }
  }

  ready(): void {
    this.isReady = true;
    this.published = this.build();
    this.timeline = mergeTimeline([], seedTimeline(this.published), TIMELINE_CAP);
    this.dirty = false;
  }

  /* --------------------------------------------------------------- publishing */

  subscribe(fn: (diff: Diff) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get clientCount(): number {
    return this.listeners.size;
  }

  getSnapshot(): Snapshot {
    const base = this.published ?? this.build();
    return { ...base, seq: this.seq, timeline: this.timeline.slice(-200) };
  }

  /** Build and publish immediately (tests, shutdown). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.commit();
  }

  private touch(): void {
    this.dirty = true;
    if (!this.isReady) return;
    const t = this.now();
    if (this.timer === null) {
      this.firstDirtyAt = t;
    } else {
      clearTimeout(this.timer);
    }
    const wait = Math.max(0, Math.min(this.debounceMs, this.maxWaitMs - (t - this.firstDirtyAt)));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.commit();
    }, wait);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  private commit(): void {
    if (!this.isReady || !this.dirty) return;
    this.dirty = false;
    const prev = this.published;
    const next = this.build();
    if (!prev) {
      this.published = next;
      return;
    }
    const ops = diffSnapshots(prev, next);
    if (ops.length === 0) {
      this.published = { ...prev, now: next.now };
      return;
    }
    const events = deriveEvents(prev, next);
    this.seq += 1;
    this.timeline = mergeTimeline(this.timeline, events, TIMELINE_CAP);
    this.published = next;
    const diff: Diff = { seq: this.seq, now: next.now, ops, events };
    for (const fn of this.listeners) {
      try {
        fn(diff);
      } catch {
        /* a failing subscriber must not affect others */
      }
    }
  }

  /* -------------------------------------------------------------- body lookup */

  /** Report path as recorded in a catalog (untrusted until the SafeReader approves it). */
  reportPath(project: string, packetId: string): string | undefined {
    return this.reportIndex.get(`${project}\0${packetId}`);
  }

  deskBody(project: string, id: string): { body: string; refs: string[] } | null {
    const item = this.desk.get(project)?.find((i) => i.id === id);
    if (!item) return null;
    return { body: capBody(item.body ?? ""), refs: item.refs.map((r) => clean(r, 200)).slice(0, 20) };
  }

  ownerBody(id: string): { body: string; refs: string[] } | null {
    const n = this.ownerIndex.get(id);
    if (!n) return null;
    const { body } = splitOwnerText(n.text, n.mentioned);
    return { body: capBody(body), refs: n.refs.map((r) => clean(r, 200)).slice(0, 20) };
  }

  /* ------------------------------------------------------------------ build */

  private build(): Snapshot {
    const now = this.now();
    const views: ProjectView[] = [];
    const sessionIndex = new Map<string, { project: string; agent: string }>();
    const ownerOf = new Map<string, string>(); // owner session -> project (first wins)
    const dirIndex = new Map<string, string>(); // normalised dir -> slug
    const reportIndex = new Map<string, string>();
    const usedSlugs = new Set<string>();

    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

    for (const [slug, entry] of this.registry) {
      const slot = this.projects.get(entry.dir);
      const vision = this.visions.get(entry.dir) ?? null;
      let view: ProjectView;
      const decoded = slot?.decoded ?? null;
      if (decoded) {
        view = this.fromDecoded(decoded, vision);
        if (view.slug !== slug) view.notes = [...view.notes, `registry slug "${slug}" differs from catalog slug "${view.slug}"`];
        for (const s of decoded.sessions) {
          if (s.sessionId) sessionIndex.set(s.sessionId, { project: view.slug, agent: s.agent });
          if (s.owner && !ownerOf.has(s.owner)) ownerOf.set(s.owner, view.slug);
        }
        for (const [id, p] of Object.entries(decoded.reportPaths)) reportIndex.set(`${view.slug}\0${id}`, p);
      } else if (slot?.lastGood) {
        // The newest document is unreadable (partial write?): keep showing the last good state.
        view = this.fromDecoded(slot.lastGood, vision);
        view.status = "degraded";
        view.issues = [`latest project.json unreadable (${slot.error ?? "unknown"}); showing last good state`, ...view.issues];
        for (const s of slot.lastGood.sessions) {
          if (s.sessionId) sessionIndex.set(s.sessionId, { project: view.slug, agent: s.agent });
          if (s.owner && !ownerOf.has(s.owner)) ownerOf.set(s.owner, view.slug);
        }
      } else {
        view = placeholder(slug, entry.dir, slot?.error ? "degraded" : "missing", slot?.error ?? "no project.json at the registered directory");
      }
      if (usedSlugs.has(view.slug)) continue;
      usedSlugs.add(view.slug);
      dirIndex.set(norm(entry.dir), view.slug);
      views.push(view);
    }

    // Desk queues for slugs the registry does not know: the Switchboard shows those too.
    for (const slug of this.desk.keys()) {
      if (usedSlugs.has(slug)) continue;
      usedSlugs.add(slug);
      views.push(placeholder(slug, "", "desk-only", "desk queue without a registered project"));
    }

    for (const v of views) {
      const items = this.desk.get(v.slug);
      if (items) v.desk = buildDeskViews(items);
      const skipped = this.deskSkipped.get(v.slug) ?? 0;
      if (skipped > 0) v.notes = [...v.notes, `${skipped} desk line${skipped === 1 ? "" : "s"} skipped (malformed or foreign)`];
    }

    // Owner notes: dedupe by cid (forwarded copies), then attribute to a project.
    const seenCids = new Set<string>();
    const byProject = new Map<string, OwnerNoteView[]>();
    this.ownerIndex = new Map();
    for (const [file, notes] of this.owner) {
      for (const n of notes) {
        if (seenCids.has(n.cid)) continue;
        seenCids.add(n.cid);
        let slug: string | undefined;
        if (n.project) slug = usedSlugs.has(n.project) ? n.project : dirIndex.get(norm(n.project));
        slug ??= sessionIndex.get(n.author)?.project ?? ownerOf.get(file);
        if (!slug) continue;
        const name = sessionIndex.get(n.author)?.agent ?? null;
        const list = byProject.get(slug) ?? [];
        list.push(buildOwnerView(n, name));
        byProject.set(slug, list);
        this.ownerIndex.set(ownerId(n.cid), n);
      }
    }
    for (const v of views) {
      const list = byProject.get(v.slug);
      if (list) v.owner = list.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)).slice(-OWNER_VIEW_CAP);
    }
    this.reportIndex = reportIndex;

    const projectRefs = views.filter((v) => v.dir).map((v) => ({ slug: v.slug, dir: v.dir }));
    const rawJobs = [...this.jobs.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    const running = rawJobs.filter((j) => j.state === "running");
    const rest = rawJobs.filter((j) => j.state !== "running").slice(0, Math.max(0, JOBS_VIEW_CAP - running.length));
    const jobs: JobView[] = [...running, ...rest]
      .map((j) => buildJobView(j, this.samples, matchJobProject(j, projectRefs)))
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

    const health: HealthIssue[] = [...this.sourceIssues].map(([source, message]) => ({ source, message }));

    return {
      seq: this.seq,
      now,
      demo: this.opts.demo ?? false,
      noColor: this.opts.noColor ?? false,
      version: this.opts.version ?? "dev",
      projects: views,
      jobs,
      relay: { counts: { ...this.relayCounts }, recent: this.relayRecent.slice(-RELAY_RECENT_CAP) },
      timeline: [],
      health,
    };
  }

  private fromDecoded(decoded: DecodedProject, vision: string | null): ProjectView {
    const p = decoded.project;
    return {
      ...p,
      deploy: computeDeployPosture(p.policy, vision),
      issues: [...p.issues],
      notes: [...p.notes],
      lanes: p.lanes,
      agents: p.agents,
      packets: p.packets,
      desk: [],
      owner: [],
    };
  }
}

function placeholder(slug: string, dir: string, status: "missing" | "degraded" | "desk-only", issue: string): ProjectView {
  return {
    slug: clean(slug, 64),
    label: clean(slug, 64),
    dir: clean(dir, 400),
    state: "unknown",
    headline: null,
    nextAction: "",
    outcome: "",
    mode: "unknown",
    policy: { ...emptyPolicy },
    deploy: { level: 1, source: "default", notes: [] },
    lanes: [],
    agents: [],
    packets: [],
    desk: [],
    owner: [],
    createdAt: "",
    updatedAt: "",
    status,
    issues: status === "desk-only" ? [] : [clean(issue, 300)],
    notes: status === "desk-only" ? [issue] : [],
  };
}

/** Bodies are text for display: strip escapes/controls but keep newlines, cap length. */
export function capBody(text: string): string {
  const t = stripControl(text);
  const chars = [...t];
  return chars.length <= BODY_CAP ? t : `${chars.slice(0, BODY_CAP - 1).join("")}…`;
}
