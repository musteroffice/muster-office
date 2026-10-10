import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { decodeRegistry, isJobFileName, type RegistryEntry } from "@automicvault/shared";
import { SafeReader } from "./safe-fs.js";
import type { DataSource, Sink } from "./sink.js";
import { JsonlTailer } from "./tailer.js";

export interface MusterPaths {
  home: string;
  stateDir: string;
  registry: string;
  relay: string;
  ownerDir: string;
  jobsDir: string;
  samples: string;
  deskDir: string;
}

/** All fixed Muster paths under `home` (`docs/data-contract.md` §1). */
export function musterPaths(home: string): MusterPaths {
  const stateDir = join(home, ".local", "state", "muster");
  const jobsDir = join(stateDir, "jobs");
  return {
    home,
    stateDir,
    registry: join(stateDir, "projects.jsonl"),
    relay: join(stateDir, "relay-events.jsonl"),
    ownerDir: join(stateDir, "owner-queue"),
    jobsDir,
    samples: join(jobsDir, "samples.json"),
    deskDir: join(home, ".local", "state", "herdr-desk"),
  };
}

export const projectDataDir = (dir: string): string => join(dir, ".brain", "data", "muster");
export const projectFile = (dir: string): string => join(projectDataDir(dir), "project.json");
export const visionFile = (dir: string): string => join(dir, "VISION.md");

const DESK_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.jsonl$/;
const OWNER_FILE_RE = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?\.jsonl$/;
const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
const RELAY_TAIL_BYTES = 4 * 1024 * 1024;

export interface FsSourceOptions {
  home: string;
  /** Backstop rescan interval; a missed watcher event costs at most this long. */
  rescanMs?: number;
  /** Set false in tests that only want the explicit `scanOnce()`. */
  watch?: boolean;
  log?: (msg: string) => void;
  /** Use polling instead of native watchers (network drives, some containers). */
  usePolling?: boolean;
}

/**
 * Reads Muster's files and pushes raw documents into a Sink. Strictly read-only: every
 * access goes through `SafeReader`, which can only open files for reading inside registered roots.
 */
export class FsSource implements DataSource {
  readonly reader = new SafeReader();
  readonly paths: MusterPaths;
  private sink: Sink | null = null;
  private watcher: FSWatcher | null = null;
  private watched = new Set<string>();
  private rescanTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private again = false;
  private stopped = false;

  private registry = new Map<string, RegistryEntry>();
  private deskTail = new Map<string, JsonlTailer>();
  private ownerTail = new Map<string, JsonlTailer>();
  private relayTail: JsonlTailer;
  private jobStamp = new Map<string, string>();
  private samplesStamp = "";
  private projectStamp = new Map<string, string>();
  private visionStamp = new Map<string, string>();
  private registryStamp = "";

  constructor(private readonly opts: FsSourceOptions) {
    this.paths = musterPaths(opts.home);
    this.relayTail = new JsonlTailer(this.reader, this.paths.relay, { initialTailBytes: RELAY_TAIL_BYTES });
    this.reader.setRoots(this.baseRoots());
  }

  private baseRoots() {
    return [
      { path: this.paths.stateDir, kind: "dir" as const },
      { path: this.paths.deskDir, kind: "dir" as const },
    ];
  }

  async start(sink: Sink): Promise<void> {
    this.sink = sink;
    await this.scanOnce();
    sink.ready();
    if (this.opts.watch === false) return;
    await this.startWatching();
    this.rescanTimer = setInterval(() => this.requestRefresh(0), this.opts.rescanMs ?? 5_000);
    this.rescanTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    await this.watcher?.close();
    this.watcher = null;
  }

