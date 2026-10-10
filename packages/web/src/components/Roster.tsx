import { useMemo } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { AgentView } from "@muster-office/shared";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { requestFocus } from "../lib/bus";
import { modelShort, plainLabel } from "../lib/format";
import { STATE_META } from "../lib/meta";
import { TONE_BADGE } from "../lib/tone";
import { EMPTY, selectProjectView, useOffice } from "../store";
import { CatPortrait, Portrait } from "./Portrait";

/**
 * The crew list: every agent on this floor as a row with a portrait, sorted so whoever needs
 * attention is first. Hovering a row outlines that person on the floor; clicking flies there.
 */

const URGENT = new Set(["failed", "silent", "nudged", "interrupted"]);
const WORKING = new Set(["running", "restarted", "launching", "restoring"]);

function group(a: AgentView): 0 | 1 | 2 {
  if (URGENT.has(a.state)) return 0;
  if (WORKING.has(a.state)) return 1;
  return 2;
}

const GROUP_LABEL = ["Needs attention", "Working", "Everyone else"] as const;

export function Roster() {
  const project = useOffice(selectProjectView);
  const selection = useOffice((s) => s.selection);
  const pointed = useOffice((s) => s.pointed);
  const view = useOffice((s) => s.view);
  const setRosterOpen = useOffice((s) => s.setRosterOpen);
  const select = useOffice((s) => s.select);
  const setPointed = useOffice((s) => s.setPointed);
  const setFollow = useOffice((s) => s.setFollow);
  const agents = project?.agents ?? EMPTY;
  const groups = useMemo(() => {
    const out: AgentView[][] = [[], [], []];
    for (const a of [...agents].sort((x, y) => x.name.localeCompare(y.name))) out[group(a)]!.push(a);
    return out;
  }, [agents]);

  return (
    <aside className="roster flex min-h-0 flex-col border-r bg-card" aria-label="Crew" data-testid="roster">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="flex-1 text-sm font-semibold">Crew</h2>
        <span className="text-xs text-muted-foreground">{agents.length}</span>
        <Button type="button" variant="ghost" size="icon-xs" onClick={() => setRosterOpen(false)} aria-label="Hide crew list ([)" title="Hide ([)">
          <PanelLeftClose />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-4">
          {agents.length === 0 && <p className="muted small px-2 py-2">Nobody is on this floor yet.</p>}
          {groups.map((list, gi) =>
            list.length === 0 ? null : (
              <section key={gi} aria-label={GROUP_LABEL[gi]}>
                <h3 className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">{GROUP_LABEL[gi]}</h3>
                <ul className="grid gap-0.5">
                  {list.map((a) => {
                    const m = STATE_META[a.state];
                    const Icon = m.icon;
                    const on = selection?.type === "agent" && selection.name === a.name;
                    return (
                      <li key={a.name}>
                        <button
                          type="button"
                          className={cn(
                            "crew flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                            on && "border-border bg-accent",
                            pointed === a.name && "pointed bg-accent",
                          )}
                          data-tone={m.tone}
                          aria-pressed={on}
                          onMouseEnter={() => setPointed(a.name)}
                          onMouseLeave={() => setPointed(null)}
                          onFocus={() => setPointed(a.name)}
                          onBlur={() => setPointed(null)}
                          onClick={() => {
                            select({ type: "agent", project: project!.slug, name: a.name });
                            if (view === "office") requestFocus({ type: "agent", name: a.name });
                          }}
                          onDoubleClick={() => {
                            select({ type: "agent", project: project!.slug, name: a.name });
                            setFollow(true);
                          }}
                          title={`${plainLabel(a.label) || a.name} · ${m.what}. Double-click to follow.`}
                        >
                          <span className="grid h-[3.25rem] w-10 shrink-0 place-items-center rounded-md border bg-muted/50">
                            <Portrait name={a.name} role={a.role} state={a.state} scale={2} />
                          </span>
                          <span className="grid min-w-0 flex-1 gap-0.5">
                            <span className="truncate text-[0.8125rem] font-medium">{plainLabel(a.label) || a.name}</span>
                            <span className="flex items-center gap-1.5">
                              <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 text-[0.6875rem] font-medium leading-4", TONE_BADGE[m.tone])}>
                                <Icon aria-hidden="true" className="size-3" /> {m.label}
                              </span>
                              <span className="text-[0.6875rem] text-muted-foreground">{a.role}</span>
                            </span>
                            <span className="truncate text-[0.6875rem] text-muted-foreground">
                              {a.lane} · {modelShort(a.model)}
                              {a.thinking ? ` · ${a.thinking}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ),
          )}
          <section aria-label="Office cat">
            <h3 className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">In the office</h3>
            <ul>
              <li>
                <button
                  type="button"
                  className="crew flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  onClick={() => view === "office" && requestFocus({ type: "cat" })}
                  title="Biscuit is decorative, not an agent. Click to find and pet."
                >
                  <span className="grid h-[3.25rem] w-10 shrink-0 place-items-center rounded-md border bg-muted/50">
                    <CatPortrait scale={2} />
                  </span>
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-[0.8125rem] font-medium">Biscuit</span>
                    <span className="text-[0.6875rem] text-muted-foreground">office cat · not an agent</span>
                  </span>
                </button>
              </li>
            </ul>
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}

/** The small tab that brings the crew list back. */
export function RosterTab() {
  const setRosterOpen = useOffice((s) => s.setRosterOpen);
  return (
    <Button type="button" variant="outline" size="sm" className="absolute bottom-3 left-3 z-10 bg-card" onClick={() => setRosterOpen(true)} aria-label="Show crew list ([)">
      <PanelLeftOpen /> Crew
    </Button>
  );
}
