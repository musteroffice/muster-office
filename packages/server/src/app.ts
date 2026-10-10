import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import type { OfficeModel } from "./model.js";
import { PathDenied, TooLarge } from "./safe-fs.js";

export interface BodyProvider {
  desk(project: string, id: string): { body: string; refs: string[] } | null;
  owner(id: string): { body: string; refs: string[] } | null;
  /** Report text, or null when missing. May throw PathDenied / TooLarge. */
  report(project: string, packetId: string): Promise<string | null>;
}

export interface AppDeps {
  model: OfficeModel;
  bodies: BodyProvider;
  /** Directory holding the built web app; null serves a tiny placeholder (API-only). */
  webRoot: string | null;
  /** The bound port. Host/Origin allow-lists are derived from it. */
  getPort: () => number;
  version: string;
  demo: boolean;
  startedAt: number;
  maxClients?: number;
}

const HOST_NAMES = ["127.0.0.1", "localhost", "[::1]"] as const;

export function allowedHosts(port: number): Set<string> {
  return new Set(HOST_NAMES.map((h) => `${h}:${port}`));
}

/** DNS-rebinding defence: only the loopback names on our own port are served. */
export function hostGuard(getPort: () => number): MiddlewareHandler {
  return async (c, next) => {
    const allowed = allowedHosts(getPort());
    const host = (c.req.header("host") ?? "").toLowerCase();
    if (!allowed.has(host)) return c.text("Forbidden: unexpected Host header", 403);
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      let ok = false;
      try {
        const u = new URL(origin);
        ok = u.protocol === "http:" && allowed.has(u.host.toLowerCase());
      } catch {
        ok = false;
      }
      if (!ok) return c.text("Forbidden: unexpected Origin", 403);
    }
    const site = c.req.header("sec-fetch-site");
    const path = c.req.path;
    if (site === "cross-site" && (path === "/events" || path.startsWith("/api/"))) {
      return c.text("Forbidden: cross-site request", 403);
    }
    return next();
  };
}

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const { model } = deps;

  app.use("*", async (c, next) => {
    await next();
    c.header("Content-Security-Policy", CSP);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  });
  app.use("*", hostGuard(deps.getPort));
  // Zero write endpoints: anything but GET/HEAD is refused before routing.
  app.use("*", async (c, next) => {
    const m = c.req.method;
    if (m !== "GET" && m !== "HEAD") {
      c.header("Allow", "GET, HEAD");
      return c.text("Method Not Allowed: this server is read-only", 405);
    }
    return next();
  });

  app.get("/healthz", (c) => {
    const snap = model.getSnapshot();
    c.header("Cache-Control", "no-store");
    return c.json({
      ok: true,
      name: "muster-office",
      version: deps.version,
      demo: deps.demo,
      uptimeSec: Math.round((Date.now() - deps.startedAt) / 1000),
      clients: model.clientCount,
      seq: snap.seq,
      projects: snap.projects.length,
      jobs: snap.jobs.length,
      degraded: snap.health.length + snap.projects.filter((p) => p.status === "degraded" || p.status === "missing").length,
    });
  });

  app.get("/api/snapshot", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(model.getSnapshot());
  });

  app.get("/api/body", async (c) => {
    c.header("Cache-Control", "no-store");
    const kind = c.req.query("kind") ?? "";
    const project = c.req.query("project") ?? "";
    const id = c.req.query("id") ?? "";
    if (project.length > 200 || id.length > 400 || !project || !id) return c.json({ error: "bad request" }, 400);
    if (kind === "desk") {
      const r = deps.bodies.desk(project, id);
      return r ? c.json(r) : c.json({ error: "not found" }, 404);
    }
    if (kind === "owner") {
      const r = deps.bodies.owner(id);
      return r ? c.json(r) : c.json({ error: "not found" }, 404);
    }
    if (kind === "report") {
      try {
        const text = await deps.bodies.report(project, id);
        return text === null ? c.json({ error: "not found" }, 404) : c.json({ body: text, refs: [] });
      } catch (e) {
        if (e instanceof PathDenied) return c.json({ error: "report path is outside the allowed roots" }, 403);
        if (e instanceof TooLarge) return c.json({ error: "report too large" }, 413);
        return c.json({ error: "unreadable" }, 500);
      }
    }
    return c.json({ error: "unknown kind" }, 400);
  });

  app.get("/events", (c) => {
    if (model.clientCount >= (deps.maxClients ?? 50)) return c.text("Too many clients", 503);
    c.header("Cache-Control", "no-store, no-transform");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      const snap = model.getSnapshot();
      const unsub = model.subscribe((diff) => {
        void stream.writeSSE({ event: "diff", id: String(diff.seq), data: JSON.stringify(diff) }).catch(() => unsub());
      });
      stream.onAbort(() => unsub());
      await stream.writeSSE({ event: "snapshot", id: String(snap.seq), data: JSON.stringify(snap) });
      while (!stream.aborted && !stream.closed) {
        await stream.sleep(15_000);
        if (stream.aborted || stream.closed) break;
        await stream.writeSSE({ event: "ping", data: String(Date.now()) });
      }
      unsub();
    });
  });

  app.get("*", (c) => serveStatic(c, deps.webRoot));
  return app;
}

async function serveStatic(c: Context, root: string | null): Promise<Response> {
  if (root === null) {
    return c.text("Muster Office API is running, but the web app has not been built. Run `npm run build`.", 200);
  }
  let rel: string;
  try {
    rel = decodeURIComponent(c.req.path);
  } catch {
    return c.text("Bad request", 400);
  }
  if (rel.includes("\0") || rel.includes("\\") || rel.split("/").includes("..")) return c.text("Bad request", 400);
  if (rel === "/" || rel === "") rel = "/index.html";
  const base = resolve(root);
  const full = resolve(join(base, rel));
  const inside = full === base || full.startsWith(base.endsWith(sep) ? base : base + sep);
  if (!inside) return c.text("Forbidden", 403);

  const tryRead = async (p: string): Promise<Uint8Array | null> => {
    try {
      return await readFile(p);
    } catch {
      return null;
    }
  };
  let data = await tryRead(full);
  let ext = extname(full).toLowerCase();
  if (data === null) {
    // SPA fallback for navigations, never for missing assets.
    if (ext !== "" && ext !== ".html") return c.text("Not found", 404);
    data = await tryRead(join(base, "index.html"));
    ext = ".html";
    if (data === null) return c.text("Not found", 404);
  }
  c.header("Content-Type", MIME[ext] ?? "application/octet-stream");
  c.header("Cache-Control", rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  return c.body(data as unknown as ArrayBuffer);
}
