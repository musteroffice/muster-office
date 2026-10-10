import { useEffect } from "react";
import { requestFocus, type FocusRequest } from "../lib/bus";
import { useOffice } from "../store";

/**
 * Director mode, for a wall display: the camera flies to whatever just happened (a failure, a
 * decision, a delivery) and, when nothing is happening, makes a slow tour of the floor. It stops
 * touring while someone is using the mouse or keyboard. It only moves the view.
 */

const TOUR_EVERY_MS = 14_000;
const QUIET_AFTER_INPUT_MS = 25_000;

export function Director() {
  useEffect(() => {
    let lastInput = 0;
    let lastMove = Date.now();
    let step = 0;
    const touch = (): void => {
      lastInput = Date.now();
    };
    const opts = { passive: true } as const;
    window.addEventListener("pointerdown", touch, opts);
    window.addEventListener("keydown", touch);
    window.addEventListener("wheel", touch, opts);

    const go = (r: FocusRequest): void => {
      lastMove = Date.now();
      requestFocus(r);
    };

    // New alerts pull the camera to their cause.
    let seen = useOffice.getState().toasts.at(-1)?.id ?? 0;
    const unsub = useOffice.subscribe((s) => {
      const fresh = s.toasts.filter((t) => t.id > seen);
      if (fresh.length === 0) return;
      seen = fresh.at(-1)!.id;
      const t = fresh.find((x) => x.focus && x.tone !== "info") ?? fresh.find((x) => x.focus);
      if (!t?.focus || Date.now() - lastInput < QUIET_AFTER_INPUT_MS) return;
      if (t.project && t.project !== s.project) s.selectProject(t.project);
      if (t.focus.type === "agent") s.select({ type: "agent", project: t.project ?? s.project ?? "", name: t.focus.name });
      setTimeout(() => go(t.focus!), t.project && t.project !== s.project ? 160 : 0);
    });

    // Otherwise, a slow tour: each open lane, the desk, the machine room.
    const tick = setInterval(() => {
      const s = useOffice.getState();
      if (document.hidden || Date.now() - lastInput < QUIET_AFTER_INPUT_MS || Date.now() - lastMove < TOUR_EVERY_MS - 500) return;
      const project = s.snapshot?.projects.find((p) => p.slug === s.project);
      if (!project) return;
      const stops: FocusRequest[] = [
        ...project.lanes.filter((l) => l.state === "open" || l.state === "draining").map((l): FocusRequest => ({ type: "lane", slug: l.slug })),
        { type: "desk" },
        { type: "machine" },
      ];
      s.select(null);
      go(stops[step++ % stops.length]!);
    }, 1000);

    return () => {
      unsub();
      clearInterval(tick);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      window.removeEventListener("wheel", touch);
    };
  }, []);
  return null;
}
