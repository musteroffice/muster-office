import { heatTier, jobIsStale, type JobView } from "@muster-office/shared";
import { nametag, steadyFor, type Actor } from "./actors";
import { drawText, drawTextCentered, fit, textSprite, textWidth } from "./font";
import { rectPx, type Bay } from "./layout";
import { C } from "./palette";
import { buildStatic, staticSignature, type Furniture, type StaticScene } from "./render-static";
import { getSpriteSet } from "./sprites";
import type { OfficeWorld, Target } from "./world";

/** Renders an `OfficeWorld` into a 2D context in world pixels (the caller applies zoom/pan). */

export interface RenderOpts {
  dayNight: boolean;
  selected: Target | null;
  hover: Target | null;
  now: number;
}

interface Drawable {
  y: number;
  order: number;
  draw: (g: CanvasRenderingContext2D) => void;
}

const STATE_CODE: Record<string, string> = {
  planned: "PLN", launching: "LCH", running: "RUN", silent: "SIL", nudged: "NDG", restarted: "RST", reported: "REP", verified: "VER",
  landed: "LND", closed: "CLS", interrupted: "INT", restoring: "RES", failed: "ERR", unknown: "?",
};

export class SceneRenderer {
  private stat: StaticScene | null = null;
  private sig = "";
  private sigRev = -1;
  private sigHour = -1;
  /** Frames drawn, for tests and perf readouts. */
  frames = 0;

  constructor(private readonly world: OfficeWorld) {}

  invalidate(): void {
    this.sig = "";
    this.sigRev = -1;
  }

  private ensureStatic(): StaticScene | null {
    const w = this.world;
    if (!w.project) return null;
    const hourBucket = Math.floor(w.hour * 2);
    if (this.stat && this.sigRev === w.revision && this.sigHour === hourBucket) return this.stat;
    this.sigRev = w.revision;
    this.sigHour = hourBucket;
    const sig = staticSignature(w.project, w.layout, hourBucket, w.rackJobs().length);
    if (sig !== this.sig || !this.stat) {
      this.stat = buildStatic({ project: w.project, layout: w.layout, hour: w.hour, frontSeats: 2 });
      this.sig = sig;
    }
    return this.stat;
  }

  render(g: CanvasRenderingContext2D, o: RenderOpts): void {
    const w = this.world;
    const stat = this.ensureStatic();
    if (!stat || !w.project) return;
    this.frames++;
    g.imageSmoothingEnabled = false;
    g.drawImage(stat.back, 0, 0);

    this.drawBelts(g, w.time);
    this.drawTickerAndLight(g, w.time);
    this.drawTokens(g);

    const list: Drawable[] = [];
    let n = 0;
    for (const f of stat.items) {
      list.push({ y: f.sortY, order: n++, draw: (gg) => gg.drawImage(f.canvas, f.x, f.y) });
      this.attachOverlay(list, f, n++);
    }
    for (const a of [...w.actors.values(), ...w.visitors]) {
      if (!a.visible || a.alpha <= 0.01) continue;
      list.push({ y: a.y + (a.sitting ? 0 : 0.5), order: a.order + 1000, draw: (gg) => this.drawActor(gg, a) });
    }
    list.sort((p, q) => p.y - q.y || p.order - q.order);
    for (const d of list) d.draw(g);

    this.drawDim(g);
    this.drawSkull(g);
    this.drawFlights(g);
    this.drawParticles(g);
    this.drawFlares(g);
    for (const a of [...w.actors.values(), ...w.visitors]) if (a.visible && a.alpha > 0.05) this.drawEmoteAndTag(g, a, o);

    if (o.dayNight) this.drawTint(g, stat);
    for (const t of [o.hover, o.selected]) {
      if (!t) continue;
      const box = w.boxOf(t);
      if (!box) continue;
      const sel = t === o.selected;
      g.strokeStyle = sel ? C.gold : "#ffffffcc";
      g.lineWidth = 1;
      if (!sel) g.setLineDash([2, 2]);
      g.strokeRect(Math.round(box.x) - 0.5, Math.round(box.y) - 0.5, Math.round(box.w) + 1, Math.round(box.h) + 1);
      g.setLineDash([]);
    }
  }

  /* --------------------------------------------------------------- floor-level */

