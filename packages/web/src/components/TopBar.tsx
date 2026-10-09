import { useShallow } from "zustand/react/shallow";
import { EMPTY, isDegraded, useOffice } from "../store";
import { THEMES, type Theme } from "../lib/prefs";

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

export function TopBar() {
  const snapshot = useOffice((s) => s.snapshot);
  const { project, view, showBodies, theme, dayNight } = useOffice(
    useShallow((s) => ({ project: s.project, view: s.view, showBodies: s.showBodies, theme: s.theme, dayNight: s.dayNight })),
  );
  const projects = snapshot?.projects ?? EMPTY;
  const demo = snapshot?.demo ?? false;
  const { selectProject, setView, setShowBodies, setTheme, setDayNight } = useOffice.getState();

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

      <div role="tablist" aria-label="Projects" className="projects">
        {projects.map((p) => (
          <button
            key={p.slug}
            role="tab"
            aria-selected={p.slug === project}
            className={p.slug === project ? "tab active" : "tab"}
            onClick={() => selectProject(p.slug)}
            title={p.status !== "ok" ? `${p.label} (${p.status})` : p.label}
          >
            {p.label}
            {p.status !== "ok" && <span className="tab-flag" aria-label={p.status}>•</span>}
          </button>
        ))}
        {projects.length === 0 && <span className="muted">No projects found</span>}
      </div>

      <div className="controls">
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

        <label className="switch" title="Tint the office by your local time of day">
          <input type="checkbox" role="switch" checked={dayNight} onChange={(e) => setDayNight(e.target.checked)} />
          <span>day/night</span>
        </label>

        <label className="select">
          <span className="sr-only">Theme</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Theme">
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t === "mono" ? "mono (no color)" : t}
              </option>
            ))}
          </select>
        </label>

        <ConnectionPill />
      </div>
    </header>
  );
}
