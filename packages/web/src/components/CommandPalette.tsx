import { useMemo } from "react";
import {
  ArrowDown,
  ArrowUp,
  Cat,
  Clapperboard,
  Compass,
  Cpu,
  Inbox,
  Keyboard,
  Layers,
  LayoutGrid,
  ListChecks,
  Map as MapIcon,
  Moon,
  Palette,
  PanelLeft,
  Rows3,
  Server,
  Table2,
  Volume2,
  Eye,
  Maximize,
  type LucideIcon,
} from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { requestFocus, type FocusRequest } from "../lib/bus";
import { plainLabel } from "../lib/format";
import { STATE_META } from "../lib/meta";
import { THEMES } from "../lib/prefs";
import { toggleFullScreen } from "../lib/fullscreen";
import { unlockAudio } from "../lib/sound";
import { useOffice, type Selection } from "../store";

/**
 * Ctrl/Cmd K: jump to any agent, lane, floor or job, or run a view command, from the keyboard.
 * Only reads and navigates; it has no way to change anything outside this browser tab.
 */

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
}

const GROUPS = ["Agents", "Floors", "Lanes", "Jobs", "Go to", "View", "Theme"] as const;

function useItems(): Item[] {
  const snapshot = useOffice((s) => s.snapshot);
  const project = useOffice((s) => s.project);
  const view = useOffice((s) => s.view);
  const st = useOffice.getState;
  return useMemo(() => {
    const items: Item[] = [];
    // `office` marks places that only exist on the floor: asking for them switches to the Office view.
    const go = (sel: Selection | null, focus?: FocusRequest, slug?: string, office = false): void => {
      const s = st();
      const other = slug && slug !== s.project;
      if (other) s.selectProject(slug);
      if (sel) s.select(sel);
      if (focus) {
        if (s.view !== "office") {
          if (!office) return;
          s.setView("office");
        }
        setTimeout(() => requestFocus(focus), other ? 140 : 60);
      }
    };
    for (const p of snapshot?.projects ?? []) {
      items.push({ id: `p:${p.slug}`, group: "Floors", label: p.label, hint: p.slug === project ? "current floor" : `${p.agents.length} agents`, icon: Layers, run: () => go({ type: "project", project: p.slug }, undefined, p.slug) });
      for (const a of p.agents) {
        const m = STATE_META[a.state];
        items.push({ id: `a:${p.slug}:${a.name}`, group: "Agents", label: plainLabel(a.label) || a.name, hint: `${m.label} · ${p.slug === project ? a.lane : `${p.label} / ${a.lane}`}`, icon: m.icon, run: () => go({ type: "agent", project: p.slug, name: a.name }, { type: "agent", name: a.name }, p.slug) });
      }
      for (const l of p.lanes) {
        if (l.archived && l.state === "closed") continue;
        items.push({ id: `l:${p.slug}:${l.slug}`, group: "Lanes", label: l.label, hint: `${l.state} · ${l.kind === "role" ? "role" : l.delivery}${p.slug === project ? "" : ` · ${p.label}`}`, icon: Rows3, run: () => go({ type: "lane", project: p.slug, slug: l.slug }, { type: "lane", slug: l.slug }, p.slug) });
      }
    }
    for (const j of snapshot?.jobs ?? []) {
      items.push({ id: `j:${j.id}`, group: "Jobs", label: `Job ${j.id.slice(0, 8)}`, hint: `${j.lost ? "lost" : j.state} · ${j.repo}`, icon: Cpu, run: () => go({ type: "job", id: j.id }, { type: "job", id: j.id }) });
    }
    items.push(
      { id: "c:desk", group: "Go to", label: "The desk", hint: "inbox, trays and flames", icon: Inbox, run: () => go({ type: "desk", project: project ?? "" }, { type: "desk" }) },
      { id: "c:machine", group: "Go to", label: "Machine room", hint: "muster-heavy racks", icon: Server, run: () => go(null, { type: "machine" }, undefined, true) },
      { id: "c:ticker", group: "Go to", label: "Flow ticker", hint: "the wall display", icon: ListChecks, run: () => go(null, { type: "ticker" }, undefined, true) },
      { id: "c:cat", group: "Go to", label: "Biscuit the cat", hint: "decorative, click to pet", icon: Cat, run: () => go(null, { type: "cat" }, undefined, true) },
      { id: "v:office", group: "View", label: "Office view", hint: view === "office" ? "current" : "pixel office", icon: LayoutGrid, run: () => st().setView("office") },
      { id: "v:board", group: "View", label: "Board view", hint: view === "board" ? "current" : "tables and kanban", icon: Table2, run: () => st().setView("board") },
      { id: "v:bodies", group: "View", label: `${st().showBodies ? "Hide" : "Show"} bodies`, hint: "desk, owner and report text", icon: Eye, run: () => st().setShowBodies(!st().showBodies) },
      { id: "v:daynight", group: "View", label: `Day and night lighting: ${st().dayNight ? "turn off" : "turn on"}`, icon: Moon, run: () => st().setDayNight(!st().dayNight) },
      { id: "v:roster", group: "View", label: `${st().rosterOpen ? "Hide" : "Show"} crew list`, hint: "[", icon: PanelLeft, run: () => st().setRosterOpen(!st().rosterOpen) },
      { id: "v:minimap", group: "View", label: `${st().minimap ? "Hide" : "Show"} minimap`, hint: "M", icon: MapIcon, run: () => st().setMinimap(!st().minimap) },
      {
        id: "v:sound",
        group: "View",
        label: `Alert sounds: ${st().sound ? "turn off" : "turn on"}`,
        icon: Volume2,
        run: () => {
          if (!st().sound) unlockAudio();
          st().setSound(!st().sound);
        },
      },
      { id: "v:fullscreen", group: "View", label: "Full screen", hint: "Z · only the office, filling the window", icon: Maximize, run: () => toggleFullScreen() },
      { id: "v:director", group: "View", label: `Director mode: ${st().director ? "turn off" : "turn on"}`, hint: "D · camera flies to the action", icon: Clapperboard, run: () => st().setDirector(!st().director) },
      { id: "v:help", group: "View", label: "Keyboard shortcuts", hint: "?", icon: Keyboard, run: () => st().setHelpOpen(true) },
    );
    for (const t of THEMES) items.push({ id: `t:${t}`, group: "Theme", label: `Theme: ${t === "mono" ? "mono (no color)" : t}`, icon: Palette, run: () => st().setTheme(t) });
    return items;
  }, [snapshot, project, view, st]);
}

