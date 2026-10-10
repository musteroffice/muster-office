import { AlertTriangle, Check, Circle, CircleDot, Skull } from "lucide-react";
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
} from "@automicvault/shared";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { EMPTY, useOffice, selectProjectView, type Selection } from "../store";
import { ageOf, plainLabel } from "../lib/format";
import { fmtDuration, fmtKB, modelShort, plural } from "../lib/format";
import { DELIVERY_STAGES, DESK_KIND_META, RULE_LABEL, ROLE_META } from "../lib/meta";
import { TONE_TEXT } from "../lib/tone";
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
        const Icon = current ? CircleDot : reached ? Check : Circle;
        return (
          <li key={stage} className={`${reached ? "reached" : ""} ${current ? "current" : ""}`} aria-current={current ? "step" : undefined}>
            <Icon aria-hidden="true" className="size-3" /> {label}
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
      <strong className="font-mono text-xs">
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

const Th = ({ children }: { children: React.ReactNode }) => (
  <TableHead scope="col" className="h-9 text-xs font-medium text-muted-foreground">
    {children}
  </TableHead>
);
const RowHead = ({ children }: { children: React.ReactNode }) => (
  <TableCell className="align-top font-medium">
    {children}
  </TableCell>
);

function LaneTable({ project }: { project: ProjectView }) {
  const lanes = project.lanes.filter((l) => !(l.archived && l.state === "closed"));
  return (
    <div className="rounded-lg border bg-card">
      <Table data-testid="lane-table">
        <TableCaption className="sr-only">Lanes of {project.label}, with delivery stage and deploy gate</TableCaption>
        <TableHeader>
          <TableRow>
            <Th>Lane</Th>
            <Th>State</Th>
            <Th>Agents</Th>
            <Th>Delivery</Th>
            <Th>Evidence</Th>
            <Th>Deploy gate</Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lanes.map((l) => (
            <TableRow key={l.slug} data-testid="lane-row">
              <RowHead>
                <SelectButton sel={{ type: "lane", project: project.slug, slug: l.slug }}>{l.label}</SelectButton>
                <div className="small muted font-normal">{l.kind === "work" ? l.goal : `${l.kind} lane`}</div>
              </RowHead>
              <TableCell className="align-top">
                <Tag tone={l.state === "open" ? "ok" : l.state === "draining" ? "warn" : l.state === "proposed" ? "ghost" : "neutral"}>{l.state}</Tag>
              </TableCell>
              <TableCell className="align-top">
                <ul className="inline">
                  {agentsOf(project, l).map((a) => (
                    <li key={a.name} className="flex items-center gap-1.5">
                      <SelectButton sel={{ type: "agent", project: project.slug, name: a.name }}>{a.name}</SelectButton> <StateBadge state={a.state} raw={a.rawState} />
                    </li>
                  ))}
                  {agentsOf(project, l).length === 0 && <li className="muted">none</li>}
                </ul>
              </TableCell>
              <TableCell className="align-top">{l.kind === "work" ? <StageStrip lane={l} /> : <span className="muted">n/a</span>}</TableCell>
              <TableCell className="small max-w-64 whitespace-normal align-top">{l.deliveryEvidence ?? <span className="muted">—</span>}</TableCell>
              <TableCell className="align-top">{l.kind === "work" ? <GateCell project={project} lane={l} /> : <span className="muted">n/a</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
              {COLUMN_LABEL[c]} <span className="font-mono">{items.length}</span>
            </h4>
            <ul>
              {items.map((l) => (
                <li key={l.slug} className="kcard">
                  <SelectButton sel={{ type: "lane", project: project.slug, slug: l.slug }}>{l.label}</SelectButton>
                  <GateCell project={project} lane={l} />
                  <ul className="inline mt-1">
                    {agentsOf(project, l).map((a) => (
                      <li key={a.name} className="flex items-center gap-1.5">
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
    <div className="rounded-lg border bg-card">
      <Table data-testid="agent-table">
        <TableCaption className="sr-only">Agents of {project.label}</TableCaption>
        <TableHeader>
          <TableRow>
            <Th>Agent</Th>
            <Th>Role</Th>
            <Th>Model · thinking</Th>
            <Th>State</Th>
            <Th>Lane</Th>
            <Th>Restarts</Th>
            <Th>Updated</Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {project.agents.map((a) => (
            <TableRow key={a.name} data-testid="agent-row" data-state={a.state}>
              <RowHead>
                <SelectButton sel={{ type: "agent", project: project.slug, name: a.name }}>{plainLabel(a.label) || a.name}</SelectButton>
                <div className="small muted font-normal">{a.name}</div>
              </RowHead>
              <TableCell>{ROLE_META[a.role].label}</TableCell>
              <TableCell className="mono small">
                {modelShort(a.model)} · {a.thinking ?? "default"}
              </TableCell>
              <TableCell>
                <StateBadge state={a.state} raw={a.rawState} />
              </TableCell>
              <TableCell>{a.lane}</TableCell>
              <TableCell>{a.restarts}</TableCell>
              <TableCell>{ageOf(a.updatedAt, now)}</TableCell>
            </TableRow>
          ))}
          {project.agents.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="muted">
                No agents in this project.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
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
          <Skull aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>No live desk: items are waiting and no desk agent is running (catalog-derived).</span>
        </p>
      )}
      <div className="rounded-lg border bg-card">
        <Table data-testid="desk-table">
          <TableCaption className="sr-only">Open desk items of {project.label}, ranked blocked then approval then decision</TableCaption>
          <TableHeader>
            <TableRow>
              <Th>Rank</Th>
              <Th>Kind</Th>
              <Th>Title</Th>
              <Th>From</Th>
              <Th>Age</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {open.map((d, i) => {
              const K = DESK_KIND_META[d.kind];
              return (
                <TableRow key={d.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <Tag tone={K.tone}>
                      <K.icon aria-hidden="true" className="size-3" /> {d.kind}
                    </Tag>
                  </TableCell>
                  <TableCell className="whitespace-normal">{d.title}</TableCell>
                  <TableCell>{d.from}</TableCell>
                  <TableCell>{ageOf(d.ts, now)}</TableCell>
                </TableRow>
              );
            })}
            {open.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="muted">
                  Inbox clear.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {rest.length > 0 && (
        <details className="more">
          <summary>Recent resolved and informational lines ({rest.length})</summary>
          <ul className="plain mt-1">
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
    <div className="rounded-lg border bg-card">
      <Table data-testid="packet-table">
        <TableCaption className="sr-only">Packets of {project.label}</TableCaption>
        <TableHeader>
          <TableRow>
            <Th>Packet</Th>
            <Th>Lane</Th>
            <Th>Agent</Th>
            <Th>State</Th>
            <Th>Checks</Th>
            <Th>Reported</Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...project.packets].reverse().map((k) => (
            <TableRow key={k.id}>
              <RowHead>
                <SelectButton sel={{ type: "packet", project: project.slug, id: k.id }}>
                  <code title={k.id}>{k.short}</code>
                </SelectButton>
              </RowHead>
              <TableCell>{k.lane}</TableCell>
              <TableCell>{k.agent}</TableCell>
              <TableCell>
                <Tag tone={k.state === "committed" ? "ok" : k.state === "rejected" ? "bad" : "info"}>{k.state}</Tag>
              </TableCell>
              <TableCell className="small">
                {k.checks.filter((c) => c.outcome === "pass").length}/{k.checks.length} pass
              </TableCell>
              <TableCell>{ageOf(k.reportedAt, now)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function JobTable({ now }: { now: number }) {
  const jobs = useOffice((s) => s.snapshot?.jobs ?? EMPTY);
  const select = useOffice((s) => s.select);
  if (jobs.length === 0) return <p className="muted">No muster-heavy jobs recorded.</p>;
  return (
    <div className="rounded-lg border bg-card">
      <Table data-testid="job-table">
        <TableCaption className="sr-only">muster-heavy jobs (the machine room)</TableCaption>
        <TableHeader>
          <TableRow>
            <Th>Job</Th>
            <Th>Repo</Th>
            <Th>State</Th>
            <Th>CPU</Th>
            <Th>RSS (peak)</Th>
            <Th>Started</Th>
            <Th>Command</Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...jobs].reverse().map((j) => (
            <TableRow key={j.id} data-state={j.state}>
              <RowHead>
                <button type="button" className="linklike" onClick={() => select({ type: "job", id: j.id })}>
                  <code>{j.id.slice(0, 8)}</code>
                </button>
              </RowHead>
              <TableCell>{j.repo}</TableCell>
              <TableCell>
                <Tag tone={j.lost ? "bad" : j.state === "running" ? (jobIsStale(j, now) ? "warn" : "ok") : j.exit === 0 ? "ok" : "warn"}>
                  {j.lost ? "lost" : j.state === "running" && jobIsStale(j, now) ? "running (stale)" : j.state}
                  {j.state === "finished" && j.exit !== null ? ` (exit ${j.exit})` : ""}
                </Tag>
              </TableCell>
              <TableCell>{j.state === "running" ? `${Math.round(j.cpuPercent)}%` : "—"}</TableCell>
              <TableCell>
                {j.state === "running" ? fmtKB(j.rssKB) : "—"} <span className="muted">({fmtKB(j.peakRssKB)})</span>
              </TableCell>
              <TableCell>{ageOf(j.startedAt, now)}</TableCell>
              <TableCell className="mono small cmd" title={j.command}>
                {j.command}
                {j.wallMs !== null && <span className="muted"> · {fmtDuration(j.wallMs)}</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Muster's own flow line, verbatim. Its leading warning sign becomes an icon. */
export function FlowLine({ line, stalled, className }: { line: string; stalled: boolean; className?: string }) {
  const text = line.replace(/^\s*⚠\s*/, "");
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {stalled && <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-warning" />}
      <span>{stalled ? text : line}</span>
    </span>
  );
}

function FlowBlock({ project, now }: { project: ProjectView; now: number }) {
  const f = flowInfo(project, now);
  return (
    <p
      className={cn("my-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 font-mono text-[0.8125rem]", f.notFlowing && "border-warning/50 text-warning")}
      data-testid="flowline"
    >
      <span className={cn("size-2 shrink-0 rounded-full", f.notFlowing ? "bg-destructive" : "bg-success")} aria-hidden="true" />
      <FlowLine line={f.line} stalled={f.notFlowing} />
    </p>
  );
}

export function ProjectOverview({ now }: { now: number }) {
  const projects = useOffice((s) => s.snapshot?.projects ?? EMPTY);
  const selectProject = useOffice((s) => s.selectProject);
  return (
    <div className="rounded-lg border bg-card">
      <Table data-testid="overview-table">
        <TableCaption className="sr-only">All projects</TableCaption>
        <TableHeader>
          <TableRow>
            <Th>Project</Th>
            <Th>Status</Th>
            <Th>Agents</Th>
            <Th>Desk</Th>
            <Th>Flow</Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((p) => {
            const open = p.desk.filter((d) => d.open).length;
            return (
              <TableRow key={p.slug}>
                <RowHead>
                  <button type="button" className="linklike" onClick={() => selectProject(p.slug)}>
                    {p.label}
                  </button>
                </RowHead>
                <TableCell>
                  <Tag tone={p.status === "ok" ? "ok" : p.status === "desk-only" ? "ghost" : "warn"}>{p.status}</Tag>
                </TableCell>
                <TableCell>{p.agents.length}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5">
                    {plural(open, "open item")}
                    {isDeadDesk(p) && <Skull aria-label="no live desk" className={cn("size-3.5", TONE_TEXT.bad)} />}
                  </span>
                </TableCell>
                <TableCell className="small whitespace-normal">
                  {p.status === "desk-only" ? "—" : (() => {
                    const f = flowInfo(p, now);
                    return <FlowLine line={f.line} stalled={f.notFlowing} />;
                  })()}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

const H2 = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h2 id={id} className="mb-2 mt-6 text-lg font-semibold tracking-tight">
    {children}
  </h2>
);
const H3 = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h3 id={id} className="mb-2 mt-7 text-base font-semibold tracking-tight">
    {children}
  </h3>
);

export function BoardView() {
  const project = useOffice(selectProjectView);
  const layout = useOffice((s) => s.boardLayout);
  const setLayout = useOffice((s) => s.setBoardLayout);
  const relay = useOffice((s) => s.snapshot?.relay);
  const loaded = useOffice((s) => s.snapshot !== null);
  const now = useNow();

  if (!loaded) {
    return (
      <div className="p-6" id="main-board">
        <p className="muted">Waiting for the first snapshot…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] px-5 pb-12 pt-1" data-testid="board">
      <section aria-labelledby="h-all">
        <H2 id="h-all">All projects</H2>
        <ProjectOverview now={now} />
      </section>

      {project ? (
        <>
          <section aria-labelledby="h-proj">
            <H2 id="h-proj">{project.label}</H2>
            <p className="muted flex flex-wrap items-center gap-1.5">
              {project.headline ?? project.nextAction} <span aria-hidden="true">·</span> <Tag tone="neutral">{project.state}</Tag>
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
              <div className="mb-2 mt-7 flex items-center gap-4">
                <h3 id="h-lanes" className="text-base font-semibold tracking-tight">
                  Lanes × delivery stages
                </h3>
                <ToggleGroup type="single" variant="outline" size="sm" value={layout} onValueChange={(v) => v && setLayout(v as "table" | "kanban")} aria-label="Lane layout">
                  <ToggleGroupItem value="table" aria-label="Table">
                    Table
                  </ToggleGroupItem>
                  <ToggleGroupItem value="kanban" aria-label="Kanban">
                    Kanban
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              {layout === "table" ? <LaneTable project={project} /> : <Kanban project={project} />}
            </section>
          )}

          <section aria-labelledby="h-agents">
            <H3 id="h-agents">Agents</H3>
            <AgentTable project={project} now={now} />
          </section>

          <section aria-labelledby="h-desk">
            <H3 id="h-desk">The desk</H3>
            <DeskTable project={project} now={now} />
          </section>

          <section aria-labelledby="h-packets">
            <H3 id="h-packets">Packets</H3>
            <PacketTable project={project} now={now} />
          </section>
        </>
      ) : (
        <p className="muted">No project selected.</p>
      )}

      <section aria-labelledby="h-jobs">
        <H3 id="h-jobs">Machine room (muster-heavy jobs)</H3>
        <JobTable now={now} />
      </section>

      <section aria-labelledby="h-relay">
        <H3 id="h-relay">Relay counters</H3>
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