  /** One full pass over every source. Safe to call repeatedly (stamps skip unchanged files). */
  async scanOnce(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.scanRegistry();
        await Promise.all([
          this.scanProjects(),
          this.scanDesk(),
          this.scanOwner(),
          this.scanJobs(),
          this.scanRelay(),
        ]);
        await this.syncWatches();
      } while (this.again && !this.stopped);
    } finally {
      this.running = false;
    }
  }

  private requestRefresh(delayMs = 30): void {
    if (this.stopped) return;
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.scanOnce().catch((e: unknown) => this.opts.log?.(`scan failed: ${String(e)}`));
    }, delayMs);
    this.refreshTimer.unref?.();
  }

  /* -------------------------------------------------------------- scanners */

  private async guard(source: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.sink?.degraded(source, null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.sink?.degraded(source, `${source}: ${msg}`);
      this.opts.log?.(`${source}: ${msg}`);
    }
  }

  private async scanRegistry(): Promise<void> {
    await this.guard("registry", async () => {
      const st = await this.reader.statFile(this.paths.registry);
      const stamp = st ? `${st.size}:${st.mtimeMs}` : "absent";
      if (stamp === this.registryStamp) return;
      const text = await this.reader.readText(this.paths.registry, MAX_PROJECT_BYTES);
      this.registryStamp = stamp;
      this.registry = text === null ? new Map() : decodeRegistry(text);
      this.sink?.setRegistry(text);
      // Project dirs become readable roots only because the registry names them.
      this.reader.setRoots([
        ...this.baseRoots(),
        ...[...this.registry.values()].flatMap((e) => [
          { path: projectDataDir(e.dir), kind: "dir" as const },
          { path: visionFile(e.dir), kind: "file" as const },
        ]),
      ]);
    });
  }

  private async scanProjects(): Promise<void> {
    const dirs = new Set([...this.registry.values()].map((e) => e.dir));
    for (const dir of dirs) {
      await this.guard(`project:${dir}`, async () => {
        const st = await this.reader.statFile(projectFile(dir));
        const stamp = st ? `${st.size}:${st.mtimeMs}` : "absent";
        if (this.projectStamp.get(dir) !== stamp) {
          const text = await this.reader.readText(projectFile(dir), MAX_PROJECT_BYTES);
          this.projectStamp.set(dir, stamp);
          this.sink?.setProject(dir, text);
        }
        const vs = await this.reader.statFile(visionFile(dir));
        const vstamp = vs ? `${vs.size}:${vs.mtimeMs}` : "absent";
        if (this.visionStamp.get(dir) !== vstamp) {
          const vtext = await this.reader.readText(visionFile(dir), 1024 * 1024);
          this.visionStamp.set(dir, vstamp);
          this.sink?.setVision(dir, vtext);
        }
      });
    }
    for (const dir of [...this.projectStamp.keys()]) {
      if (!dirs.has(dir)) {
        this.projectStamp.delete(dir);
        this.visionStamp.delete(dir);
        this.sink?.setProject(dir, null);
        this.sink?.setVision(dir, null);
      }
    }
  }

  private async scanDesk(): Promise<void> {
    await this.guard("desk", async () => {
      const names = (await this.reader.list(this.paths.deskDir)).filter((n) => DESK_FILE_RE.test(n));
      const present = new Set(names);
      for (const name of names) {
        const slug = name.slice(0, -".jsonl".length);
        let t = this.deskTail.get(name);
        if (!t) {
          t = new JsonlTailer(this.reader, join(this.paths.deskDir, name), { initialTailBytes: 32 * 1024 * 1024 });
          this.deskTail.set(name, t);
        }
        await this.drain(t, (r) => this.sink?.deskLines(slug, r.lines, r.reset));
      }
      for (const name of [...this.deskTail.keys()]) {
        if (!present.has(name)) {
          this.deskTail.delete(name);
          this.sink?.deskLines(name.slice(0, -".jsonl".length), [], true);
        }
      }
    });
  }

  private async scanOwner(): Promise<void> {
    await this.guard("owner-queue", async () => {
      const names = (await this.reader.list(this.paths.ownerDir)).filter((n) => OWNER_FILE_RE.test(n));
      const present = new Set(names);
      for (const name of names) {
        const key = name.slice(0, -".jsonl".length);
        let t = this.ownerTail.get(name);
        if (!t) {
          t = new JsonlTailer(this.reader, join(this.paths.ownerDir, name), { initialTailBytes: 8 * 1024 * 1024 });
          this.ownerTail.set(name, t);
        }
        await this.drain(t, (r) => this.sink?.ownerLines(key, r.lines, r.reset));
      }
      for (const name of [...this.ownerTail.keys()]) {
        if (!present.has(name)) {
          this.ownerTail.delete(name);
          this.sink?.ownerLines(name.slice(0, -".jsonl".length), [], true);
        }
      }
    });
  }

  private async scanJobs(): Promise<void> {
    await this.guard("jobs", async () => {
      const names = await this.reader.list(this.paths.jobsDir);
      const jobNames = names.filter(isJobFileName);
      const present = new Set<string>();
      for (const name of jobNames) {
        const id = name.slice(0, -".json".length);
        present.add(id);
        const file = join(this.paths.jobsDir, name);
        const st = await this.reader.statFile(file);
        if (!st) continue;
        const stamp = `${st.size}:${st.mtimeMs}`;
        if (this.jobStamp.get(id) === stamp) continue;
        const text = await this.reader.readText(file, 1024 * 1024);
        this.jobStamp.set(id, stamp);
        this.sink?.setJob(id, text);
      }
      for (const id of [...this.jobStamp.keys()]) {
        if (!present.has(id)) {
          this.jobStamp.delete(id);
          this.sink?.setJob(id, null);
        }
      }
      const st = await this.reader.statFile(this.paths.samples);
      const stamp = st ? `${st.size}:${st.mtimeMs}` : "absent";
      if (stamp !== this.samplesStamp) {
        this.samplesStamp = stamp;
        this.sink?.setSamples(st ? await this.reader.readText(this.paths.samples, 4 * 1024 * 1024) : null);
      }
    });
  }

  private async scanRelay(): Promise<void> {
    await this.guard("relay-events", async () => {
      await this.drain(this.relayTail, (r) => this.sink?.relayLines(r.lines, r.reset));
    });
  }

  private async drain(t: JsonlTailer, deliver: (r: { lines: string[]; reset: boolean }) => void): Promise<void> {
    for (let i = 0; i < 64; i++) {
      const r = await t.poll();
      if (r.reset || r.lines.length > 0) deliver(r);
      if (!r.more) return;
    }
  }

  /* -------------------------------------------------------------- watching */

  private desiredWatches(): string[] {
    const p = this.paths;
    const list = [p.stateDir, p.ownerDir, p.jobsDir, p.deskDir];
    for (const e of this.registry.values()) list.push(projectDataDir(e.dir), visionFile(e.dir));
    return list;
  }

  private async startWatching(): Promise<void> {
    this.watcher = chokidarWatch([], {
      ignoreInitial: true,
      persistent: true,
      depth: 0,
      ignorePermissionErrors: true,
      usePolling: this.opts.usePolling ?? false,
      interval: 500,
    });
    const onEvent = (): void => this.requestRefresh(30);
    this.watcher.on("add", onEvent).on("change", onEvent).on("unlink", onEvent).on("addDir", onEvent).on("unlinkDir", onEvent);
    this.watcher.on("error", (e) => this.opts.log?.(`watcher error: ${String(e)}`));
    await this.syncWatches();
  }

  /** Add watches for directories that now exist; unwatch ones no project names any more. */
  private async syncWatches(): Promise<void> {
    const w = this.watcher;
    if (!w) return;
    const want = new Set(this.desiredWatches());
    for (const path of want) {
      if (this.watched.has(path)) continue;
      // Only register paths that exist: chokidar does not reliably pick up late-created ones,
      // so the rescan backstop adds them on the first pass after they appear.
      const present = await stat(path).then(() => true, () => false);
      if (!present) continue;
      this.watched.add(path);
      w.add(path);
    }
    for (const path of [...this.watched]) {
      if (!want.has(path)) {
        this.watched.delete(path);
        void w.unwatch(path);
      }
    }
  }
}