  private drawBelts(g: CanvasRenderingContext2D, time: number): void {
    const w = this.world;
    const off = w.reduced ? 0 : Math.floor((time / 1000) * 10) % 8;
    for (const bay of w.layout.bays) {
      if (!bay.belt || bay.lane.state === "proposed") continue;
      const b = rectPx(bay.belt);
      const running = bay.lane.state === "open" || bay.lane.state === "draining";
      g.save();
      g.beginPath();
      g.rect(b.x, b.y + 5, b.w, 8);
      g.clip();
      g.fillStyle = running ? "#9aa3c0" : "#5b6280";
      for (let x = -8 + off; x < b.w; x += 8) {
        g.fillRect(b.x + x + 1, b.y + 6, 2, 1);
        g.fillRect(b.x + x + 2, b.y + 7, 2, 1);
        g.fillRect(b.x + x + 3, b.y + 8, 2, 1);
        g.fillRect(b.x + x + 2, b.y + 9, 2, 1);
        g.fillRect(b.x + x + 1, b.y + 10, 2, 1);
      }
      g.restore();
    }
  }

  private drawTickerAndLight(g: CanvasRenderingContext2D, time: number): void {
    const w = this.world;
    const flow = w.flow;
    if (!flow) return;
    const t = rectPx(w.layout.wall.ticker);
    const inner = { x: t.x + 20, y: t.y + 4, w: t.w - 22, h: 9 };
    const extra = w.deadDesk ? "   ·   NO LIVE DESK" : "";
    const text = `${flow.line}${extra}`;
    const color = flow.notFlowing ? "#ff8a5a" : "#ffc24a";
    g.save();
    g.beginPath();
    g.rect(inner.x, inner.y, inner.w, inner.h);
    g.clip();
    if (w.reduced) {
      drawText(g, fit(text.toUpperCase(), Math.floor(inner.w / 4)), inner.x + 2, inner.y + 2, color);
    } else {
      const spr = textSprite(text, color);
      const span = spr.width + 56;
      const x0 = inner.x - (((time / 1000) * 26) % span);
      for (let k = 0; x0 + k * span < inner.x + inner.w; k++) g.drawImage(spr, Math.round(x0 + k * span), inner.y + 2);
    }
    // LED grid look
    g.fillStyle = "#00000040";
    for (let y = inner.y + 1; y < inner.y + inner.h; y += 2) g.fillRect(inner.x, y, inner.w, 1);
    g.restore();
    // warning light
    const l = w.layout.wall.light;
    const on = flow.notFlowing && (w.reduced || Math.floor(time / 450) % 2 === 0);
    g.fillStyle = flow.notFlowing ? (on ? C.ledRed : "#5a1a1a") : "#2f6a47";
    g.fillRect(l.x - 3, l.y - 3, 6, 6);
    if (on) {
      g.fillStyle = "#ff5a5a40";
      g.fillRect(l.x - 6, l.y - 6, 12, 12);
      g.fillStyle = "#ff5a5a22";
      g.fillRect(l.x - 9, l.y - 9, 18, 18);
    }
  }

  private drawTokens(g: CanvasRenderingContext2D): void {
    const w = this.world;
    const sp = getSpriteSet();
    for (const bay of w.layout.bays) {
      const tok = w.tokens.get(bay.lane.slug);
      if (!tok || !bay.pads.length) continue;
      const paper = sp.prop("paper");
      if (tok.mode === "slide" && tok.pad >= 0) {
        const a = bay.pads[tok.pad]!.centre;
        const b = bay.pads[tok.to]!.centre;
        const e = tok.t * tok.t * (3 - 2 * tok.t);
        const x = a.x + (b.x - a.x) * e;
        const y = a.y + (b.y - a.y) * e - Math.sin(Math.PI * e) * 5;
        g.drawImage(paper, Math.round(x - 3), Math.round(y - 8));
      } else if (tok.mode === "rest" && tok.pad >= 0) {
        const c = bay.pads[tok.pad]!.centre;
        g.drawImage(paper, Math.round(c.x - 3), Math.round(c.y - 8));
        if (tok.waived) {
          g.fillStyle = C.gray;
          g.fillRect(Math.round(c.x - 3), Math.round(c.y - 3), 7, 1);
        }
      }
    }
  }

