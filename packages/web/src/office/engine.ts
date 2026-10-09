import type { Snapshot } from "@muster-office/shared";
import { onChanges, useOffice, type ChangeBatch, type Selection } from "../store";
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
  private lastSnapshot: Snapshot | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: EngineHooks,
  ) {
    this.mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.world = new OfficeWorld({ reducedMotion: this.mq.matches });
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
    this.fit();
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
      onChanges((batch, snap) => this.onChanges(batch, snap)),
      useOffice.subscribe((s, prev) => {
        if (s.dayNight !== prev.dayNight) {
          this.dayNight = s.dayNight;
          this.wake();
        }
        if (s.project !== prev.project) {
          this.syncFromStore(true);
          this.fit();
        }
        if (s.selection !== prev.selection) {
          this.selected = selectionToTarget(s.selection);
          this.wake();
        }
        if (s.theme !== prev.theme) this.dirty = true;
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
    if (!reduced || this.dirty) {
      const w0 = performance.now();
      this.world.step(reduced ? 0 : dtMs, Date.now());
      this.draw();
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
    if (this.bgAge++ % 60 === 0) this.bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || this.bg;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = this.bg;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(s, 0, 0, s, Math.round(-this.camX * s), Math.round(-this.camY * s));
    g.imageSmoothingEnabled = false;
    this.renderer.render(g, { dayNight: this.dayNight, selected: this.selected, hover: this.hover, now: Date.now() });
    g.setTransform(1, 0, 0, 1, 0, 0);
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
    this.clampCamera();
    this.dirty = true;
  }

  /** Largest integer zoom that shows the whole width, then centre horizontally. */
  fit(): void {
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

  private setZoomInternal(z: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z)));
    this.hooks.onZoom(this.zoom);
  }

  setZoom(z: number, anchorX = this.cssW / 2, anchorY = this.cssH / 2): void {
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
    this.camX = wx - this.cssW / this.zoom / 2;
    this.camY = wy - this.cssH / this.zoom / 2;
    this.clampCamera();
    this.wake();
  }

  pan(dx: number, dy: number): void {
    this.camX += dx / this.zoom;
    this.camY += dy / this.zoom;
    this.clampCamera();
    this.wake();
  }

  private toWorld(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: this.camX + (e.clientX - r.left) / this.zoom, y: this.camY + (e.clientY - r.top) / this.zoom };
  }

  /* --------------------------------------------------------------------- input */

  private onPointerMove(e: PointerEvent): void {
    this.lastInput = performance.now();
    if (this.dragging) {
      const d = this.dragging;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
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
      this.hooks.onSelect(hit);
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
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
