import {
  deployName,
  flowInfo,
  isDeadDesk,
  jobIsStale,
  laneDeployLevel,
  rankOpen,
  type AgentView,
  type LaneView,
  type ProjectView,
} from "@muster-office/shared";
import { EMPTY, useOffice, selectProjectView, type Selection } from "../store";
import { ageOf } from "../lib/format";
import { fmtDuration, fmtKB, modelShort, plural } from "../lib/format";
import { DELIVERY_STAGES, DESK_KIND_META, RULE_LABEL, ROLE_META } from "../lib/meta";
import { StateBadge, Tag, useNow } from "./hooks";

function SelectButton({ sel, children, label }: { sel: Selection; children: React.ReactNode; label?: string }) {
  const select = useOffice((s) => s.select);
  return (
    <button type="button" className="linklike" onClick={() => select(sel)} aria-label={label}>
      {children}
    </button>
  );
}

export function laneStageColumn(l: LaneView): "backlog" | "building" | "landed" | "deployed" | "proven" | "waived" | "closed" {
  if (l.state === "proposed") return "backlog";
  if (l.delivery === "landed") return "landed";
  if (l.delivery === "deployed") return "deployed";
  if (l.delivery === "proven") return "proven";
  if (l.delivery === "waived") return "waived";
  return l.state === "closed" ? "closed" : "building";
}

const COLUMN_LABEL: Record<ReturnType<typeof laneStageColumn>, string> = {
  backlog: "Backlog (proposed)",
  building: "Building",
  landed: "Landed, not live",
  deployed: "Deployed",
  proven: "Proven",
  waived: "Waived",
  closed: "Closed, nothing delivered",
};

function StageStrip({ lane }: { lane: LaneView }) {
  const order = ["landed", "deployed", "proven"] as const;
  const idx = (order as readonly string[]).indexOf(lane.delivery);
  return (
    <ol className="stages" aria-label={`Delivery: ${lane.delivery}`}>
      {DELIVERY_STAGES.map(({ stage, label }) => {
        const own = (order as readonly string[]).indexOf(stage);
        const reached = stage === "waived" ? lane.delivery === "waived" : idx >= 0 && own <= idx;
        const current = lane.delivery === stage;
        return (
          <li key={stage} className={`${reached ? "reached" : ""} ${current ? "current" : ""}`} aria-current={current ? "step" : undefined}>
            <span aria-hidden="true">{current ? "●" : reached ? "✓" : "○"}</span> {label}
            <span className="sr-only">{current ? " (current)" : reached ? " (done)" : " (not reached)"}</span>
          </li>
        );
      })}
    </ol>
  );
}

function GateCell({ project, lane }: { project: ProjectView; lane: LaneView }) {
  const level = laneDeployLevel(lane, project.deploy.level);
  const lowered = lane.deployLevel !== null && lane.deployLevel < project.deploy.level;
  return (
    <div className="gate" title={lane.deployRule ? RULE_LABEL[lane.deployRule] : `project level from ${project.deploy.source}`}>
      <strong>
        L{level} {deployName(level)}
      </strong>
      {lowered && lane.deployRule && <div className="small muted">lowered by rule: {lane.deployRule}</div>}
      {lane.override && <div className="small muted">override: “{lane.override}”</div>}
    </div>
  );
}

function agentsOf(project: ProjectView, lane: LaneView): AgentView[] {
  return project.agents.filter((a) => a.lane === lane.slug);
}

