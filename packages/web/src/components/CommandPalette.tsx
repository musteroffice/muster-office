import { useEffect, useMemo, useRef, useState } from "react";
import { requestFocus, type FocusRequest } from "../lib/bus";
import { STATE_META } from "../lib/meta";
import { THEMES } from "../lib/prefs";
import { unlockAudio } from "../lib/sound";
import { useOffice, type Selection } from "../store";

/**
 * Ctrl/⌘ K: jump to any agent, lane, project or job, or run a view command, from the keyboard.
 * Only reads and navigates; it has no way to change anything outside this browser tab.
 */

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  glyph: string;
  run: () => void;
}

/** Subsequence match with a bonus for prefixes and word starts; null when it does not match. */
export function fuzzy(query: string, text: string): number | null {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    score += at === prev + 1 ? 6 : 1;
    if (at === 0 || " -_/·".includes(t[at - 1] ?? "")) score += 4;
    prev = at;
    ti = at + 1;
  }
  return score - t.length * 0.05;
}

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
      items.push({ id: `p:${p.slug}`, group: "Floors", label: p.label, hint: p.slug === project ? "current floor" : `${p.agents.length} agents`, glyph: "▣", run: () => go({ type: "project", project: p.slug }, undefined, p.slug) });
      for (const a of p.agents) {
        const m = STATE_META[a.state];
        items.push({ id: `a:${p.slug}:${a.name}`, group: "Agents", label: a.label || a.name, hint: `${m.label} · ${p.slug === project ? a.lane : `${p.label} / ${a.lane}`}`, glyph: m.glyph, run: () => go({ type: "agent", project: p.slug, name: a.name }, { type: "agent", name: a.name }, p.slug) });
      }
      for (const l of p.lanes) {
        if (l.archived && l.state === "closed") continue;
        items.push({ id: `l:${p.slug}:${l.slug}`, group: "Lanes", label: l.label, hint: `${l.state} · ${l.kind === "role" ? "role" : l.delivery}${p.slug === project ? "" : ` · ${p.label}`}`, glyph: "▤", run: () => go({ type: "lane", project: p.slug, slug: l.slug }, { type: "lane", slug: l.slug }, p.slug) });
      }
    }
    for (const j of snapshot?.jobs ?? []) {
      items.push({ id: `j:${j.id}`, group: "Jobs", label: `Job ${j.id.slice(0, 8)}`, hint: `${j.lost ? "lost" : j.state} · ${j.repo}`, glyph: "▥", run: () => go({ type: "job", id: j.id }, { type: "job", id: j.id }) });
    }
    items.push(
      { id: "c:desk", group: "Go to", label: "The desk", hint: "inbox, trays and flames", glyph: "✉", run: () => go({ type: "desk", project: project ?? "" }, { type: "desk" }) },
      { id: "c:machine", group: "Go to", label: "Machine room", hint: "muster-heavy racks", glyph: "▥", run: () => go(null, { type: "machine" }, undefined, true) },
      { id: "c:ticker", group: "Go to", label: "Flow ticker", hint: "the wall display", glyph: "≡", run: () => go(null, { type: "ticker" }, undefined, true) },
      { id: "c:cat", group: "Go to", label: "Biscuit the cat", hint: "decorative, click to pet", glyph: "♥", run: () => go(null, { type: "cat" }, undefined, true) },
      { id: "v:office", group: "View", label: "Office view", hint: view === "office" ? "current" : "pixel office", glyph: "▦", run: () => st().setView("office") },
      { id: "v:board", group: "View", label: "Board view", hint: view === "board" ? "current" : "tables and kanban", glyph: "☰", run: () => st().setView("board") },
      { id: "v:bodies", group: "View", label: `${st().showBodies ? "Hide" : "Show"} bodies`, hint: "desk, owner and report text", glyph: "☐", run: () => st().setShowBodies(!st().showBodies) },
      { id: "v:daynight", group: "View", label: `Day/night lighting: ${st().dayNight ? "turn off" : "turn on"}`, glyph: "☾", run: () => st().setDayNight(!st().dayNight) },
      { id: "v:roster", group: "View", label: `${st().rosterOpen ? "Hide" : "Show"} crew list`, hint: "[", glyph: "☷", run: () => st().setRosterOpen(!st().rosterOpen) },
      { id: "v:minimap", group: "View", label: `${st().minimap ? "Hide" : "Show"} minimap`, hint: "M", glyph: "◲", run: () => st().setMinimap(!st().minimap) },
      {
        id: "v:sound",
        group: "View",
        label: `Alert sounds: ${st().sound ? "turn off" : "turn on"}`,
        glyph: "♪",
        run: () => {
          if (!st().sound) unlockAudio();
          st().setSound(!st().sound);
        },
      },
      { id: "v:director", group: "View", label: `Director mode: ${st().director ? "turn off" : "turn on"}`, hint: "D · camera flies to the action", glyph: "▶", run: () => st().setDirector(!st().director) },
      { id: "v:help", group: "View", label: "Keyboard shortcuts", hint: "?", glyph: "⌨", run: () => st().setHelpOpen(true) },
    );
    for (const t of THEMES) items.push({ id: `t:${t}`, group: "Theme", label: `Theme: ${t === "mono" ? "mono (no color)" : t}`, glyph: "◐", run: () => st().setTheme(t) });
    return items;
  }, [snapshot, project, view, st]);
}

export function CommandPalette() {
  const open = useOffice((s) => s.paletteOpen);
  const setOpen = useOffice((s) => s.setPaletteOpen);
  if (!open) return null;
  return <PaletteBody close={() => setOpen(false)} />;
}

function PaletteBody({ close }: { close: () => void }) {
  const items = useItems();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  useEffect(() => input.current?.focus(), []);

  const shown = useMemo(() => {
    if (!q.trim()) return items.filter((it) => it.group === "Agents" || it.group === "Floors" || it.group === "Go to").slice(0, 40);
    return items
      .map((it) => ({ it, s: fuzzy(q, `${it.label} ${it.hint ?? ""} ${it.group}`) }))
      .filter((x): x is { it: Item; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.it);
  }, [items, q]);

  useEffect(() => setI(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }, [i]);

  const run = (it: Item | undefined): void => {
    if (!it) return;
    close();
    it.run();
  };

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setI((n) => Math.min(shown.length - 1, n + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setI((n) => Math.max(0, n - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(shown[i]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  let last = "";
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()} data-testid="palette">
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className="palette-input">
          <span aria-hidden="true">⌕</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to an agent, lane, floor or job… or run a command"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown[i] ? `pal-${shown[i]!.id}` : undefined}
            aria-label="Search"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd>esc</kbd>
        </div>
        <ul id="palette-list" ref={list} role="listbox" className="palette-list">
          {shown.length === 0 && <li className="palette-empty">Nothing matches “{q}”.</li>}
          {shown.map((it, n) => {
            const head = it.group !== last;
            last = it.group;
            return (
              <li key={it.id} role="presentation">
                {head && <div className="palette-group">{it.group}</div>}
                <div id={`pal-${it.id}`} role="option" aria-selected={n === i} data-i={n} className={`palette-item${n === i ? " on" : ""}`} onMouseMove={() => setI(n)} onClick={() => run(it)}>
                  <span className="palette-glyph" aria-hidden="true">
                    {it.glyph}
                  </span>
                  <span className="palette-label">{it.label}</span>
                  {it.hint && <span className="palette-hint">{it.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> go
          </span>
          <span>read-only: this only moves your view</span>
        </div>
      </div>
    </div>
  );
}
