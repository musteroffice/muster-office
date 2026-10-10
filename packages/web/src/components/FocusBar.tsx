import { Activity, Inbox, Minimize, PackageCheck, Users, Wifi, WifiOff } from "lucide-react";
import { deskPiles, flowInfo, type ProjectView } from "@automicvault/shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { setFullScreen } from "../lib/fullscreen";
import { TONE_TEXT } from "../lib/tone";
import { EMPTY, selectProjectView, useOffice } from "../store";
import { useNow } from "./hooks";

const WORKING = new Set(["running", "restarted", "launching", "restoring"]);

function Chip({ icon: Icon, children, tone }: { icon: typeof Activity; children: React.ReactNode; tone?: "ok" | "warn" | "bad" }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-2 text-[0.8125rem] font-medium">
      <Icon aria-hidden="true" className={cn("size-3.5 text-muted-foreground", tone && TONE_TEXT[tone])} />
      {children}
    </span>
  );
}

function summary(project: ProjectView, now: number) {
  const f = flowInfo(project, now);
  const piles = deskPiles(project.desk, now);
  const open = piles.reduce((n, p) => n + p.count, 0);
  const work = project.lanes.filter((l) => l.kind === "work" && !(l.archived && l.state === "closed"));
  return {
    f,
    open,
    blocked: piles.find((p) => p.kind === "blocked")?.count ?? 0,
    working: project.agents.filter((a) => WORKING.has(a.state)).length,
    proven: work.filter((l) => l.delivery === "proven" || l.delivery === "waived").length,
  };
}

/**
 * Full-screen mode's only chrome: floors, the numbers that matter, and the way out. It floats over the
 * corner of the office so the floor gets the whole window.
 */
export function FocusBar() {
  const project = useOffice(selectProjectView);
  const projects = useOffice((s) => s.snapshot?.projects ?? EMPTY);
  const selected = useOffice((s) => s.project);
  const selectProject = useOffice((s) => s.selectProject);
  const conn = useOffice((s) => s.conn);
  const now = useNow();
  const v = project ? summary(project, now) : null;
  const live = conn === "live";
  return (
    <div className="absolute left-3 top-3 z-[6] flex max-w-[calc(100%-13rem)] flex-wrap items-center gap-1 rounded-lg border bg-card p-1 shadow-sm" data-testid="focus-bar">
      {projects.length > 1 ? (
        <Tabs value={selected ?? ""} onValueChange={selectProject}>
          <TabsList className="h-7" aria-label="Projects">
            {projects.map((p) => (
              <TabsTrigger key={p.slug} value={p.slug} aria-controls={undefined} className="px-2.5 text-[0.8125rem]">
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : (
        <span className="px-2 text-sm font-semibold">{project?.label ?? "Automicvault"}</span>
      )}
      {v && (
        <>
          <Chip icon={Activity} tone={v.f.notFlowing ? "bad" : "ok"}>
            {v.f.notFlowing ? "stalled" : "flowing"} <span className="font-normal text-muted-foreground">WIP {v.f.wip}/{v.f.limit ?? "off"}</span>
          </Chip>
          <Chip icon={Users}>
            {v.working}/{project?.agents.length ?? 0} <span className="font-normal text-muted-foreground">working</span>
          </Chip>
          <Chip icon={Inbox} tone={v.blocked ? "bad" : v.open ? "warn" : "ok"}>
            {v.open} <span className="font-normal text-muted-foreground">on the desk</span>
          </Chip>
          <Chip icon={PackageCheck}>
            {v.proven} <span className="font-normal text-muted-foreground">proven</span>
          </Chip>
        </>
      )}
      <Chip icon={live ? Wifi : WifiOff} tone={live ? "ok" : "bad"}>
        {live ? "live" : conn}
      </Chip>
      <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2" onClick={() => setFullScreen(false)} aria-label="Exit full screen (Esc)" data-testid="exit-fullscreen">
        <Minimize /> Exit
      </Button>
    </div>
  );
}
