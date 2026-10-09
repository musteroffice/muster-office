import { useEffect } from "react";
import { BoardView } from "./components/Board";
import { OfficeView } from "./components/OfficeView";
import { SidePanel } from "./components/SidePanel";
import { SpriteSheet } from "./components/SpriteSheet";
import { Timeline } from "./components/Timeline";
import { TopBar } from "./components/TopBar";
import { loadPref } from "./lib/prefs";
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
      document.documentElement.dataset["theme"] = theme === "system" ? (mq.matches ? "light" : "dark") : theme;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
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

function Shell() {
  const view = useOffice((s) => s.view);
  useTheme();
  useEffect(() => connectEvents(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
      if (e.key === "Escape" && !typing) useOffice.getState().select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <TopBar />
      <div className="workspace">
        <main id="main" tabIndex={-1} aria-label={view === "office" ? "Office" : "Board"}>
          {view === "office" ? <OfficeView /> : <BoardView />}
        </main>
        <SidePanel />
      </div>
      <Timeline />
      <LiveRegion />
    </div>
  );
}