export function CommandPalette() {
  const open = useOffice((s) => s.paletteOpen);
  const setOpen = useOffice((s) => s.setPaletteOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {open && <PaletteBody close={() => setOpen(false)} />}
    </Dialog>
  );
}

function PaletteBody({ close }: { close: () => void }) {
  const items = useItems();
  const byGroup = GROUPS.map((g) => [g, items.filter((i) => i.group === g)] as const).filter(([, list]) => list.length > 0);
  return (
    <DialogContent showCloseButton={false} className="top-[16%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" data-testid="palette">
      <DialogHeader className="sr-only">
        <DialogTitle>Command palette</DialogTitle>
        <DialogDescription>Search for an agent, lane, floor, job or view command. This only moves your view.</DialogDescription>
      </DialogHeader>
      <Command className="rounded-none **:data-[slot=command-input-wrapper]:h-12">
        <CommandInput aria-label="Search" placeholder="Jump to an agent, lane, floor or job, or run a command" />
        <CommandList className="max-h-[22rem]">
          <CommandEmpty>Nothing matches.</CommandEmpty>
          {byGroup.map(([g, list]) => (
            <CommandGroup key={g} heading={g}>
              {list.map((it) => (
                <CommandItem
                  key={it.id}
                  value={`${it.group} ${it.label} ${it.hint ?? ""}`}
                  onSelect={() => {
                    close();
                    it.run();
                  }}
                >
                  <it.icon aria-hidden="true" />
                  <span className="font-medium">{it.label}</span>
                  {it.hint && <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">{it.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
        <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>
              <ArrowUp />
            </Kbd>
            <Kbd>
              <ArrowDown />
            </Kbd>{" "}
            move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd> go
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Compass className="size-3.5" /> only moves your view
          </span>
        </div>
      </Command>
    </DialogContent>
  );
}
