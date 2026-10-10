import { Command, Keyboard, LayoutGrid, Maximize, Map as MapIcon, Palette, Search, Settings, Sun, Users, Volume2, Wifi, WifiOff } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { GithubMark, XMark } from "./BrandIcons";
import { EMPTY, isDegraded, useOffice } from "../store";
import { toggleFullScreen } from "../lib/fullscreen";
import { GITHUB_URL, X_LABEL, X_URL } from "../lib/links";
import { THEMES, type Theme } from "../lib/prefs";
import { unlockAudio } from "../lib/sound";
import { TONE_DOT } from "../lib/tone";

/** The app's mark: a little pixel monitor on a stand, drawn with the current text colour. */
function Logo() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" shapeRendering="crispEdges" className="shrink-0">
      <rect x="1" y="2" width="14" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="5" width="3" height="3" fill="currentColor" />
      <rect x="9" y="5" width="3" height="1.5" fill="currentColor" opacity="0.5" />
      <rect x="6.5" y="12" width="3" height="2" fill="currentColor" />
      <rect x="4" y="14" width="8" height="1.2" fill="currentColor" />
    </svg>
  );
}

function ConnectionPill() {
  const conn = useOffice((s) => s.conn);
  const snapshot = useOffice((s) => s.snapshot);
  const degraded = isDegraded(snapshot);
  const health = snapshot?.health ?? EMPTY;
  const projects = snapshot?.projects ?? EMPTY;
  const issues = health.length + projects.filter((p) => p.status === "degraded" || p.status === "missing").length;
  let label: string = conn;
  let tone: "ok" | "warn" | "bad" = "ok";
  if (conn === "live" && degraded) {
    label = "degraded";
    tone = "warn";
  } else if (conn === "live") {
    label = "live";
  } else if (conn === "reconnecting" || conn === "connecting") {
    tone = "warn";
  } else {
    tone = "bad";
  }
  const problems = projects.filter((p) => p.status === "degraded" || p.status === "missing");
  const Icon = conn === "live" ? Wifi : WifiOff;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="connection"
          data-tone={tone}
          aria-label={`Connection: ${label}${issues ? `, ${issues} issues` : ""}`}
          className={cn("h-8 gap-1.5 px-2.5 font-medium capitalize", tone === "ok" && "text-success", tone === "warn" && "text-warning", tone === "bad" && "text-destructive")}
        >
          <Icon aria-hidden="true" />
          {label}
          {degraded && <span className="rounded bg-warning px-1 text-[0.6875rem] leading-4 text-background">{issues}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 text-sm" aria-label="Connection details">
        {conn !== "live" && <p>The browser is {conn} to the local server. Data on screen may be stale.</p>}
        {!degraded && conn === "live" && <p>Everything is being read normally.</p>}
        {health.map((h) => (
          <p key={h.source} className="mt-1">
            <strong>{h.source}</strong>: {h.message}
          </p>
        ))}
        {problems.map((p) => (
          <div key={p.slug} className="mt-2">
            <strong>{p.slug}</strong> <span className="muted">({p.status})</span>
            <ul className="mt-1 list-disc pl-5">
              {p.issues.map((i, n) => (
                <li key={n}>{i}</li>
              ))}
            </ul>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

const FAILED = new Set(["failed"]);
const WARN = new Set(["silent", "nudged", "interrupted"]);

/** The project tabs, each with a status dot and a count of what is failing or needs a look. */
function ProjectTabs() {
  const snapshot = useOffice((s) => s.snapshot);
  const project = useOffice((s) => s.project);
  const selectProject = useOffice((s) => s.selectProject);
  const projects = snapshot?.projects ?? EMPTY;
  if (projects.length === 0) return <span className="muted">No projects found</span>;
  return (
    <Tabs value={project ?? ""} onValueChange={selectProject} className="min-w-0 flex-1 overflow-x-auto">
      <TabsList aria-label="Projects" className="h-8">
        {projects.map((p) => {
          const failed = p.agents.filter((a) => FAILED.has(a.state)).length;
          const warn = p.agents.filter((a) => WARN.has(a.state)).length;
          const blocked = p.desk.filter((d) => d.open && d.kind === "blocked").length;
          const running = p.agents.filter((a) => a.state === "running").length;
          const bad = failed + blocked;
          const tone = bad > 0 ? "bad" : warn > 0 || p.status !== "ok" ? "warn" : running > 0 ? "ok" : "ghost";
          return (
            <TabsTrigger key={p.slug} value={p.slug} aria-controls={undefined} title={p.status !== "ok" ? `${p.label} (${p.status})` : p.label} className="gap-2 px-3 text-[0.8125rem]">
              <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
              {p.label}
              {p.status !== "ok" && <span className="sr-only">{p.status}</span>}
              {bad > 0 && (
                <Badge variant="destructive" className="h-4 min-w-4 rounded px-1 text-[0.6875rem]" title={`${failed} failed, ${blocked} blocked`}>
                  {bad}
                </Badge>
              )}
              {bad === 0 && warn > 0 && (
                <Badge variant="outline" className="h-4 min-w-4 rounded border-warning/50 px-1 text-[0.6875rem] text-warning" title={`${warn} need a look`}>
                  {warn}
                </Badge>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

function SettingsMenu() {
  const { theme, dayNight, sound, minimap, rosterOpen } = useOffice(
    useShallow((s) => ({ theme: s.theme, dayNight: s.dayNight, sound: s.sound, minimap: s.minimap, rosterOpen: s.rosterOpen })),
  );
  const { setTheme, setDayNight, setSound, setMinimap, setRosterOpen, setHelpOpen } = useOffice.getState();
  const keep = (e: Event): void => e.preventDefault();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon-sm" aria-label="Settings" title="Settings" data-testid="settings">
          <Settings />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>View</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={rosterOpen} onCheckedChange={setRosterOpen} onSelect={keep}>
          <Users /> Crew list
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={minimap} onCheckedChange={setMinimap} onSelect={keep}>
          <MapIcon /> Minimap
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={dayNight} onCheckedChange={setDayNight} onSelect={keep}>
          <Sun /> Day and night lighting
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={sound}
          onCheckedChange={(v) => {
            if (v) unlockAudio();
            setSound(v);
          }}
          onSelect={keep}
        >
          <Volume2 /> Alert sounds
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          <Palette className="size-3.5" /> Theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t} value={t}>
              {t === "mono" ? "mono (no color)" : t}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setHelpOpen(true)}>
          <Keyboard /> Keyboard shortcuts
          <Kbd className="ml-auto">?</Kbd>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar() {
  const snapshot = useOffice((s) => s.snapshot);
  const { view, showBodies } = useOffice(useShallow((s) => ({ view: s.view, showBodies: s.showBodies })));
  const demo = snapshot?.demo ?? false;
  const { setView, setShowBodies, setPaletteOpen } = useOffice.getState();
  const mac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.userAgent);

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background px-3 py-2">
      <div className="flex items-center gap-2">
        <Logo />
        <h1 className="max-sm:sr-only text-sm font-semibold tracking-tight">Muster Office</h1>
        {demo && (
          <Badge variant="outline" data-testid="demo-badge" title="Synthetic data from the built-in simulator. Nothing on this screen is real." className="rounded-md border-warning/50 font-mono text-[0.6875rem] tracking-wider text-warning">
            DEMO
          </Badge>
        )}
      </div>

      <ProjectTabs />

      <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <nav className="flex items-center gap-0.5" aria-label="Links">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub (opens in a new tab)" data-testid="link-github">
                  <GithubMark />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>GitHub</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
                <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label={`${X_LABEL} (opens in a new tab)`} data-testid="link-x">
                  <XMark />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{X_LABEL}</TooltipContent>
          </Tooltip>
        </nav>

        <Button type="button" variant="outline" size="sm" onClick={() => setPaletteOpen(true)} aria-label="Search and jump (Ctrl K)" data-testid="open-palette" className="h-8 w-8 justify-center px-0 font-normal text-muted-foreground sm:w-44 sm:justify-start sm:px-3">
          <Search />
          <span className="hidden flex-1 text-left sm:inline">Jump to…</span>
          <Kbd className="hidden sm:inline-flex">{mac ? <Command /> : "Ctrl"} K</Kbd>
        </Button>

        <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setView(v as "office" | "board")} aria-label="View">
          <ToggleGroupItem value="office" aria-label="Office" className="h-8 gap-1.5 px-2.5">
            <LayoutGrid className="size-3.5" /> Office
          </ToggleGroupItem>
          <ToggleGroupItem value="board" aria-label="Board" className="h-8 px-2.5">
            Board
          </ToggleGroupItem>
        </ToggleGroup>

        <label className="flex cursor-pointer select-none items-center gap-2 text-[0.8125rem] text-muted-foreground" title="Desk, owner and report bodies stay on the server until you ask for them.">
          <Switch checked={showBodies} onCheckedChange={setShowBodies} aria-label="show bodies" />
          show bodies
        </label>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline" size="icon-sm" aria-label="Full screen (Z)" onClick={toggleFullScreen} data-testid="fullscreen">
              <Maximize />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Full screen (Z)</TooltipContent>
        </Tooltip>
        <SettingsMenu />
        <ConnectionPill />
      </div>
    </header>
  );
}
