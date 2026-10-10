import { describe, expect, it } from "vitest";
import {
  AGENT_STATES,
  buildDeskViews,
  buildJobView,
  decodeDeskLine,
  decodeJob,
  decodeProject,
  decodeSamples,
  type JobView,
  type ProjectView,
  type RawDeskItem,
} from "@muster-office/shared";
import { LOOP, PROJECTS, deskLines, jobDocuments, projectDocument } from "@muster-office/shared/demo";
import { TILE } from "../src/office/layout";
import { tileOf } from "../src/office/transitions";
import { OfficeWorld, type Target } from "../src/office/world";

const T0 = Date.parse("2026-10-09T12:00:00Z");
const TICK = 2500;

/** Build the harbor/lantern/quarry view for demo tick `k`, exactly as the server would. */
function viewAt(slug: string, k: number): { project: ProjectView; jobs: JobView[]; now: number } {
  const clock = { epoch: T0, cycleStart: T0, tickMs: TICK };
  const def = PROJECTS.find((p) => p.slug === slug)!;
  const decoded = decodeProject(projectDocument(def, k, clock));
  if (!decoded.ok) throw new Error(decoded.error);
  const items = deskLines(def, k, clock).map(decodeDeskLine).filter((x): x is RawDeskItem => x !== null);
  const project: ProjectView = { ...decoded.value.project, desk: buildDeskViews(items), deploy: { level: slug === "harbor-api" ? 2 : 1, source: "default", notes: [] } };
  const now = T0 + k * TICK;
  const docs = jobDocuments(k, clock, now);
  const samples = decodeSamples(docs.samples);
  const jobs = [...docs.jobs.values()].map((t) => decodeJob(t)).filter((j) => j !== null).map((j) => buildJobView(j, samples, null));
  return { project, jobs, now };
}

/** Step the world forward `ms` in 50 ms frames. */
function run(world: OfficeWorld, ms: number, now: number): number {
  for (let t = 0; t < ms; t += 50) {
    now += 50;
    world.step(50, now);
  }
  return now;
}

const actor = (w: OfficeWorld, name: string) => w.actors.get(name)!;
const snapTo = (w: OfficeWorld, slug: string, k: number, snap = true) => {
  const v = viewAt(slug, k);
  w.sync(v.project, v.jobs, v.now, snap);
  return v.now;
};

describe("initial placement", () => {
  it("seats every present agent and hides planned/closed ones", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    snapTo(w, "harbor-api", 1);
    const ada = actor(w, "ada");
    expect(ada.visible).toBe(true);
    expect(ada.sitting).toBe(true);
    expect(ada.script).toEqual([]);
    expect(tileOf(ada)).toEqual(w.layout.bays.find((b) => b.lane.slug === "auth-rework")!.desks[1]!.seat);
    expect(actor(w, "bram").visible).toBe(false); // planned: empty chair
    // desk operator sits at the front desk, not in the role lane's pod
    expect(tileOf(actor(w, "yaffle"))).toEqual(w.layout.front.seats[0]);
  });

  it("gives every role a different, stable seat inside its pod", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    snapTo(w, "harbor-api", 1);
    const seats = [...w.actors.values()].filter((a) => a.visible).map((a) => `${a.x},${a.y}`);
    expect(new Set(seats).size).toBe(seats.length);
    const first = [...w.actors.values()].map((a) => `${a.name}:${a.x},${a.y}`).sort();
    snapTo(w, "harbor-api", 1);
    expect([...w.actors.values()].map((a) => `${a.name}:${a.x},${a.y}`).sort()).toEqual(first);
  });
});

