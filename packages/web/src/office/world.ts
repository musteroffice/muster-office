import {
  backlog,
  deskPiles,
  flowInfo,
  isDeadDesk,
  type AgentStateOrUnknown,
  type Change,
  type DeskPile,
  type FlowInfo,
  type JobView,
  type LaneView,
  type OpenKind,
  type ProjectView,
} from "@muster-office/shared";
import { steadyFor, type Actor, type Emote } from "./actors";
import { FLOOR_W, TILE, layoutFloor, rectContains, rectPx, type Bay, type FloorLayout, type Rect, type Tile } from "./layout";
import { hash } from "./palette";
import { findPath } from "./path";
import { lookFor } from "./sprites/procedural";
import type { Look, Pose } from "./sprites/types";
import { advance, fastForward, feet, planTransition, scriptDuration, tileOf, type Env, type PlanCtx, type SceneEvent, type Step } from "./transitions";

/**
 * The office's *state*: where everyone is, what they are doing, what is flying through the air.
 * No DOM in here, so it is unit-testable. `scene-draw.ts` renders it.
 */

export type Target =
  | { type: "agent"; project: string; name: string }
  | { type: "lane"; project: string; slug: string; part: "bay" | "strip" | "gate" | "sign" }
  | { type: "desk"; project: string }
  | { type: "door"; project: string }
  | { type: "project"; project: string; part: "sign" | "ticker" }
  | { type: "job"; id: string }
  | { type: "rack"; slot: number };

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  kind: "spark" | "smoke" | "star";
  color: string;
  size: number;
}

export interface Flight {
  /** Pixel path, travelled at constant speed. */
  pts: Array<{ x: number; y: number }>;
  t: number;
  dur: number;
  kind: "paper" | "stamped";
  arc: number;
  onDone?: () => void;
}

export interface LaneToken {
  lane: string;
  /** Pad index currently shown (-1 none). */
  pad: number;
  /** Pad index it is moving to (animating). */
  to: number;
  /** 0..1 progress of a belt slide. */
  t: number;
  /** "flight": a packet flight is carrying it; "slide": it rides the belt; "rest": it sits on a pad. */
  mode: "rest" | "slide" | "flight";
  waived: boolean;
}

export interface Flare {
  x: number;
  y: number;
  t: number;
  kind: "added" | "resolved";
  color: string;
}

export interface PileView {
  kind: OpenKind;
  count: number;
  heat: number;
  shownHeat: number;
  tier: DeskPile["tier"];
  oldestMs: number;
}

export interface TransitionLogEntry {
  at: number;
  agent: string;
  from: AgentStateOrUnknown;
  to: AgentStateOrUnknown;
  steps: string[];
  fast: boolean;
}

export interface WorldOptions {
  reducedMotion: boolean;
}

const HOURS = (now: number): number => {
  const d = new Date(now);
  return d.getHours() + d.getMinutes() / 60;
};

const FAST_FORWARD_MS = 30_000;
const LOG_CAP = 80;

function newActor(key: string, kind: Actor["kind"], project: string, name: string, look: Look, order: number): Actor {
  return {
    key, kind, project, name, agent: null, look, x: 0, y: 0, dir: "down", seat: null, sitting: false,
    shown: "unknown", target: "unknown", pendingTarget: "unknown", visible: false, alpha: 1,
    pose: { kind: "stand", dir: "down" }, emote: "none", emoteUntil: 0, stateAge: 0, screen: "off", smoke: false,
    carrying: false, spin: 0, materialize: 0, walkT: 0, phase: (hash(name) % 1000) / 1000, script: [], stepT: 0,
    override: null, primed: false, order,
  };
}