  /* ---------------------------------------------------------------- overlays */

  private attachOverlay(list: Drawable[], f: Furniture, order: number): void {
    const w = this.world;
    if (f.id.startsWith("desk:")) {
      const [, slug, idx] = f.id.split(":");
      const bay = w.layout.bays.find((b) => b.lane.slug === slug);
      const desk = bay?.desks[Number(idx)];
      if (!bay || !desk) return;
      const sitter = [...w.actors.values()].find((a) => a.seat && a.seat.x === desk.seat.x && a.seat.y === desk.seat.y && (a.sitting || a.shown !== "closed") && a.agent && a.agent.role !== "desk");
      list.push({ y: f.sortY + 0.2, order, draw: (g) => this.drawDeskOverlay(g, f, desk.main, sitter ?? null, bay) });
    } else if (f.id.startsWith("tray:")) {
      const kind = f.id.slice(5);
      list.push({ y: f.sortY + 0.3, order, draw: (g) => this.drawTrayPile(g, f, kind) });
    } else if (f.id.startsWith("rack:")) {
      const slot = Number(f.id.slice(5));
      list.push({ y: f.sortY + 0.1, order, draw: (g) => this.drawRack(g, f, slot) });
    } else if (f.id === "console") {
      list.push({ y: f.sortY + 0.1, order, draw: (g) => this.drawConsole(g, f) });
    }
  }

  private drawDeskOverlay(g: CanvasRenderingContext2D, f: Furniture, main: boolean, sitter: Actor | null, bay: Bay): void {
    const w = this.world;
    const screen = sitter?.visible ? sitter.screen : (sitter?.screen ?? "off");
    const topY = f.y + 12;
    const cx = f.x + 24;
    const sp = getSpriteSet();
    const mh = main ? 14 : 11;
    const my = topY - mh + 6;
    const t = w.time;
    switch (screen) {
      case "on": {
        g.fillStyle = "#5ff0d022";
        g.fillRect(cx - 12, topY, 24, 9);
        g.fillStyle = C.screenOn;
        g.fillRect(cx - 1, my + 3, 2, 2); // power LED on the monitor back
        const k = w.reduced ? 0 : Math.floor(t / 140) % 6;
        g.fillStyle = "#9ffff0";
        for (let i = 0; i < 3; i++) g.fillRect(cx - 6 + ((i * 2 + k) % 6) * 2, topY + 9, 1, 1); // keyboard backlight
        break;
      }
      case "dim":
        g.fillStyle = C.screenDim;
        g.fillRect(cx - 1, my + 3, 2, 2);
        break;
      case "error": {
        const blink = w.reduced || Math.floor(t / 300) % 2 === 0;
        g.fillStyle = blink ? "#ff5a5a55" : "#ff5a5a22";
        g.fillRect(cx - 14, topY - 2, 28, 12);
        g.fillStyle = C.ledRed;
        g.fillRect(cx - 1, my + 3, 2, 2);
        break;
      }
      case "blueprint":
        g.drawImage(sp.prop("blueprint"), f.x + 5, topY + 1);
        break;
      default:
        break;
    }
    // Lane dimming happens in drawDim; here only the lamp on the main desk.
    if (main && bay.lane.state !== "closed" && (screen === "on" || screen === "dim")) {
      g.fillStyle = "#ffe9a844";
      g.fillRect(f.x + 36, topY + 1, 9, 6);
    }
  }

