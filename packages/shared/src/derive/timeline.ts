import type {
  AgentView,
  JobView,
  ProjectView,
  RelayEventView,
  Severity,
  Snapshot,
  TimelineEvent,
} from "../view.js";

const ms = (iso: string | null | undefined, fallback: number): number => {
  if (!iso) return fallback;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : fallback;
};

function agentSeverity(state: string): Severity {
  switch (state) {
    case "failed":
      return "error";
    case "silent":
    case "nudged":
    case "interrupted":
    case "restarted":
      return "warn";
    case "reported":
    case "verified":
    case "landed":
      return "ok";
    default:
      return "info";
  }
}


function agentEventSeverity(type: string): Severity {
  if (/fail|error|lost|gone/i.test(type)) return "error";
  if (/nudge|restart|silent|interrupt|stuck/i.test(type)) return "warn";
  return "info";
}

function agentEventId(project: string, a: AgentView, e: AgentView["events"][number]): string {
  return `ae:${project}:${a.name}:${e.at}:${e.type}`;
}

function jobText(job: JobView, verb: string): string {
  const exit = job.exit !== null ? ` (exit ${job.exit})` : "";
  return `job ${job.id.slice(0, 8)} ${verb} · ${job.repo || "unknown repo"}${exit}`;
}

export function relayEventToTimeline(r: RelayEventView, i: number): TimelineEvent {
  const count = r.itemCount !== null ? ` ×${r.itemCount}` : "";
  const via = r.path ? ` via ${r.path}` : "";
  return {
    id: `relay:${r.ts}:${r.kind}:${r.project}:${r.session}:${i}`,
    ts: ms(r.ts, 0),
    kind: "relay",
    project: r.project || null,
    agent: null,
    lane: null,
    text: `relay ${r.kind}${count}${via}`,
    severity: r.kind === "desk_note_skipped_self" ? "info" : "info",
  };
}

/** Events for everything already in a snapshot, so the timeline is useful before the first live diff. */
export function seedTimeline(snap: Snapshot): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const p of snap.projects) {
    for (const a of p.agents) {
      for (const e of a.events) {
        out.push({
          id: agentEventId(p.slug, a, e),
          ts: ms(e.at, snap.now),
          kind: "agent",
          project: p.slug,
          agent: a.name,
          lane: a.lane,
          text: `${a.name} · ${e.type}${e.detail ? `: ${e.detail}` : ""}`,
          severity: agentEventSeverity(e.type),
        });
      }
    }
    for (const l of p.lanes) {
      for (const h of l.deliveryHistory) {
        out.push({
          id: `ld:${p.slug}:${l.slug}:${h.stage}:${h.at}`,
          ts: ms(h.at, snap.now),
          kind: "delivery",
          project: p.slug,
          agent: null,
          lane: l.slug,
          text: `lane ${l.slug} delivery → ${h.stage}${h.evidence ? ` · ${h.evidence}` : ""}`,
          severity: h.stage === "proven" ? "ok" : "info",
        });
      }
    }
    for (const k of p.packets) {
      out.push({
        id: `pk:${p.slug}:${k.id}:reported:${k.reportedAt}`,
        ts: ms(k.reportedAt, snap.now),
        kind: "packet",
        project: p.slug,
        agent: k.agent,
        lane: k.lane,
        text: `packet ${k.short} reported by ${k.agent}`,
        severity: "info",
      });
      if (k.state !== "reported" && k.state !== "unknown") {
        out.push({
          id: `pk:${p.slug}:${k.id}:${k.state}:${k.updatedAt}`,
          ts: ms(k.updatedAt, snap.now),
          kind: "packet",
          project: p.slug,
          agent: k.agent,
          lane: k.lane,
          text: `packet ${k.short} ${k.state}`,
          severity: k.state === "rejected" ? "warn" : "ok",
        });
      }
    }
    for (const d of p.desk) {
      out.push({
        id: `dk:${p.slug}:${d.id}`,
        ts: ms(d.ts, snap.now),
        kind: "desk",
        project: p.slug,
        agent: null,
        lane: null,
        text: d.resolves
          ? `desk ${d.from} resolved ${d.resolves}: ${d.title}`
          : `desk ${d.kind} from ${d.from}: ${d.title}`,
        severity: d.kind === "blocked" && d.open ? "error" : d.open ? "warn" : "info",
      });
    }
    for (const o of p.owner) {
      out.push({
        id: `ow:${p.slug}:${o.id}`,
        ts: ms(o.ts, snap.now),
        kind: "owner",
        project: p.slug,
        agent: o.author,
        lane: o.lane,
        text: `${o.author} ${o.kind}: ${o.title}`,
        severity: o.kind === "blocked" ? "error" : o.kind === "question" || o.kind === "action" ? "warn" : "info",
      });
    }
  }
  for (const j of snap.jobs) {
    out.push({
      id: `job:${j.id}:started`,
      ts: ms(j.startedAt, snap.now),
      kind: "job",
      project: j.project,
      agent: null,
      lane: null,
      text: jobText(j, "started"),
      severity: "info",
    });
    if (j.state !== "running") {
      out.push({
        id: `job:${j.id}:${j.state}`,
        ts: ms(j.finishedAt, snap.now),
        kind: "job",
        project: j.project,
        agent: null,
        lane: null,
        text: jobText(j, j.lost ? "lost (wrapper died)" : "finished"),
        severity: j.lost ? "error" : j.exit === 0 ? "ok" : "warn",
      });
    }
  }
  snap.relay.recent.forEach((r, i) => out.push(relayEventToTimeline(r, i)));
  return out.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
}

