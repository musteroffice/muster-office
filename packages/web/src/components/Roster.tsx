import { useMemo } from "react";
import type { AgentView } from "@muster-office/shared";
import { requestFocus } from "../lib/bus";
import { modelShort } from "../lib/format";
import { STATE_META } from "../lib/meta";
import { EMPTY, selectProjectView, useOffice } from "../store";
import { CatPortrait, Portrait } from "./Portrait";

/**
 * The crew list: every agent on this floor as a card with a portrait, sorted so whoever needs
 * attention is first. Hovering a card outlines that person on the floor; clicking flies there.
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
    <aside className="roster" aria-label="Crew" data-testid="roster">
      <div className="roster-head">
        <h2>Crew</h2>
        <span className="muted small">{agents.length}</span>
        <button type="button" className="icon-btn" onClick={() => setRosterOpen(false)} aria-label="Hide crew list ([)" title="Hide ([)">
          ‹
        </button>
      </div>
      <div className="roster-list">
        {agents.length === 0 && <p className="muted small pad">Nobody is on this floor yet.</p>}
        {groups.map((list, gi) =>
          list.length === 0 ? null : (
            <section key={gi} aria-label={GROUP_LABEL[gi]}>
              <h3 className="roster-group">{GROUP_LABEL[gi]}</h3>
              <ul>
                {list.map((a) => {
                  const m = STATE_META[a.state];
                  const on = selection?.type === "agent" && selection.name === a.name;
                  return (
                    <li key={a.name}>
                      <button
                        type="button"
                        className={`crew t-${m.tone}${on ? " on" : ""}${pointed === a.name ? " pointed" : ""}`}
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
                        title={`${a.label || a.name} · ${m.what}. Double-click to follow.`}
                      >
                        <span className="crew-pic">
                          <Portrait name={a.name} role={a.role} state={a.state} scale={2} />
                        </span>
                        <span className="crew-text">
                          <span className="crew-name">{a.label || a.name}</span>
                          <span className="crew-line">
                            <span className={`pill-state t-${m.tone}`}>
                              <span aria-hidden="true">{m.glyph}</span> {m.label}
                            </span>
                            <span className="crew-role">{a.role}</span>
                          </span>
                          <span className="crew-meta">
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
          <h3 className="roster-group">In the office</h3>
          <ul>
            <li>
              <button type="button" className="crew cat" onClick={() => view === "office" && requestFocus({ type: "cat" })} title="Biscuit is decorative, not an agent. Click to find and pet.">
                <span className="crew-pic">
                  <CatPortrait scale={2} />
                </span>
                <span className="crew-text">
                  <span className="crew-name">Biscuit</span>
                  <span className="crew-meta">office cat · not an agent</span>
                </span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </aside>
  );
}
