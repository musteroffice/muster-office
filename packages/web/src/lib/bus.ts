/**
 * A tiny event bus between the React chrome and the canvas engine, so the roster, command palette,
 * toasts and timeline can ask the camera to go somewhere without importing the engine.
 */

export type FocusRequest =
  | { type: "agent"; name: string }
  | { type: "lane"; slug: string }
  | { type: "desk" }
  | { type: "door" }
  | { type: "job"; id: string }
  | { type: "ticker" }
  | { type: "machine" }
  | { type: "cat" }
  | { type: "fit" };

type Listener = (r: FocusRequest) => void;
const listeners = new Set<Listener>();

export function onFocus(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function requestFocus(r: FocusRequest): void {
  for (const fn of listeners) fn(r);
}
