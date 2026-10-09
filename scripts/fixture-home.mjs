// Builds a throwaway "Muster home" from the repo's test fixtures, laid out exactly like a real install.
// It is a development and testing aid: the Muster Office server itself never writes anywhere.
//
//   node scripts/fixture-home.mjs <dir> [--loop]
//   node bin/muster-office.mjs --home <dir>
//
// With --loop it keeps changing the catalog the way Muster does (write a temp file, rename it over
// project.json) so you can watch the live path without Muster installed.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "..", "packages", "shared", "test", "fixtures");
const fx = (name) => readFileSync(join(fixtures, name), "utf8");

/** Write a fresh fixture home, then return handles to change it. */
export function makeFixtureHome(home, slug = "harbor-api") {
  const state = join(home, ".local", "state", "muster");
  const projectDir = join(home, "code", slug);
  const data = join(projectDir, ".brain", "data", "muster");
  for (const d of [data, join(state, "jobs"), join(state, "owner-queue"), join(home, ".local", "state", "herdr-desk")]) mkdirSync(d, { recursive: true });
  const catalog = (text) => JSON.stringify({ ...JSON.parse(text), dir: projectDir, slug });
  const projectFile = join(data, "project.json");

  writeFileSync(join(state, "projects.jsonl"), `${JSON.stringify({ slug, dir: projectDir, spaceId: null, ts: new Date().toISOString() })}\n`);
  writeFileSync(projectFile, catalog(fx("project.valid.json")));
  writeFileSync(join(projectDir, "VISION.md"), fx("vision.good.md"));
  writeFileSync(join(home, ".local", "state", "herdr-desk", `${slug}.jsonl`), fx("desk.valid.jsonl"));
  writeFileSync(join(state, "owner-queue", "sess-desk-0000000000.jsonl"), fx("owner.valid.jsonl"));
  writeFileSync(join(state, "jobs", "11111111-1111-4111-8111-111111111111.json"), fx("job-running.json"));
  writeFileSync(join(state, "jobs", "22222222-2222-4222-8222-222222222222.json"), fx("job-finished.json"));
  writeFileSync(join(state, "jobs", "33333333-3333-4333-8333-333333333333.json"), fx("job-lost.json"));
  writeFileSync(join(state, "jobs", "samples.json"), fx("samples.json"));
  writeFileSync(join(state, "relay-events.jsonl"), fx("relay.valid.jsonl"));

  return openFixtureHome(home, slug);
}

/** Handles to an existing fixture home (writes nothing until you call a mutator). */
export function openFixtureHome(home, slug = "harbor-api") {
  const projectDir = join(home, "code", slug);
  const projectFile = join(projectDir, ".brain", "data", "muster", "project.json");
  return {
    home,
    projectDir,
    projectFile,
    /** Replace project.json the way Muster does: temp file, then atomic rename. */
    setAgentState(name, agentState) {
      const doc = JSON.parse(readFileSync(projectFile, "utf8"));
      for (const a of doc.agents) if (a.name === name) Object.assign(a, { state: agentState, updatedAt: new Date().toISOString() });
      const tmp = `${projectFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(doc));
      renameSync(tmp, projectFile);
    },
    appendDesk(item) {
      appendFileSync(join(home, ".local", "state", "herdr-desk", `${slug}.jsonl`), `${JSON.stringify({ id: `n${Date.now()}`, ts: new Date().toISOString(), from: "w-auth", ...item })}\n`);
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/fixture-home.mjs <dir> [--loop]");
    process.exit(2);
  }
  const h = makeFixtureHome(resolve(dir));
  console.log(`fixture Muster home written to ${h.home}\nrun: node bin/muster-office.mjs --home "${h.home}"`);
  if (process.argv.includes("--loop")) {
    const cycle = ["running", "silent", "nudged", "restarted", "running", "reported", "verified", "landed"];
    let i = 0;
    setInterval(() => {
      const next = cycle[i++ % cycle.length];
      h.setAgentState("w-auth", next);
      if (i % 3 === 0) h.appendDesk({ kind: "decision", title: `Decision ${i}` });
      console.log(`w-auth → ${next}`);
    }, 3000);
    console.log("looping (Ctrl-C to stop)…");
  }
}
