import { useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardView } from "./components/Board";
import { CommandPalette } from "./components/CommandPalette";
import { Help } from "./components/Help";
import { OfficeView } from "./components/OfficeView";
import { Roster, RosterTab } from "./components/Roster";
import { SidePanel } from "./components/SidePanel";
import { SpriteSheet } from "./components/SpriteSheet";
import { Timeline } from "./components/Timeline";
import { Toasts } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { Vitals } from "./components/Vitals";
import { loadPref } from "./lib/prefs";
import { playTone } from "./lib/sound";
import { connectEvents } from "./sse";
import { useOffice } from "./store";

function useTheme(): void {
  const theme = useOffice((s) => s.theme);
  const noColor = useOffice((s) => s.snapshot?.noColor ?? false);
  useEffect(() => {
    // NO_COLOR on the server process makes mono the default until the viewer picks something.
    if (noColor && loadPref<string | null>("theme", null, (v): v is string | null => v === null || typeof v === "string") === null) {
      useOffice.setState({ theme: "mono" });
    }
  }, [noColor]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = (): void => {
      const resolved = theme === "system" ? (mq.matches ? "light" : "dark") : theme;
      const root = document.documentElement;
      root.dataset["theme"] = resolved;
      // shadcn keys its dark tokens on the `dark` class; mono is a dark theme with the hue removed.
      root.classList.toggle("dark", resolved !== "light");
      root.style.colorScheme = resolved === "light" ? "light" : "dark";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

/** The tab title and favicon say how the office is doing, so a background tab is still a status light. */
function usePageStatus(): void {
  const snapshot = useOffice((s) => s.snapshot);
  useEffect(() => {
    let failed = 0;
    let blocked = 0;
    let warn = 0;
    for (const p of snapshot?.projects ?? []) {
      for (const a of p.agents) {
        if (a.state === "failed") failed++;
        else if (a.state === "silent" || a.state === "interrupted") warn++;
      }
      blocked += p.desk.filter((d) => d.open && d.kind === "blocked").length;
    }
    const bad = failed + blocked;
    document.title = bad > 0 ? `(${bad}) Muster Office` : warn > 0 ? `· Muster Office` : "Muster Office";
    const tone = bad > 0 ? "#ef4444" : warn > 0 ? "#f59e0b" : "#22c55e";
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3' fill='#18181b'/><rect x='2' y='3' width='12' height='8' rx='1' fill='none' stroke='#fafafa' stroke-width='1.4'/><rect x='5' y='6' width='3' height='3' fill='#fafafa'/><rect x='6' y='12' width='4' height='2' fill='#fafafa'/><circle cx='12.5' cy='3.5' r='3' fill='${tone}'/></svg>`;
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }, [snapshot]);
}

/** New alerts make a sound when the viewer has turned sound on. */
function useAlertSounds(): void {
  useEffect(() => {
    let seen = useOffice.getState().toasts.at(-1)?.id ?? 0;
    return useOffice.subscribe((s) => {
      const fresh = s.toasts.filter((t) => t.id > seen);
      if (fresh.length === 0) return;
      seen = fresh.at(-1)!.id;
      if (s.sound) playTone(fresh.some((t) => t.tone === "bad") ? "bad" : fresh[0]!.tone);
    });
  }, []);
}

function LiveRegion() {
  const announcements = useOffice((s) => s.announcements);
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="false" data-testid="live-region">
      {announcements.slice(-3).map((a) => (
        <p key={a.id}>{a.text}</p>
      ))}
    </div>
  );
}

export default function App() {
  if (window.location.hash === "#sprites") return <SpriteSheet />;
  return <Shell />;
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const st = useOffice.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        st.setPaletteOpen(!st.paletteOpen);
        return;
      }
      if (e.key === "Escape") {
        if (st.paletteOpen || st.helpOpen) return; // the dialog handles its own Escape
        if (!typing && !document.querySelector("[data-radix-popper-content-wrapper], [role='menu']")) st.select(null);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || st.paletteOpen || st.helpOpen) return;
      if (e.key === "/") {
        e.preventDefault();
        st.setPaletteOpen(true);
      } else if (e.key === "?") {
        e.preventDefault();
        st.setHelpOpen(!st.helpOpen);
      } else if (e.key === "[") {
        st.setRosterOpen(!st.rosterOpen);
      } else if (e.key === "m" && document.activeElement?.tagName !== "BUTTON") {
        st.setMinimap(!st.minimap);
      } else if (e.key === "d" && st.view === "office") {
        st.setDirector(!st.director);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function Shell() {
  const view = useOffice((s) => s.view);
  const rosterOpen = useOffice((s) => s.rosterOpen);
  const hasProject = useOffice((s) => !!s.project);
  useTheme();
  usePageStatus();
  useAlertSounds();
  useShortcuts();
  useEffect(() => connectEvents(), []);
  const showRoster = view === "office" && rosterOpen && hasProject;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="app">
        <a className="skip rounded-md bg-primary px-3 py-1.5 text-primary-foreground" href="#main">
          Skip to content
        </a>
        <TopBar />
        <Vitals />
        <div className={`workspace${showRoster ? " with-roster" : ""}`}>
          {showRoster && <Roster />}
          <main id="main" tabIndex={-1} aria-label={view === "office" ? "Office" : "Board"}>
            {view === "office" ? <OfficeView /> : <BoardView />}
            {view === "office" && !rosterOpen && hasProject && <RosterTab />}
          </main>
          <SidePanel />
        </div>
        <Timeline />
        <Toasts />
        <CommandPalette />
        <Help />
        <LiveRegion />
      </div>
    </TooltipProvider>
  );
}