/** Events for what changed between two snapshots. */
export function deriveEvents(prev: Snapshot, next: Snapshot): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const prevProjects = new Map(prev.projects.map((p) => [p.slug, p] as const));
  for (const p of next.projects) {
    const old = prevProjects.get(p.slug);
    if (!old) {
      out.push(sys(`project:${p.slug}:added:${next.now}`, next.now, p.slug, `project ${p.label} appeared`, "info"));
      continue;
    }
    projectEvents(old, p, next.now, out);
  }
  for (const p of prev.projects) {
    if (!next.projects.some((n) => n.slug === p.slug)) {
      out.push(sys(`project:${p.slug}:removed:${next.now}`, next.now, p.slug, `project ${p.label} disappeared`, "warn"));
    }
  }
  const prevJobs = new Map(prev.jobs.map((j) => [j.id, j] as const));
  for (const j of next.jobs) {
    const old = prevJobs.get(j.id);
    if (!old) {
      out.push(mk(`job:${j.id}:started`, ms(j.startedAt, next.now), "job", j.project, null, null, jobText(j, "started"), "info"));
    }
    if (j.state !== "running" && old?.state !== j.state) {
      out.push(
        mk(
          `job:${j.id}:${j.state}`,
          ms(j.finishedAt, next.now),
          "job",
          j.project,
          null,
          null,
          jobText(j, j.lost ? "lost (wrapper died)" : "finished"),
          j.lost ? "error" : j.exit === 0 ? "ok" : "warn",
        ),
      );
    }
  }
  const seenRelay = new Set(prev.relay.recent.map((r) => `${r.ts}|${r.kind}|${r.project}|${r.session}`));
  next.relay.recent.forEach((r, i) => {
    if (!seenRelay.has(`${r.ts}|${r.kind}|${r.project}|${r.session}`)) out.push(relayEventToTimeline(r, i));
  });
  return out;
}

function sys(id: string, ts: number, project: string | null, text: string, severity: Severity): TimelineEvent {
  return mk(id, ts, "system", project, null, null, text, severity);
}

function mk(
  id: string,
  ts: number,
  kind: TimelineEvent["kind"],
  project: string | null,
  agent: string | null,
  lane: string | null,
  text: string,
  severity: Severity,
): TimelineEvent {
  return { id, ts, kind, project, agent, lane, text, severity };
}