  private drawTrayPile(g: CanvasRenderingContext2D, f: Furniture, kind: string): void {
    const w = this.world;
    const sp = getSpriteSet();
    const bx = f.x + 1;
    const top = f.y + 4;
    let count = 0;
    let verified = 0;
    let tier: 0 | 1 | 2 | 3 | 4 = 0;
    if (kind === "packets") {
      count = w.trayCount();
      verified = Math.min(count, w.project?.packets.filter((p) => p.state === "verified").length ?? 0);
    } else {
      const pile = w.piles.find((p) => p.kind === kind);
      count = pile?.count ?? 0;
      tier = pile ? heatTier(pile.shownHeat) : 0;
    }
    const sheets = Math.min(8, count);
    const base = top + 6;
    for (let i = 0; i < sheets; i++) {
      const y = base - i * 1.5;
      g.fillStyle = i % 2 ? C.paperShade : C.paper;
      g.fillRect(bx + 3 + (i % 3), Math.round(y) - 1, 22, 2);
      g.fillStyle = C.ink;
      g.fillRect(bx + 3 + (i % 3), Math.round(y) + 1, 22, 1);
    }
    if (kind === "packets" && verified > 0) {
      g.drawImage(sp.prop("check"), bx + 20, Math.round(base - sheets * 1.5) - 6);
    }
    const stackTop = base - sheets * 1.5 - 1;
    if (tier > 0) {
      const frame = w.reduced ? 0 : Math.floor(w.time / 110) + (kind.length % 3);
      const fl = sp.flame(tier as 1 | 2 | 3 | 4, frame);
      const fx = bx + 14 - fl.width / 2;
      const fy = stackTop - fl.height + 1;
      const glow = [0, 0.1, 0.16, 0.22, 0.3][tier]!;
      g.fillStyle = `rgba(255,160,60,${glow})`;
      g.beginPath();
      g.arc(bx + 14, fy + fl.height * 0.6, 6 + tier * 3, 0, Math.PI * 2);
      g.fill();
      g.drawImage(fl, Math.round(fx), Math.round(fy));
    }
    if (count > 0) {
      const label = `${kind === "packets" ? "PKT" : kind === "blocked" ? "BLK" : kind === "approval" ? "APR" : "DEC"} ${count}`;
      const color = kind === "blocked" ? "#ff8a8a" : kind === "approval" ? "#ffb870" : kind === "decision" ? "#ffe17a" : "#9fc4ff";
      const flameTop = tier > 0 ? stackTop - sp.flame(tier as 1 | 2 | 3 | 4, 0).height : stackTop;
      drawTextCentered(g, label, bx + 14, Math.round(flameTop) - 9, color, C.ink);
    }
  }

  private drawRack(g: CanvasRenderingContext2D, f: Furniture, slot: number): void {
    const w = this.world;
    const job = w.rackJobs()[slot];
    const x = f.x;
    const y = f.y;
    const t = w.time;
    if (!job) {
      g.fillStyle = "#3a4058";
      g.fillRect(x + 4, y + 4, 2, 2);
      drawTextCentered(g, "-", x + 16, y + 14, "#505874");
      return;
    }
    const mine = job.project === w.project?.slug;
    const running = job.state === "running";
    const stale = running && jobIsStale(job, w.nowMs);
    const failed = job.state === "finished" && (job.exit ?? 0) !== 0;
    const led = (i: number): string => {
      if (job.lost) return "#2a2f44";
      if (failed) return C.ledRed;
      if (stale) return Math.floor(t / 500) % 2 ? C.ledAmber : "#5a4a1a";
      if (running) return ((Math.floor(t / 120) * 7 + i * 13 + slot * 5) % 5) < 3 ? C.ledGreen : "#1f5a37";
      return "#2a7a4a";
    };
    for (let i = 0; i < 3; i++) {
      g.fillStyle = led(i);
      g.fillRect(x + 4 + i * 5, y + 3, 3, 2);
    }
    drawText(g, job.id.slice(0, 3).toUpperCase(), x + 19, y + 2, "#8a93b4");
    let l1: string;
    let l2: string;
    if (job.lost) {
      l1 = "LOST";
      l2 = "DEAD";
    } else if (running) {
      l1 = `${Math.round(job.cpuPercent)}%`;
      l2 = job.rssKB >= 1_048_576 ? `${(job.rssKB / 1_048_576).toFixed(1)}G` : `${Math.round(job.rssKB / 1024)}M`;
    } else {
      l1 = `EXIT ${job.exit ?? "?"}`;
      l2 = repoShort(job);
    }
    drawText(g, l1, x + 4, y + 9, job.lost ? C.red : failed ? "#ff8a8a" : running ? C.screenOn : C.metalLight);
    drawText(g, l2, x + 4, y + 16, "#7d86a6");
    // gauges
    if (running) {
      const cpu = Math.min(1, job.cpuPercent / 100);
      g.fillStyle = "#12141f";
      g.fillRect(x + 4, y + 24, 24, 3);
      g.fillRect(x + 4, y + 29, 24, 3);
      g.fillStyle = cpu > 0.85 ? C.ledRed : cpu > 0.6 ? C.ledAmber : C.ledGreen;
      g.fillRect(x + 4, y + 24, Math.round(24 * cpu), 3);
      if (job.cpuPercent > 100) {
        g.fillStyle = C.ledRed;
        g.fillRect(x + 26, y + 24, 2, 3);
      }
      const rssFrac = job.peakRssKB > 0 ? Math.min(1, job.rssKB / job.peakRssKB) : 0;
      g.fillStyle = C.blue;
      g.fillRect(x + 4, y + 29, Math.round(24 * rssFrac), 3);
      // fan
      const spin = w.reduced ? 0 : Math.floor(t / 90) % 4;
      g.fillStyle = "#12141f";
      g.fillRect(x + 12, y + 36, 8, 8);
      g.fillStyle = C.metal;
      if (spin % 2 === 0) {
        g.fillRect(x + 15, y + 36, 2, 8);
        g.fillRect(x + 12, y + 39, 8, 2);
      } else {
        for (let i = 0; i < 8; i += 2) {
          g.fillRect(x + 12 + i, y + 36 + i, 2, 2);
          g.fillRect(x + 18 - i, y + 36 + i, 2, 2);
        }
      }
    }
    if (job.lost) {
      g.fillStyle = "#0a0b12b8";
      g.fillRect(x, y, 32, 48);
      g.fillStyle = C.red;
      for (let i = 0; i < 24; i++) g.fillRect(x + 4 + i, y + 8 + Math.round(i * 1.4) + ((i * 7) % 3), 1, 1);
      if (!w.reduced && Math.floor(t / 700 + slot) % 4 === 0) {
        g.fillStyle = C.yellow;
        g.fillRect(x + 10 + ((Math.floor(t / 90) * 5) % 12), y + 20 + ((Math.floor(t / 70) * 3) % 14), 1, 1);
      }
    }
    if (mine) {
      g.fillStyle = C.gold;
      g.fillRect(x, y, 32, 1);
      g.fillRect(x, y + 47, 32, 1);
    }
  }