describe("lifecycle animations", () => {
  it("planned → launching: walks in from the door, then sits", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    let now = snapTo(w, "harbor-api", 3);
    const bram = actor(w, "bram");
    expect(bram.visible).toBe(false);
    const v = viewAt("harbor-api", 4);
    w.sync(v.project, v.jobs, v.now, false);
    now = run(w, 50, v.now);
    expect(bram.visible).toBe(true);
    expect(Math.abs(bram.x - w.layout.door.spawn.x)).toBeLessThan(TILE);
    expect(Math.abs(bram.y - w.layout.door.spawn.y)).toBeLessThan(TILE);
    now = run(w, 400, now);
    expect(bram.pose.kind).toBe("walk");
    expect(bram.sitting).toBe(false);
    run(w, 40_000, now);
    expect(bram.sitting).toBe(true);
    expect(tileOf(bram)).toEqual(bram.seat);
    expect(bram.shown).toBe("launching");
  });

  it("running → reported: stands, carries a sheet to the tray, drops it, returns and sits", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    let now = snapTo(w, "harbor-api", 5);
    const ada = actor(w, "ada");
    const home = { x: ada.x, y: ada.y };
    const v = viewAt("harbor-api", 6);
    w.sync(v.project, v.jobs, v.now, false);
    now = v.now;
    expect(w.trayCount()).toBe(0); // the data counts the packet, but it has not been handed over yet
    let sawCarry = false;
    let sawFlight = false;
    let leftSeat = false;
    let reachedTray = false;
    const drop = w.layout.front.trays[0]!.drop;
    for (let t = 0; t < 90_000; t += 50) {
      now += 50;
      w.step(50, now);
      if (ada.carrying) sawCarry = true;
      if (!ada.sitting) leftSeat = true;
      if (w.flights.some((f) => f.kind === "paper")) sawFlight = true;
      const tile = tileOf(ada);
      if (tile.x === drop.x && tile.y === drop.y) reachedTray = true;
      if (ada.script.length === 0 && ada.sitting && leftSeat) break;
    }
    expect(leftSeat).toBe(true);
    expect(sawCarry).toBe(true);
    expect(reachedTray).toBe(true);
    expect(sawFlight).toBe(true);
    expect(ada.carrying).toBe(false);
    expect(ada.sitting).toBe(true);
    expect({ x: ada.x, y: ada.y }).toEqual(home);
    expect(ada.shown).toBe("reported");
    expect(w.trayCount()).toBe(1);
  });

  it("silent shows ZZZ, nudged pops a bang bubble, restarted spins", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    let now = snapTo(w, "harbor-api", 14);
    const bram = actor(w, "bram");
    let v = viewAt("harbor-api", 15);
    w.sync(v.project, v.jobs, v.now, false);
    now = run(w, 200, v.now);
    expect(bram.emote).toBe("zzz");
    expect(bram.pose.kind).toBe("slump");
    v = viewAt("harbor-api", 19);
    w.sync(v.project, v.jobs, v.now, false);
    now = run(w, 300, v.now);
    expect(bram.emote).toBe("bang");
    expect(bram.pose.kind).toBe("alert");
    v = viewAt("harbor-api", 23);
    w.sync(v.project, v.jobs, v.now, false);
    let spun = false;
    for (let t = 0; t < 7000; t += 50) {
      now += 50;
      w.step(50, now);
      if (bram.spin > 0) spun = true;
    }
    expect(spun).toBe(true);
    expect(bram.shown).toBe("restarted");
    expect(bram.pose).toMatchObject({ kind: "sit" });
  });

  it("failed sparks and smokes; interrupted ghosts; restoring materialises, then solid again", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    let now = snapTo(w, "lantern-web", 7);
    const dina = actor(w, "dina");
    let v = viewAt("lantern-web", 8);
    w.sync(v.project, v.jobs, v.now, false);
    now = run(w, 1500, v.now);
    expect(dina.shown).toBe("failed");
    expect(dina.smoke).toBe(true);
    expect(dina.screen).toBe("error");
    expect(w.particles.length).toBeGreaterThan(0);

    v = viewAt("lantern-web", 22);
    w.sync(v.project, v.jobs, v.now, false);
    let materialised = false;
    for (let t = 0; t < 2500; t += 50) {
      now += 50;
      w.step(50, now);
      if (dina.materialize > 0) materialised = true;
    }
    expect(materialised).toBe(true);
    expect(dina.alpha).toBeLessThan(1);
    v = viewAt("lantern-web", 26);
    w.sync(v.project, v.jobs, v.now, false);
    run(w, 2000, v.now);
    expect(dina.shown).toBe("running");
    expect(dina.alpha).toBe(1);
  });

  it("hawk goes ghostly when interrupted", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    const now = snapTo(w, "harbor-api", 9);
    const kestrel = actor(w, "kestrel");
    expect(kestrel.alpha).toBe(1);
    const v = viewAt("harbor-api", 10);
    w.sync(v.project, v.jobs, v.now, false);
    run(w, 1500, now + TICK);
    expect(kestrel.shown).toBe("interrupted");
    expect(kestrel.alpha).toBeLessThan(0.6);
    expect(kestrel.alpha).toBeGreaterThan(0.2);
  });

  it("running → closed: walks out of the door and the chair empties", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    let now = snapTo(w, "harbor-api", 29);
    const boss = actor(w, "boss-b");
    expect(boss.visible).toBe(true);
    const v = viewAt("harbor-api", 30);
    w.sync(v.project, v.jobs, v.now, false);
    now = v.now;
    now = run(w, 500, now);
    expect(boss.sitting).toBe(false);
    run(w, 60_000, now);
    expect(boss.visible).toBe(false);
    expect(boss.shown).toBe("closed");
  });
});

