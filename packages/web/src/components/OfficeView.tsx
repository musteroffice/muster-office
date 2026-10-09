import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { backlog, deployName, deskPiles, flowInfo, inFlight, isDeadDesk, jobIsStale, laneDeployLevel, type JobView, type ProjectView } from "@muster-office/shared";
import { OfficeEngine, targetKey, toSelection } from "../office/engine";
import type { Target } from "../office/world";
import { ageOf, fmtKB, modelShort } from "../lib/format";
import { DEPLOY_LEVEL_META, RULE_LABEL, STATE_META } from "../lib/meta";
import { selectProjectView, useOffice } from "../store";
import { useNow } from "./hooks";

interface Hover {
  target: Target;
  x: number;
  y: number;
}

function describe(t: Target, project: ProjectView, jobs: readonly JobView[], now: number): { title: string; lines: string[] } {
  switch (t.type) {
    case "agent": {
      const a = project.agents.find((x) => x.name === t.name);
      if (!a) return { title: t.name, lines: [] };
      const last = project.packets.filter((p) => p.agent === a.name).at(-1);
      const m = STATE_META[a.state];
      return {
        title: `${a.label || a.name}`,
        lines: [
          `${a.role} · ${m.label}: ${m.what}`,
          `${modelShort(a.model)} · thinking ${a.thinking ?? "default"}`,
          `lane ${a.lane}${a.restarts ? ` · ${a.restarts} restart${a.restarts === 1 ? "" : "s"}` : ""}`,
          last ? `packet ${last.short} (${last.state})` : "no packet yet",
        ],
      };
    }
    case "lane": {
      const lane = project.lanes.find((l) => l.slug === t.slug);
      if (!lane) {
        const w = project.lanes.find((l) => l.slug === t.slug);
        return { title: t.slug, lines: [w ? w.goal : "waiting at the door: WIP is at its limit"] };
      }
      const level = laneDeployLevel(lane, project.deploy.level);
      if (t.part === "gate") {
        return {
          title: `Deploy gate · level ${level} ${deployName(level)}`,
          lines: [
            DEPLOY_LEVEL_META[level].gloss,
            `project level ${project.deploy.level} from ${project.deploy.source}`,
            ...(lane.deployRule ? [`rule: ${lane.deployRule} — ${RULE_LABEL[lane.deployRule]}`] : []),
            ...(lane.override ? [`override: “${lane.override}”`] : []),
          ],
        };
      }
      if (t.part === "strip") {
        const packet = project.packets.filter((p) => p.lane === lane.slug && p.state === "committed").at(-1);
        return {
          title: `Delivery · ${lane.delivery}`,
          lines: [
            ...(packet ? [`packet ${packet.short}`] : []),
            ...lane.deliveryHistory.slice(-3).map((h) => `${h.stage}: ${h.evidence || "no evidence text"}`),
            ...(lane.deliveryHistory.length === 0 ? ["nothing delivered yet"] : []),
          ],
        };
      }
      return { title: `${lane.label} · ${lane.state}`, lines: [lane.goal || `${lane.kind} lane`, `${lane.kind === "work" ? `delivery ${lane.delivery}` : "role lane"}`] };
    }
    case "desk": {
      const piles = deskPiles(project.desk, now);
      const dead = isDeadDesk(project);
      const pk = project.packets.filter((p) => p.state === "reported" || p.state === "verified");
      return {
        title: "The desk",
        lines: [
          ...(piles.length ? piles.map((p) => `${p.kind}: ${p.count} open · oldest ${Math.round(p.oldestMs / 60000)}m`) : ["inbox clear"]),
          ...(pk.length ? [`packets waiting: ${pk.map((p) => p.short).join(", ")}`] : []),
          ...(dead ? ["☠ no live desk (catalog-derived)"] : []),
        ],
      };
    }
    case "door": {
      const f = flowInfo(project, now);
      return { title: `The door · WIP ${f.wip}/${f.limit ?? "off"}`, lines: [f.atLimit ? "At the limit: the backlog waits here" : `${f.openSlots ?? "∞"} slot(s) free`, `${inFlight(project).length} in flight · ${backlog(project).length} waiting`] };
    }
    case "project":
      return { title: project.label, lines: [flowInfo(project, now).line] };
    case "job": {
      const j = jobs.find((x) => x.id === t.id);
      if (!j) return { title: "Job", lines: [] };
      return {
        title: `Job ${j.id.slice(0, 8)} · ${j.lost ? "lost" : j.state}`,
        lines: [
          j.command,
          j.state === "running" ? `CPU ${Math.round(j.cpuPercent)}% · RSS ${fmtKB(j.rssKB)} (peak ${fmtKB(j.peakRssKB)})${jobIsStale(j, now) ? " · stale" : ""}` : `peak RSS ${fmtKB(j.peakRssKB)}${j.exit !== null ? ` · exit ${j.exit}` : ""}`,
          `${j.repo} · started ${ageOf(j.startedAt, now)}`,
        ],
      };
    }
    case "rack":
      return { title: "Empty rack slot", lines: [] };
  }
}

