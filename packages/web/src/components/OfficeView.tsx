import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Clapperboard, ListTree, Loader2, Maximize2, Navigation, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { backlog, deployName, deskPiles, flowInfo, inFlight, isDeadDesk, jobIsStale, laneDeployLevel, type JobView, type ProjectView } from "@muster-office/shared";
import { OfficeEngine, targetKey, toSelection } from "../office/engine";
import type { Target } from "../office/world";
import { ageOf, fmtKB, modelShort, plainLabel } from "../lib/format";
import { DEPLOY_LEVEL_META, RULE_LABEL, STATE_META } from "../lib/meta";
import { TONE_TEXT } from "../lib/tone";
import { selectProjectView, useOffice } from "../store";
import { Director } from "./Director";
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
        title: plainLabel(a.label) || a.name,
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
          ...(dead ? ["no live desk (catalog-derived)"] : []),
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
    case "critter":
      return { title: "Biscuit, the office cat", lines: ["Decorative: not an agent, and not Muster data.", "Click to pet."] };
  }
}

/** The overview map. The engine paints into it; clicking or dragging moves the camera. */
function Minimap({ engineRef, attach }: { engineRef: React.RefObject<OfficeEngine | null>; attach: (el: HTMLCanvasElement | null) => void }) {
  const move = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const eng = engineRef.current;
    if (!eng) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = eng.minimapToWorld((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (useOffice.getState().follow) useOffice.getState().setFollow(false);
    eng.centerOn(p.x, p.y);
  };
  return (
    <div className="minimap absolute bottom-3 right-3 z-[5] rounded-lg border bg-card p-1 shadow-sm" data-testid="minimap">
      <canvas
        ref={attach}
        aria-label="Minimap: click or drag to move the view"
        role="img"
        className="block rounded-sm"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && move(e)}
      />
    </div>
  );
}