describe("bursts, fast-forward and reduced motion", () => {
  it("a snapshot (reconnect) places everyone without animating", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    snapTo(w, "harbor-api", 5);
    snapTo(w, "harbor-api", 12, true);
    expect(w.busyActors).toBe(0);
    expect(actor(w, "ada").shown).toBe("landed");
    expect(w.transitions).toBe(0);
  });

  it("many queued transitions fast-forward instead of dragging on", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    snapTo(w, "harbor-api", 5);
    // Flip ada through a long chain of states in one second of wall time.
    const states = ["reported", "running", "reported", "running", "reported", "running", "reported", "running"];
    const base = viewAt("harbor-api", 5);
    let now = base.now;
    for (const s of states) {
      const project = { ...base.project, agents: base.project.agents.map((a) => (a.name === "ada" ? { ...a, state: s as never } : a)) };
      w.sync(project, base.jobs, now, false);
      now += 100;
      w.step(100, now);
    }
    const ada = actor(w, "ada");
    expect(ada.script.reduce((n, s) => n + (s.k === "walkTo" ? 1 : 0), 0)).toBeLessThan(10);
    const fast = w.log.filter((l) => l.fast).length;
    expect(fast).toBeGreaterThan(0);
    run(w, 120_000, now);
    expect(ada.script).toEqual([]);
    expect(ada.shown).toBe("running");
    expect(ada.sitting).toBe(true);
  });

  it("reduced motion: no walking, no particles, tokens snap", () => {
    const w = new OfficeWorld({ reducedMotion: true });
    snapTo(w, "harbor-api", 5);
    const v = viewAt("harbor-api", 6);
    w.sync(v.project, v.jobs, v.now, false);
    const ada = actor(w, "ada");
    expect(ada.script).toEqual([]);
    expect(ada.shown).toBe("reported");
    expect(ada.sitting).toBe(true);
    w.step(50, v.now + 50);
    expect(w.particles).toEqual([]);
    expect(w.flights).toEqual([]);
    const v2 = viewAt("harbor-api", 12);
    w.sync(v2.project, v2.jobs, v2.now, false);
    expect(w.tokens.get("auth-rework")).toMatchObject({ pad: 0, mode: "rest" });
  });
});

describe("delivery tokens, queue and desk", () => {
  it("a landed packet flies from the tray to the first pad, then rides the belt", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    snapTo(w, "harbor-api", 11);
    expect(w.tokens.get("auth-rework")).toMatchObject({ pad: -1, mode: "rest" });
    let v = viewAt("harbor-api", 12);
    w.sync(v.project, v.jobs, v.now, false);
    expect(w.tokens.get("auth-rework")?.mode).toBe("flight");
    expect(w.flights.some((f) => f.kind === "stamped")).toBe(true);
    run(w, 8000, v.now);
    expect(w.tokens.get("auth-rework")).toMatchObject({ pad: 0, to: 0, mode: "rest" });
    v = viewAt("harbor-api", 20);
    w.sync(v.project, v.jobs, v.now, false);
    expect(w.tokens.get("auth-rework")?.mode).toBe("slide");
    run(w, 1200, v.now);
    expect(w.tokens.get("auth-rework")).toMatchObject({ pad: 1, to: 1, mode: "rest" });
    v = viewAt("harbor-api", 26);
    w.sync(v.project, v.jobs, v.now, false);
    run(w, 1200, v.now);
    expect(w.tokens.get("auth-rework")).toMatchObject({ pad: 2, mode: "rest" });
  });

  it("queues backlog lanes at the door while WIP is at the limit, and releases them when a slot frees", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    const now = snapTo(w, "harbor-api", 1);
    expect(w.flow?.atLimit).toBe(true);
    expect(w.visitors.map((v) => v.name)).toEqual(["notify-queue", "mail-templates"]);
    run(w, 20_000, now);
    for (const [i, v] of w.visitors.entries()) expect(tileOf(v)).toEqual(w.layout.queue[i]);
    snapTo(w, "harbor-api", 21, false);
    expect(w.flow?.atLimit).toBe(false);
    expect(w.visitors).toHaveLength(0);
  });

  it("builds pile heat from the open desk items and eases it back when they resolve", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    let now = snapTo(w, "harbor-api", 13);
    const blocked = w.piles.find((p) => p.kind === "blocked");
    expect(blocked?.count).toBe(1);
    expect(blocked?.shownHeat).toBeGreaterThan(0);
    const v = viewAt("harbor-api", 21);
    w.sync(v.project, v.jobs, v.now, false);
    now = v.now;
    expect(w.piles.find((p) => p.kind === "blocked")?.count).toBe(0);
    expect(w.piles.find((p) => p.kind === "blocked")?.shownHeat).toBeGreaterThan(0.5); // still cooling
    run(w, 6000, now);
    expect(w.piles.find((p) => p.kind === "blocked")).toBeUndefined();
  });

  it("flares on a new desk item and on a resolution", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    snapTo(w, "harbor-api", 12);
    const v = viewAt("harbor-api", 13);
    w.sync(v.project, v.jobs, v.now, false);
    w.applyChanges([{ t: "desk", project: "harbor-api", id: "h-2", kind: "blocked", change: "added" }], false);
    expect(w.flares.at(-1)?.kind).toBe("added");
    w.applyChanges([{ t: "desk", project: "harbor-api", id: "h-2", kind: "blocked", change: "resolved" }], false);
    expect(w.flares.at(-1)?.kind).toBe("resolved");
  });

  it("reports a dead desk with the skull", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    snapTo(w, "quarry-batch", 5);
    expect(w.deadDesk).toBe(true);
    snapTo(w, "harbor-api", 5);
    expect(w.deadDesk).toBe(false);
  });
});

