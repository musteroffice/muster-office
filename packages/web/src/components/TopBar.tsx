import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { EMPTY, isDegraded, useOffice } from "../store";
import { THEMES, type Theme } from "../lib/prefs";
import { unlockAudio } from "../lib/sound";

function ConnectionPill() {
  const conn = useOffice((s) => s.conn);
  const snapshot = useOffice((s) => s.snapshot);
  const degraded = isDegraded(snapshot);
  const health = snapshot?.health ?? EMPTY;
  const projects = snapshot?.projects ?? EMPTY;
  const issues = health.length + projects.filter((p) => p.status === "degraded" || p.status === "missing").length;
  let label: string = conn;
  let tone = "ok";
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
  return (
    <details className="pill-wrap">
      <summary className={`pill tone-${tone}`} data-testid="connection" aria-label={`Connection: ${label}${issues ? `, ${issues} issues` : ""}`}>
        <span className="dot" aria-hidden="true" />
        {label}
        {degraded && <span className="count">{issues}</span>}
      </summary>
      <div className="popover" role="region" aria-label="Connection details">
        {conn !== "live" && <p>The browser is {conn} to the local server. Data on screen may be stale.</p>}
        {!degraded && conn === "live" && <p>Everything is being read normally.</p>}
        {health.map((h) => (
          <p key={h.source}>
            <strong>{h.source}</strong>: {h.message}
          </p>
        ))}
        {problems.map((p) => (
          <div key={p.slug}>
            <strong>{p.slug}</strong> ({p.status})
            <ul>
              {p.issues.map((i, n) => (
                <li key={n}>{i}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

const FAILED = new Set(["failed"]);
const WARN = new Set(["silent", "nudged", "interrupted"]);

/** The project tabs, each with a live health dot and a count of what is running or needs a look. */
function Tabs() {
  const snapshot = useOffice((s) => s.snapshot);
  const project = useOffice((s) => s.project);
  const selectProject = useOffice((s) => s.selectProject);
  const projects = snapshot?.projects ?? EMPTY;
  return (
    <div role="tablist" aria-label="Projects" className="projects">
      {projects.map((p) => {
        const failed = p.agents.filter((a) => FAILED.has(a.state)).length;
        const warn = p.agents.filter((a) => WARN.has(a.state)).length;
        const blocked = p.desk.filter((d) => d.open && d.kind === "blocked").length;
        const running = p.agents.filter((a) => a.state === "running").length;
        const tone = failed + blocked > 0 ? "bad" : warn > 0 || p.status !== "ok" ? "warn" : running > 0 ? "ok" : "ghost";
        const on = p.slug === project;
        return (
          <button
            key={p.slug}
            role="tab"
            aria-selected={on}
            className={on ? "tab active" : "tab"}
            onClick={() => selectProject(p.slug)}
            title={p.status !== "ok" ? `${p.label} (${p.status})` : p.label}
          >
            <span className={`tab-dot t-${tone}`} aria-hidden="true" />
            {p.label}
            {p.status !== "ok" && (
              <span className="tab-flag" aria-label={p.status}>
                •
              </span>
            )}
            {failed + blocked > 0 && (
              <span className="tab-count t-bad" title={`${failed} failed, ${blocked} blocked`}>
                {failed + blocked}
              </span>
            )}
            {failed + blocked === 0 && warn > 0 && (
              <span className="tab-count t-warn" title={`${warn} need a look`}>
                {warn}
              </span>
            )}
          </button>
        );
      })}
      {projects.length === 0 && <span className="muted">No projects found</span>}
    </div>
  );
}

function Settings() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const { theme, dayNight, sound, minimap, rosterOpen } = useOffice(
    useShallow((s) => ({ theme: s.theme, dayNight: s.dayNight, sound: s.sound, minimap: s.minimap, rosterOpen: s.rosterOpen })),
  );
  const { setTheme, setDayNight, setSound, setMinimap, setRosterOpen, setHelpOpen } = useOffice.getState();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="icon-btn" aria-haspopup="true" aria-expanded={open} aria-label="Settings" title="Settings" onClick={() => setOpen(!open)} data-testid="settings">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M7 1h2l.4 1.9 1.3.6 1.7-1 1.4 1.4-1 1.7.6 1.3L15 7v2l-1.9.4-.6 1.3 1 1.7-1.4 1.4-1.7-1-1.3.6L9 15H7l-.4-1.9-1.3-.6-1.7 1-1.4-1.4 1-1.7-.6-1.3L1 9V7l1.9-.4.6-1.3-1-1.7 1.4-1.4 1.7 1 1.3-.6L7 1Zm1 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
        </svg>
      </button>
      {open && (
        <div className="popover menu-pop glass" role="group" aria-label="Settings">
          <label className="menu-row">
            <span>Day / night lighting</span>
            <span className="switch">
              <input type="checkbox" role="switch" checked={dayNight} onChange={(e) => setDayNight(e.target.checked)} aria-label="day/night" />
            </span>
          </label>
          <label className="menu-row">
            <span>Alert sounds</span>
            <span className="switch">
              <input
                type="checkbox"
                role="switch"
                checked={sound}
                onChange={(e) => {
                  if (e.target.checked) unlockAudio();
                  setSound(e.target.checked);
                }}
                aria-label="alert sounds"
              />
            </span>
          </label>
          <label className="menu-row">
            <span>Crew list</span>
            <span className="switch">
              <input type="checkbox" role="switch" checked={rosterOpen} onChange={(e) => setRosterOpen(e.target.checked)} aria-label="crew list" />
            </span>
          </label>
          <label className="menu-row">
            <span>Minimap</span>
            <span className="switch">
              <input type="checkbox" role="switch" checked={minimap} onChange={(e) => setMinimap(e.target.checked)} aria-label="minimap" />
            </span>
          </label>
          <label className="menu-row">
            <span>Theme</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Theme">
              {THEMES.map((t) => (
                <option key={t} value={t}>
                  {t === "mono" ? "mono (no color)" : t}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="menu-link"
            onClick={() => {
              setOpen(false);
              setHelpOpen(true);
            }}
          >
            Keyboard shortcuts <kbd>?</kbd>
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const snapshot = useOffice((s) => s.snapshot);
  const { view, showBodies } = useOffice(useShallow((s) => ({ view: s.view, showBodies: s.showBodies })));
  const demo = snapshot?.demo ?? false;
  const { setView, setShowBodies, setPaletteOpen } = useOffice.getState();
  const mac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" aria-hidden="true" />
        <h1>Muster Office</h1>
        {demo && (
          <span className="demo-badge" data-testid="demo-badge" title="Synthetic data from the built-in simulator. Nothing on this screen is real.">
            DEMO
          </span>
        )}
      </div>

      <Tabs />

      <div className="controls">
        <button type="button" className="cmdk" onClick={() => setPaletteOpen(true)} aria-label="Search and jump (Ctrl K)" data-testid="open-palette">
          <span aria-hidden="true">⌕</span>
          <span className="cmdk-text">Jump to…</span>
          <kbd>{mac ? "⌘K" : "Ctrl K"}</kbd>
        </button>

        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={view === "office"} onClick={() => setView("office")}>
            Office
          </button>
          <button aria-pressed={view === "board"} onClick={() => setView("board")}>
            Board
          </button>
        </div>

        <label className="switch" title="Desk, owner and report bodies stay on the server until you ask for them.">
          <input type="checkbox" role="switch" checked={showBodies} onChange={(e) => setShowBodies(e.target.checked)} />
          <span>show bodies</span>
        </label>

        <Settings />
        <ConnectionPill />
      </div>
    </header>
  );
}
