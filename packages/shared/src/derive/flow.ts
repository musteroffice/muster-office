import {
  DEPLOY_NAMES,
  KIND_RANK,
  KIND_WEIGHT,
  PROCESS_STATES,
  TERMINAL_PACKET_STATES,
  type DeployLevel,
  type OpenKind,
} from "../enums.js";
import type { DeskItemView, LaneView, ProjectView } from "../view.js";

/** `formatAge` from `src/switchboard.ts:161`. */
export function formatAge(ms: number): string {
  if (ms < 60_000) return "now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

const t = (iso: string | null): number => (iso === null ? NaN : Date.parse(iso));

/** Effective lane level: a lane override only ever lowers the project level. */
export function laneDeployLevel(lane: Pick<LaneView, "deployLevel">, level: DeployLevel): DeployLevel {
  return lane.deployLevel === null || lane.deployLevel > level ? level : lane.deployLevel;
}

export function deployName(level: DeployLevel): string {
  return DEPLOY_NAMES[level];
}

/** Role and retro tabs are not feature WIP. Archived undelivered work still counts. */
export function inFlight(project: Pick<ProjectView, "lanes" | "deploy">): LaneView[] {
  const level = project.deploy.level;
  return project.lanes.filter(
    (lane) =>
      lane.kind === "work" &&
      !(lane.delivery === "deployed" && laneDeployLevel(lane, level) >= 2) &&
      (lane.state === "open" ||
        lane.state === "draining" ||
        (lane.state === "closed" && (lane.delivery === "landed" || lane.delivery === "deployed"))),
  );
}

/** Unranked work follows ranked work; creation order breaks ties. */
export function backlog(project: Pick<ProjectView, "lanes">): LaneView[] {
  return project.lanes
    .filter((lane) => lane.kind === "work" && lane.state === "proposed" && !lane.archived)
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || t(a.createdAt) - t(b.createdAt));
}

export function wipLimit(project: Pick<ProjectView, "policy">): number | null {
  return project.policy.wipLimit;
}

export function openSlots(project: Pick<ProjectView, "lanes" | "deploy" | "policy">): number | null {
  const limit = wipLimit(project);
  return limit === null ? null : Math.max(0, limit - inFlight(project).length);
}

export interface FlowInfo {
  wip: number;
  limit: number | null;
  openSlots: number | null;
  /** True when WIP is at or over the limit. */
  atLimit: boolean;
  stalled: boolean;
  unlanded: boolean;
  notFlowing: boolean;
  next: string | null;
  retro: string | null;
  landedNotLive: Array<{ slug: string; ageMs: number }>;
  watching: string[];
  oldestMs: number | null;
  lastProvenAt: number | null;
  cycleMs: number | null;
  perWeek: number | null;
  line: string;
}

/**
 * Structured flow state plus the exact Muster line (`flowLine`, `src/tokens.ts:119`).
 * `now` is a parameter so the client can tick ages without a round trip.
 */