describe("hit testing", () => {
  const w = new OfficeWorld({ reducedMotion: false });
  snapTo(w, "harbor-api", 1);

  it("finds agents, desk, door, racks, gates, strips, signs and ticker", () => {
    const ada = actor(w, "ada");
    expect(w.hitTest(ada.x, ada.y - 10)).toEqual({ type: "agent", project: "harbor-api", name: "ada" });
    const L = w.layout;
    const at = (tx: number, ty: number): Target | null => w.hitTest(tx * TILE + 8, ty * TILE + 8);
    expect(at(L.front.counter.x + 3, L.front.counter.y)).toMatchObject({ type: "desk" });
    expect(at(L.door.rect.x, L.door.rect.y)).toMatchObject({ type: "door" });
    const bay = L.bays.find((b) => b.lane.slug === "auth-rework")!;
    expect(at(bay.gate!.x, bay.gate!.y)).toMatchObject({ type: "lane", part: "gate", slug: "auth-rework" });
    expect(at(bay.strip!.x + 3, bay.strip!.y + 1)).toMatchObject({ type: "lane", part: "strip" });
    expect(at(bay.sign.x + 2, bay.sign.y)).toMatchObject({ type: "lane", part: "sign" });
    expect(at(L.wall.ticker.x + 5, L.wall.ticker.y)).toMatchObject({ type: "project", part: "ticker" });
    expect(at(L.wall.sign.x + 5, L.wall.sign.y + 1)).toMatchObject({ type: "project", part: "sign" });
    const job = w.rackJobs()[0];
    expect(at(L.machine.racks[0]!.rect.x, L.machine.racks[0]!.rect.y)).toEqual(job ? { type: "job", id: job.id } : { type: "rack", slot: 0 });
    expect(at(2, 1)).toBeNull();
  });

  it("returns a box for any target it can hit", () => {
    const t = w.hitTest(actor(w, "ada").x, actor(w, "ada").y - 10)!;
    expect(w.boxOf(t)).toMatchObject({ w: 16, h: 24 });
    expect(w.boxOf({ type: "desk", project: "harbor-api" })).not.toBeNull();
  });
});

describe("a whole demo cycle", () => {
  it("runs 84 ticks of real time without errors and every actor ends at rest at home", () => {
    const w = new OfficeWorld({ reducedMotion: false });
    for (const slug of ["harbor-api", "lantern-web", "quarry-batch"]) {
      const fresh = new OfficeWorld({ reducedMotion: false });
      let now = snapTo(fresh, slug, 0);
      for (let k = 1; k <= LOOP; k++) {
        const v = viewAt(slug, k % LOOP);
        fresh.sync(v.project, v.jobs, v.now + 1_000_000, false);
        now = run(fresh, TICK, now + 0);
        for (const a of fresh.actors.values()) {
          expect(Number.isFinite(a.x) && Number.isFinite(a.y), `${a.name} position`).toBe(true);
        }
      }
      run(fresh, 120_000, now);
      for (const a of fresh.actors.values()) {
        expect(a.script, `${slug}/${a.name} still scripted`).toEqual([]);
        if (a.visible && a.sitting) expect(tileOf(a)).toEqual(a.seat);
      }
      for (const s of fresh.statesSeen) w.statesSeen.add(s);
    }
    // Across the three floors the cycle visits every lifecycle state.
    expect([...w.statesSeen].sort()).toEqual([...AGENT_STATES].sort());
  });
});
