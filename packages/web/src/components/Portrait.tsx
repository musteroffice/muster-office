import { useEffect, useRef } from "react";
import type { AgentStateOrUnknown, Role } from "@muster-office/shared";
import { steadyFor } from "../office/actors";
import { getSpriteSet } from "../office/sprites";
import { lookFor } from "../office/sprites/procedural";
import type { Pose } from "../office/sprites/types";
import { catSprite } from "../office/critter";

/**
 * A character's portrait for the roster and the detail panel, drawn through the same SpriteSet as the
 * office so a custom sprite sheet shows up here too. One shared timer animates every portrait.
 */

const subs = new Set<(tick: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;

function subscribe(fn: (tick: number) => void): () => void {
  subs.add(fn);
  if (timer === null) {
    timer = setInterval(() => {
      if (document.hidden) return;
      tick++;
      for (const s of subs) s(tick);
    }, 340);
  }
  return () => {
    subs.delete(fn);
    if (subs.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function poseFor(state: AgentStateOrUnknown, t: number): Pose {
  const st = steadyFor(state);
  switch (st.pose) {
    case "type":
      return { kind: "sit", frame: t % 2 === 0 ? 1 : 2 };
    case "slump":
      return { kind: "slump" };
    case "alert":
      return { kind: "alert" };
    default:
      return st.sits ? { kind: "sit", frame: 0 } : { kind: "stand", dir: "down" };
  }
}

export function Portrait({ name, role, state, scale = 2 }: { name: string; role: Role | "unknown"; state: AgentStateOrUnknown; scale?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = (t: number): void => {
      const sp = getSpriteSet();
      const st = steadyFor(state);
      g.clearRect(0, 0, c.width, c.height);
      g.imageSmoothingEnabled = false;
      g.globalAlpha = st.ghost ? 0.5 : st.present ? 1 : 0.35;
      g.drawImage(sp.character(lookFor(role, name), poseFor(state, reduced ? 0 : t)), 0, 0);
      g.globalAlpha = 1;
    };
    draw(tick);
    if (reduced) return;
    return subscribe(draw);
  }, [name, role, state]);
  return <canvas ref={ref} className="portrait" width={16} height={24} style={{ width: 16 * scale, height: 24 * scale }} aria-hidden="true" />;
}

/** Biscuit's portrait, for the roster's decorative row. */
export function CatPortrait({ scale = 2 }: { scale?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const spr = catSprite("sit", "right", 0, 0);
    c.width = spr.width;
    c.height = spr.height;
    g.imageSmoothingEnabled = false;
    g.drawImage(spr, 0, 0);
  }, []);
  return <canvas ref={ref} className="portrait" width={14} height={15} style={{ width: 14 * scale, height: 15 * scale }} aria-hidden="true" />;
}