  private drawConsole(g: CanvasRenderingContext2D, f: Furniture): void {
    const w = this.world;
    const running = w.jobs.filter((j) => j.state === "running").length;
    const lost = w.jobs.filter((j) => j.lost).length;
    drawText(g, `${running} RUN`, f.x + 7, f.y + 3, C.screenOn);
    drawText(g, lost > 0 ? `${lost} LOST` : "OK", f.x + f.canvas.width - 26 + (lost > 0 ? 0 : 6), f.y + 4, lost > 0 ? C.red : C.ledGreen);
  }

  /* -------------------------------------------------------------------- actors */

  private drawActor(g: CanvasRenderingContext2D, a: Actor): void {
    const sp = getSpriteSet();
    const spr = sp.character(a.look, a.pose);
    const x = Math.round(a.x - 8);
    const y = Math.round(a.y - 24);
    if (!a.sitting) {
      g.fillStyle = "#00000030";
      g.fillRect(Math.round(a.x) - 5, Math.round(a.y) - 2, 10, 2);
    }
    const ghost = a.alpha < 0.999;
    if (ghost) g.globalAlpha = Math.max(0, Math.min(1, a.alpha));
    g.drawImage(spr, x, y);
    if (a.materialize > 0) {
      // a scan line sweeping down while the body fades in
      const p = 1 - a.materialize / 1200;
      g.globalAlpha = 0.8;
      g.fillStyle = "#9ffff0";
      g.fillRect(x, y + Math.round(p * 24), 16, 1);
      g.globalAlpha = 0.18;
      g.drawImage(sp.prop("ghost-scan"), x, y);
    }
    if (a.carrying) {
      g.globalAlpha = 1;
      g.drawImage(sp.prop("paper"), Math.round(a.x) - 3, Math.round(a.y) - 15);
    }
    g.globalAlpha = 1;
  }

