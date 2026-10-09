import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Diff, Snapshot } from "@muster-office/shared";
import { startServer, type RunningServer } from "../src/index.js";
import { fixtureText, makeHome, openSse, waitFor, type TestHome } from "./helpers.js";

let home: TestHome;
let server: RunningServer | undefined;
let web: string;

beforeEach(() => {
  home = makeHome();
  web = mkdtempSync(join(tmpdir(), "muster-office-web-"));
  writeFileSync(join(web, "index.html"), "<!doctype html><title>office</title>");
  mkdirSync(join(web, "assets"));
  writeFileSync(join(web, "assets", "app.js"), "console.log(1)");
  writeFileSync(join(home.home, "outside-secret.txt"), "TOP SECRET OUTSIDE");
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  home.cleanup();
  rmSync(web, { recursive: true, force: true });
});

const start = async (): Promise<RunningServer> => {
  server = await startServer({ home: home.home, port: 0, webRoot: web, version: "test", rescanMs: 300 });
  return server;
};

/** Raw request so tests can forge Host/Origin and send odd paths. */
function raw(
  s: RunningServer,
  opts: { method?: string; path?: string; headers?: Record<string, string> },
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: s.port, method: opts.method ?? "GET", path: opts.path ?? "/", headers: opts.headers },
      (res) => {
        let body = "";
        res.on("data", (d: Buffer) => (body += d.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("security", () => {
  it("binds to 127.0.0.1 only", async () => {
    const s = await start();
    expect(s.url.startsWith("http://127.0.0.1:")).toBe(true);
  });

  it("rejects non-loopback Host headers (DNS rebinding)", async () => {
    const s = await start();
    for (const host of ["evil.example.com", `evil.example.com:${s.port}`, "127.0.0.1", `127.0.0.1.evil.com:${s.port}`]) {
      const r = await raw(s, { path: "/healthz", headers: { Host: host } });
      expect(r.status, `Host: ${host}`).toBe(403);
    }
    for (const host of [`127.0.0.1:${s.port}`, `localhost:${s.port}`]) {
      expect((await raw(s, { path: "/healthz", headers: { Host: host } })).status, host).toBe(200);
    }
  });

  it("rejects foreign and null Origins, accepts same-origin", async () => {
    const s = await start();
    const host = `127.0.0.1:${s.port}`;
    for (const origin of ["http://evil.example.com", "null", "https://127.0.0.1:" + s.port, `http://127.0.0.1:${s.port + 1}`]) {
      expect((await raw(s, { path: "/api/snapshot", headers: { Host: host, Origin: origin } })).status, origin).toBe(403);
    }
    expect((await raw(s, { path: "/api/snapshot", headers: { Host: host, Origin: `http://127.0.0.1:${s.port}` } })).status).toBe(200);
    expect((await raw(s, { path: "/events", headers: { Host: host, "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
  });

  it("has zero write endpoints: every non-GET/HEAD method is refused", async () => {
    const s = await start();
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]) {
      for (const path of ["/", "/healthz", "/api/body", "/events", "/api/snapshot", "/anything"]) {
        const r = await raw(s, { method, path });
        expect(r.status, `${method} ${path}`).toBe(405);
        expect(r.headers["access-control-allow-origin"]).toBeUndefined();
      }
    }
  });

  it("sends security headers and no CORS headers", async () => {
    const s = await start();
    const r = await raw(s, { path: "/" });
    expect(r.headers["content-security-policy"]).toMatch(/default-src 'none'/);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not serve files outside the web root", async () => {
    const s = await start();
    writeFileSync(join(web, "..", "muster-office-leak.txt"), "LEAK");
    try {
      for (const path of ["/../muster-office-leak.txt", "/..%2fmuster-office-leak.txt", "/%2e%2e/muster-office-leak.txt", "/assets/..%5c..%5cmuster-office-leak.txt", "/%00"]) {
        const r = await raw(s, { path });
        expect(r.body, path).not.toContain("LEAK");
        expect([400, 403, 404, 200]).toContain(r.status);
      }
      expect((await raw(s, { path: "/assets/missing.js" })).status).toBe(404);
      expect((await raw(s, { path: "/assets/app.js" })).body).toBe("console.log(1)");
      expect((await raw(s, { path: "/some/spa/route" })).body).toContain("<title>office</title>");
    } finally {
      rmSync(join(web, "..", "muster-office-leak.txt"), { force: true });
    }
  });
});

describe("with no Muster data at all", () => {
  it("starts, answers /healthz and sends an empty snapshot", async () => {
    rmSync(home.stateDir, { recursive: true, force: true });
    const s = await start();
    const h = (await (await fetch(`${s.url}/healthz`)).json()) as Record<string, unknown>;
    expect(h).toMatchObject({ ok: true, name: "muster-office", projects: 0, demo: false });
    const snap = (await (await fetch(`${s.url}/api/snapshot`)).json()) as Snapshot;
    expect(snap.projects).toEqual([]);
  });
});

describe("live pipeline", () => {
  it("loads the registry, catalog, desk, owner queue, jobs and relay counters", async () => {
    home.writeProject(fixtureText("project.valid.json"));
    home.writeDesk("harbor-api", fixtureText("desk.valid.jsonl"));
    writeFileSync(join(home.stateDir, "owner-queue", "sess-desk-0000000000.jsonl"), fixtureText("owner.valid.jsonl"));
    home.writeJob("11111111-1111-4111-8111-111111111111.json", fixtureText("job-running.json"));
    home.writeJob("22222222-2222-4222-8222-222222222222.json", fixtureText("job-finished.json"));
    home.writeJob("33333333-3333-4333-8333-333333333333.json", fixtureText("job-lost.json"));
    home.writeJob("samples.json", fixtureText("samples.json"));
    writeFileSync(join(home.stateDir, "relay-events.jsonl"), fixtureText("relay.valid.jsonl"));
    writeFileSync(join(home.projectDir, "VISION.md"), fixtureText("vision.good.md"));
    const s = await start();
    const snap = (await (await fetch(`${s.url}/api/snapshot`)).json()) as Snapshot;
    const p = snap.projects[0]!;
    expect(p.slug).toBe("harbor-api");
    expect(p.status).toBe("ok");
    expect(p.agents).toHaveLength(3);
    expect(p.deploy).toMatchObject({ level: 2, source: "VISION.md" });
    expect(p.desk.filter((d) => d.open).map((d) => d.id)).toEqual(["d2", "d3"]);
    expect(p.owner.map((o) => o.title)).toEqual(["Which branch?", "Halfway there"]);
    expect(p.owner[0]?.author).toBe("w-auth");
    expect(snap.jobs.map((j) => j.state).sort()).toEqual(["finished", "lost", "running"]);
    expect(snap.jobs.find((j) => j.state === "running")?.cpuPercent).toBe(250);
    expect(snap.jobs.every((j) => j.project === "harbor-api")).toBe(true);
    expect(snap.relay.counts["desk_note"]).toBe(1);
    expect(snap.timeline.length).toBeGreaterThan(5);
  });

  it("never puts bodies, env vars or session files on the wire", async () => {
    home.writeProject(fixtureText("project.valid.json"));
    home.writeDesk("harbor-api", fixtureText("desk.valid.jsonl"));
    writeFileSync(join(home.stateDir, "owner-queue", "sess-desk-0000000000.jsonl"), fixtureText("owner.valid.jsonl"));
    const s = await start();
    const sse = await openSse(`${s.url}/events`);
    await waitFor(() => sse.snapshot());
    const all = sse.messages.map((m) => m.data).join("\n");
    for (const leak of ["SECRET BODY", "long BODY with details", "sk-ant", "RESTORESECRET", "ANTHROPIC_API_KEY", "sess-w-auth-0000000000", "/.pi/sessions"]) {
      expect(all, leak).not.toContain(leak);
    }
    sse.close();
  });

  it("serves bodies only on request", async () => {
    home.writeProject(fixtureText("project.valid.json"));
    home.writeDesk("harbor-api", fixtureText("desk.valid.jsonl"));
    writeFileSync(join(home.stateDir, "owner-queue", "sess-desk-0000000000.jsonl"), fixtureText("owner.valid.jsonl"));
    const s = await start();
    const desk = (await (await fetch(`${s.url}/api/body?kind=desk&project=harbor-api&id=d1`)).json()) as { body: string };
    expect(desk.body).toContain("SECRET BODY");
    const owner = (await (await fetch(`${s.url}/api/body?kind=owner&project=harbor-api&id=c0ffee00c0ffee00`)).json()) as { body: string };
    expect(owner.body).toContain("long BODY");
    expect((await fetch(`${s.url}/api/body?kind=desk&project=harbor-api&id=nope`)).status).toBe(404);
    expect((await fetch(`${s.url}/api/body?kind=bogus&project=a&id=b`)).status).toBe(400);
    expect((await fetch(`${s.url}/api/body?kind=desk`)).status).toBe(400);
  });

  it("reads reports only inside the project's muster data dir (catalog paths are untrusted)", async () => {
    const cat = JSON.parse(fixtureText("project.valid.json")) as Record<string, unknown> & { packets: Array<Record<string, unknown>> };
    const insideDir = join(home.projectDir, ".brain", "data", "muster", "reports", "auth-rework");
    mkdirSync(insideDir, { recursive: true });
    writeFileSync(join(insideDir, "report.svx"), "---\ntitle: ok\n---\n## Summary\nAll good\u001b[31m!");
    const good = { ...cat.packets[0]!, id: "aaaa1111aaaa1111", report: join(insideDir, "report.svx") };
    const evil = { ...cat.packets[0]!, id: "bbbb2222bbbb2222", report: join(home.home, "outside-secret.txt") };
    const traversal = { ...cat.packets[0]!, id: "cccc3333cccc3333", report: join(insideDir, "..", "..", "..", "..", "..", "..", "..", "outside-secret.txt") };
    cat.packets = [good, evil, traversal];
    home.writeProject(JSON.stringify(cat));
    const s = await start();
    const ok = await fetch(`${s.url}/api/body?kind=report&project=harbor-api&id=aaaa1111aaaa1111`);
    expect(ok.status).toBe(200);
    const body = ((await ok.json()) as { body: string }).body;
    expect(body).toContain("All good");
    expect(body).not.toContain("\u001b");
    for (const id of ["bbbb2222bbbb2222", "cccc3333cccc3333"]) {
      const r = await fetch(`${s.url}/api/body?kind=report&project=harbor-api&id=${id}`);
      expect(r.status, id).toBe(403);
      expect(await r.text()).not.toContain("TOP SECRET");
    }
  });

  it("streams a snapshot, then diffs within about a second of a file change", async () => {
    home.writeProject(fixtureText("project.valid.json"));
    const s = await start();
    const sse = await openSse(`${s.url}/events`);
    const snap = await waitFor(() => sse.snapshot());
    expect(sse.messages[0]?.event).toBe("snapshot");
    expect(snap.projects[0]?.agents.find((a) => a.name === "w-auth")?.state).toBe("reported");

    const next = JSON.parse(fixtureText("project.valid.json")) as { agents: Array<{ name: string; state: string; updatedAt: string }> };
    next.agents.find((a) => a.name === "w-auth")!.state = "landed";
    next.agents.find((a) => a.name === "w-auth")!.updatedAt = new Date().toISOString();
    const t0 = Date.now();
    home.replaceProjectAtomically(JSON.stringify(next)); // Muster writes via temp + rename
    const diffMsg = await waitFor(() => sse.messages.find((m) => m.event === "diff"), 2500);
    const elapsed = Date.now() - t0;
    const diff = JSON.parse(diffMsg.data) as Diff;
    expect(elapsed).toBeLessThan(1500);
    expect(diff.seq).toBe(snap.seq + 1);
    expect(diff.ops.some((o) => o.op === "put" && o.coll === "agents" && (o.item as { state: string }).state === "landed")).toBe(true);
    expect(diff.events.some((e) => /reported → landed/.test(e.text))).toBe(true);
    sse.close();
  });

  it("picks up desk items appended to a JSONL queue (tailing, torn lines held back)", async () => {
    home.writeProject(fixtureText("project.valid.json"));
    home.writeDesk("harbor-api", "");
    const s = await start();
    const sse = await openSse(`${s.url}/events`);
    await waitFor(() => sse.snapshot());
    const line = JSON.stringify({ id: "n1", ts: new Date().toISOString(), from: "w-auth", kind: "blocked", title: "New blocker" });
    // First half of a line: must not surface.
    writeFileSync(join(home.home, ".local", "state", "herdr-desk", "harbor-api.jsonl"), line.slice(0, 20));
    await new Promise((r) => setTimeout(r, 450));
    expect(sse.messages.filter((m) => m.event === "diff")).toHaveLength(0);
    home.writeDesk("harbor-api", `${line}\n`);
    const diff = await waitFor(() => sse.messages.find((m) => m.event === "diff"), 2500);
    const parsed = JSON.parse(diff.data) as Diff;
    expect(parsed.ops.some((o) => o.op === "put" && o.coll === "desk")).toBe(true);
    sse.close();
  });

  it("keeps the last good catalog and marks the project degraded when project.json breaks", async () => {
    home.writeProject(fixtureText("project.valid.json"));
    const s = await start();
    const sse = await openSse(`${s.url}/events`);
    await waitFor(() => sse.snapshot());
    home.writeProject(fixtureText("project.truncated.json")); // partial write, not valid JSON
    await waitFor(() => sse.messages.find((m) => m.event === "diff"), 2500);
    const snap = (await (await fetch(`${s.url}/api/snapshot`)).json()) as Snapshot;
    const p = snap.projects[0]!;
    expect(p.status).toBe("degraded");
    expect(p.agents).toHaveLength(3);
    expect(p.issues[0]).toMatch(/last good/);
    // The server itself is fine.
    expect((await fetch(`${s.url}/healthz`)).status).toBe(200);
    // Recovery clears the badge.
    home.writeProject(fixtureText("project.valid.json"));
    await waitFor(async () => undefined, 1).catch(() => undefined);
    await waitFor(() => {
      const last = sse.messages.filter((m) => m.event === "diff").at(-1);
      return last ? (JSON.parse(last.data) as Diff).ops.some((o) => o.op === "project.put" && o.project.status === "ok") : undefined;
    }, 2500);
    sse.close();
  });

  it("survives a corrupt catalog on first load, as a degraded project", async () => {
    home.writeProject(fixtureText("project.corrupt-rows.json"));
    const s = await start();
    const snap = (await (await fetch(`${s.url}/api/snapshot`)).json()) as Snapshot;
    expect(snap.projects[0]?.status).toBe("degraded");
    expect(snap.projects[0]?.agents).toHaveLength(3);
    home.writeProject("{ not json at all");
    const s2 = snap; // keep lint quiet about unused
    expect(s2.projects).toHaveLength(1);
  });

  it("shows a desk queue whose project is not in the registry", async () => {
    home.writeProject(fixtureText("project.valid.json"));
    home.writeDesk("ghost-project", fixtureText("desk.valid.jsonl"));
    const s = await start();
    const snap = (await (await fetch(`${s.url}/api/snapshot`)).json()) as Snapshot;
    const ghost = snap.projects.find((p) => p.slug === "ghost-project");
    expect(ghost?.status).toBe("desk-only");
    expect(ghost?.desk.filter((d) => d.open)).toHaveLength(2);
  });

  it("shows a registered project with a missing catalog as missing, not crashed", async () => {
    const s = await start();
    const snap = (await (await fetch(`${s.url}/api/snapshot`)).json()) as Snapshot;
    expect(snap.projects[0]?.status).toBe("missing");
    expect(snap.projects[0]?.issues[0]).toMatch(/no project\.json/);
  });
});