export function flowInfo(project: ProjectView, now: number): FlowInfo {
  const lanes = inFlight(project);
  const limit = wipLimit(project);
  const workLanes = project.lanes.filter((lane) => lane.kind === "work");
  const history = workLanes.flatMap((lane) =>
    lane.deliveryHistory.length > 0
      ? lane.deliveryHistory
      : lane.deliveryAt
        ? [{ stage: lane.delivery, at: lane.deliveryAt, evidence: lane.deliveryEvidence ?? "" }]
        : [],
  );
  // Count lanes, not repeated proof entries. First proof ends that lane's cycle.
  const proven = workLanes
    .flatMap((lane) => {
      const times = lane.deliveryHistory.filter((e) => e.stage === "proven").map((e) => t(e.at));
      if (times.length === 0 && lane.delivery === "proven" && lane.deliveryAt) times.push(t(lane.deliveryAt));
      const valid = times.filter(Number.isFinite);
      if (valid.length === 0) return [];
      const at = Math.min(...valid);
      return at <= now ? [{ at, cycle: at - t(lane.openedAt ?? lane.createdAt) }] : [];
    })
    .sort((a, b) => b.at - a.at);
  const cycles = proven
    .slice(0, 10)
    .map((e) => e.cycle)
    .filter((ms) => Number.isFinite(ms) && ms >= 0)
    .sort((a, b) => a - b);
  const middle = Math.floor(cycles.length / 2);
  const median = cycles.length ? (cycles[middle]! + cycles[Math.floor((cycles.length - 1) / 2)]!) / 2 : null;
  const lastProven = proven[0]?.at;
  const lastMove = Math.max(lastProven ?? 0, ...history.map((e) => t(e.at)).filter(Number.isFinite));
  const created = lanes.map((lane) => t(lane.createdAt)).filter(Number.isFinite);
  const oldest = created.length ? Math.min(...created) : now;
  const stalled = lanes.length > 0 && now - Math.max(lastMove, oldest) > project.policy.flowStallMin * 60_000;
  const unlanded = project.packets.some(
    (p) =>
      !(TERMINAL_PACKET_STATES as readonly string[]).includes(p.state) &&
      now - t(p.reportedAt) > project.policy.landWaitMin * 60_000,
  );
  const level = project.deploy.level;
  const watching = workLanes.filter((lane) => lane.delivery === "deployed" && laneDeployLevel(lane, level) >= 2);
  const landed = lanes.filter((lane) => lane.delivery === "landed" || lane.delivery === "deployed");
  const slots = openSlots(project);
  const next = backlog(project)[0];
  const retro = project.lanes.find((lane) => lane.kind === "retro" && (lane.state === "open" || lane.state === "draining"));
  const ago = (at: number) => {
    const age = formatAge(Math.max(0, now - at));
    return age === "now" ? "just now" : `${age} ago`;
  };
  const landedList = landed.map((lane) => ({
    slug: lane.slug,
    ageMs: Math.max(0, now - t(lane.deliveryAt ?? lane.updatedAt)),
  }));
  const perWeek = proven.length ? proven.filter((e) => now - e.at <= 7 * 86_400_000).length : null;
  const line = [
    `${stalled || unlanded ? "⚠ not flowing · " : ""}WIP ${lanes.length}/${limit ?? "off"}`,
    ...(slots ? [`${slots} open`, next ? `next: ${next.slug}` : "backlog empty"] : []),
    ...(retro ? [`retro: running ${retro.slug}`] : []),
    `landed, not live: ${landedList.map((l) => `${l.slug} ${formatAge(l.ageMs)}`).join(", ") || "none"}`,
    ...(watching.length ? [`watching: ${watching.map((lane) => lane.slug).join(", ")}`] : []),
    ...(lanes.length ? [`oldest in flight ${formatAge(Math.max(0, now - oldest))}`] : []),
    ...(lastProven !== undefined ? [`last proven ${ago(lastProven)}`] : []),
    ...(median !== null ? [`cycle ${formatAge(median)}`] : []),
    ...(perWeek !== null ? [`${perWeek}/wk`] : []),
  ]
    .join(" · ")
    .replace(/[\r\n]+/g, " ");
  return {
    wip: lanes.length,
    limit,
    openSlots: slots,
    atLimit: limit !== null && lanes.length >= limit,
    stalled,
    unlanded,
    notFlowing: stalled || unlanded,
    next: next?.slug ?? null,
    retro: retro?.slug ?? null,
    landedNotLive: landedList,
    watching: watching.map((l) => l.slug),
    oldestMs: lanes.length ? Math.max(0, now - oldest) : null,
    lastProvenAt: lastProven ?? null,
    cycleMs: median,
    perWeek,
    line,
  };
}

export function flowLine(project: ProjectView, now: number): string {
  return flowInfo(project, now).line;
}

/* -------------------------------------------------------------------- desk heat */

export interface DeskPile {
  kind: OpenKind;
  count: number;
  oldestMs: number;
  /** Sum of weight × (1 + log2(1 + ageHours)); drives flame size. */
  heat: number;
  /** 0 = none, 1 ember, 2 small, 3 medium, 4 large flame. */
  tier: 0 | 1 | 2 | 3 | 4;
}

export function openDeskItems(items: readonly DeskItemView[]): DeskItemView[] {
  return items.filter((item) => item.open);
}

export function heatTier(heat: number): DeskPile["tier"] {
  if (heat <= 0) return 0;
  if (heat < 2.5) return 1;
  if (heat < 6) return 2;
  if (heat < 12) return 3;
  return 4;
}

/** Ranked blocked > approval > decision; each pile has a heat from weight (3/2/1) and log age. */
export function deskPiles(items: readonly DeskItemView[], now: number): DeskPile[] {
  const piles = new Map<OpenKind, DeskPile>();
  for (const item of items) {
    if (!item.open || !(item.kind in KIND_RANK)) continue;
    const kind = item.kind as OpenKind;
    const age = Math.max(0, now - t(item.ts));
    const hours = Number.isFinite(age) ? age / 3_600_000 : 0;
    const heat = KIND_WEIGHT[kind] * (1 + Math.log2(1 + hours));
    const pile = piles.get(kind) ?? { kind, count: 0, oldestMs: 0, heat: 0, tier: 0 };
    pile.count += 1;
    pile.heat += heat;
    pile.oldestMs = Math.max(pile.oldestMs, Number.isFinite(age) ? age : 0);
    piles.set(kind, pile);
  }
  const out = [...piles.values()].map((p) => ({ ...p, tier: heatTier(p.heat) }));
  return out.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

/** Open items ranked blocked > approval > decision, oldest first. */
export function rankOpen(items: readonly DeskItemView[]): DeskItemView[] {
  return openDeskItems(items).sort(
    (a, b) => KIND_RANK[a.kind as OpenKind] - KIND_RANK[b.kind as OpenKind] || t(a.ts) - t(b.ts),
  );
}

/**
 * Catalog-derived approximation of Muster's "no live desk" skull: items are open and no desk-role
 * agent is in a process state. (Muster uses the live intercom session list, which is not on disk.)
 */
export function isDeadDesk(project: Pick<ProjectView, "agents" | "desk">): boolean {
  if (!project.desk.some((d) => d.open)) return false;
  return !project.agents.some((a) => a.role === "desk" && (PROCESS_STATES as readonly string[]).includes(a.state));
}