function projectEvents(old: ProjectView, p: ProjectView, now: number, out: TimelineEvent[]): void {
  const slug = p.slug;
  if (old.status !== p.status) {
    out.push(sys(`ps:${slug}:${p.status}:${now}`, now, slug, `project ${p.label} is now ${p.status}`, p.status === "ok" ? "ok" : "warn"));
  }
  if (old.state !== p.state) out.push(sys(`pst:${slug}:${p.state}:${now}`, now, slug, `project ${p.label}: ${old.state} → ${p.state}`, "info"));

  const oldAgents = new Map(old.agents.map((a) => [a.name, a] as const));
  for (const a of p.agents) {
    const o = oldAgents.get(a.name);
    const at = ms(a.updatedAt, now);
    if (!o) {
      out.push(mk(`as:${slug}:${a.name}:new:${a.createdAt}`, ms(a.createdAt, now), "agent", slug, a.name, a.lane, `${a.name} (${a.role}) joined lane ${a.lane} as ${a.state}`, agentSeverity(a.state)));
    } else if (o.state !== a.state) {
      out.push(mk(`as:${slug}:${a.name}:${a.state}:${a.updatedAt}`, at, "agent", slug, a.name, a.lane, `${a.name} ${o.state} → ${a.state}`, agentSeverity(a.state)));
    }
    const known = new Set((o?.events ?? []).map((e) => `${e.at}|${e.type}`));
    for (const e of a.events) {
      if (known.has(`${e.at}|${e.type}`)) continue;
      out.push(mk(agentEventId(slug, a, e), ms(e.at, now), "agent", slug, a.name, a.lane, `${a.name} · ${e.type}${e.detail ? `: ${e.detail}` : ""}`, agentEventSeverity(e.type)));
    }
  }
  for (const o of old.agents) {
    if (!p.agents.some((a) => a.name === o.name)) {
      out.push(mk(`ar:${slug}:${o.name}:${now}`, now, "agent", slug, o.name, o.lane, `${o.name} left the roster`, "info"));
    }
  }

  const oldLanes = new Map(old.lanes.map((l) => [l.slug, l] as const));
  for (const l of p.lanes) {
    const o = oldLanes.get(l.slug);
    const at = ms(l.updatedAt, now);
    if (!o) {
      out.push(mk(`ln:${slug}:${l.slug}:new:${l.createdAt}`, ms(l.createdAt, now), "lane", slug, null, l.slug, `lane ${l.slug} created (${l.state})`, "info"));
      continue;
    }
    if (o.state !== l.state) {
      out.push(mk(`ls:${slug}:${l.slug}:${l.state}:${l.updatedAt}`, at, "lane", slug, null, l.slug, `lane ${l.slug} ${o.state} → ${l.state}`, l.state === "draining" ? "warn" : "info"));
    }
    const knownStages = new Set(o.deliveryHistory.map((h) => `${h.stage}|${h.at}`));
    for (const h of l.deliveryHistory) {
      if (knownStages.has(`${h.stage}|${h.at}`)) continue;
      out.push(mk(`ld:${slug}:${l.slug}:${h.stage}:${h.at}`, ms(h.at, now), "delivery", slug, null, l.slug, `lane ${l.slug} delivery → ${h.stage}${h.evidence ? ` · ${h.evidence}` : ""}`, h.stage === "proven" ? "ok" : "info"));
    }
  }

  const oldPackets = new Map(old.packets.map((k) => [k.id, k] as const));
  for (const k of p.packets) {
    const o = oldPackets.get(k.id);
    if (!o) {
      out.push(mk(`pk:${slug}:${k.id}:reported:${k.reportedAt}`, ms(k.reportedAt, now), "packet", slug, k.agent, k.lane, `packet ${k.short} reported by ${k.agent}`, "info"));
    } else if (o.state !== k.state) {
      out.push(mk(`pk:${slug}:${k.id}:${k.state}:${k.updatedAt}`, ms(k.updatedAt, now), "packet", slug, k.agent, k.lane, `packet ${k.short} ${o.state} → ${k.state}`, k.state === "rejected" ? "warn" : "ok"));
    }
  }

  const oldDesk = new Map(old.desk.map((d) => [d.id, d] as const));
  for (const d of p.desk) {
    const o = oldDesk.get(d.id);
    if (!o) {
      out.push(mk(`dk:${slug}:${d.id}`, ms(d.ts, now), "desk", slug, null, null,
        d.resolves ? `desk ${d.from} resolved ${d.resolves}: ${d.title}` : `desk ${d.kind} from ${d.from}: ${d.title}`,
        d.kind === "blocked" && d.open ? "error" : d.open ? "warn" : "info"));
    } else if (o.open && !d.open) {
      out.push(mk(`dkr:${slug}:${d.id}:${d.resolvedBy ?? ""}`, now, "desk", slug, null, null, `desk resolved ${d.kind}: ${d.title}`, "ok"));
    }
  }

  const oldOwner = new Set(old.owner.map((o) => o.id));
  for (const o of p.owner) {
    if (oldOwner.has(o.id)) continue;
    out.push(mk(`ow:${slug}:${o.id}`, ms(o.ts, now), "owner", slug, o.author, o.lane, `${o.author} ${o.kind}: ${o.title}`,
      o.kind === "blocked" ? "error" : o.kind === "question" || o.kind === "action" ? "warn" : "info"));
  }
}