export class OfficeWorld {
  project: ProjectView | null = null;
  jobs: JobView[] = [];
  layout: FloorLayout = layoutFloor({ lanes: [] });
  layoutKey = "";
  actors = new Map<string, Actor>();
  visitors: Actor[] = [];
  particles: Particle[] = [];
  flights: Flight[] = [];
  tokens = new Map<string, LaneToken>();
  flares: Flare[] = [];
  piles: PileView[] = [];
  flow: FlowInfo | null = null;
  deadDesk = false;
  /** Agents on their way to hand a sheet to the tray (the data already counts it). */
  private dropping = new Set<string>();
  time = 0;
  hour = 12;
  reduced: boolean;
  /** Debug and test hooks. */
  log: TransitionLogEntry[] = [];
  statesSeen = new Set<string>();
  transitions = 0;
  private lastNow = 0;
  /** Wall-clock ms of the latest sync/step. */
  get nowMs(): number {
    return this.lastNow;
  }
  private smokeT = 0;
  private home = new Map<string, { seat: Tile; sitting: boolean }>();

  constructor(opts: WorldOptions) {
    this.reduced = opts.reducedMotion;
  }

  private env: Env = {
    layout: this.layout,
    emit: (e) => this.onEvent(e),
  };

  /* ---------------------------------------------------------------- project */

  /** Make the world match `project`. `snap` skips every animation (first load, reconnect, project switch). */
  sync(project: ProjectView, jobs: JobView[], now: number, snap: boolean): void {
    const switched = this.project?.slug !== project.slug;
    this.project = project;
    this.jobs = jobs;
    this.lastNow = now;
    this.hour = HOURS(now);
    this.flow = flowInfo(project, now);
    this.deadDesk = isDeadDesk(project);
    if (switched) this.resetProject();

    const rackSlots = Math.max(7, this.rackJobs().length);
    const key = this.layoutKeyFor(project, rackSlots);
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.layout = layoutFloor({ lanes: project.lanes, rackSlots });
      this.env = { layout: this.layout, emit: (e) => this.onEvent(e) };
    }
    // Geometry only rebuilds on structural changes, so keep every bay pointing at the current lane data.
    for (const bay of this.layout.bays) {
      const cur = project.lanes.find((l) => l.slug === bay.lane.slug);
      if (cur) bay.lane = cur;
    }
    this.assignHomes(project);

    const present = new Set<string>();
    project.agents.forEach((agent, i) => {
      present.add(agent.name);
      let a = this.actors.get(agent.name);
      const isNew = !a;
      if (!a) {
        a = newActor(`${project.slug}/${agent.name}`, "agent", project.slug, agent.name, lookFor(agent.role, agent.name), i);
        this.actors.set(agent.name, a);
      }
      a.agent = agent;
      a.look = lookFor(agent.role, agent.name);
      const h = this.home.get(agent.name);
      const moved = !!h && !!a.seat && (a.seat.x !== h.seat.x || a.seat.y !== h.seat.y);
      a.seat = h?.seat ?? null;
      if (!a.primed || (snap && !isNew)) this.place(a, agent.state);
      else if (agent.state !== a.pendingTarget) this.retarget(a, agent.state, snap);
      else if (moved && a.visible && a.script.length === 0) this.relocate(a);
      this.statesSeen.add(agent.state);
    });
    for (const name of [...this.actors.keys()]) if (!present.has(name)) this.actors.delete(name);

