import type { DataSource, Sink } from "../sink.js";
import {
  LOOP,
  PROJECTS,
  deskLines,
  jobDocuments,
  ownerLines,
  projectDocument,
  registryDocument,
  relayLines,
  reportDocument,
  visionDocument,
  type Clock,
} from "@automicvault/shared/demo";

export interface DemoOptions {
  /** Milliseconds per simulator step. */
  tickMs: number;
  /** First tick to emit (tests). */
  startTick?: number;
  /** Clock override (tests). */
  now?: () => number;
}

/**
 * Deterministic synthetic Muster. Every tick it renders the demo world for that tick as raw
 * documents (project.json text, JSONL lines, job JSON) and pushes them through the same Sink
 * the filesystem source uses. It touches no files. The script loops every LOOP ticks.
 */
export class DemoSource implements DataSource {
  private sink: Sink | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private k: number;
  private readonly clock: Clock;
  private readonly now: () => number;
  private sent = { desk: new Map<string, number>(), owner: new Map<string, number>(), relay: 0 };
  private jobIds = new Set<string>();
  /** Counts ticks published since start (not modulo LOOP). Used by tests. */
  published = 0;

  constructor(readonly opts: DemoOptions) {
    this.now = opts.now ?? Date.now;
    const t = this.now();
    this.k = opts.startTick ?? 0;
    this.clock = { epoch: t, cycleStart: t - this.k * opts.tickMs, tickMs: opts.tickMs };
  }

  get tick(): number {
    return this.k;
  }

  async start(sink: Sink): Promise<void> {
    this.sink = sink;
    this.publish(true);
    sink.ready();
    if (this.opts.tickMs > 0) {
      this.timer = setInterval(() => this.step(), this.opts.tickMs);
      (this.timer as unknown as { unref?: () => void }).unref?.();
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Advance one step (the timer calls this; tests call it directly with tickMs 0). */
  step(): void {
    this.k = (this.k + 1) % LOOP;
    const wrapped = this.k === 0;
    if (wrapped) this.clock.cycleStart = this.now();
    this.publish(wrapped);
  }

  reportText(project: string, packetId: string): string | null {
    return reportDocument(project, packetId);
  }

  private publish(reset: boolean): void {
    const sink = this.sink;
    if (!sink) return;
    const { k, clock } = this;
    this.published++;
    sink.setRegistry(registryDocument(clock));
    for (const p of PROJECTS) {
      const dir = `/demo/${p.slug}`;
      sink.setProject(dir, projectDocument(p, k, clock));
      sink.setVision(dir, visionDocument(p));

      const desk = deskLines(p, k, clock);
      const deskSent = reset ? 0 : (this.sent.desk.get(p.slug) ?? 0);
      if (reset || desk.length > deskSent) sink.deskLines(p.slug, desk.slice(deskSent), reset);
      this.sent.desk.set(p.slug, desk.length);

      const owner = ownerLines(p, k, clock);
      const ownerSent = reset ? 0 : (this.sent.owner.get(p.slug) ?? 0);
      if (reset || owner.length > ownerSent) sink.ownerLines(p.deskSession, owner.slice(ownerSent), reset);
      this.sent.owner.set(p.slug, owner.length);
    }
    const relay = relayLines(k, clock);
    const relaySent = reset ? 0 : this.sent.relay;
    if (reset || relay.length > relaySent) sink.relayLines(relay.slice(relaySent), reset);
    this.sent.relay = relay.length;

    const docs = jobDocuments(k, clock, this.now());
    for (const [id, text] of docs.jobs) sink.setJob(id, text);
    for (const id of this.jobIds) if (!docs.jobs.has(id)) sink.setJob(id, null);
    this.jobIds = new Set(docs.jobs.keys());
    sink.setSamples(docs.samples);
  }
}
