import { describe, expect, it } from "vitest";
import {
  buildDeskViews,
  buildJobView,
  buildOwnerView,
  clean,
  computeDeployPosture,
  decodeDeploySection,
  decodeDeskLine,
  decodeJob,
  decodeOwnerLine,
  decodePolicy,
  decodeProject,
  decodeRegistry,
  decodeRelayLine,
  decodeSamples,
  jobIsStale,
  matchJobProject,
  redactCommand,
  stripControl,
} from "../src/index.js";
import { fixture, loadDesk, loadProject, NOW } from "./helpers.js";

describe("decodeProject", () => {
  it("decodes a valid catalog and exposes only allow-listed fields", () => {
    const p = loadProject();
    expect(p.slug).toBe("harbor-api");
    expect(p.status).toBe("ok");
    expect(p.lanes.map((l) => l.slug)).toEqual(["auth-rework", "billing-sync", "desk"]);
    expect(p.agents.map((a) => [a.name, a.state])).toEqual([
      ["desk", "running"],
      ["w-auth", "reported"],
      ["hawk-1", "silent"],
    ]);
    const worker = p.agents[1]!;
    expect(worker.model).toBe("openai-codex/gpt-6.1-sol");
    expect(worker.thinking).toBe("medium");
    expect(p.packets[0]?.short).toBe("a1b2c3d4e5f6");
    expect(p.policy.wipLimit).toBe(3);
    expect(p.policy.flowStallMin).toBe(120);
    expect(p.deploy).toEqual({ level: 1, source: "policy", notes: [] });
  });

  it("never leaks env vars, session ids, file paths or restore commands", () => {
    const json = JSON.stringify(loadProject());
    for (const secret of ["sk-ant", "SECRETSECRET", "RESTORESECRET", "ANTHROPIC_API_KEY", "/home/dev/.pi/sessions", "sess-w-auth-0000000000", "/home/dev/briefs", ".clones", "terminalId"]) {
      expect(json).not.toContain(secret);
    }
    expect(json).not.toContain("/reports/");
  });

  it("skips corrupt rows and flags the project as degraded without failing", () => {
    const p = loadProject("project.corrupt-rows.json");
    expect(p.status).toBe("degraded");
    expect(p.agents).toHaveLength(3);
    expect(p.lanes).toHaveLength(3);
    expect(p.issues.join("\n")).toMatch(/agents\[3\]/);
    expect(p.issues.join("\n")).toMatch(/agents\[4\] is not an object/);
    expect(p.issues.join("\n")).toMatch(/lanes\[3\] is not an object/);
  });

  it("reports a partial write as an error instead of throwing", () => {
    const r = decodeProject(fixture("project.truncated.json"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not valid JSON/);
  });

  it("rejects non-objects and slug-less documents", () => {
    expect(decodeProject("[]").ok).toBe(false);
    expect(decodeProject("{}").ok).toBe(false);
    expect(decodeProject("").ok).toBe(false);
  });

  it("tolerates schema drift: unknown enums, extra fields, newer writer, missing policy", () => {
    const p = loadProject("project.drift.json");
    expect(p.status).toBe("ok");
    expect(p.notes.join(" ")).toMatch(/newer Muster/);
    const worker = p.agents.find((a) => a.name === "w-auth")!;
    expect(worker.state).toBe("unknown");
    expect(worker.rawState).toBe("teleporting");
    expect(p.lanes[0]?.state).toBe("unknown");
    expect(p.packets[0]?.state).toBe("unknown");
    expect(p.policy.wipLimit).toBe(3);
    expect(p.policy.restartAfterMin).toBe(60);
  });

  it("applies Muster's done-live backfill to lanes with no delivery record", () => {
    const p = loadProject("project.old-delivery.json");
    const by = Object.fromEntries(p.lanes.map((l) => [l.slug, l]));
    expect(by["auth-rework"]?.delivery).toBe("proven");
    expect(by["auth-rework"]?.deliveryEvidence).toBe("before done-live");
    expect(by["billing-sync"]?.delivery).toBe("landed");
    expect(by["billing-sync"]?.deliveryEvidence).toMatch(/not proven/);
    expect(by["old-done"]?.delivery).toBe("proven");
    expect(by["desk"]?.delivery).toBe("none");
    expect(by["billing-sync"]?.deliveryHistory).toHaveLength(1);
  });

  it("decodes policy defaults and nulls like Muster", () => {
    expect(decodePolicy(undefined)).toMatchObject({ wipLimit: 3, flowStallMin: 120, landWaitMin: 30, nudgeAfterMin: 30, restartAfterMin: 60, deployLevel: null });
    expect(decodePolicy({ wipLimit: null, restartAfterMin: null }).wipLimit).toBeNull();
    expect(decodePolicy({ wipLimit: null, restartAfterMin: null }).restartAfterMin).toBeNull();
    expect(decodePolicy({ wipLimit: -2, nudgeAfterMin: 90, restartAfterMin: 10 })).toMatchObject({ wipLimit: 3, restartAfterMin: 90 });
  });
});

describe("registry", () => {
  it("keeps the newest line per slug and skips torn/foreign lines", () => {
    const reg = decodeRegistry(fixture("registry.jsonl"));
    expect([...reg.keys()].sort()).toEqual(["harbor-api", "lantern-web"]);
    expect(reg.get("harbor-api")?.dir).toBe("/home/dev/code/harbor-api");
  });
});

describe("desk queue", () => {
  it("decodes valid lines and resolves items", () => {
    const views = buildDeskViews(loadDesk());
    expect(views.map((v) => [v.id, v.open])).toEqual([
      ["d1", false],
      ["d2", true],
      ["d3", true],
      ["d4", false],
      ["d5", false],
    ]);
    expect(views[0]?.resolvedBy).toBe("d4");
    expect(views[0]?.hasBody).toBe(true);
    expect(views[2]?.refCount).toBe(1);
  });

  it("never puts bodies into views", () => {
    expect(JSON.stringify(buildDeskViews(loadDesk()))).not.toContain("SECRET BODY");
  });

  it("skips corrupt, foreign and torn lines", () => {
    const items = loadDesk("desk.corrupt.jsonl");
    expect(items.map((i) => i.id)).toEqual(["d1", "d2"]);
    expect(decodeDeskLine("")).toBeNull();
    expect(decodeDeskLine("{")).toBeNull();
  });

  it("keeps every open item even when the queue is long", () => {
    const lines = Array.from({ length: 400 }, (_, i) =>
      JSON.stringify({ id: `i${i}`, ts: new Date(NOW + i).toISOString(), from: "a", kind: i === 3 ? "blocked" : "fyi", title: `t${i}` }),
    );
    const items = lines.map(decodeDeskLine).filter((x) => x !== null);
    const views = buildDeskViews(items);
    expect(views.length).toBe(201);
    expect(views.some((v) => v.id === "i3" && v.open)).toBe(true);
  });
});

describe("owner queue", () => {
  const notes = fixture("owner.valid.jsonl").split("\n").map(decodeOwnerLine).filter((x) => x !== null);

  it("skips foreign $type and malformed lines", () => {
    expect(notes).toHaveLength(2);
  });

  it("splits title/body after stripping the mention prefix, and hides the body", () => {
    const v = buildOwnerView(notes[0]!, "w-auth");
    expect(v.title).toBe("Which branch?");
    expect(v.hasBody).toBe(true);
    expect(v.author).toBe("w-auth");
    expect(JSON.stringify(v)).not.toContain("BODY");
    expect(v.kind).toBe("question");
  });

  it("normalises legacy delivery statuses", () => {
    expect(notes[1]?.delivery).toBe("delivered");
  });
});

describe("heavy jobs", () => {
  it("decodes all three states", () => {
    const run = decodeJob(fixture("job-running.json"))!;
    const fin = decodeJob(fixture("job-finished.json"))!;
    const lost = decodeJob(fixture("job-lost.json"))!;
    expect([run.state, fin.state, lost.state]).toEqual(["running", "finished", "lost"]);
    expect(fin.exit).toBe(0);
    expect(lost.exit).toBeNull();
    expect(lost.lost).toBe(true);
    expect(run.finishedAt).toBeNull();
  });

  it("rejects bad ids, unknown states and garbage", () => {
    expect(decodeJob("{")).toBeNull();
    expect(decodeJob(JSON.stringify({ id: "nope", state: "running" }))).toBeNull();
    expect(decodeJob(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", state: "sleeping" }))).toBeNull();
  });

  it("overlays a newer sample onto running jobs only", () => {
    const run = decodeJob(fixture("job-running.json"))!;
    const cache = decodeSamples(fixture("samples.json"))!;
    expect(Object.keys(cache.jobs)).toEqual([run.id]);
    const v = buildJobView(run, cache, "harbor-api");
    expect(v.cpuPercent).toBe(250);
    expect(v.rssKB).toBe(3000);
    expect(v.peakRssKB).toBe(4000);
    const fin = buildJobView(decodeJob(fixture("job-finished.json"))!, cache, null);
    expect(fin.cpuPercent).toBe(0);
  });

  it("redacts secrets in commands", () => {
    const run = decodeJob(fixture("job-running.json"))!;
    const out = buildJobView(run, null, null).command;
    for (const leak of ["abc123456789", "abcdefghijklmnop", "hunter2", "s3cret"]) expect(out).not.toContain(leak);
    expect(out).toContain("npm test");
    expect(redactCommand("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuv node x")).not.toContain("sk-abcdef");
    expect(redactCommand("gh auth --token ghp_abcdefghijklmnopqrstuvwxyz0123456789")).not.toContain("ghp_");
    expect(redactCommand("x".repeat(500)).length).toBeLessThanOrEqual(300);
  });

  it("maps jobs to projects by cwd or repo", () => {
    const projects = [{ slug: "harbor-api", dir: "/home/dev/code/harbor-api" }, { slug: "lantern-web", dir: "/home/dev/code/lantern-web" }];
    expect(matchJobProject({ cwd: "/home/dev/code/harbor-api/.clones/x", repo: "x" }, projects)).toBe("harbor-api");
    expect(matchJobProject({ cwd: "/elsewhere", repo: "lantern-web" }, projects)).toBe("lantern-web");
    expect(matchJobProject({ cwd: "/elsewhere", repo: "nothing" }, projects)).toBeNull();
    expect(matchJobProject({ cwd: "C:\\Code\\Harbor-API\\sub", repo: "z" }, [{ slug: "harbor-api", dir: "C:/code/harbor-api" }])).toBe("harbor-api");
  });

  it("flags running jobs with old telemetry as stale", () => {
    const v = buildJobView(decodeJob(fixture("job-running.json"))!, null, null);
    expect(jobIsStale({ ...v, sampledAt: NOW - 10_000 }, NOW)).toBe(false);
    expect(jobIsStale({ ...v, sampledAt: NOW - 120_000 }, NOW)).toBe(true);
    expect(jobIsStale({ ...v, state: "finished", sampledAt: 0 }, NOW)).toBe(false);
  });
});

describe("relay + posture + sanitising", () => {
  it("decodes relay lines, keeping unknown kinds and dropping malformed ones", () => {
    const events = fixture("relay.valid.jsonl").split("\n").map(decodeRelayLine).filter((x) => x !== null);
    expect(events.map((e) => e.kind)).toEqual(["packet_report", "desk_note", "owner_note", "brand_new_kind"]);
    expect(events[1]).toMatchObject({ itemCount: 2, path: "queue", woke: true });
  });

  it("parses the VISION.md deploy posture like Muster", () => {
    expect(decodeDeploySection(fixture("vision.good.md"))).toEqual({ level: 2, missing: false });
    expect(decodeDeploySection(fixture("vision.bad.md")).issue).toMatch(/malformed/);
    expect(decodeDeploySection("# nothing").missing).toBe(true);
    expect(decodeDeploySection("## Deploy posture\nLevel: 1 (jfdi)\n").issue).toMatch(/differ/);
  });

  it("lets VISION.md win over policy and notes the mismatch", () => {
    const policy = decodePolicy({ deployLevel: 1 });
    expect(computeDeployPosture(policy, fixture("vision.good.md"))).toEqual({
      level: 2,
      source: "VISION.md",
      notes: ["policy 1 differs; VISION.md wins"],
    });
    expect(computeDeployPosture(policy, null)).toEqual({ level: 1, source: "policy", notes: [] });
    expect(computeDeployPosture(decodePolicy({}), null)).toEqual({ level: 1, source: "default", notes: [] });
    expect(computeDeployPosture(decodePolicy({ deployLevel: 3 }), fixture("vision.bad.md")).level).toBe(3);
  });

  it("strips terminal escapes, control characters and bidi overrides", () => {
    expect(stripControl("a\u001b[31mred\u001b[0m\u202eb\u0007c")).toBe("aredbc");
    expect(clean("  hello \n world  ", 50)).toBe("hello world");
    expect(clean("abcdefghij", 5)).toBe("abcd…");
    expect(clean(42 as unknown)).toBe("");
  });
});
