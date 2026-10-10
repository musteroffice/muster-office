import { memo, useMemo } from "react";
import { ChevronDown, ChevronUp, Cpu, Inbox, MessageSquare, PackageCheck, Radio, Rows3, Settings2, Truck, User, type LucideIcon } from "lucide-react";
import type { TimelineKind } from "@automicvault/shared";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { EMPTY, useOffice } from "../store";
import { clock } from "../lib/format";

const KINDS: TimelineKind[] = ["agent", "lane", "delivery", "packet", "desk", "owner", "job", "relay", "system"];
export const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  agent: User,
  lane: Rows3,
  delivery: Truck,
  packet: PackageCheck,
  desk: Inbox,
  owner: MessageSquare,
  job: Cpu,
  relay: Radio,
  system: Settings2,
};
const RENDER_CAP = 100;

export const SEV_BAR = { ok: "border-l-success", warn: "border-l-warning", error: "border-l-destructive", info: "border-l-border" } as const;

type Row = ReturnType<typeof useOffice.getState>["timeline"][number];

/** One line of the timeline. Events never change once written, so a row only renders again when its highlight flips. */
const TimelineRow = memo(function TimelineRow({ e, fresh }: { e: Row; fresh: boolean }) {
  const Icon = KIND_ICON[e.kind];
  const select = useOffice.getState().select;
  return (
    <li className={cn("flex items-baseline gap-2.5 border-l-2 py-0.5 pl-2.5", SEV_BAR[e.severity], e.severity === "error" && "bg-destructive/5", fresh && "bg-accent")}>
      <time className="shrink-0 font-mono text-xs text-muted-foreground" dateTime={new Date(e.ts).toISOString()}>
        {clock(e.ts)}
      </time>
      <span className="inline-flex w-[5.25rem] shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <Icon aria-hidden="true" className="size-3" />
        {e.kind}
      </span>
      {e.project && <span className="shrink-0 text-xs text-muted-foreground">{e.project}</span>}
      {e.agent && e.project ? (
        <button type="button" className="linklike text-left" onClick={() => select({ type: "agent", project: e.project!, name: e.agent! })}>
          {e.text}
        </button>
      ) : (
        <span>{e.text}</span>
      )}
      <span className="sr-only"> severity {e.severity}</span>
    </li>
  );
});

export function Timeline() {
  const { timeline, filters, open, projects } = useOffice(
    useShallow((s) => ({ timeline: s.timeline, filters: s.filters, open: s.timelineOpen, projects: s.snapshot?.projects ?? EMPTY })),
  );
  const { setFilters, setTimelineOpen } = useOffice.getState();

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

  return (
    <section className={cn("border-t bg-background", open ? "flex h-[clamp(8.25rem,22vh,14.5rem)] flex-col" : "")} aria-labelledby="tl-h" data-testid="timeline">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5">
        <h2 id="tl-h" className="text-sm font-semibold">
          Timeline
        </h2>
        <span className="text-xs text-muted-foreground">{rows.length} shown, newest first</span>
        {!open && latest && (
          <span className={cn("min-w-0 flex-1 truncate border-l-2 pl-2 text-[0.8125rem]", SEV_BAR[latest.severity])} key={latest.id}>
            <time className="font-mono text-xs text-muted-foreground" dateTime={new Date(latest.ts).toISOString()}>
              {clock(latest.ts)}
            </time>{" "}
            {latest.text}
          </span>
        )}
        {open && (
          <>
            <Select value={filters.project} onValueChange={(v) => setFilters({ project: v, agent: "all" })}>
              <SelectTrigger size="sm" aria-label="Project filter" className="h-7 w-auto gap-1.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.agent} onValueChange={(v) => setFilters({ agent: v })}>
              <SelectTrigger size="sm" aria-label="Agent filter" className="h-7 w-auto gap-1.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all agents</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToggleGroup type="multiple" variant="outline" size="sm" value={filters.kinds} onValueChange={(v) => setFilters({ kinds: v as TimelineKind[] })} aria-label="Event kinds" className="flex-wrap">
              {KINDS.map((k) => {
                const Icon = KIND_ICON[k];
                return (
                  <ToggleGroupItem key={k} value={k} aria-label={k} className="h-7 gap-1 px-2 text-xs">
                    <Icon className="size-3" /> {k}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </>
        )}
        <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setTimelineOpen(!open)} aria-expanded={open} aria-label={open ? "Collapse timeline" : "Expand timeline"}>
          {open ? <ChevronDown /> : <ChevronUp />}
        </Button>
      </div>
      {open && (
        <ScrollArea className="min-h-0 flex-1">
          <ol className="m-0 list-none px-3 pb-2 text-[0.8125rem]" data-testid="timeline-list">
            {rows.map((e, n) => (
              <TimelineRow key={e.id} e={e} fresh={n === 0 && e.ts > Date.now() - 2000} />
            ))}
            {rows.length === 0 && <li className="text-muted-foreground">No events match.</li>}
          </ol>
        </ScrollArea>
      )}
    </section>
  );
}
