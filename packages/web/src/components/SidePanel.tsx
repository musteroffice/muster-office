import {
  backlog,
  deployName,
  deskPiles,
  flowInfo,
  inFlight,
  isDeadDesk,
  jobIsStale,
  laneDeployLevel,
  rankOpen,
  type ProjectView,
} from "@muster-office/shared";
import { useShallow } from "zustand/react/shallow";
import { Check, Crosshair, Minus, Navigation, Skull, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { requestFocus } from "../lib/bus";
import { useOffice, type Selection } from "../store";
import { FlowLine } from "./Board";
import { Portrait } from "./Portrait";
import { ageMs, ageOf, clock, fmtDuration, fmtKB, plainLabel } from "../lib/format";
import { DEPLOY_LEVEL_META, DESK_KIND_META, RULE_LABEL, ROLE_META, STATE_META } from "../lib/meta";
import { BodyBlock, StateBadge, Tag, useNow } from "./hooks";

function Link({ sel, children }: { sel: Selection; children: React.ReactNode }) {
  const select = useOffice((s) => s.select);
  return (
    <button type="button" className="linklike" onClick={() => select(sel)}>
      {children}
    </button>
  );
}

function Facts({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function AgentPanel({ project, name, now }: { project: ProjectView; name: string; now: number }) {
  const showBodies = useOffice((s) => s.showBodies);
  const timeline = useOffice((s) => s.timeline);
  const view = useOffice((s) => s.view);
  const follow = useOffice((s) => s.follow);
  const setFollow = useOffice((s) => s.setFollow);
  const agent = project.agents.find((a) => a.name === name);
  if (!agent) return <p className="muted">That agent is no longer in the catalog.</p>;
  const packets = project.packets.filter((p) => p.agent === name).reverse();
  const last = packets[0];
  const desk = project.desk.filter((d) => d.from === name).slice(-8).reverse();
  const notes = project.owner.filter((o) => o.author === name).slice(-5).reverse();
  const history = timeline.filter((e) => e.project === project.slug && e.agent === name).slice(-25).reverse();
  const m = STATE_META[agent.state];
  return (
    <>
      <div className="flex items-start gap-3.5">
        <span className="grid h-24 w-[4.5rem] shrink-0 place-items-center rounded-lg border bg-muted/40" data-tone={m.tone}>
          <Portrait name={agent.name} role={agent.role} state={agent.state} scale={3} />
        </span>
        <div className="min-w-0">
          <h3 className="panel-title">
            {plainLabel(agent.label) || agent.name} <StateBadge state={agent.state} raw={agent.rawState} />
          </h3>
          <p className="muted small">{m.what}</p>
          {view === "office" && (
            <div className="mt-2 flex gap-1.5">
              <Button type="button" size="sm" variant="outline" onClick={() => requestFocus({ type: "agent", name })}>
                <Crosshair /> Locate
              </Button>
              <Button type="button" size="sm" variant={follow ? "default" : "outline"} aria-pressed={follow} onClick={() => setFollow(!follow)} title="Keep the camera on this agent (F)">
                <Navigation /> Follow
              </Button>
            </div>
          )}
        </div>
      </div>
      <Facts
        rows={[
          ["Role", `${ROLE_META[agent.role].label}${agent.sideOf ? ` (side desk of ${agent.sideOf})` : ""}`],
          ["Model", `${agent.model} · thinking ${agent.thinking ?? "default"}`],
          ["Lane", <Link key="l" sel={{ type: "lane", project: project.slug, slug: agent.lane }}>{agent.lane}</Link>],
          ["First-turn proof", agent.delivery],
          ["Restarts", String(agent.restarts)],
          ["Machine", agent.machine],
          ["Session", <code key="s">{agent.sessionShort}…</code>],
          ["Created", ageOf(agent.createdAt, now)],
          ["Updated", ageOf(agent.updatedAt, now)],
        ]}
      />

      <h4>State history</h4>
      {agent.events.length + history.length === 0 && <p className="muted small">No events recorded.</p>}
      <ol className="history">
        {history.map((e) => (
          <li key={e.id}>
            <time>{clock(e.ts)}</time> {e.text}
          </li>
        ))}
        {history.length === 0 &&
          [...agent.events].reverse().slice(0, 12).map((e, i) => (
            <li key={i}>
              <time>{e.at.slice(11, 19)}</time> {e.type}: {e.detail}
            </li>
          ))}
      </ol>

      <h4>Last report</h4>
      {last ? (
        <>
          <p>
            <Link sel={{ type: "packet", project: project.slug, id: last.id }}>
              <code>{last.short}</code>
            </Link>{" "}
            <Tag tone={last.state === "committed" ? "ok" : "info"}>{last.state}</Tag> <span className="muted small">{ageOf(last.reportedAt, now)}</span>
          </p>
          <ul className="checks">
            {last.checks.map((c, i) => (
              <li key={i} className={`check-${c.outcome}`}>
                {c.outcome === "pass" ? <Check aria-hidden="true" className="size-3.5" /> : c.outcome === "fail" ? <X aria-hidden="true" className="size-3.5" /> : <Minus aria-hidden="true" className="size-3.5" />} {c.name} <span className="sr-only">{c.outcome}</span>
                {c.detail && <span className="muted small"> {c.detail}</span>}
              </li>
            ))}
          </ul>
          <BodyBlock kind="report" project={project.slug} id={last.id} enabled={showBodies} />
        </>
      ) : (
        <p className="muted small">No packets yet.</p>
      )}

      {packets.length > 1 && (
        <>
          <h4>Recent packets</h4>
          <ul className="plain">
            {packets.slice(0, 6).map((p) => (
              <li key={p.id}>
                <Link sel={{ type: "packet", project: project.slug, id: p.id }}>
                  <code>{p.short}</code>
                </Link>{" "}
                {p.state} · {ageOf(p.reportedAt, now)}
              </li>
            ))}
          </ul>
        </>
      )}

      <h4>Related desk items</h4>
      {desk.length === 0 && <p className="muted small">None from this agent.</p>}
      <ul className="plain">
        {desk.map((d) => (
          <li key={d.id}>
            <Tag tone={DESK_KIND_META[d.kind].tone}>{d.kind}</Tag> {d.title} {d.open ? <Tag tone="warn">open</Tag> : null}
            {d.hasBody && <BodyBlock kind="desk" project={project.slug} id={d.id} enabled={showBodies} />}
          </li>
        ))}
      </ul>

      {notes.length > 0 && (
        <>
          <h4>Owner notes</h4>
          <ul className="plain">
            {notes.map((o) => (
              <li key={o.id}>
                <Tag tone={o.kind === "blocked" ? "bad" : o.kind === "question" ? "warn" : "neutral"}>{o.kind}</Tag> {o.title}
                {o.hasBody && <BodyBlock kind="owner" project={project.slug} id={o.id} enabled={showBodies} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function LanePanel({ project, slug, now }: { project: ProjectView; slug: string; now: number }) {
  const lane = project.lanes.find((l) => l.slug === slug);
  if (!lane) return <p className="muted">That lane is gone.</p>;
  const level = laneDeployLevel(lane, project.deploy.level);
  const agents = project.agents.filter((a) => a.lane === slug);
  const packets = project.packets.filter((p) => p.lane === slug).reverse();
  const names = new Set(agents.map((a) => a.name));
  const desk = project.desk.filter((d) => names.has(d.from)).slice(-6).reverse();
  return (
    <>
      <h3 className="panel-title">
        {lane.label} <Tag tone={lane.state === "open" ? "ok" : lane.state === "draining" ? "warn" : "ghost"}>{lane.state}</Tag>
      </h3>
      <p className="muted small">{lane.goal || `${lane.kind} lane`}</p>
      <Facts
        rows={[
          ["Kind", lane.kind],
          ["Delivery", lane.delivery],
          ["Rank", lane.rank === null ? "—" : String(lane.rank)],
          ["Created", ageOf(lane.createdAt, now)],
          ["Opened", ageOf(lane.openedAt, now)],
        ]}
      />
      {lane.kind === "work" && (
        <>
          <h4>Deploy gate</h4>
          <p>
            <strong>
              Level {level} · {deployName(level)}
            </strong>{" "}
            <span className="muted small">
              (project: {project.deploy.level} from {project.deploy.source})
            </span>
          </p>
          <p className="small muted">{DEPLOY_LEVEL_META[level].gloss}</p>
          {lane.deployRule && <p className="small">Rule: <strong>{lane.deployRule}</strong> — {RULE_LABEL[lane.deployRule]}</p>}
          {lane.override && <p className="small">WIP override: “{lane.override}”</p>}
          {project.deploy.notes.map((n, i) => (
            <p key={i} className="small bad">
              {n}
            </p>
          ))}

          <h4>Delivery evidence</h4>
          {lane.deliveryHistory.length === 0 ? (
            <p className="muted small">Nothing delivered yet.</p>
          ) : (
            <ol className="history">
              {[...lane.deliveryHistory].reverse().map((h, i) => (
                <li key={i}>
                  <Tag tone={h.stage === "proven" ? "ok" : "info"}>{h.stage}</Tag> <span className="muted small">{ageOf(h.at, now)}</span>
                  <div>{h.evidence || <span className="muted">no evidence text</span>}</div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <h4>Agents</h4>
      <ul className="plain">
        {agents.map((a) => (
          <li key={a.name}>
            <Link sel={{ type: "agent", project: project.slug, name: a.name }}>{a.name}</Link> <StateBadge state={a.state} raw={a.rawState} />
          </li>
        ))}
        {agents.length === 0 && <li className="muted">none</li>}
      </ul>
      <h4>Recent packets</h4>
      <ul className="plain">
        {packets.slice(0, 6).map((p) => (
          <li key={p.id}>
            <Link sel={{ type: "packet", project: project.slug, id: p.id }}>
              <code>{p.short}</code>
            </Link>{" "}
            {p.state} · {ageOf(p.reportedAt, now)}
          </li>
        ))}
        {packets.length === 0 && <li className="muted">none</li>}
      </ul>
      {desk.length > 0 && (
        <>
          <h4>Related desk items</h4>
          <ul className="plain">
            {desk.map((d) => (
              <li key={d.id}>
                <Tag tone={DESK_KIND_META[d.kind].tone}>{d.kind}</Tag> {d.title}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function DeskPanel({ project, now }: { project: ProjectView; now: number }) {
  const showBodies = useOffice((s) => s.showBodies);
  const open = rankOpen(project.desk);
  const piles = deskPiles(project.desk, now);
  const dead = isDeadDesk(project);
  const recent = project.desk.filter((d) => !d.open).slice(-8).reverse();
  return (
    <>
      <h3 className="panel-title">The desk · {project.label}</h3>
      {dead && (
        <p className="callout bad">
          <Skull aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>No live desk. Items are waiting and no desk agent is in a running state. (Derived from the catalog; Muster uses its live session list.)</span>
        </p>
      )}
      <ul className="plain piles">
        {piles.map((p) => (
          <li key={p.kind}>
            <Tag tone={DESK_KIND_META[p.kind].tone}>
              {(() => {
                const K = DESK_KIND_META[p.kind].icon;
                return <K aria-hidden="true" className="size-3" />;
              })()}{" "}
              {p.kind}
            </Tag>{" "}
            {p.count} open · oldest {ageMs(p.oldestMs)} · heat {p.heat.toFixed(1)} <span className="muted small">(flame {["none", "ember", "small", "medium", "large"][p.tier]})</span>
          </li>
        ))}
        {piles.length === 0 && <li className="muted">Inbox clear.</li>}
      </ul>
      <h4>Open items (blocked, then approval, then decision)</h4>
      <ol className="plain items">
        {open.map((d) => (
          <li key={d.id}>
            <Tag tone={DESK_KIND_META[d.kind].tone}>{d.kind}</Tag> <strong>{d.title}</strong>
            <div className="muted small">
              {d.from} · {ageOf(d.ts, now)}
              {d.refCount > 0 ? ` · ${d.refCount} refs` : ""}
            </div>
            {d.hasBody && <BodyBlock kind="desk" project={project.slug} id={d.id} enabled={showBodies} />}
          </li>
        ))}
        {open.length === 0 && <li className="muted">None.</li>}
      </ol>
      <h4>Recently settled</h4>
      <ul className="plain">
        {recent.map((d) => (
          <li key={d.id}>
            <Tag tone={DESK_KIND_META[d.kind].tone}>{d.kind}</Tag> {d.title} <span className="muted small">· {ageOf(d.ts, now)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function JobPanel({ id, now }: { id: string; now: number }) {
  const job = useOffice((s) => s.snapshot?.jobs.find((j) => j.id === id));
  if (!job) return <p className="muted">That job is no longer recorded.</p>;
  const stale = jobIsStale(job, now);
  return (
    <>
      <h3 className="panel-title">
        Job <code>{job.id.slice(0, 8)}</code> <Tag tone={job.lost ? "bad" : job.state === "running" ? (stale ? "warn" : "ok") : "neutral"}>{job.lost ? "lost" : job.state}</Tag>
      </h3>
      {job.lost && <p className="callout bad">The wrapper process died without recording an exit. The rack is dark.</p>}
      {stale && <p className="callout warn">Telemetry is more than a minute old; the wrapper may be gone.</p>}
      <Facts
        rows={[
          ["Repo", job.repo || "—"],
          ["Project", job.project ?? "unmapped"],
          ["Host", job.host],
          ["Started", ageOf(job.startedAt, now)],
          ["Wall time", fmtDuration(job.wallMs ?? now - Date.parse(job.startedAt))],
          ["CPU (tree)", job.state === "running" ? `${Math.round(job.cpuPercent)}%` : "—"],
          ["RSS", job.state === "running" ? fmtKB(job.rssKB) : "—"],
          ["Peak RSS (sampled)", fmtKB(job.peakRssKB)],
          ["CPU seconds", String(Math.round(job.cpuSeconds))],
          ["Exit", job.exit === null ? (job.lost ? "lost" : "—") : String(job.exit)],
        ]}
      />
      <h4>Command (secrets redacted)</h4>
      <pre className="body-text">{job.command}</pre>
    </>
  );
}

function PacketPanel({ project, id, now }: { project: ProjectView; id: string; now: number }) {
  const showBodies = useOffice((s) => s.showBodies);
  const k = project.packets.find((p) => p.id === id);
  if (!k) return <p className="muted">That packet is gone.</p>;
  return (
    <>
      <h3 className="panel-title">
        Packet <code title={k.id}>{k.short}</code> <Tag tone={k.state === "committed" ? "ok" : k.state === "rejected" ? "bad" : "info"}>{k.state}</Tag>
      </h3>
      <Facts
        rows={[
          ["Hash", <code key="h" className="wrap">{k.id}</code>],
          ["Kind", k.kind],
          ["Lane", <Link key="l" sel={{ type: "lane", project: project.slug, slug: k.lane }}>{k.lane}</Link>],
          ["Agent", <Link key="a" sel={{ type: "agent", project: project.slug, name: k.agent }}>{k.agent}</Link>],
          ["Reported", ageOf(k.reportedAt, now)],
          ["Verified", ageOf(k.verifiedAt, now)],
          ["Landed as", k.landedAs ?? "—"],
          ["Attested", k.attested ? "yes (owner vouched)" : "no"],
          ["Gate", k.gate ? `${k.gate.host}, ${fmtDuration(k.gate.durationMs)}` : "—"],
          ["Supersedes", k.supersedes ?? "—"],
        ]}
      />
      {k.evidence && <p className="small">Evidence: {k.evidence}</p>}
      <h4>Checks</h4>
      <ul className="checks">
        {k.checks.map((c, i) => (
          <li key={i} className={`check-${c.outcome}`}>
            {c.outcome === "pass" ? <Check aria-hidden="true" className="size-3.5" /> : c.outcome === "fail" ? <X aria-hidden="true" className="size-3.5" /> : <Minus aria-hidden="true" className="size-3.5" />} {c.name} <span className="sr-only">{c.outcome}</span>
            {c.detail && <span className="muted small"> {c.detail}</span>}
          </li>
        ))}
      </ul>
      <h4>Report</h4>
      <BodyBlock kind="report" project={project.slug} id={k.id} enabled={showBodies} />
    </>
  );
}

function ProjectPanel({ project, now }: { project: ProjectView; now: number }) {
  const f = flowInfo(project, now);
  return (
    <>
      <h3 className="panel-title">{project.label}</h3>
      <p className="muted small">{project.outcome}</p>
      <p className={cn("my-2 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs", f.notFlowing && "border-warning/50 text-warning")}>
        <span className={cn("size-2 shrink-0 rounded-full", f.notFlowing ? "bg-destructive" : "bg-success")} aria-hidden="true" />
        <FlowLine line={f.line} stalled={f.notFlowing} />
      </p>
      <Facts
        rows={[
          ["Headline", project.headline ?? "—"],
          ["Next action", project.nextAction || "—"],
          ["State", project.state],
          ["Mode", project.mode],
          ["Deploy posture", `L${project.deploy.level} ${deployName(project.deploy.level)} (${project.deploy.source})`],
          ["WIP limit", project.policy.wipLimit === null ? "off" : String(project.policy.wipLimit)],
          ["Flow stall", `${project.policy.flowStallMin} min`],
          ["Land wait", `${project.policy.landWaitMin} min`],
          ["Nudge / restart", `${project.policy.nudgeAfterMin} min / ${project.policy.restartAfterMin ?? "never"}`],
        ]}
      />
      {project.deploy.notes.map((n, i) => (
        <p key={i} className="small bad">
          {n}
        </p>
      ))}
      {project.issues.map((n, i) => (
        <p key={i} className="callout warn">
          {n}
        </p>
      ))}
      {project.notes.map((n, i) => (
        <p key={i} className="small muted">
          {n}
        </p>
      ))}
    </>
  );
}

function DoorPanel({ project, now }: { project: ProjectView; now: number }) {
  const f = flowInfo(project, now);
  const flight = inFlight(project);
  const queue = backlog(project);
  return (
    <>
      <h3 className="panel-title">The door · WIP {f.wip}/{f.limit ?? "off"}</h3>
      <p className="muted small">
        {f.atLimit && queue.length > 0 ? "WIP is at the limit: the backlog waits at the door." : f.limit === null ? "No WIP limit." : `${f.openSlots ?? 0} slot(s) free.`}
      </p>
      <h4>In flight</h4>
      <ul className="plain">
        {flight.map((l) => (
          <li key={l.slug}>
            <Link sel={{ type: "lane", project: project.slug, slug: l.slug }}>{l.slug}</Link> · {l.delivery} · {ageOf(l.createdAt, now)}
          </li>
        ))}
        {flight.length === 0 && <li className="muted">none</li>}
      </ul>
      <h4>Waiting (ranked)</h4>
      <ol className="plain">
        {queue.map((l) => (
          <li key={l.slug}>
            <Link sel={{ type: "lane", project: project.slug, slug: l.slug }}>{l.slug}</Link> <span className="muted small">{l.goal}</span>
          </li>
        ))}
        {queue.length === 0 && <li className="muted">backlog empty</li>}
      </ol>
    </>
  );
}

export function SidePanel() {
  const { selection, project } = useOffice(
    useShallow((s) => ({ selection: s.selection, project: s.snapshot?.projects.find((p) => p.slug === (s.selection && "project" in s.selection ? s.selection.project : s.project)) })),
  );
  const select = useOffice((s) => s.select);
  const now = useNow();
  const open = selection !== null;
  return (
    <aside className={cn("side flex min-h-0 w-[22.5rem] max-w-[44vw] flex-col border-l bg-card", open && "open")} aria-label="Details" data-testid="side-panel" hidden={!open}>
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{selection ? selection.type : ""}</span>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => select(null)} aria-label="Close details (Esc)">
          <X />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 pb-8 pt-3">
          {selection?.type === "job" && <JobPanel id={selection.id} now={now} />}
          {selection && selection.type !== "job" && !project && <p className="muted">That project is gone.</p>}
          {selection && selection.type !== "job" && project && (
            <>
              {selection.type === "agent" && <AgentPanel project={project} name={selection.name} now={now} />}
              {selection.type === "lane" && <LanePanel project={project} slug={selection.slug} now={now} />}
              {selection.type === "desk" && <DeskPanel project={project} now={now} />}
              {selection.type === "packet" && <PacketPanel project={project} id={selection.id} now={now} />}
              {selection.type === "project" && <ProjectPanel project={project} now={now} />}
              {selection.type === "door" && <DoorPanel project={project} now={now} />}
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