  private drawEmoteAndTag(g: CanvasRenderingContext2D, a: Actor, o: RenderOpts): void {
    const w = this.world;
    const sp = getSpriteSet();
    const x = Math.round(a.x);
    const top = Math.round(a.y - 24);
    const t = w.time;
    const bob = w.reduced ? 0 : Math.round(Math.sin(t / 260 + a.phase * 6) * 1);
    // Busy agents mutter now and then: a speech bubble for ~2 s out of every ~12 s, out of step with each other.
    const mutter = !w.reduced && a.kind === "agent" && a.shown === "running" && a.sitting && a.emote === "none" && ((t / 1000 + a.phase * 12) % 12) < 2;
    if (mutter) g.drawImage(sp.prop("bubble-dots", Math.floor(t / 300)), x + 5, top - 8 + bob);
    switch (a.emote) {
      case "dots":
        g.drawImage(sp.prop("bubble-dots", w.reduced ? 0 : Math.floor(t / 300)), x + 5, top - 8 + bob);
        break;
      case "bang":
        if (w.reduced || Math.floor(t / 350) % 4 !== 3) g.drawImage(sp.prop("bubble-bang"), x + 5, top - 12 + bob);
        break;
      case "zzz": {
        const k = w.reduced ? 1 : Math.floor(t / 500) % 4;
        for (let i = 0; i < Math.min(3, k + (w.reduced ? 2 : 0)); i++) drawText(g, "Z", x + 7 + i * 3, top - 3 - i * 4, i === 0 ? "#b8c4ff" : "#8fa0f0", C.ink);
        break;
      }
      case "check":
        g.drawImage(sp.prop("check"), x + 6, top - 5 + bob);
        break;
      case "paper":
        g.drawImage(sp.prop("paper"), x + 6, top - 6 + bob);
        break;
      case "error": {
        g.fillStyle = C.red;
        g.fillRect(x + 5, top - 9, 9, 9);
        g.fillStyle = C.ink;
        g.fillRect(x + 6, top - 8, 7, 7);
        drawText(g, "X", x + 8, top - 7, C.red);
        break;
      }
      case "spinner":
      case "boot": {
        const k = w.reduced ? 0 : Math.floor(t / 110) % 8;
        const pts: Array<[number, number]> = [[0, -3], [2, -2], [3, 0], [2, 2], [0, 3], [-2, 2], [-3, 0], [-2, -2]];
        pts.forEach(([px, py], i) => {
          g.fillStyle = (i + k) % 8 < 3 ? C.screenOn : "#2f5a66";
          g.fillRect(x + 11 + px, top - 4 + py, 1, 1);
        });
        break;
      }
      default:
        break;
    }

    // Name plate: name, model and thinking, plus a state code (never colour alone).
    if (a.kind === "visitor") {
      const label = fit(a.name.toUpperCase(), 11);
      this.plate(g, x, top - 14, label, "QUEUED", C.gray, "#9aa3c8");
      return;
    }
    if (!a.agent) return;
    const tag = nametag(a.agent);
    const st = steadyFor(a.shown);
    const hot = this.same(o.hover, a) || this.same(o.selected, a);
    const code = STATE_CODE[a.shown] ?? "?";
    this.plate(g, x, top - (a.emote === "none" ? 14 : 14), tag.name, tag.model, st.badgeColor, "#c8d0f0", code, hot ? st.badge : undefined);
  }

  private same(t: Target | null, a: Actor): boolean {
    return !!t && t.type === "agent" && t.name === a.name && t.project === a.project;
  }

  private plate(g: CanvasRenderingContext2D, cx: number, y: number, l1: string, l2: string, tone: string, l2color: string, code?: string, badge?: string): void {
    const codeW = code ? textWidth(code) + 3 : 0;
    const w = Math.max(textWidth(l1) + codeW, textWidth(l2)) + 5;
    const h = badge ? 19 : 13;
    const x = Math.round(cx - w / 2);
    const yy = y - (badge ? 6 : 0);
    g.fillStyle = "#12101ccc";
    g.fillRect(x, yy, w, h);
    g.fillStyle = tone;
    g.fillRect(x, yy, 1, h);
    drawText(g, l1, x + 3, yy + 2, "#ffffff");
    if (code) drawText(g, code, x + w - textWidth(code) - 2, yy + 2, tone);
    drawText(g, l2, x + 3, yy + 8, l2color);
    if (badge) drawText(g, badge, x + 3, yy + 14, tone);
  }

  /* ------------------------------------------------------------------- effects */

