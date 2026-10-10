import { useMemo } from "react";
import type { TimelineKind } from "@muster-office/shared";
import { useShallow } from "zustand/react/shallow";
import { EMPTY, useOffice } from "../store";
import { clock } from "../lib/format";

const KINDS: TimelineKind[] = ["agent", "lane", "delivery", "packet", "desk", "owner", "job", "relay", "system"];
const GLYPH: Record<TimelineKind, string> = { agent: "☺", lane: "▤", delivery: "⇥", packet: "▥", desk: "✉", owner: "✎", job: "⚙", relay: "≋", system: "◇" };
const RENDER_CAP = 150;

export function Timeline() {
  const { timeline, filters, open, projects } = useOffice(
    useShallow((s) => ({ timeline: s.timeline, filters: s.filters, open: s.timelineOpen, projects: s.snapshot?.projects ?? EMPTY })),
  );
  const { setFilters, setTimelineOpen, select } = useOffice.getState();

  const agents = useMemo(() => {
    const set = new Set<string>();
    for (const e of timeline) if (e.agent && (filters.project === "all" || e.project === filters.project)) set.add(e.agent);
    return [...set].sort();
  }, [timeline, filters.project]);

  const rows = useMemo(() => {
    const out = [];
    for (let i = timeline.length - 1; i >= 0 && out.length < RENDER_CAP; i--) {
      const e = timeline[i]!;
      if (filters.project !== "all" && e.project !== filters.project) continue;
      if (filters.agent !== "all" && e.agent !== filters.agent) continue;
      if (filters.kinds.length > 0 && !filters.kinds.includes(e.kind)) continue;
      out.push(e);
    }
    return out;
  }, [timeline, filters]);

  const latest = rows[0];
  const toggleKind = (k: TimelineKind): void => {
    const has = filters.kinds.includes(k);
    setFilters({ kinds: has ? filters.kinds.filter((x) => x !== k) : [...filters.kinds, k] });
  };

  return (
    <section className={`timeline ${open ? "open" : "closed"}`} aria-labelledby="tl-h" data-testid="timeline">
      <div className="tl-head">
        <h2 id="tl-h">Timeline</h2>
        <span className="muted small">{rows.length} shown · newest first</span>
        {!open && latest && (
          <span className={`tl-latest sev-${latest.severity}`} key={latest.id}>
            <time dateTime={new Date(latest.ts).toISOString()}>{clock(latest.ts)}</time> {latest.text}
          </span>
        )}
        <label className="select small">
          <span className="sr-only">Project filter</span>
          <select aria-label="Project filter" value={filters.project} onChange={(e) => setFilters({ project: e.target.value, agent: "all" })}>
            <option value="all">all projects</option>
            {projects.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="select small">
          <span className="sr-only">Agent filter</span>
          <select aria-label="Agent filter" value={filters.agent} onChange={(e) => setFilters({ agent: e.target.value })}>
            <option value="all">all agents</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <div className="chips" role="group" aria-label="Event kinds">
          {KINDS.map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={filters.kinds.includes(k)} onClick={() => toggleKind(k)}>
              {k}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" onClick={() => setTimelineOpen(!open)} aria-expanded={open} aria-label={open ? "Collapse timeline" : "Expand timeline"}>
          {open ? "▾" : "▴"}
        </button>
      </div>
      {open && (
        <ol className="tl-list" data-testid="timeline-list">
          {rows.map((e, n) => (
            <li key={e.id} className={`sev-${e.severity}${n === 0 && e.ts > Date.now() - 2000 ? " fresh" : ""}`}>
              <time dateTime={new Date(e.ts).toISOString()}>{clock(e.ts)}</time>
              <span className={`kind kind-${e.kind}`}>
                <span aria-hidden="true">{GLYPH[e.kind]} </span>
                {e.kind}
              </span>
              {e.project && <span className="muted small proj">{e.project}</span>}
              {e.agent && e.project ? (
                <button type="button" className="linklike" onClick={() => select({ type: "agent", project: e.project!, name: e.agent! })}>
                  {e.text}
                </button>
              ) : (
                <span>{e.text}</span>
              )}
              <span className="sr-only"> severity {e.severity}</span>
            </li>
          ))}
          {rows.length === 0 && <li className="muted">No events match.</li>}
        </ol>
      )}
    </section>
  );
}
