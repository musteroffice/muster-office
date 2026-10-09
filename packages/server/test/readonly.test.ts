import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fixtureText, makeHome, openSse, waitFor } from "./helpers.js";

/**
 * The server must never open a Muster file for writing. Two independent checks:
 *  1. at runtime, every fs call made *from packages/server/src* is recorded while the whole
 *     pipeline runs (watching, tailing, catalogs, bodies, SSE), and any write-capable call fails the test;
 *  2. statically, no server source mentions a write API or child_process.
 * The test's own fixture writes go through the same mocked module but are attributed by stack and ignored.
 */

const guard = vi.hoisted(() => ({
  serverCalls: [] as string[],
  violations: [] as string[],
}));

const WRITE_FNS = new Set([
  "writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream", "mkdir", "mkdirSync", "mkdtemp", "mkdtempSync",
  "rename", "renameSync", "unlink", "unlinkSync", "rm", "rmSync", "rmdir", "rmdirSync", "copyFile", "copyFileSync", "cp", "cpSync",
  "truncate", "truncateSync", "ftruncate", "ftruncateSync", "symlink", "symlinkSync", "link", "linkSync", "chmod", "chmodSync",
  "chown", "chownSync", "utimes", "utimesSync", "futimes", "futimesSync", "write", "writeSync", "writev", "writevSync",
]);
const READ_ONLY_OPEN = /^r$/;

function wrap<T extends Record<string, unknown>>(real: T, label: string): T {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(real)) {
    if (typeof value !== "function") {
      out[name] = value;
      continue;
    }
    out[name] = (...args: unknown[]) => {
      const stack = new Error().stack ?? "";
      if (/packages[\\/]server[\\/]src/.test(stack)) {
        guard.serverCalls.push(`${label}.${name}`);
        if (WRITE_FNS.has(name)) guard.violations.push(`${label}.${name}(${String(args[0])})`);
        if (name === "open" || name === "openSync") {
          const flags = args[1];
          if (typeof flags === "string" && !READ_ONLY_OPEN.test(flags)) guard.violations.push(`${label}.${name}(${String(args[0])}, ${flags})`);
          if (typeof flags === "number" && flags !== 0) guard.violations.push(`${label}.${name}(${String(args[0])}, flags=${flags})`);
        }
      }
      return (value as (...a: unknown[]) => unknown)(...args);
    };
  }
  return out as T;
}

vi.mock("node:fs", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  const wrapped = wrap(real, "fs");
  return { ...wrapped, default: wrapped };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  const wrapped = wrap(real, "fsp");
  return { ...wrapped, default: wrapped };
});

describe("read-only guarantee", () => {
  const home = makeHome();
  let close: (() => Promise<void>) | undefined;

  beforeAll(() => {
    home.writeProject(fixtureText("project.valid.json"));
    home.writeDesk("harbor-api", fixtureText("desk.valid.jsonl"));
    writeFileSync(join(home.stateDir, "owner-queue", "sess-desk-0000000000.jsonl"), fixtureText("owner.valid.jsonl"));
    home.writeJob("11111111-1111-4111-8111-111111111111.json", fixtureText("job-running.json"));
    home.writeJob("samples.json", fixtureText("samples.json"));
    writeFileSync(join(home.stateDir, "relay-events.jsonl"), fixtureText("relay.valid.jsonl"));
    writeFileSync(join(home.projectDir, "VISION.md"), fixtureText("vision.good.md"));
  });
  afterAll(async () => {
    await close?.();
    home.cleanup();
  });

  it("never calls a write-capable fs API from server code while serving a full session", async () => {
    const { startServer } = await import("../src/index.js");
    const server = await startServer({ home: home.home, port: 0, webRoot: null, version: "test", rescanMs: 200 });
    close = () => server.close();
    const sse = await openSse(`${server.url}/events`);
    await waitFor(() => sse.snapshot());

    // Exercise every read path: catalog rewrite, desk append, owner append, job change, relay append, bodies.
    const next = JSON.parse(fixtureText("project.valid.json")) as { agents: Array<{ name: string; state: string }> };
    next.agents[1]!.state = "landed";
    home.replaceProjectAtomically(JSON.stringify(next));
    home.appendDesk("harbor-api", JSON.stringify({ id: "x1", ts: new Date().toISOString(), from: "a", kind: "decision", title: "t" }));
    home.appendRelay(JSON.stringify({ ts: new Date().toISOString(), session: "s", kind: "desk_note", project: "harbor-api" }));
    home.writeJob("11111111-1111-4111-8111-111111111111.json", fixtureText("job-finished.json").replace("22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111"));
    await waitFor(() => sse.messages.filter((m) => m.event === "diff").length >= 1, 3000);
    await fetch(`${server.url}/api/body?kind=desk&project=harbor-api&id=d1`);
    await fetch(`${server.url}/api/body?kind=report&project=harbor-api&id=a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0`);
    await fetch(`${server.url}/healthz`);
    await new Promise((r) => setTimeout(r, 500));
    sse.close();

    expect(guard.serverCalls.length).toBeGreaterThan(10); // the interceptor really saw the server's reads
    expect(guard.serverCalls.some((c) => c === "fsp.open")).toBe(true);
    expect(guard.violations).toEqual([]);
  });
});

describe("static scan of server sources", () => {
  const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) files.push(p);
    }
  };
  walk(srcDir);

  it("finds the server sources", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("mentions no fs write API, write-mode open flag or child_process", () => {
    const banned = [
      /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|mkdtemp|rename|renameSync|unlink|unlinkSync|rmdir|rmdirSync|copyFile|copyFileSync|truncate|ftruncate|symlink|chmod|chown|utimes)\s*\(/,
      /\bfs(?:p|\.promises)?\.rm(?:Sync)?\s*\(/,
      /open(?:Sync)?\([^)]*,\s*["'`](?:w|a|r\+|w\+|a\+|wx|ax)["'`]/,
      /child_process|\bspawn\(|\bexecFile|\bexecSync|\beval\(|new Function\(/,
    ];
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const re of banned) {
        const m = re.exec(text);
        if (m) hits.push(`${f.split(sep).slice(-2).join("/")}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("registers no route other than GET handlers", () => {
    const app = readFileSync(join(srcDir, "app.ts"), "utf8");
    expect(app).not.toMatch(/app\.(post|put|patch|delete|all|on)\(/);
    expect(app).toMatch(/app\.get\(/);
  });
});