  private drawDim(g: CanvasRenderingContext2D): void {
    for (const bay of this.world.layout.bays) {
      const s = bay.lane.state;
      if (s !== "draining" && s !== "closed") continue;
      const p = rectPx({ x: bay.origin.x, y: bay.origin.y + 2, w: 11, h: 4 });
      g.fillStyle = s === "draining" ? "#0a0c1c80" : "#0a0c1c55";
      g.fillRect(p.x, p.y, p.w, p.h);
      if (s === "draining") {
        g.fillStyle = C.yellow;
        for (let x = 0; x < p.w; x += 8) g.fillRect(p.x + x, p.y + p.h - 3, 4, 2);
      }
    }
  }

  private drawSkull(g: CanvasRenderingContext2D): void {
    const w = this.world;
    if (!w.deadDesk) return;
    const s = w.layout.front.skull;
    const bob = w.reduced ? 0 : Math.round(Math.sin(w.time / 400) * 1.5);
    g.drawImage(getSpriteSet().prop("skull"), s.x - 4, s.y - 6 + bob);
    drawTextCentered(g, "NO LIVE DESK", s.x + 4, s.y + 6, C.red, C.ink);
  }

  private drawFlights(g: CanvasRenderingContext2D): void {
    const sp = getSpriteSet();
    for (const f of this.world.flights) {
      const pts = f.pts;
      if (pts.length < 2) continue;
      let total = 0;
      const seg: number[] = [];
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
        seg.push(d);
        total += d;
      }
      let dist = Math.min(1, Math.max(0, f.t)) * total;
      let i = 0;
      while (i < seg.length - 1 && dist > seg[i]!) {
        dist -= seg[i]!;
        i++;
      }
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const u = seg[i]! > 0 ? dist / seg[i]! : 1;
      const x = a.x + (b.x - a.x) * u;
      const y = a.y + (b.y - a.y) * u - Math.sin(Math.PI * Math.min(1, f.t)) * f.arc;
      g.drawImage(sp.prop("paper"), Math.round(x - 3), Math.round(y - 4));
      if (f.kind === "stamped") g.drawImage(sp.prop("check"), Math.round(x + 2), Math.round(y - 8));
    }
  }

  private drawParticles(g: CanvasRenderingContext2D): void {
    const sp = getSpriteSet();
    for (const p of this.world.particles) {
      const k = 1 - p.life / p.max;
      if (p.kind === "smoke") {
        g.globalAlpha = Math.max(0, k * 0.8);
        g.drawImage(sp.prop("smoke", p.size), Math.round(p.x), Math.round(p.y));
        g.globalAlpha = 1;
      } else {
        g.globalAlpha = Math.max(0, Math.min(1, k * 1.4));
        g.fillStyle = p.color;
        g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
        g.globalAlpha = 1;
      }
    }
  }

  private drawFlares(g: CanvasRenderingContext2D): void {
    const sp = getSpriteSet();
    for (const f of this.world.flares) {
      const k = f.t / 1.8;
      g.globalAlpha = Math.max(0, 1 - k);
      if (f.kind === "added") {
        const r = 3 + k * 16;
        g.strokeStyle = f.color;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(f.x, f.y, r, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = "#ffffff";
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + k * 2;
          g.fillRect(Math.round(f.x + Math.cos(a) * r), Math.round(f.y + Math.sin(a) * r), 1, 1);
        }
      } else {
        g.drawImage(sp.prop("check"), Math.round(f.x - 3), Math.round(f.y - 6 - k * 14));
      }
      g.globalAlpha = 1;
    }
  }

  private drawTint(g: CanvasRenderingContext2D, stat: StaticScene): void {
    const h = this.world.hour;
    let color: string | null = null;
    if (h < 5.5 || h >= 21) color = "rgba(14,22,80,0.36)";
    else if (h < 7) color = "rgba(120,90,160,0.18)";
    else if (h >= 17.5 && h < 19.5) color = "rgba(235,130,70,0.14)";
    else if (h >= 19.5) color = "rgba(70,50,130,0.24)";
    if (!color) return;
    g.fillStyle = color;
    g.fillRect(0, 0, stat.w, stat.h);
  }
}

function repoShort(job: JobView): string {
  return job.repo.toUpperCase().slice(0, 6);
}

