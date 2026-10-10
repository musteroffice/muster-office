import { useEffect, useRef } from "react";
import { useOffice } from "../store";

const KEYS: Array<[string, string]> = [
  ["Ctrl/⌘ K  or  /", "Command palette: jump to anything"],
  ["?", "This list"],
  ["Esc", "Close, then deselect"],
  ["Drag · wheel", "Pan · zoom (whole steps keep the pixels sharp)"],
  ["Arrows", "Pan the camera (canvas focused)"],
  ["+  −  0", "Zoom in · out · fit the floor"],
  ["N  /  P", "Next · previous agent"],
  ["F", "Follow the selected agent"],
  ["D", "Director mode: the camera flies to the action (wall display)"],
  ["[", "Hide or show the crew list"],
  ["M", "Hide or show the minimap"],
  ["Click Biscuit", "Pet the office cat"],
];

export function Help() {
  const open = useOffice((s) => s.helpOpen);
  const setOpen = useOffice((s) => s.setHelpOpen);
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div
        className="palette help"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <div className="palette-input">
          <strong>Keyboard shortcuts</strong>
          <button type="button" ref={ref} className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
            ×
          </button>
        </div>
        <dl className="help-list">
          {KEYS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="muted small pad">
          Muster Office only reads. Nothing here can change an agent, a lane or a desk item.
        </p>
      </div>
    </div>
  );
}
