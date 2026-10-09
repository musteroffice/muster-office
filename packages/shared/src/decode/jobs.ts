import { HEAVY_STATES, type HeavyState } from "../enums.js";
import type { JobView } from "../view.js";
import { clean, isRec, ms, num, pick, str, tryParse } from "./util.js";

export interface JobSample {
  cpuPercent: number;
  rssKB: number;
  peakRssKB: number;
  cpuSeconds: number;
}

export interface SampleCache {
  sampledAt: number;
  jobs: Record<string, JobSample>;
}

export interface RawJob {
  id: string;
  host: string;
  repo: string;
  cwd: string;
  command: string;
  state: HeavyState;
  startedAt: string;
  finishedAt: string | null;
  cpuPercent: number;
  rssKB: number;
  peakRssKB: number;
  cpuSeconds: number;
  wallMs: number | null;
  exit: number | null;
  lost: boolean;
  sampledAt: number | null;
}

const JOB_ID_RE = /^[a-f0-9-]{36}$/;

export function isJobFileName(name: string): boolean {
  return /^[a-f0-9-]{36}\.json$/.test(name);
}

export function decodeJob(text: string): RawJob | null {
  const raw = tryParse(text);
  if (!isRec(raw)) return null;
  const state = pick(HEAVY_STATES, raw["state"]);
  const id = str(raw["id"]);
  if (!state || !JOB_ID_RE.test(id)) return null;
  const finished = state !== "running";
  return {
    id,
    host: str(raw["host"]),
    repo: str(raw["repo"]),
    cwd: str(raw["cwd"]),
    command: str(raw["command"]),
    state,
    startedAt: str(raw["startedAt"]),
    finishedAt: finished && typeof raw["finishedAt"] === "string" ? raw["finishedAt"] : null,
    cpuPercent: Math.max(0, num(raw["cpuPercent"])),
    rssKB: Math.max(0, num(raw["rssKB"])),
    peakRssKB: Math.max(0, num(raw["peakRssKB"])),
    cpuSeconds: Math.max(0, num(raw["cpuSeconds"])),
    wallMs: finished && typeof raw["wallMs"] === "number" && Number.isFinite(raw["wallMs"]) ? raw["wallMs"] : null,
    exit: typeof raw["exit"] === "number" && Number.isFinite(raw["exit"]) ? raw["exit"] : null,
    lost: state === "lost" || raw["lost"] === true,
    sampledAt: typeof raw["sampledAt"] === "number" && Number.isFinite(raw["sampledAt"]) ? raw["sampledAt"] : null,
  };
}

export function decodeSamples(text: string): SampleCache | null {
  const raw = tryParse(text);
  if (!isRec(raw) || !isRec(raw["jobs"])) return null;
  const jobs: Record<string, JobSample> = {};
  for (const [id, s] of Object.entries(raw["jobs"])) {
    if (!isRec(s) || !JOB_ID_RE.test(id)) continue;
    jobs[id] = {
      cpuPercent: Math.max(0, num(s["cpuPercent"])),
      rssKB: Math.max(0, num(s["rssKB"])),
      peakRssKB: Math.max(0, num(s["peakRssKB"])),
      cpuSeconds: Math.max(0, num(s["cpuSeconds"])),
    };
  }
  return { sampledAt: num(raw["sampledAt"]), jobs };
}

const REDACTIONS: Array<[RegExp, string]> = [
  // URL credentials: scheme://user:pass@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1***@"],
  // Authorization / Bearer
  [/\b(authorization\s*[:=]\s*)(?:bearer\s+|basic\s+|token\s+)?\S+/gi, "$1***"],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ***"],
  // --flag value / --flag=value for secret-looking flag names
  [/(--?[a-z0-9_-]*(?:token|secret|password|passwd|pwd|api[-_]?key|apikey|credential|auth|private[-_]?key)[a-z0-9_-]*(?:=|\s+))\S+/gi, "$1***"],
  // ENV=value assignments whose name looks secret
  [/\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE_?KEY|AUTH)[A-Za-z0-9_]*=)\S+/gi, "$1***"],
  // Well-known token shapes
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "***"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "***"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "***"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "***"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "***"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "***"],
  // Long opaque blobs (hex/base64) that are almost certainly keys
  [/\b[A-Fa-f0-9]{40,}\b/g, "***"],
  [/\b[A-Za-z0-9+/_-]{48,}={0,2}/g, "***"],
];

/** Redact obvious secrets in a command line and cap it at 300 characters. */
export function redactCommand(command: string): string {
  let out = command;
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  return clean(out, 300);
}

/** Jobs are host-wide; link one to a project when its cwd is inside the project dir or `repo` matches. */
export function matchJobProject(
  job: Pick<RawJob, "cwd" | "repo">,
  projects: ReadonlyArray<{ slug: string; dir: string }>,
): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const cwd = norm(job.cwd);
  let best: { slug: string; len: number } | null = null;
  for (const p of projects) {
    const dir = norm(p.dir);
    if (!dir) continue;
    if (cwd === dir || cwd.startsWith(`${dir}/`)) {
      if (!best || dir.length > best.len) best = { slug: p.slug, len: dir.length };
    }
  }
  if (best) return best.slug;
  const repo = job.repo.toLowerCase();
  for (const p of projects) {
    const base = norm(p.dir).split("/").pop() ?? "";
    if (repo && (repo === p.slug.toLowerCase() || repo === base)) return p.slug;
  }
  return null;
}

/** Overlay a newer sample for running jobs, then project to a view. */
export function buildJobView(job: RawJob, cache: SampleCache | null, project: string | null): JobView {
  let { cpuPercent, rssKB, peakRssKB, cpuSeconds, sampledAt } = job;
  if (job.state === "running" && cache) {
    const s = cache.jobs[job.id];
    if (s && cache.sampledAt > (sampledAt ?? 0)) {
      cpuPercent = s.cpuPercent;
      rssKB = s.rssKB;
      peakRssKB = Math.max(peakRssKB, s.peakRssKB);
      cpuSeconds = Math.max(cpuSeconds, s.cpuSeconds);
      sampledAt = cache.sampledAt;
    }
  }
  return {
    id: job.id,
    host: clean(job.host, 60),
    repo: clean(job.repo, 80),
    project,
    command: redactCommand(job.command),
    state: job.state,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    cpuPercent,
    rssKB,
    peakRssKB,
    cpuSeconds,
    wallMs: job.wallMs,
    exit: job.exit,
    lost: job.lost,
    sampledAt,
  };
}

/** A running job whose telemetry is older than 60 s probably lost its wrapper (Muster marks it on its next pass). */
export function jobIsStale(job: Pick<JobView, "state" | "sampledAt" | "startedAt">, now: number): boolean {
  if (job.state !== "running") return false;
  const last = job.sampledAt ?? ms(job.startedAt, now);
  return now - last > 60_000;
}