function LaneTable({ project }: { project: ProjectView }) {
  const lanes = project.lanes.filter((l) => !(l.archived && l.state === "closed"));
  return (
    <table className="grid" data-testid="lane-table">
      <caption className="sr-only">Lanes of {project.label}, with delivery stage and deploy gate</caption>
      <thead>
        <tr>
          <th scope="col">Lane</th>
          <th scope="col">State</th>
          <th scope="col">Agents</th>
          <th scope="col">Delivery</th>
          <th scope="col">Evidence</th>
          <th scope="col">Deploy gate</th>
        </tr>
      </thead>
      <tbody>
        {lanes.map((l) => (
          <tr key={l.slug} data-testid="lane-row">
            <th scope="row">
              <SelectButton sel={{ type: "lane", project: project.slug, slug: l.slug }}>{l.label}</SelectButton>
              <div className="small muted">{l.kind === "work" ? l.goal : `${l.kind} lane`}</div>
            </th>
            <td>
              <Tag tone={l.state === "open" ? "ok" : l.state === "draining" ? "warn" : l.state === "proposed" ? "ghost" : "neutral"}>{l.state}</Tag>
            </td>
            <td>
              <ul className="inline">
                {agentsOf(project, l).map((a) => (
                  <li key={a.name}>
                    <SelectButton sel={{ type: "agent", project: project.slug, name: a.name }}>{a.name}</SelectButton> <StateBadge state={a.state} raw={a.rawState} />
                  </li>
                ))}
                {agentsOf(project, l).length === 0 && <li className="muted">none</li>}
              </ul>
            </td>
            <td>{l.kind === "work" ? <StageStrip lane={l} /> : <span className="muted">n/a</span>}</td>
            <td className="small">{l.deliveryEvidence ?? <span className="muted">—</span>}</td>
            <td>{l.kind === "work" ? <GateCell project={project} lane={l} /> : <span className="muted">n/a</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Kanban({ project }: { project: ProjectView }) {
  const work = project.lanes.filter((l) => l.kind === "work" && !(l.archived && l.state === "closed"));
  const cols = ["backlog", "building", "landed", "deployed", "proven", "waived", "closed"] as const;
  return (
    <div className="kanban" data-testid="kanban">
      {cols.map((c) => {
        const items = work.filter((l) => laneStageColumn(l) === c);
        return (
          <section key={c} className="kcol" aria-labelledby={`k-${c}`}>
            <h4 id={`k-${c}`}>
              {COLUMN_LABEL[c]} <span className="count">{items.length}</span>
            </h4>
            <ul>
              {items.map((l) => (
                <li key={l.slug} className="kcard">
                  <SelectButton sel={{ type: "lane", project: project.slug, slug: l.slug }}>{l.label}</SelectButton>
                  <GateCell project={project} lane={l} />
                  <ul className="inline">
                    {agentsOf(project, l).map((a) => (
                      <li key={a.name}>
                        <SelectButton sel={{ type: "agent", project: project.slug, name: a.name }}>{a.name}</SelectButton> <StateBadge state={a.state} raw={a.rawState} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {items.length === 0 && <li className="muted small">empty</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function AgentTable({ project, now }: { project: ProjectView; now: number }) {
  return (
    <table className="grid" data-testid="agent-table">
      <caption className="sr-only">Agents of {project.label}</caption>
      <thead>
        <tr>
          <th scope="col">Agent</th>
          <th scope="col">Role</th>
          <th scope="col">Model · thinking</th>
          <th scope="col">State</th>
          <th scope="col">Lane</th>
          <th scope="col">Restarts</th>
          <th scope="col">Updated</th>
        </tr>
      </thead>
      <tbody>
        {project.agents.map((a) => (
          <tr key={a.name} data-testid="agent-row" data-state={a.state}>
            <th scope="row">
              <SelectButton sel={{ type: "agent", project: project.slug, name: a.name }}>{a.label || a.name}</SelectButton>
              <div className="small muted">{a.name}</div>
            </th>
            <td>{ROLE_META[a.role].label}</td>
            <td className="mono small">
              {modelShort(a.model)} · {a.thinking ?? "default"}
            </td>
            <td>
              <StateBadge state={a.state} raw={a.rawState} />
            </td>
            <td>{a.lane}</td>
            <td>{a.restarts}</td>
            <td>{ageOf(a.updatedAt, now)}</td>
          </tr>
        ))}
        {project.agents.length === 0 && (
          <tr>
            <td colSpan={7} className="muted">
              No agents in this project.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function DeskTable({ project, now }: { project: ProjectView; now: number }) {
  const open = rankOpen(project.desk);
  const rest = project.desk.filter((d) => !d.open).slice(-12).reverse();
  const dead = isDeadDesk(project);
  return (
    <>
      {dead && (
        <p className="callout bad" role="status">
          ☠ No live desk: items are waiting and no desk agent is running (catalog-derived).
        </p>
      )}
      <table className="grid" data-testid="desk-table">
        <caption className="sr-only">Open desk items of {project.label}, ranked blocked then approval then decision</caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Kind</th>
            <th scope="col">Title</th>
            <th scope="col">From</th>
            <th scope="col">Age</th>
          </tr>
        </thead>
        <tbody>
          {open.map((d, i) => (
            <tr key={d.id}>
              <td>{i + 1}</td>
              <td>
                <Tag tone={DESK_KIND_META[d.kind].tone}>
                  <span aria-hidden="true">{DESK_KIND_META[d.kind].glyph}</span> {d.kind}
                </Tag>
              </td>
              <td>{d.title}</td>
              <td>{d.from}</td>
              <td>{ageOf(d.ts, now)}</td>
            </tr>
          ))}
          {open.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                Inbox clear.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {rest.length > 0 && (
        <details className="more">
          <summary>Recent resolved and informational lines ({rest.length})</summary>
          <ul className="plain">
            {rest.map((d) => (
              <li key={d.id}>
                <Tag tone={DESK_KIND_META[d.kind].tone}>{d.kind}</Tag> {d.title} <span className="muted small">· {d.from} · {ageOf(d.ts, now)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function PacketTable({ project, now }: { project: ProjectView; now: number }) {
  if (project.packets.length === 0) return <p className="muted">No packets.</p>;
  return (
    <table className="grid" data-testid="packet-table">
      <caption className="sr-only">Packets of {project.label}</caption>
      <thead>
        <tr>
          <th scope="col">Packet</th>
          <th scope="col">Lane</th>
          <th scope="col">Agent</th>
          <th scope="col">State</th>
          <th scope="col">Checks</th>
          <th scope="col">Reported</th>
        </tr>
      </thead>
      <tbody>
        {[...project.packets].reverse().map((k) => (
          <tr key={k.id}>
            <th scope="row">
              <SelectButton sel={{ type: "packet", project: project.slug, id: k.id }}>
                <code title={k.id}>{k.short}</code>
              </SelectButton>
            </th>
            <td>{k.lane}</td>
            <td>{k.agent}</td>
            <td>
              <Tag tone={k.state === "committed" ? "ok" : k.state === "rejected" ? "bad" : "info"}>{k.state}</Tag>
            </td>
            <td className="small">
              {k.checks.filter((c) => c.outcome === "pass").length}/{k.checks.length} pass
            </td>
            <td>{ageOf(k.reportedAt, now)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function JobTable({ now }: { now: number }) {
  const jobs = useOffice((s) => s.snapshot?.jobs ?? EMPTY);
  const select = useOffice((s) => s.select);
  if (jobs.length === 0) return <p className="muted">No muster-heavy jobs recorded.</p>;
  return (
    <table className="grid" data-testid="job-table">
      <caption className="sr-only">muster-heavy jobs (the machine room)</caption>
      <thead>
        <tr>
          <th scope="col">Job</th>
          <th scope="col">Repo</th>
          <th scope="col">State</th>
          <th scope="col">CPU</th>
          <th scope="col">RSS (peak)</th>
          <th scope="col">Started</th>
          <th scope="col">Command</th>
        </tr>
      </thead>
      <tbody>
        {[...jobs].reverse().map((j) => (
          <tr key={j.id} data-state={j.state}>
            <th scope="row">
              <button type="button" className="linklike" onClick={() => select({ type: "job", id: j.id })}>
                <code>{j.id.slice(0, 8)}</code>
              </button>
            </th>
            <td>{j.repo}</td>
            <td>
              <Tag tone={j.lost ? "bad" : j.state === "running" ? (jobIsStale(j, now) ? "warn" : "ok") : j.exit === 0 ? "ok" : "warn"}>
                {j.lost ? "lost" : j.state === "running" && jobIsStale(j, now) ? "running (stale)" : j.state}
                {j.state === "finished" && j.exit !== null ? ` (exit ${j.exit})` : ""}
              </Tag>
            </td>
            <td>{j.state === "running" ? `${Math.round(j.cpuPercent)}%` : "—"}</td>
            <td>
              {j.state === "running" ? fmtKB(j.rssKB) : "—"} <span className="muted">({fmtKB(j.peakRssKB)})</span>
            </td>
            <td>{ageOf(j.startedAt, now)}</td>
            <td className="mono small cmd" title={j.command}>
              {j.command}
              {j.wallMs !== null && <span className="muted"> · {fmtDuration(j.wallMs)}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FlowBlock({ project, now }: { project: ProjectView; now: number }) {
  const f = flowInfo(project, now);
  return (
    <p className={`flowline ${f.notFlowing ? "stalled" : ""}`} data-testid="flowline">
      <span className="flow-light" aria-hidden="true" />
      {f.line}
    </p>
  );
}

export function ProjectOverview({ now }: { now: number }) {
  const projects = useOffice((s) => s.snapshot?.projects ?? EMPTY);
  const selectProject = useOffice((s) => s.selectProject);
  return (
    <table className="grid" data-testid="overview-table">
      <caption className="sr-only">All projects</caption>
      <thead>
        <tr>
          <th scope="col">Project</th>
          <th scope="col">Status</th>
          <th scope="col">Agents</th>
          <th scope="col">Desk</th>
          <th scope="col">Flow</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((p) => {
          const open = p.desk.filter((d) => d.open).length;
          return (
            <tr key={p.slug}>
              <th scope="row">
                <button type="button" className="linklike" onClick={() => selectProject(p.slug)}>
                  {p.label}
                </button>
              </th>
              <td>
                <Tag tone={p.status === "ok" ? "ok" : p.status === "desk-only" ? "ghost" : "warn"}>{p.status}</Tag>
              </td>
              <td>{p.agents.length}</td>
              <td>
                {plural(open, "open item")}
                {isDeadDesk(p) ? " ☠" : ""}
              </td>
              <td className="small">{p.status === "desk-only" ? "—" : flowInfo(p, now).line}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function BoardView() {
  const project = useOffice(selectProjectView);
  const layout = useOffice((s) => s.boardLayout);
  const setLayout = useOffice((s) => s.setBoardLayout);
  const relay = useOffice((s) => s.snapshot?.relay);
  const loaded = useOffice((s) => s.snapshot !== null);
  const now = useNow();

  if (!loaded) return <div className="board" id="main-board"><p className="muted">Waiting for the first snapshot…</p></div>;

  return (
    <div className="board" data-testid="board">
      <section aria-labelledby="h-all">
        <h2 id="h-all">All projects</h2>
        <ProjectOverview now={now} />
      </section>

      {project ? (
        <>
          <section aria-labelledby="h-proj">
            <h2 id="h-proj">{project.label}</h2>
            <p className="muted">
              {project.headline ?? project.nextAction} · <Tag tone="neutral">{project.state}</Tag>{" "}
              <Tag tone="info" title={project.deploy.notes.join("; ") || project.deploy.source}>
                deploy L{project.deploy.level} {deployName(project.deploy.level)} ({project.deploy.source})
              </Tag>
              {project.status !== "ok" && <Tag tone="warn">{project.status}</Tag>}
            </p>
            {project.issues.length > 0 && (
              <ul className="callout warn">
                {project.issues.map((i, n) => (
                  <li key={n}>{i}</li>
                ))}
              </ul>
            )}
            {project.status !== "desk-only" && <FlowBlock project={project} now={now} />}
          </section>

          {project.status !== "desk-only" && (
            <section aria-labelledby="h-lanes">
              <div className="section-head">
                <h3 id="h-lanes">Lanes × delivery stages</h3>
                <div className="seg" role="group" aria-label="Lane layout">
                  <button aria-pressed={layout === "table"} onClick={() => setLayout("table")}>
                    Table
                  </button>
                  <button aria-pressed={layout === "kanban"} onClick={() => setLayout("kanban")}>
                    Kanban
                  </button>
                </div>
              </div>
              {layout === "table" ? <LaneTable project={project} /> : <Kanban project={project} />}
            </section>
          )}

          <section aria-labelledby="h-agents">
            <h3 id="h-agents">Agents</h3>
            <AgentTable project={project} now={now} />
          </section>

          <section aria-labelledby="h-desk">
            <h3 id="h-desk">The desk</h3>
            <DeskTable project={project} now={now} />
          </section>

          <section aria-labelledby="h-packets">
            <h3 id="h-packets">Packets</h3>
            <PacketTable project={project} now={now} />
          </section>
        </>
      ) : (
        <p className="muted">No project selected.</p>
      )}

      <section aria-labelledby="h-jobs">
        <h3 id="h-jobs">Machine room (muster-heavy jobs)</h3>
        <JobTable now={now} />
      </section>

      <section aria-labelledby="h-relay">
        <h3 id="h-relay">Relay counters</h3>
        {relay && Object.keys(relay.counts).length > 0 ? (
          <ul className="inline">
            {Object.entries(relay.counts).map(([k, n]) => (
              <li key={k}>
                <code>{k}</code> {n}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No relay events recorded.</p>
        )}
      </section>
    </div>
  );
}
