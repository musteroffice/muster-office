import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Snapshot } from "@muster-office/shared";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, "..", "..", "shared", "test", "fixtures");
export const fixtureText = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

export interface TestHome {
  home: string;
  projectDir: string;
  stateDir: string;
  /** Test-only helpers: the *test* writes Muster files, never the server. */
  writeProject(text: string): void;
  replaceProjectAtomically(text: string): void;
  appendDesk(slug: string, line: string): void;
  writeDesk(slug: string, text: string): void;
  writeJob(name: string, text: string): void;
  appendRelay(line: string): void;
  cleanup(): void;
}

/** Build a throwaway HOME laid out like a real Muster install. */
export function makeHome(slug = "harbor-api"): TestHome {
  const home = mkdtempSync(join(tmpdir(), "muster-office-test-"));
  const stateDir = join(home, ".local", "state", "muster");
  const projectDir = join(home, "code", slug);
  const dataDir = join(projectDir, ".brain", "data", "muster");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(stateDir, "jobs"), { recursive: true });
  mkdirSync(join(stateDir, "owner-queue"), { recursive: true });
  mkdirSync(join(home, ".local", "state", "herdr-desk"), { recursive: true });
  writeFileSync(join(stateDir, "projects.jsonl"), `${JSON.stringify({ slug, dir: projectDir, spaceId: null, ts: new Date().toISOString() })}\n`);
  const catalog = (text: string): string => {
    const o = JSON.parse(text) as Record<string, unknown>;
    o["dir"] = projectDir;
    o["slug"] = slug;
    return JSON.stringify(o);
  };
  const projectFile = join(dataDir, "project.json");
  return {
    home,
    projectDir,
    stateDir,
    writeProject: (text) => writeFileSync(projectFile, safeCatalog(text, catalog)),
    replaceProjectAtomically: (text) => {
      const tmp = `${projectFile}.${process.pid}.tmp`;
      writeFileSync(tmp, safeCatalog(text, catalog));
      renameSync(tmp, projectFile);
    },
    appendDesk: (s, line) => appendFileSync(join(home, ".local", "state", "herdr-desk", `${s}.jsonl`), `${line}\n`),
    writeDesk: (s, text) => writeFileSync(join(home, ".local", "state", "herdr-desk", `${s}.jsonl`), text),
    writeJob: (name, text) => writeFileSync(join(stateDir, "jobs", name), text),
    appendRelay: (line) => appendFileSync(join(stateDir, "relay-events.jsonl"), `${line}\n`),
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

function safeCatalog(text: string, rewrite: (t: string) => string): string {
  try {
    return rewrite(text);
  } catch {
    return text; // deliberately corrupt documents pass through untouched
  }
}

export function copyFixture(name: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(FIXTURES, name), to);
}

export async function waitFor<T>(fn: () => T | undefined | false, timeoutMs = 3000, stepMs = 25): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

/** Minimal SSE client over fetch for tests. */
export async function openSse(url: string, headers: Record<string, string> = {}) {
  const ac = new AbortController();
  const res = await fetch(url, { headers: { accept: "text/event-stream", ...headers }, signal: ac.signal });
  const messages: SseMessage[] = [];
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  void (async () => {
    if (!reader) return;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const m: SseMessage = { event: "message", data: "" };
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) m.event = line.slice(6).trim();
            else if (line.startsWith("data:")) m.data += (m.data ? "\n" : "") + line.slice(5).trimStart();
            else if (line.startsWith("id:")) m.id = line.slice(3).trim();
          }
          messages.push(m);
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return {
    status: res.status,
    headers: res.headers,
    messages,
    snapshot: (): Snapshot | undefined => {
      const m = messages.find((x) => x.event === "snapshot");
      return m ? (JSON.parse(m.data) as Snapshot) : undefined;
    },
    close: () => ac.abort(),
  };
}