    this.syncVisitors(project, snap);
    this.syncTokens(project, snap);
    this.syncPiles(project, now, snap);
  }

  private resetProject(): void {
    this.actors.clear();
    this.visitors = [];
    this.particles = [];
    this.flights = [];
    this.tokens.clear();
    this.flares = [];
    this.piles = [];
    this.home.clear();
    this.dropping.clear();
  }

  private layoutKeyFor(project: ProjectView, rackSlots: number): string {
    return `${rackSlots}|${project.lanes.map((l) => `${l.slug}:${l.kind}:${l.state}:${l.archived ? 1 : 0}:${l.createdAt}`).join("|")}`;
  }

  /** Racks hold running jobs plus recent ones, oldest first so slots stay put. */
  rackJobs(): JobView[] {
    return this.jobs.slice(-14);
  }

  /* ----------------------------------------------------------------- homes */

  private assignHomes(project: ProjectView): void {
    const layout = this.layout;
    const taken = new Set<string>();
    const key = (t: Tile): string => `${t.x},${t.y}`;
    const next = new Map<string, { seat: Tile; sitting: boolean }>();
    const agents = project.agents.slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.name < b.name ? -1 : 1));

    // Desk operators sit at the front desk.
    const ops = agents.filter((a) => a.role === "desk");
    const claim = (name: string, seat: Tile, sitting: boolean): void => {
      taken.add(key(seat));
      next.set(name, { seat, sitting });
    };
    ops.forEach((a, i) => {
      const prev = this.home.get(a.name);
      const free = layout.front.seats.filter((s) => !taken.has(key(s)));
      const sticky = prev && layout.front.seats.some((s) => s.x === prev.seat.x && s.y === prev.seat.y) && !taken.has(key(prev.seat));
      if (sticky) claim(a.name, prev.seat, true);
      else if (free[0]) claim(a.name, free[0], true);
      else claim(a.name, layout.front.stand[(i - layout.front.seats.length) % layout.front.stand.length]!, false);
    });

    // Everyone else sits in their lane's pod; stickiness keeps people in their chair when others come and go.
    for (const bay of layout.bays) {
      const mine = agents.filter((a) => a.role !== "desk" && a.lane === bay.lane.slug);
      const rank = (r: string): number => ({ worker: 0, boss: 1, judge: 2, hawk: 3 })[r] ?? 4;
      const pref = [bay.desks[1]!, bay.desks[0]!, bay.desks[2]!];
      const placed = new Set<string>();
      for (const a of mine) {
        const prev = this.home.get(a.name);
        const stay = prev?.sitting ? pref.find((d) => d.seat.x === prev.seat.x && d.seat.y === prev.seat.y) : undefined;
        if (stay && !taken.has(key(stay.seat))) {
          claim(a.name, stay.seat, true);
          placed.add(a.name);
        }
      }
      for (const a of mine.slice().sort((x, y) => rank(x.role) - rank(y.role))) {
        if (placed.has(a.name)) continue;
        const free = pref.find((d) => !taken.has(key(d.seat)));
        if (free) claim(a.name, free.seat, true);
        else {
          const spot = bay.stand.find((s) => !taken.has(key(s))) ?? bay.stand[0]!;
          claim(a.name, spot, false);
        }
      }
    }
    // Agents of lanes with no bay wait in the lobby.
    let lobby = 0;
    for (const a of agents) {
      if (next.has(a.name)) continue;
      const spot = layout.front.stand[lobby++ % layout.front.stand.length]!;
      next.set(a.name, { seat: spot, sitting: false });
    }
    this.home = next;
  }

  /* ------------------------------------------------------------- actors */

  private planCtx(a: Actor, walking: boolean): PlanCtx {
    const h = this.home.get(a.name);
    const tray = this.layout.front.trays[0]!;
    return {
      layout: this.layout,
      home: h?.seat ?? null,
      homeSitting: h?.sitting ?? false,
      packetDrop: tray.drop,
      doorEntry: this.layout.door.entry,
      doorSpawn: this.layout.door.spawn,
      walking,
    };
  }

  /** Put an actor straight into the resting appearance of `state` (no animation). */
  place(a: Actor, state: AgentStateOrUnknown): void {
    const st = steadyFor(state);
    const h = this.home.get(a.name);
    a.script = [];
    this.dropping.delete(a.key);
    a.override = null;
    a.spin = 0;
    a.materialize = 0;
    a.shown = state;
    a.target = state;
    a.pendingTarget = state;
    a.primed = true;
    a.visible = st.present && !!h;
    a.carrying = false;
    if (h) {
      const f = feet(h.seat, st.sits && h.sitting);
      a.x = f.x;
      a.y = f.y;
      a.sitting = st.sits && h.sitting;
      a.dir = "down";
    }
    this.applySteady(a, state);
  }

  private applySteady(a: Actor, state: AgentStateOrUnknown): void {
    const st = steadyFor(state);
    a.shown = state;
    a.stateAge = 0;
    a.screen = st.screen;
    a.smoke = st.smoke;
    a.emote = st.emote;
    a.emoteUntil = 0;
    a.alpha = st.ghost ? (st.ghost.min + st.ghost.max) / 2 : 1;
  }

  private retarget(a: Actor, to: AgentStateOrUnknown, snap: boolean): void {
    const from = a.pendingTarget;
    if (from === to) return;
    const rt = { env: this.env };
    const fast = snap || this.reduced || scriptDuration(a.script) > FAST_FORWARD_MS;
    if (fast) {
      fastForward(a, rt);
      this.place(a, to);
      this.logTransition(a, from, to, [], true);
      return;
    }
    const backlogMs = scriptDuration(a.script);
    const steps = planTransition(a, from, to, this.planCtx(a, true));
    // Hurry when several transitions are queued: up to 3x faster walking.
    const hurry = 1 + Math.min(2, backlogMs / 8000);
    for (const s of steps) if (s.k === "walkTo") s.speed = (s.speed ?? 4) * hurry;
    if (to === "reported") this.dropping.add(a.key);
    // Soft appearance that should change the moment the state does.
    steps.unshift({ k: "call", fn: () => this.softApply(a, to) });
    steps.push({ k: "call", fn: () => this.finishTransition(a, to) });
    a.script.push(...steps);
    a.target = to;
    a.pendingTarget = to;
    this.transitions++;
    this.logTransition(a, from, to, steps.map((s) => s.k), false);
  }

  private softApply(a: Actor, to: AgentStateOrUnknown): void {
    const st = steadyFor(to);
    a.screen = st.screen;
    a.smoke = st.smoke;
    // Attention-getting emotes show the moment the state changes; completion marks wait for the hand-off.
    if (["bang", "zzz", "dots", "error", "boot", "spinner"].includes(st.emote)) {
      a.emote = st.emote;
      a.emoteUntil = 0;
    }
    if (st.ghost === false && a.alpha < 1 && to !== "interrupted" && to !== "restoring") a.alpha = Math.max(a.alpha, 0.6);
  }

  private finishTransition(a: Actor, to: AgentStateOrUnknown): void {
    const h = this.home.get(a.name);
    const st = steadyFor(to);
    this.applySteady(a, to);
    a.visible = st.present && !!h;
    if (h && st.present) {
      // Settle exactly on the seat.
      const here = tileOf(a);
      if (here.x !== h.seat.x || here.y !== h.seat.y) {
        const f = feet(h.seat, h.sitting && st.sits);
        a.x = f.x;
        a.y = f.y;
      }
      a.sitting = h.sitting && st.sits;
    }
  }

  /** Walk an actor back to its (changed) home. */
  private relocate(a: Actor): void {
    const h = this.home.get(a.name);
    if (!h) return;
    if (this.reduced) {
      this.place(a, a.shown);
      return;
    }
    a.script.push({ k: "stand" }, { k: "walkTo", to: h.seat }, h.sitting ? { k: "sit" } : { k: "face", dir: "down" });
  }

  private logTransition(a: Actor, from: AgentStateOrUnknown, to: AgentStateOrUnknown, steps: string[], fast: boolean): void {
    this.log.push({ at: this.lastNow, agent: a.name, from, to, steps, fast });
    if (this.log.length > LOG_CAP) this.log.shift();
  }

  /* ----------------------------------------------------------- visitors */

  private syncVisitors(project: ProjectView, snap: boolean): void {
    const f = this.flow;
    const waiting = f && f.atLimit ? backlog(project) : [];
    const spots = this.layout.queue;
    const slugs = waiting.slice(0, spots.length).map((l) => l.slug);
    this.visitors = slugs.map((slug, i) => {
      const prev = this.visitors.find((v) => v.name === slug);
      const spot = spots[i]!;
      const a = prev ?? newActor(`${project.slug}/queue/${slug}`, "visitor", project.slug, slug, lookFor("worker", `visitor-${slug}`), 1000 + i);
      const p = feet(spot, false);
      a.visible = true;
      a.alpha = 1;
      a.sitting = false;
      a.dir = "right";
      a.look = { ...a.look, id: `visitor:${slug}`, shirt: "#8890b8", accent: "#aab0d0", hat: "none" };
      const instant = this.reduced || snap;
      if (!prev) {
        a.x = instant ? p.x : this.layout.door.spawn.x;
        a.y = instant ? p.y : this.layout.door.spawn.y;
        a.primed = true;
      }
      if (instant || Math.hypot(a.x - p.x, a.y - p.y) < 1) {
        a.x = p.x;
        a.y = p.y;
        a.script = [];
      } else if (a.script.length === 0) {
        a.script = [{ k: "walkTo", to: spot }, { k: "face", dir: "right" }];
      }
      return a;
    });
  }

  /* ------------------------------------------------------- tokens & piles */

  private padFor(lane: LaneView): { index: number; waived: boolean } {
    switch (lane.delivery) {
      case "landed":
        return { index: 0, waived: false };
      case "deployed":
        return { index: 1, waived: false };
      case "proven":
        return { index: 2, waived: false };
      case "waived":
        return { index: 2, waived: true };
      default:
        return { index: -1, waived: false };
    }
  }

  private syncTokens(project: ProjectView, snap: boolean): void {
    const seen = new Set<string>();
    for (const bay of this.layout.bays) {
      const lane = bay.lane;
      if (!bay.strip) continue;
      seen.add(lane.slug);
      const want = this.padFor(lane);
      let tok = this.tokens.get(lane.slug);
      if (!tok) {
        tok = { lane: lane.slug, pad: want.index, to: want.index, t: 1, mode: "rest", waived: want.waived };
        this.tokens.set(lane.slug, tok);
        continue;
      }
      tok.waived = want.waived;
      if (tok.to !== want.index) {
        const from = tok.to;
        if (snap || this.reduced || want.index < 0) {
          tok.pad = want.index;
          tok.to = want.index;
          tok.t = 1;
          tok.mode = "rest";
        } else if (from < 0) {
          // A new packet leaves the front desk tray and travels to the first pad.
          tok.pad = -1;
          tok.to = want.index;
          this.launchFromTray(bay, want.index, tok);
        } else {
          tok.pad = from;
          tok.to = want.index;
          tok.t = 0;
          tok.mode = "slide";
        }
      }
    }
    for (const k of [...this.tokens.keys()]) if (!seen.has(k)) this.tokens.delete(k);
    void project;
  }

  private launchFromTray(bay: Bay, padIndex: number, tok: LaneToken): void {
    const tray = this.layout.front.trays[0]!;
    const start = { x: tray.rect.x * TILE + 16, y: tray.rect.y * TILE - 2 };
    const tiles = findPath(this.layout, tray.drop, { x: bay.pads[0]!.rect.x, y: bay.pads[0]!.rect.y + bay.pads[0]!.rect.h });
    const pts = [start, ...(tiles ?? []).map((t) => ({ x: t.x * TILE + 8, y: t.y * TILE + 8 })), bay.pads[padIndex]!.centre];
    tok.mode = "flight"; // hidden until the flight lands
    tok.t = 0;
    this.flights.push({
      pts,
      t: 0,
      dur: Math.max(900, pts.length * 120),
      kind: "stamped",
      arc: 6,
      onDone: () => {
        tok.mode = "rest";
        tok.t = 1;
        tok.pad = tok.to;
      },
    });
  }

  private syncPiles(project: ProjectView, now: number, snap: boolean): void {
    const piles = deskPiles(project.desk, now);
    const byKind = new Map(this.piles.map((p) => [p.kind, p] as const));
    const next: PileView[] = [];
    for (const p of piles) {
      const prev = byKind.get(p.kind);
      next.push({ kind: p.kind, count: p.count, heat: p.heat, shownHeat: snap || this.reduced || !prev ? p.heat : prev.shownHeat, tier: p.tier, oldestMs: p.oldestMs });
    }
    // A pile that emptied keeps easing down until its flame is out.
    for (const prev of this.piles) {
      if (!next.some((n) => n.kind === prev.kind) && prev.shownHeat > 0.05 && !snap && !this.reduced) {
        next.push({ ...prev, count: 0, heat: 0, tier: 0 });
      }
    }
    this.piles = next.sort((a, b) => a.kind.localeCompare(b.kind));
  }

  /** Sheets in the packet tray (data) minus those still being carried over. */
  trayCount(): number {
    const n = this.project?.packets.filter((p) => p.state === "reported" || p.state === "verified").length ?? 0;
    const inTransit = this.dropping.size + this.flights.filter((f) => f.kind === "paper").length;
    return Math.max(0, n - inTransit);
  }

  /* ---------------------------------------------------------------- events */

  private onEvent(e: SceneEvent): void {
    switch (e.t) {
      case "drop-packet": {
        const tray = this.layout.front.trays[0]!;
        const from = { x: e.actor.x, y: e.actor.y - 12 };
        const to = { x: tray.rect.x * TILE + 16, y: tray.rect.y * TILE + 2 };
        this.dropping.delete(e.actor.key);
        if (this.reduced) break;
        this.flights.push({ pts: [from, to], t: 0, dur: 320, kind: "paper", arc: 10 });
        break;
      }
      case "sparks":
        if (!this.reduced) this.burst(e.x, e.y, e.n, e.color ?? "#ffcf5a");
        break;
      case "stamp": {
        const tray = this.layout.front.trays[0]!;
        if (!this.reduced) this.burst(tray.rect.x * TILE + 16, tray.rect.y * TILE, 8, "#6dff9a");
        break;
      }
    }
  }

  burst(x: number, y: number, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (i % 2) * 0.3;
      const sp = 14 + ((i * 37) % 22);
      this.particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 14, life: 0, max: 0.5 + ((i * 13) % 5) / 10, kind: "spark", color, size: 1 });
    }
  }

  /** Called with the store's change batch (after `sync`). Triggers one-off effects. */
  applyChanges(changes: readonly Change[], reset: boolean): void {
    if (!this.project || reset || this.reduced) return;
    const slug = this.project.slug;
    for (const c of changes) {
      if (c.t === "desk" && c.project === slug) {
        const kind = c.kind === "blocked" || c.kind === "approval" || c.kind === "decision" ? c.kind : null;
        const tray = this.layout.front.trays.find((t) => t.kind === kind);
        if (!tray) continue;
        const cx = tray.rect.x * TILE + 16;
        const cy = tray.rect.y * TILE;
        if (c.change === "added" && kind) {
          this.flares.push({ x: cx, y: cy, t: 0, kind: "added", color: kind === "blocked" ? "#ff6b6b" : kind === "approval" ? "#ffa84a" : "#ffe17a" });
        } else if (c.change === "resolved") {
          this.flares.push({ x: cx, y: cy, t: 0, kind: "resolved", color: "#6dff9a" });
        }
      }
      if (c.t === "agent" && c.project === slug && c.to === "verified") this.stampFor(c.name);
    }
  }

  /** A desk operator stamps the packet tray when something is verified. */
  private stampFor(agentName: string): void {
    const op = [...this.actors.values()].find((a) => a.agent?.role === "desk" && a.visible && a.sitting && a.name !== agentName);
    const stamp = (a: Actor): void => {
      a.script.push(
        { k: "pose", pose: { kind: "stamp", frame: 0 }, ms: 320 },
        { k: "pose", pose: { kind: "stamp", frame: 1 }, ms: 260 },
        { k: "call", fn: (env) => env.emit({ t: "stamp", actor: a }) },
      );
    };
    if (op && op.script.length < 4) stamp(op);
    else this.onEvent({ t: "stamp", actor: op ?? ([...this.actors.values()][0] as Actor) });
  }

  /* ------------------------------------------------------------------ step */

  step(dtMs: number, now: number): void {
    this.lastNow = now;
    this.hour = HOURS(now);
    this.time += dtMs;
    const dt = dtMs / 1000;
    const rt = { env: this.env };
    const all = [...this.actors.values(), ...this.visitors];
    for (const a of all) {
      a.stateAge += dt;
      const busy = a.script.length > 0;
      if (busy) advance(a, dtMs, rt);
      if (a.emoteUntil > 0) {
        a.emoteUntil -= dtMs;
        if (a.emoteUntil <= 0) {
          a.emoteUntil = 0;
          a.emote = steadyFor(a.shown).emote;
        }
      }
      a.pose = this.poseOf(a, busy);
      if (a.smoke && a.visible && !this.reduced) this.smokeT += dt;
      if (a.shown === "restoring" || a.shown === "interrupted") {
        const g = steadyFor(a.shown).ghost;
        if (g) a.alpha = this.reduced ? (g.min + g.max) / 2 : g.min + (g.max - g.min) * (0.5 + 0.5 * Math.sin(this.time / 380 + a.phase * 6.28));
      }
    }
    if (!this.reduced) this.stepFx(dt, all);
    for (const p of this.piles) p.shownHeat += (p.heat - p.shownHeat) * Math.min(1, dt * 2.2);
    this.piles = this.piles.filter((p) => p.count > 0 || p.shownHeat > 0.05);
    for (const tok of this.tokens.values()) {
      if (tok.mode !== "slide") continue;
      tok.t = Math.min(1, tok.t + dt / 0.8);
      if (tok.t >= 1) {
        tok.pad = tok.to;
        tok.mode = "rest";
      }
    }
  }

  private poseOf(a: Actor, busy: boolean): Pose {
    const walking = busy && a.script[0]?.k === "walk";
    if (walking) {
      const frame = Math.floor(a.walkT * 9) % 4;
      return a.carrying ? { kind: "carry", dir: a.dir, frame } : { kind: "walk", dir: a.dir, frame };
    }
    if (a.spin > 0) {
      const dirs = ["down", "left", "up", "right"] as const;
      return { kind: "stand", dir: dirs[Math.floor(a.spin / 90) % 4]! };
    }
    if (a.override) return a.override;
    if (a.carrying) return { kind: "carry", dir: a.dir, frame: 0 };
    if (!a.sitting) return { kind: "stand", dir: a.kind === "visitor" ? "right" : a.dir === "up" && !busy ? "down" : a.dir };
    const st = steadyFor(a.shown);
    switch (st.pose) {
      case "type":
        return { kind: "sit", frame: this.reduced ? 0 : (Math.floor((this.time / 1000) * 6 + a.phase * 10) % 2 === 0 ? 1 : 2) };
      case "slump":
        return { kind: "slump" };
      case "alert":
        return { kind: "alert" };
      default:
        return { kind: "sit", frame: 0 };
    }
  }

  private stepFx(dt: number, all: Actor[]): void {
    for (const a of all) {
      if (a.smoke && a.visible && Math.random() < dt * 5) {
        this.particles.push({ x: a.x + (Math.random() - 0.5) * 6, y: a.y - 22, vx: (Math.random() - 0.5) * 4, vy: -10 - Math.random() * 6, life: 0, max: 1.3, kind: "smoke", color: "", size: Math.floor(Math.random() * 3) });
      }
      if (a.shown === "failed" && a.visible && Math.random() < dt * 1.4) this.burst(a.x + (Math.random() - 0.5) * 8, a.y - 14, 3, "#ffb04a");
    }
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "spark") p.vy += 60 * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.max).slice(-300);
    for (const f of this.flights) {
      f.t += (dt * 1000) / f.dur;
    }
    for (const f of this.flights) if (f.t >= 1) f.onDone?.();
    this.flights = this.flights.filter((f) => f.t < 1);
    for (const f of this.flares) f.t += dt;
    this.flares = this.flares.filter((f) => f.t < 1.8);
  }

  /** True while anything is moving: the engine uses this to decide whether it may idle. */
  get animating(): boolean {
    if (this.reduced) return false;
    return true; // steady-state animation (typing, flames, ticker) is always running
  }

  get busyActors(): number {
    return [...this.actors.values(), ...this.visitors].filter((a) => a.script.length > 0).length;
  }

  /* ---------------------------------------------------------------- hit test */

  hitTest(wx: number, wy: number): Target | null {
    const p = this.project;
    if (!p) return null;
    // Actors first, topmost (largest y) wins.
    const actors = [...this.actors.values(), ...this.visitors].filter((a) => a.visible && a.alpha > 0.05).sort((a, b) => b.y - a.y);
    for (const a of actors) {
      if (wx >= a.x - 8 && wx <= a.x + 8 && wy >= a.y - 24 && wy <= a.y) {
        if (a.kind === "visitor") return { type: "lane", project: p.slug, slug: a.name, part: "bay" };
        return { type: "agent", project: p.slug, name: a.name };
      }
    }
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    const L = this.layout;
    for (const r of L.machine.racks) if (rectContains(r.rect, tx, ty)) {
      const job = this.rackJobs()[r.slot];
      return job ? { type: "job", id: job.id } : { type: "rack", slot: r.slot };
    }
    if (rectContains({ x: 11, y: L.lobbyTop, w: 13, h: 9 }, tx, ty) || rectContains(L.front.counter, tx, ty)) return { type: "desk", project: p.slug };
    if (this.visitors.length > 0 && rectContains({ x: 1, y: L.lobbyTop, w: 4, h: 9 }, tx, ty)) return { type: "door", project: p.slug };
    if (rectContains(L.door.rect, tx, ty) || (tx >= L.door.rect.x - 1 && tx <= L.door.rect.x + 2 && ty >= L.h - 3)) return { type: "door", project: p.slug };
    for (const bay of L.bays) {
      if (bay.gate && rectContains(bay.gate, tx, ty)) return { type: "lane", project: p.slug, slug: bay.lane.slug, part: "gate" };
      if (bay.strip && (rectContains(bay.strip, tx, ty) || rectContains({ ...bay.strip, y: bay.strip.y - 1, h: 1 }, tx, ty))) return { type: "lane", project: p.slug, slug: bay.lane.slug, part: "strip" };
      if (rectContains(bay.sign, tx, ty)) return { type: "lane", project: p.slug, slug: bay.lane.slug, part: "sign" };
      if (rectContains(bay.rect, tx, ty)) return { type: "lane", project: p.slug, slug: bay.lane.slug, part: "bay" };
    }
    if (rectContains(L.wall.ticker, tx, ty)) return { type: "project", project: p.slug, part: "ticker" };
    if (rectContains(L.wall.sign, tx, ty)) return { type: "project", project: p.slug, part: "sign" };
    return null;
  }

  /** Pixel box of a target, for outlines and tooltips. */
  boxOf(t: Target): { x: number; y: number; w: number; h: number } | null {
    const L = this.layout;
    switch (t.type) {
      case "agent": {
        const a = this.actors.get(t.name);
        return a && a.visible ? { x: a.x - 8, y: a.y - 24, w: 16, h: 24 } : null;
      }
      case "lane": {
        const bay = L.bays.find((b) => b.lane.slug === t.slug);
        if (!bay) {
          const v = this.visitors.find((x) => x.name === t.slug);
          return v ? { x: v.x - 8, y: v.y - 24, w: 16, h: 24 } : null;
        }
        if (t.part === "gate" && bay.gate) return rectPx(bay.gate);
        if (t.part === "strip" && bay.strip) return rectPx({ ...bay.strip, y: bay.strip.y - 1, h: bay.strip.h + 1 });
        return rectPx(bay.rect);
      }
      case "desk":
        return rectPx({ x: 11, y: L.lobbyTop, w: 13, h: 9 });
      case "door":
        return rectPx({ x: 1, y: L.lobbyTop + 1, w: 5, h: 9 });
      case "project":
        return rectPx(t.part === "ticker" ? L.wall.ticker : L.wall.sign);
      case "job": {
        const slot = this.rackJobs().findIndex((j) => j.id === t.id);
        const r = L.machine.racks[slot];
        return r ? rectPx(r.rect) : null;
      }
      case "rack": {
        const r = L.machine.racks[t.slot];
        return r ? rectPx(r.rect) : null;
      }
    }
  }

  worldSize(): { w: number; h: number } {
    return { w: FLOOR_W * TILE, h: this.layout.h * TILE };
  }
}

export type { Rect, Step, Emote };