export function OfficeView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<OfficeEngine | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [zoom, setZoom] = useState(2);
  const project = useOffice(selectProjectView);
  const jobs = useOffice((s) => s.snapshot?.jobs);
  const loaded = useOffice((s) => s.snapshot !== null);
  const select = useOffice((s) => s.select);
  const now = useNow();

  const hooks = useMemo(
    () => ({
      onHover: (target: Target | null, x: number, y: number) => setHover((prev) => (target ? (prev && targetKey(prev.target) === targetKey(target) && Math.abs(prev.x - x) + Math.abs(prev.y - y) < 3 ? prev : { target, x, y }) : null)),
      onSelect: (t: Target | null) => select(t ? toSelection(t) : null),
      onZoom: (z: number) => setZoom(z),
    }),
    [select],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new OfficeEngine(canvas, hooks);
    engineRef.current = engine;
    engine.start();
    window.__office = { debug: () => engine.debug(), screenPosOf: (n) => engine.screenPosOf(n), zoom: () => engine.getZoom(), centerOn: (x, y) => engine.centerOn(x, y), focusAgent: (n) => engine.focusAgent(n) };
    return () => {
      engine.stop();
      engineRef.current = null;
      delete window.__office;
    };
  }, [hooks]);

  // The first snapshot can arrive after mount.
  useEffect(() => {
    if (loaded) {
      engineRef.current?.syncFromStore(true);
      engineRef.current?.fit();
      engineRef.current?.wake();
    }
  }, [loaded]);

  const tip = useMemo(() => (hover && project ? describe(hover.target, project, jobs ?? [], now) : null), [hover, project, jobs, now]);
  const agentCount = project?.agents.length ?? 0;
  const label = project
    ? `Office floor of ${project.label}: ${agentCount} agent${agentCount === 1 ? "" : "s"}, ${project.lanes.length} lane${project.lanes.length === 1 ? "" : "s"}. Arrow keys pan, plus and minus zoom, N and P step through agents, Enter selects. The Board view shows the same data as tables.`
    : "Office floor";

  const nudge = useCallback((fn: (e: OfficeEngine) => void) => engineRef.current && fn(engineRef.current), []);

  return (
    <div className="office" data-testid="office">
      <canvas ref={canvasRef} className="office-canvas" tabIndex={0} role="application" aria-label={label} aria-roledescription="animated office" data-testid="office-canvas" />
      {!loaded && <div className="office-empty muted">Waiting for the first snapshot…</div>}
      {loaded && !project && <div className="office-empty muted">No project to show. Muster has not registered any, or the registry is empty.</div>}
      <div className="hud" role="group" aria-label="Camera">
        <button type="button" onClick={() => nudge((e) => e.setZoom(e.getZoom() + 1))} aria-label="Zoom in">
          +
        </button>
        <span className="hud-zoom" aria-live="off">
          {zoom}×
        </span>
        <button type="button" onClick={() => nudge((e) => e.setZoom(e.getZoom() - 1))} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => nudge((e) => (e.fit(), e.wake()))} aria-label="Fit to window">
          fit
        </button>
      </div>
      <details className="legend">
        <summary>legend</summary>
        <ul>
          {Object.entries(STATE_META)
            .filter(([k]) => k !== "unknown")
            .map(([k, m]) => (
              <li key={k}>
                <code>{k.slice(0, 3).toUpperCase()}</code> {m.label} — {m.what}
              </li>
            ))}
        </ul>
        <p className="small muted">Flames: heat from kind weight (blocked 3, approval 2, decision 1) and log age. Skull: no live desk.</p>
      </details>
      {hover && tip && (
        <div className="tooltip" role="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{tip.title}</strong>
          {tip.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
