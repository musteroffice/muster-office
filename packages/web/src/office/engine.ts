import type { Snapshot } from "@muster-office/shared";
import { onFocus, type FocusRequest } from "../lib/bus";
import { onChanges, useOffice, type ChangeBatch, type Selection } from "../store";
import { steadyFor } from "./actors";
import { SceneRenderer } from "./scene-draw";
import { OfficeWorld, type Target } from "./world";

/**
 * The render loop and camera. Responsibilities:
 *  - 60 fps via requestAnimationFrame, paused while the tab is hidden;
 *  - freeze after ~60 s with no data and no input, wake on either;
 *  - prefers-reduced-motion: static poses, draw only when something changed;
 *  - integer-zoom pixel-perfect scaling, pan and zoom by mouse and keyboard.
 */

export const IDLE_FREEZE_MS = 60_000;

/** `?freezeMs=2000` shortens the idle freeze (used by the end-to-end tests). */
function freezeAfter(): number {
  try {
    const v = Number(new URLSearchParams(window.location.search).get("freezeMs"));
    return Number.isFinite(v) && v >= 500 ? v : IDLE_FREEZE_MS;
  } catch {
    return IDLE_FREEZE_MS;
  }
}
/** `?hour=22` pins the office clock, for screenshots and tests. */
function hourParam(): number | null {
  try {
    const v = new URLSearchParams(window.location.search).get("hour");
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n < 24 ? n : null;
  } catch {
    return null;
  }
}
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

export interface EngineHooks {
  onHover(target: Target | null, clientX: number, clientY: number): void;
  onSelect(target: Target | null): void;
  onZoom(zoom: number): void;
}

export interface EngineDebug {
  running: boolean;
  frozen: boolean;
  hidden: boolean;
  reduced: boolean;
  zoom: number;
  frames: number;
  actors: number;
  visibleActors: number;
  busyActors: number;
  transitions: number;
  statesSeen: string[];
  fps: number;
  /** Average and worst recent time spent in step+draw, in ms. */
  frameMsAvg: number;
  frameMsMax: number;
  log: OfficeWorld["log"];
  /** Biscuit, the decorative cat (null before the first floor is built). */
  critter: { mode: string; x: number; y: number } | null;
  popups: number;
  pulseSpikes: number;
  hour: number;
  cam: { x: number; y: number };
  flying: boolean;
  /** Smoothed ms per render section. */
  profile: Record<string, number>;
}

export function toSelection(t: Target): Selection | null {
  switch (t.type) {
    case "agent":
      return { type: "agent", project: t.project, name: t.name };
    case "lane":
      return { type: "lane", project: t.project, slug: t.slug };
    case "desk":
      return { type: "desk", project: t.project };
    case "door":
      return { type: "door", project: t.project };
    case "project":
      return { type: "project", project: t.project };
    case "job":
      return { type: "job", id: t.id };
    case "rack":
    case "critter":
      return null;
  }
}

export function targetKey(t: Target | null): string {
  if (!t) return "";
  return JSON.stringify(t);
}