export function OfficeView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<OfficeEngine | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [zoom, setZoom] = useState(2);
  const project = useOffice(selectProjectView);
  const jobs = useOffice((s) => s.snapshot?.jobs);
  const loaded = useOffice((s) => s.snapshot !== null);
  const select = useOffice((s) => s.select);
  const minimap = useOffice((s) => s.minimap);
  const follow = useOffice((s) => s.follow);
  const director = useOffice((s) => s.director);
  const setDirector = useOffice((s) => s.setDirector);
  const selected = useOffice((s) => s.selection);
  const setFollow = useOffice((s) => s.setFollow);
  const now = useNow();
  const attachMini = useCallback((el: HTMLCanvasElement | null) => {
    miniRef.current = el;
    engineRef.current?.attachMinimap(el);
  }, []);

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
    engine.attachMinimap(miniRef.current);
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
      engineRef.current?.frameAction();
      engineRef.current?.wake();
    }
  }, [loaded]);

  const tip = useMemo(() => (hover && project ? describe(hover.target, project, jobs ?? [], now) : null), [hover, project, jobs, now]);
  const agentCount = project?.agents.length ?? 0;
  const label = project
    ? `Office floor of ${project.label}: ${agentCount} agent${agentCount === 1 ? "" : "s"}, ${project.lanes.length} lane${project.lanes.length === 1 ? "" : "s"}. Arrow keys pan, plus and minus zoom, N and P step through agents, Enter selects. The Board view shows the same data as tables.`
    : "Office floor";

  // What a sighted viewer reads off the floor, as text, for assistive tech. The Board view has the full tables.
  const summary = useMemo(() => {
    if (!project) return "";
    const f = flowInfo(project, now);
    const byState = new Map<string, string[]>();
    for (const a of project.agents) byState.set(a.state, [...(byState.get(a.state) ?? []), a.name]);
    const agents = [...byState].map(([s, names]) => `${s}: ${names.join(", ")}`).join("; ");
    const open = project.desk.filter((d) => d.open).length;
    return `${f.line}. Agents — ${agents || "none"}. Desk: ${open} open item${open === 1 ? "" : "s"}${isDeadDesk(project) ? ", no live desk" : ""}. Machine room: ${(jobs ?? []).filter((j) => j.state === "running").length} running job(s), ${(jobs ?? []).filter((j) => j.lost).length} lost.`;
  }, [project, jobs, now]);

  const nudge = useCallback((fn: (e: OfficeEngine) => void) => engineRef.current && fn(engineRef.current), []);

  return (
    <div className="office" data-testid="office">
      <canvas ref={canvasRef} className="office-canvas" tabIndex={0} role="application" aria-label={label} aria-roledescription="animated office" aria-describedby="office-summary" data-testid="office-canvas" />
      <p id="office-summary" className="sr-only">
        {summary}
      </p>
      {!loaded && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            Opening the office…
          </div>
        </div>
      )}
      {loaded && !project && <div className="pointer-events-none absolute inset-0 grid place-items-center text-muted-foreground">No project to show. Muster has not registered any, or the registry is empty.</div>}
      {director && <Director />}
      <div className="absolute right-3 top-3 z-[5] flex items-center gap-0.5 rounded-lg border bg-card p-0.5 shadow-sm" role="group" aria-label="Camera">
        <Button type="button" variant={director ? "default" : "ghost"} size="sm" className="h-7 gap-1.5 px-2" aria-pressed={director} onClick={() => setDirector(!director)} title="Director: the camera flies to the action by itself, for a wall display (D)">
          <Clapperboard /> auto
        </Button>
        {selected?.type === "agent" && (
          <Button type="button" variant={follow ? "default" : "ghost"} size="sm" className="h-7 gap-1.5 px-2" aria-pressed={follow} onClick={() => setFollow(!follow)} title="Keep the camera on the selected agent (F)">
            <Navigation /> follow
          </Button>
        )}
        <Separator orientation="vertical" className="mx-0.5 h-4" />
        <Button type="button" variant="ghost" size="icon-sm" className="size-7" onClick={() => nudge((e) => e.setZoom(e.getZoom() - 1))} aria-label="Zoom out">
          <ZoomOut />
        </Button>
        <span className="min-w-8 text-center font-mono text-xs" aria-live="off">
          {zoom}x
        </span>
        <Button type="button" variant="ghost" size="icon-sm" className="size-7" onClick={() => nudge((e) => e.setZoom(e.getZoom() + 1))} aria-label="Zoom in">
          <ZoomIn />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" className="size-7" onClick={() => nudge((e) => (e.fit(), e.wake()))} aria-label="Fit to window" title="Fit the whole floor">
          <Maximize2 />
        </Button>
      </div>
      {minimap && loaded && project && <Minimap engineRef={engineRef} attach={attachMini} />}
      <Collapsible className="absolute left-3 top-3 z-[5] max-w-sm rounded-lg border bg-card text-xs shadow-sm max-sm:hidden">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-muted-foreground">
            <ListTree /> Legend <ChevronDown className="size-3" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t px-2.5 py-2">
          <ul className="m-0 grid list-none gap-1 p-0">
            {Object.entries(STATE_META)
              .filter(([k]) => k !== "unknown")
              .map(([k, m]) => {
                const Icon = m.icon;
                return (
                  <li key={k} className="flex items-start gap-1.5">
                    <Icon aria-hidden="true" className={cn("mt-0.5 size-3.5 shrink-0", TONE_TEXT[m.tone])} />
                    <span>
                      <span className="font-medium">{m.label}</span> <span className="text-muted-foreground">{m.what}</span>
                    </span>
                  </li>
                );
              })}
          </ul>
          <p className="mt-2 text-muted-foreground">Flames: heat from kind weight (blocked 3, approval 2, decision 1) and log age. Skull: no live desk.</p>
        </CollapsibleContent>
      </Collapsible>
      {hover && tip && (
        <div className="pointer-events-none absolute z-20 max-w-[21rem] rounded-md border bg-popover px-2.5 py-1.5 text-xs leading-snug text-popover-foreground shadow-md" role="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong className="mb-0.5 block text-[0.8125rem] font-semibold">{tip.title}</strong>
          {tip.lines.map((l, i) => (
            <div key={i} className="break-words text-muted-foreground">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
