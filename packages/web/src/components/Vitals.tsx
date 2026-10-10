import { useMemo } from "react";
import { deskPiles, flowInfo, isDeadDesk, type ProjectView } from "@muster-office/shared";
import { requestFocus } from "../lib/bus";
import { selectProjectView, useOffice } from "../store";
import { useNow } from "./hooks";

/**
 * The vital-signs strip: what a glance at the office should answer. Every card is a button that
 * takes you to the thing it counts, so an alert is never more than one click from its cause.
 */

type Tone = "ok" | "warn" | "bad" | "info" | "ghost";

const WORKING = new Set(["running", "restarted", "launching", "restoring"]);
const ATTENTION = new Set(["failed", "silent", "nudged", "interrupted"]);

function Vital({ label, value, sub, tone, onClick, title, children }: { label: string; value: string | number; sub?: string; tone: Tone; onClick?: () => void; title?: string; children?: React.ReactNode }) {
  return (
    <button type="button" className={`vital t-${tone}`} onClick={onClick} title={title} disabled={!onClick}>
      <span className="v-label">{label}</span>
      <span className="v-row">
        <span className="v-num" key={String(value)}>
          {value}
        </span>
        {children}
      </span>
      {sub && <span className="v-sub">{sub}</span>}
    </button>
  );
}

/** Events per 30 s over the last ten minutes, as a small area chart. */
function Spark({ stamps, now }: { stamps: number[]; now: number }) {
  const N = 20;
  const STEP = 30_000;
  const buckets = new Array<number>(N).fill(0);
  for (const t of stamps) {
    const k = N - 1 - Math.floor((now - t) / STEP);
    if (k >= 0 && k < N) buckets[k]!++;
  }
  const max = Math.max(3, ...buckets);
  const pts = buckets.map((b, i) => `${(i / (N - 1)) * 96 + 2},${22 - (b / max) * 18}`);
  return (
    <svg className="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`2,22 ${pts.join(" ")} 98,22`} className="spark-fill" />
      <polyline points={pts.join(" ")} className="spark-line" />
    </svg>
  );
}

function summarize(project: ProjectView, now: number) {
  const agents = project.agents;
  const working = agents.filter((a) => WORKING.has(a.state)).length;
  const attention = agents.filter((a) => ATTENTION.has(a.state));
  const failed = agents.filter((a) => a.state === "failed");
  const piles = deskPiles(project.desk, now);
  const pile = (k: string): number => piles.find((p) => p.kind === k)?.count ?? 0;
  const work = project.lanes.filter((l) => l.kind === "work" && !(l.archived && l.state === "closed"));
  return {
    working,
    attention,
    failed,
    blocked: pile("blocked"),
    approval: pile("approval"),
    decision: pile("decision"),
    hot: Math.max(0, ...piles.map((p) => p.tier)),
    landed: work.filter((l) => l.delivery === "landed").length,
    deployed: work.filter((l) => l.delivery === "deployed").length,
    proven: work.filter((l) => l.delivery === "proven" || l.delivery === "waived").length,
    flow: flowInfo(project, now),
    dead: isDeadDesk(project),
  };
}

export function Vitals() {
  const project = useOffice(selectProjectView);
  const jobs = useOffice((s) => s.snapshot?.jobs);
  const timeline = useOffice((s) => s.timeline);
  const select = useOffice((s) => s.select);
  const view = useOffice((s) => s.view);
  const now = useNow();
  const stamps = useMemo(() => (project ? timeline.filter((e) => e.project === project.slug).slice(-200).map((e) => e.ts) : []), [timeline, project]);
  // Keep the row in the page grid even before there is data, so the layout never jumps.
  if (!project) return <section className="vitals vitals-empty" aria-label="Vital signs" />;
  const v = summarize(project, now);
  const running = (jobs ?? []).filter((j) => j.state === "running").length;
  const lost = (jobs ?? []).filter((j) => j.lost).length;
  const go = (fn: () => void) => (): void => {
    fn();
  };
  const first = v.failed[0] ?? v.attention[0];
  const open = v.blocked + v.approval + v.decision;
  const perMin = stamps.filter((t) => now - t < 60_000).length;
  const f = v.flow;

  return (
    <section className="vitals" aria-label="Vital signs" data-testid="vitals">
      <Vital
        label="Flow"
        value={f.notFlowing ? "stalled" : "flowing"}
        sub={`WIP ${f.wip}/${f.limit ?? "off"}${f.atLimit ? " · at limit" : ""}`}
        tone={f.notFlowing ? "bad" : f.atLimit ? "warn" : "ok"}
        title={f.line}
        onClick={go(() => {
          select({ type: "project", project: project.slug });
          if (view === "office") requestFocus({ type: "ticker" });
        })}
      >
        <span className={`beacon ${f.notFlowing ? "bad" : "ok"}`} aria-hidden="true" />
      </Vital>
      <Vital
        label="Crew"
        value={`${v.working}/${project.agents.length}`}
        sub={v.attention.length ? `${v.attention.length} need attention` : "all steady"}
        tone={v.failed.length ? "bad" : v.attention.length ? "warn" : "ok"}
        title="Agents working now, out of everyone on this floor. Click to look at the first one needing attention."
        onClick={
          first
            ? go(() => {
                select({ type: "agent", project: project.slug, name: first.name });
                if (view === "office") requestFocus({ type: "agent", name: first.name });
              })
            : undefined
        }
      />
      <Vital
        label="Desk"
        value={open}
        sub={open ? [v.blocked && `${v.blocked} blocked`, v.approval && `${v.approval} approval`, v.decision && `${v.decision} decision`].filter(Boolean).join(" · ") : "inbox clear"}
        tone={v.blocked ? "bad" : open ? "warn" : "ok"}
        title={v.dead ? "Open items. No live desk operator (derived from the catalog)." : "Open desk items: blocked, then approval, then decision."}
        onClick={go(() => {
          select({ type: "desk", project: project.slug });
          if (view === "office") requestFocus({ type: "desk" });
        })}
      >
        {v.hot >= 2 && <span className="flame" aria-hidden="true" />}
      </Vital>
      <Vital
        label="Delivery"
        value={v.proven}
        sub={`${v.landed} landed · ${v.deployed} deployed`}
        tone={v.proven ? "ok" : "info"}
        title="Lanes whose work is proven live (waived counts), and how many are mid-way."
        onClick={go(() => select({ type: "project", project: project.slug }))}
      />
      <Vital
        label="Machine"
        value={running}
        sub={lost ? `${lost} lost` : running ? "heavy jobs running" : "idle"}
        tone={lost ? "bad" : running ? "info" : "ghost"}
        title="muster-heavy jobs on this host"
        onClick={go(() => {
          if (view === "office") requestFocus({ type: "machine" });
        })}
      />
      <div className="vital vital-pulse t-info" role="img" aria-label={`${perMin} events in the last minute`}>
        <span className="v-label">Pulse</span>
        <span className="v-row">
          <span className="v-num" key={perMin}>
            {perMin}
          </span>
          <span className="v-unit">/min</span>
        </span>
        <Spark stamps={stamps} now={now} />
      </div>
    </section>
  );
}