export class OfficeEngine {
  readonly world: OfficeWorld;
  readonly renderer: SceneRenderer;
  private g: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  private frozen = false;
  private lastFrame = 0;
  private lastInput = performance.now();
  private dirty = true;
  private zoom = 2;
  private camX = 0;
  private camY = 0;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private hover: Target | null = null;
  private selected: Target | null = null;
  private dayNight = true;
  private fpsSamples: number[] = [];
  private fps = 0;
  private workMs: number[] = [];
  private mq: MediaQueryList;
  private unsubs: Array<() => void> = [];
  private dragging: { x: number; y: number; camX: number; camY: number; moved: boolean } | null = null;
  private fitted = "";
  private freezeMs = freezeAfter();
  private bg = "#0e1120";
  private bgAge = 0;
  private lightBg = false;
  private voidPattern: CanvasPattern | null = null;
  private voidLayer: HTMLCanvasElement | null = null;
  private voidKey = "";
  private voidPatternLight = false;
  private lastSnapshot: Snapshot | null = null;
  /** An eased camera move in progress. */
  private fly: { fx: number; fy: number; tx: number; ty: number; t: number; dur: number } | null = null;
  private minimap: HTMLCanvasElement | null = null;
  private minimapAt = 0;
  private stepMs = 0;
  /** Until the viewer moves the camera, the opening view is re-applied as the layout settles. */
  private needFrame = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: EngineHooks,
  ) {
    this.mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.world = new OfficeWorld({ reducedMotion: this.mq.matches });
    this.world.hourOverride = hourParam();
    this.renderer = new SceneRenderer(this.world);
    const g = canvas.getContext("2d", { alpha: false });
    if (!g) throw new Error("2D canvas is not available");
    this.g = g;
  }

  /* ----------------------------------------------------------------- lifecycle */

  start(): void {
    const s = useOffice.getState();
    this.dayNight = s.dayNight;
    this.attach();
    this.syncFromStore(true);
    this.resize();
    this.frameAction();
    this.wake();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  private attach(): void {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window | Document, ev: string, fn: (e: never) => void, opts?: AddEventListenerOptions): void => {
      el.addEventListener(ev, fn as EventListener, opts);
      this.unsubs.push(() => el.removeEventListener(ev, fn as EventListener));
      void (0 as unknown as K);
    };
    on(c, "pointermove", (e: PointerEvent) => this.onPointerMove(e));
    on(c, "pointerdown", (e: PointerEvent) => this.onPointerDown(e));
    on(c, "pointerup", (e: PointerEvent) => this.onPointerUp(e));
    on(c, "pointerleave", () => this.setHover(null, 0, 0));
    on(c, "wheel", (e: WheelEvent) => this.onWheel(e), { passive: false });
    on(c, "keydown", (e: KeyboardEvent) => this.onKey(e));
    on(document, "visibilitychange", () => (document.hidden ? this.pause() : this.wake()));
    const rm = (): void => {
      this.world.reduced = this.mq.matches;
      this.syncFromStore(true);
      this.wake();
    };
    this.mq.addEventListener("change", rm);
    this.unsubs.push(() => this.mq.removeEventListener("change", rm));
    const ro = new ResizeObserver(() => {
      this.resize();
      this.wake();
    });
    ro.observe(c.parentElement ?? c);
    this.unsubs.push(() => ro.disconnect());

    this.unsubs.push(
      onFocus((r) => this.focusRequest(r)),
      onChanges((batch, snap) => this.onChanges(batch, snap)),
      useOffice.subscribe((s, prev) => {
        if (s.dayNight !== prev.dayNight) {
          this.dayNight = s.dayNight;
          this.wake();
        }
        if (s.project !== prev.project) {
          this.syncFromStore(true);
          this.needFrame = true;
          this.frameAction();
        }
        if (s.selection !== prev.selection) {
          this.selected = selectionToTarget(s.selection);
          this.wake();
        }
        if (s.theme !== prev.theme) this.dirty = true;
        if (s.pointed !== prev.pointed || s.conn !== prev.conn || s.follow !== prev.follow) this.wake();
      }),
    );
  }

  /* ------------------------------------------------------------------- data in */

  private onChanges(batch: ChangeBatch, snap: Snapshot): void {
    this.lastSnapshot = snap;
    const project = this.currentProject(snap);
    if (!project) return;
    this.world.sync(project, snap.jobs, snap.now > 0 ? Date.now() : Date.now(), batch.reset);
    this.world.applyChanges(batch.changes, batch.reset);
    this.wake();
  }

  private currentProject(snap: Snapshot | null) {
    const slug = useOffice.getState().project;
    return snap?.projects.find((p) => p.slug === slug) ?? null;
  }

  /** Rebuild the world from the store without animating (first load, project switch, motion preference). */
  syncFromStore(snapAll: boolean): void {
    const st = useOffice.getState();
    const snap = st.snapshot;
    this.lastSnapshot = snap;
    const project = this.currentProject(snap);
    if (!snap || !project) return;
    this.world.sync(project, snap.jobs, Date.now(), snapAll);
    this.selected = selectionToTarget(st.selection);
    this.dirty = true;
  }

  /* ---------------------------------------------------------------------- loop */

  /** Resume drawing: new data, user input, tab visible again. */
  wake(): void {
    this.lastInput = performance.now();
    this.frozen = false;
    this.dirty = true;
    if (!this.running && !document.hidden) {
      this.running = true;
      this.lastFrame = 0;
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
  }

  private pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Data arrived (snapshot or diff): that counts as activity for the idle freeze. */
  dataArrived(): void {
    this.lastInput = performance.now();
    if (this.frozen) this.wake();
  }

  private frame(t: number): void {
    if (!this.running) return;
    const dtMs = this.lastFrame === 0 ? 16 : Math.min(100, t - this.lastFrame);
    this.lastFrame = t;
    const lastData = useOffice.getState().lastDataAt;
    const idleFor = Math.min(t - this.lastInput, Date.now() - lastData);
    if (idleFor > this.freezeMs && !this.dirty) {
      // Freeze: nothing arrived and nobody touched anything for a minute. Stop the loop entirely.
      this.frozen = true;
      this.running = false;
      return;
    }
    const reduced = this.world.reduced;
    this.stepCamera(dtMs);
    if (!reduced || this.dirty) {
      const w0 = performance.now();
      const s0 = performance.now();
      this.world.step(reduced ? 0 : dtMs, Date.now());
      this.stepMs = this.stepMs * 0.95 + (performance.now() - s0) * 0.05;
      this.draw();
      this.drawMinimap(t);
      this.dirty = false;
      this.workMs.push(performance.now() - w0);
      if (this.workMs.length > 120) this.workMs.shift();
    }
    this.fpsSamples.push(dtMs);
    if (this.fpsSamples.length > 30) this.fpsSamples.shift();
    this.fps = 1000 / (this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length);
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
  }

  private draw(): void {
    const g = this.g;
    const s = this.scale();
    if (this.bgAge++ % 60 === 0) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim() || this.bg;
      if (bg !== this.bg) this.voidKey = "";
      this.bg = bg;
      this.lightBg = isLight(this.bg);
    }
    // The space around the building only changes when the camera does, so it is painted into a cached
    // layer and blitted: a full-screen pattern fill every frame was the single biggest cost.
    const key = `${this.camX}|${this.camY}|${s}|${this.canvas.width}|${this.canvas.height}|${this.bg}`;
    if (key !== this.voidKey) {
      this.paintVoid(s);
      this.voidKey = key;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    this.blitVoid(g, s);
    g.setTransform(s, 0, 0, s, Math.round(-this.camX * s), Math.round(-this.camY * s));
    g.imageSmoothingEnabled = false;
    const st = useOffice.getState();
    const pointed: Target | null = st.pointed && this.world.project ? { type: "agent", project: this.world.project.slug, name: st.pointed } : null;
    this.renderer.render(g, { dayNight: this.dayNight, selected: this.selected, hover: this.hover, now: Date.now(), live: st.conn === "live", pointed });
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Copy the cached background, but only the bands the floor will not cover anyway. */
  private blitVoid(g: CanvasRenderingContext2D, s: number): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const layer = this.voidLayer;
    if (!layer) {
      g.fillStyle = this.bg;
      g.fillRect(0, 0, W, H);
      return;
    }
    const { w, h } = this.world.worldSize();
    const x0 = Math.max(0, Math.round((-this.camX) * s));
    const y0 = Math.max(0, Math.round((-this.camY) * s));
    const x1 = Math.min(W, Math.round((w - this.camX) * s));
    const y1 = Math.min(H, Math.round((h - this.camY) * s));
    if (x1 <= x0 || y1 <= y0) {
      g.drawImage(layer, 0, 0);
      return;
    }
    const band = (x: number, y: number, bw: number, bh: number): void => {
      if (bw > 0 && bh > 0) g.drawImage(layer, x, y, bw, bh, x, y, bw, bh);
    };
    band(0, 0, W, Math.max(0, y0 - 1));
    band(0, Math.min(H, y1 + 1), W, Math.max(0, H - y1 - 1));
    band(0, Math.max(0, y0 - 1), Math.max(0, x0 - 1), Math.min(H, y1 + 1) - Math.max(0, y0 - 1));
    band(Math.min(W, x1 + 1), Math.max(0, y0 - 1), Math.max(0, W - x1 - 1), Math.min(H, y1 + 1) - Math.max(0, y0 - 1));
  }

  /** Background, blueprint dot grid and the building's drop shadow, into the cached layer. */
  private paintVoid(s: number): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!this.voidLayer) this.voidLayer = document.createElement("canvas");
    if (this.voidLayer.width !== W || this.voidLayer.height !== H) {
      this.voidLayer.width = W;
      this.voidLayer.height = H;
    }
    const g = this.voidLayer.getContext("2d", { alpha: false })!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = this.bg;
    g.fillRect(0, 0, W, H);
    g.setTransform(s, 0, 0, s, Math.round(-this.camX * s), Math.round(-this.camY * s));
    g.imageSmoothingEnabled = false;
    const { w, h } = this.world.worldSize();
    if (!this.voidPattern || this.voidPatternLight !== this.lightBg) {
      const c = document.createElement("canvas");
      c.width = c.height = 16;
      const p = c.getContext("2d")!;
      p.fillStyle = this.lightBg ? "rgba(20,24,60,0.16)" : "rgba(160,180,255,0.13)";
      p.fillRect(3, 3, 1, 1);
      p.fillRect(11, 11, 1, 1);
      this.voidPattern = g.createPattern(c, "repeat");
      this.voidPatternLight = this.lightBg;
    }
    const vw = W / s;
    const vh = H / s;
    if (this.voidPattern) {
      g.fillStyle = this.voidPattern;
      g.fillRect(Math.floor(this.camX) - 16, Math.floor(this.camY) - 16, vw + 32, vh + 32);
    }
    g.fillStyle = this.lightBg ? "rgba(20,24,60,0.22)" : "rgba(0,0,0,0.38)";
    g.fillRect(-1, 5, w + 7, h + 3);
    g.fillStyle = this.lightBg ? "rgba(20,24,60,0.12)" : "rgba(0,0,0,0.2)";
    g.fillRect(-3, 3, w + 11, h + 8);
    g.fillStyle = this.lightBg ? "#8a90b8" : "#3c4570";
    g.fillRect(-2, -2, w + 4, 2);
    g.fillRect(-2, h, w + 4, 2);
    g.fillRect(-2, 0, 2, h);
    g.fillRect(w, 0, 2, h);
  }

  /** The overview map in the corner: the static floor, a dot per agent, and the visible rectangle. */
  private drawMinimap(t: number): void {
    const c = this.minimap;
    if (!c || t - this.minimapAt < 90) return;
    this.minimapAt = t;
    const floor = this.renderer.floor;
    const g = c.getContext("2d");
    if (!g || !floor) return;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(floor, 0, 0, c.width, c.height);
    g.fillStyle = "rgba(8,10,24,0.28)";
    g.fillRect(0, 0, c.width, c.height);
    const { w, h } = this.world.worldSize();
    const sx = c.width / w;
    const sy = c.height / h;
    for (const a of this.world.actors.values()) {
      if (!a.visible) continue;
      g.fillStyle = steadyFor(a.shown).badgeColor;
      g.fillRect(Math.round(a.x * sx) - 1, Math.round((a.y - 6) * sy) - 1, 3, 3);
      g.fillStyle = "#0a0c1c";
      g.fillRect(Math.round(a.x * sx), Math.round((a.y - 6) * sy), 1, 1);
    }
    const cat = this.world.critter;
    if (cat) {
      g.fillStyle = "#f0b878";
      g.fillRect(Math.round(cat.x * sx), Math.round((cat.y - 4) * sy), 2, 2);
    }
    g.strokeStyle = "#ffd866";
    g.lineWidth = 1;
    const vx = Math.max(0, this.camX) * sx;
    const vy = Math.max(0, this.camY) * sy;
    const vw = Math.min(w, this.cssW / this.zoom) * sx;
    const vh = Math.min(h, this.cssH / this.zoom) * sy;
    g.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, Math.max(2, Math.round(vw) - 1), Math.max(2, Math.round(vh) - 1));
  }

  /** Give the engine the minimap canvas (or null to detach it). Its size follows the floor's aspect. */
  attachMinimap(c: HTMLCanvasElement | null): void {
    this.minimap = c;
    this.minimapAt = 0;
    if (c) this.sizeMinimap();
    this.dirty = true;
  }

  private sizeMinimap(): void {
    const c = this.minimap;
    if (!c) return;
    const { w, h } = this.world.worldSize();
    c.width = 188;
    c.height = Math.max(40, Math.round((188 * h) / w));
  }

  /** The floor point at a fraction (0..1) of the minimap, for clicks on it. */
  minimapToWorld(fx: number, fy: number): { x: number; y: number } {
    const { w, h } = this.world.worldSize();
    return { x: fx * w, y: fy * h };
  }

  /* -------------------------------------------------------------------- camera */

  /** Device pixels per world pixel, always an integer so the pixel art stays crisp. */
  private scale(): number {
    return Math.max(1, Math.round(this.zoom * this.dpr));
  }

  resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const r = parent.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = Math.max(1, Math.floor(r.width));
    this.cssH = Math.max(1, Math.floor(r.height));
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    if (this.needFrame) this.frameAction();
    else this.clampCamera();
    this.sizeMinimap();
    this.dirty = true;
  }

  /** Largest integer zoom that shows the whole width, then centre horizontally. */
  fit(): void {
    this.userMoved();
    const { w, h } = this.world.worldSize();
    const both = Math.floor(Math.min(this.cssW / w, this.cssH / h));
    // Prefer the whole floor; failing that, 2x when the width fits (the viewer pans down).
    const byWidth = Math.min(2, Math.floor(this.cssW / w));
    this.setZoomInternal(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.max(both, byWidth))));
    this.camX = -(this.cssW / this.zoom - w) / 2;
    this.camY = 0;
    this.clampCamera();
    this.fitted = this.world.project?.slug ?? "";
    this.dirty = true;
  }

  /**
   * The opening view of a floor: readable pixels (2x when the window is wide enough), centred on
   * where the agents are. "fit" is still there for the whole-floor overview.
   */
  frameAction(): void {
    if (this.cssW < 300 || this.cssH < 200 || !this.world.project) {
      this.needFrame = true;
      return;
    }
    const { w, h } = this.world.worldSize();
    const z = this.cssW >= 760 && this.cssH >= 360 ? 2 : 1;
    this.setZoomInternal(z);
    const seen = [...this.world.actors.values()].filter((a) => a.visible);
    let cx = w / 2;
    let cy = h / 2;
    if (seen.length > 0) {
      const xs = seen.map((a) => a.x).sort((p, q) => p - q);
      const ys = seen.map((a) => a.y).sort((p, q) => p - q);
      cx = xs[Math.floor(xs.length / 2)]!;
      cy = ys[Math.floor(ys.length / 2)]! - 20;
    }
    this.camX = cx - this.cssW / this.zoom / 2;
    this.camY = cy - this.cssH / this.zoom / 2;
    this.clampCamera();
    this.fitted = this.world.project?.slug ?? "";
    this.dirty = true;
  }

  private setZoomInternal(z: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z)));
    this.hooks.onZoom(this.zoom);
  }

  setZoom(z: number, anchorX = this.cssW / 2, anchorY = this.cssH / 2): void {
    this.userMoved();
    const before = { x: this.camX + anchorX / this.zoom, y: this.camY + anchorY / this.zoom };
    this.setZoomInternal(z);
    this.camX = before.x - anchorX / this.zoom;
    this.camY = before.y - anchorY / this.zoom;
    this.clampCamera();
    this.wake();
  }

  getZoom(): number {
    return this.zoom;
  }

  private clampCamera(): void {
    const { w, h } = this.world.worldSize();
    const vw = this.cssW / this.zoom;
    const vh = this.cssH / this.zoom;
    const margin = 24;
    this.camX = vw >= w ? -(vw - w) / 2 : Math.max(-margin, Math.min(w - vw + margin, this.camX));
    this.camY = vh >= h ? -(vh - h) / 2 : Math.max(-margin, Math.min(h - vh + margin, this.camY));
    this.camX = Math.round(this.camX);
    this.camY = Math.round(this.camY);
  }

  /** Bring an agent into view; true when it is on the floor. */
  focusAgent(name: string): boolean {
    const a = this.world.actors.get(name);
    if (!a || !a.visible) return false;
    this.centerOn(a.x, a.y - 12);
    return true;
  }

  /** Centre the view on a world pixel (used by tests and screenshots). */
  centerOn(wx: number, wy: number): void {
    this.userMoved();
    this.camX = wx - this.cssW / this.zoom / 2;
    this.camY = wy - this.cssH / this.zoom / 2;
    this.clampCamera();
    this.wake();
  }

  pan(dx: number, dy: number): void {
    this.userMoved();
    this.cancelFly();
    if (useOffice.getState().follow) useOffice.getState().setFollow(false);
    this.camX += dx / this.zoom;
    this.camY += dy / this.zoom;
    this.clampCamera();
    this.wake();
  }

  private toWorld(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: this.camX + (e.clientX - r.left) / this.zoom, y: this.camY + (e.clientY - r.top) / this.zoom };
  }

  /* ----------------------------------------------------------- eased camera */

  /** Glide the camera so (wx, wy) is centred. Instant under reduced motion. */
  flyTo(wx: number, wy: number, zoom?: number): void {
    this.userMoved();
    if (zoom !== undefined && zoom !== this.zoom) this.setZoom(zoom);
    const vw = this.cssW / this.zoom;
    const vh = this.cssH / this.zoom;
    const tx = wx - vw / 2;
    const ty = wy - vh / 2;
    if (this.world.reduced) {
      this.camX = tx;
      this.camY = ty;
      this.clampCamera();
      this.wake();
      return;
    }
    const dist = Math.hypot(tx - this.camX, ty - this.camY);
    this.fly = { fx: this.camX, fy: this.camY, tx, ty, t: 0, dur: Math.max(260, Math.min(760, 220 + dist * 1.2)) };
    this.wake();
  }

  private cancelFly(): void {
    this.fly = null;
  }

  /** The viewer took the camera: stop re-applying the opening view. */
  private userMoved(): void {
    this.needFrame = false;
  }

  private stepCamera(dtMs: number): void {
    const st = useOffice.getState();
    if (st.follow && st.selection?.type === "agent") {
      const a = this.world.actors.get(st.selection.name);
      if (a?.visible) {
        const vw = this.cssW / this.zoom;
        const vh = this.cssH / this.zoom;
        const k = this.world.reduced ? 1 : 1 - Math.exp(-dtMs / 140);
        this.camX += (a.x - vw / 2 - this.camX) * k;
        this.camY += (a.y - 12 - vh / 2 - this.camY) * k;
        this.clampCamera();
        this.dirty = true;
        this.fly = null;
        return;
      }
    }
    const f = this.fly;
    if (!f) return;
    f.t += dtMs;
    const u = Math.min(1, f.t / f.dur);
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    this.camX = f.fx + (f.tx - f.fx) * e;
    this.camY = f.fy + (f.ty - f.fy) * e;
    this.clampCamera();
    this.dirty = true;
    if (u >= 1) this.fly = null;
  }

  /** Where something is on the floor, in pixels, and a good zoom for looking at it. */
  private spotOf(r: FocusRequest): { x: number; y: number; zoom: number } | null {
    const L = this.world.layout;
    const T = 16;
    switch (r.type) {
      case "agent": {
        const a = this.world.actors.get(r.name);
        if (!a) return null;
        if (a.visible) return { x: a.x, y: a.y - 12, zoom: 3 };
        const h = a.seat;
        return h ? { x: h.x * T + 8, y: h.y * T, zoom: 3 } : null;
      }
      case "lane": {
        const bay = L.bays.find((b) => b.lane.slug === r.slug);
        return bay ? { x: (bay.origin.x + 10) * T, y: (bay.origin.y + 4.5) * T, zoom: 2 } : null;
      }
      case "desk":
        return { x: (L.front.counter.x + L.front.counter.w / 2) * T, y: (L.front.counter.y + 1) * T, zoom: 3 };
      case "door":
        return { x: (L.door.rect.x + 1) * T, y: (L.h - 4) * T, zoom: 3 };
      case "job": {
        const slot = this.world.rackJobs().findIndex((j) => j.id === r.id);
        const rack = L.machine.racks[slot];
        return rack ? { x: (rack.rect.x + 1) * T, y: (rack.rect.y + 1.5) * T, zoom: 3 } : null;
      }
      case "machine":
        return { x: (L.machine.room.x + L.machine.room.w / 2) * T, y: (L.machine.room.y + 2.5) * T, zoom: 2 };
      case "ticker":
        return { x: (L.wall.ticker.x + L.wall.ticker.w / 2) * T, y: (L.wall.ticker.y + 3) * T, zoom: 2 };
      case "cat": {
        const c = this.world.critter;
        return c ? { x: c.x, y: c.y - 6, zoom: 4 } : null;
      }
    }
  }

  private focusRequest(r: FocusRequest): void {
    if (useOffice.getState().view !== "office") return;
    const spot = this.spotOf(r);
    if (!spot) return;
    this.flyTo(spot.x, spot.y, Math.max(this.zoom, spot.zoom));
  }

  /* --------------------------------------------------------------------- input */

  private onPointerMove(e: PointerEvent): void {
    this.lastInput = performance.now();
    if (this.dragging) {
      const d = this.dragging;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        d.moved = true;
        if (useOffice.getState().follow) useOffice.getState().setFollow(false);
      }
      this.camX = d.camX - dx / this.zoom;
      this.camY = d.camY - dy / this.zoom;
      this.clampCamera();
      this.wake();
      return;
    }
    const w = this.toWorld(e);
    this.setHover(this.world.hitTest(w.x, w.y), e.clientX, e.clientY);
    if (this.frozen) this.wake();
  }

  private setHover(t: Target | null, x: number, y: number): void {
    if (targetKey(t) !== targetKey(this.hover)) {
      this.hover = t;
      this.dirty = true;
      this.canvas.style.cursor = t ? "pointer" : "grab";
    }
    this.hooks.onHover(t, x, y);
  }

  private onPointerDown(e: PointerEvent): void {
    this.lastInput = performance.now();
    this.userMoved();
    this.cancelFly();
    this.canvas.setPointerCapture(e.pointerId);
    this.dragging = { x: e.clientX, y: e.clientY, camX: this.camX, camY: this.camY, moved: false };
    this.canvas.style.cursor = "grabbing";
    this.wake();
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.dragging;
    this.dragging = null;
    this.canvas.style.cursor = this.hover ? "pointer" : "grab";
    if (d && !d.moved) {
      const w = this.toWorld(e);
      const hit = this.world.hitTest(w.x, w.y);
      if (hit?.type === "critter") this.world.petCritter();
      else this.hooks.onSelect(hit);
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.userMoved();
    this.cancelFly();
    const r = this.canvas.getBoundingClientRect();
    const dir = e.deltaY < 0 ? 1 : -1;
    this.setZoom(this.zoom + dir, e.clientX - r.left, e.clientY - r.top);
  }

  private onKey(e: KeyboardEvent): void {
    const step = 48;
    switch (e.key) {
      case "ArrowLeft":
        this.pan(-step, 0);
        break;
      case "ArrowRight":
        this.pan(step, 0);
        break;
      case "ArrowUp":
        this.pan(0, -step);
        break;
      case "ArrowDown":
        this.pan(0, step);
        break;
      case "+":
      case "=":
        this.setZoom(this.zoom + 1);
        break;
      case "-":
      case "_":
        this.setZoom(this.zoom - 1);
        break;
      case "0":
        this.fit();
        this.wake();
        break;
      case "n":
      case "p":
        this.cycleSelection(e.key === "n" ? 1 : -1);
        break;
      case "f": {
        const st = useOffice.getState();
        if (st.selection?.type === "agent") st.setFollow(!st.follow);
        break;
      }
      case "Enter":
      case " ":
        if (this.hover) this.hooks.onSelect(this.hover);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  /** Keyboard access: step through every agent, then the desk, in a stable order. */
  private cycleSelection(dir: 1 | -1): void {
    const p = this.world.project;
    if (!p) return;
    const targets: Target[] = [
      ...p.agents.map((a): Target => ({ type: "agent", project: p.slug, name: a.name })),
      { type: "desk", project: p.slug },
    ];
    const cur = targets.findIndex((t) => targetKey(t) === targetKey(this.selected));
    const next = targets[(cur + dir + targets.length) % targets.length]!;
    this.hooks.onSelect(next);
  }

  /* ---------------------------------------------------------------------- debug */

  debug(): EngineDebug {
    const w = this.world;
    const all = [...w.actors.values()];
    return {
      running: this.running,
      frozen: this.frozen,
      hidden: document.hidden,
      reduced: w.reduced,
      zoom: this.zoom,
      frames: this.renderer.frames,
      actors: all.length,
      visibleActors: all.filter((a) => a.visible).length,
      busyActors: w.busyActors,
      transitions: w.transitions,
      statesSeen: [...w.statesSeen].sort(),
      fps: Math.round(this.fps),
      frameMsAvg: this.workMs.length ? this.workMs.reduce((a, b) => a + b, 0) / this.workMs.length : 0,
      frameMsMax: this.workMs.length ? Math.max(...this.workMs) : 0,
      log: w.log.slice(-20),
      critter: w.critter ? { mode: w.critter.mode, x: Math.round(w.critter.x), y: Math.round(w.critter.y) } : null,
      popups: w.popups.length,
      pulseSpikes: w.pulse.length,
      hour: w.hour,
      cam: { x: Math.round(this.camX), y: Math.round(this.camY) },
      flying: this.fly !== null,
      profile: { ...this.renderer.profile, step: this.stepMs },
    };
  }

  /** Test hook: pixel position of an agent on screen (CSS px relative to the canvas). */
  screenPosOf(name: string): { x: number; y: number } | null {
    const a = this.world.actors.get(name);
    if (!a) return null;
    return { x: (a.x - this.camX) * this.zoom, y: (a.y - 12 - this.camY) * this.zoom };
  }

  get lastSnap(): Snapshot | null {
    return this.lastSnapshot;
  }
  get fittedFor(): string {
    return this.fitted;
  }
}

export function selectionToTarget(s: Selection | null): Target | null {
  if (!s) return null;
  switch (s.type) {
    case "agent":
      return { type: "agent", project: s.project, name: s.name };
    case "lane":
      return { type: "lane", project: s.project, slug: s.slug, part: "bay" };
    case "desk":
      return { type: "desk", project: s.project };
    case "door":
      return { type: "door", project: s.project };
    case "project":
      return { type: "project", project: s.project, part: "sign" };
    case "job":
      return { type: "job", id: s.id };
    case "packet":
      return null;
  }
}

/** Is a #rrggbb colour light? Used to pick dot-grid contrast for the light theme. */
function isLight(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150;
}
