import { useEffect, useRef } from "react";
import type { Dir } from "../office/layout";
import { drawText } from "../office/font";
import { C } from "../office/palette";
import { getSpriteSet, lookFor, type Pose } from "../office/sprites";

/**
 * A development view (open `/#sprites`): every role in every pose, drawn through the same
 * `SpriteSet` the office uses. Handy when drawing new sprites or checking a custom set.
 */
const ROLES = ["worker", "boss", "hawk", "judge", "desk"] as const;
const DIRS: Dir[] = ["down", "up", "right", "left"];

const POSES: Array<{ label: string; pose: Pose }> = [
  ...DIRS.map((d) => ({ label: `stand ${d}`, pose: { kind: "stand", dir: d } as Pose })),
  ...[0, 1, 2, 3].map((f) => ({ label: `walk ${f}`, pose: { kind: "walk", dir: "down", frame: f } as Pose })),
  ...[0, 1, 2, 3].map((f) => ({ label: `walk r${f}`, pose: { kind: "walk", dir: "right", frame: f } as Pose })),
  { label: "carry", pose: { kind: "carry", dir: "down", frame: 0 } },
  { label: "sit idle", pose: { kind: "sit", frame: 0 } },
  { label: "type 1", pose: { kind: "sit", frame: 1 } },
  { label: "type 2", pose: { kind: "sit", frame: 2 } },
  { label: "slump", pose: { kind: "slump" } },
  { label: "alert", pose: { kind: "alert" } },
  { label: "stamp up", pose: { kind: "stamp", frame: 0 } },
  { label: "stamp dn", pose: { kind: "stamp", frame: 1 } },
];

export function SpriteSheet() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const sp = getSpriteSet();
    const cw = 30;
    const rh = 40;
    const w = POSES.length * cw + 40;
    const h = ROLES.length * 2 * rh + 90;
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#8a7e68";
    g.fillRect(0, 0, w, h);
    ROLES.forEach((role, ri) => {
      ["ada", "ben"].forEach((name, ni) => {
        const row = ri * 2 + ni;
        const look = lookFor(role, role === "worker" ? name : `${role}-${name}`);
        drawText(g, role.toUpperCase(), 2, row * rh + 18, C.ink);
        POSES.forEach((p, i) => g.drawImage(sp.character(look, p.pose), 40 + i * cw + 7, row * rh + 8));
      });
    });
    POSES.forEach((p, i) => drawText(g, p.label.toUpperCase().slice(0, 7), 40 + i * cw, ROLES.length * 2 * rh + 6, C.ink));
    const base = ROLES.length * 2 * rh + 20;
    (["paper", "blueprint", "skull", "check", "bubble-bang", "bubble-dots", "spark", "smoke", "stamp"] as const).forEach((n, i) => g.drawImage(sp.prop(n), 6 + i * 22, base));
    ([1, 2, 3, 4] as const).forEach((t) => [0, 1, 2, 3].forEach((f) => g.drawImage(sp.flame(t, f), 240 + t * 60 + f * 13, base - 4)));
  }, []);
  return (
    <div style={{ padding: 12, overflow: "auto", height: "100%" }}>
      <h2>Sprite sheet ({getSpriteSet().name})</h2>
      <canvas ref={ref} style={{ imageRendering: "pixelated", width: "min(100%, 2400px)", maxWidth: "none" }} />
    </div>
  );
}
