/**
 * CF Pages _worker.js entry point.
 *
 * - GET /events  → SSE stream powered by DemoSource + OfficeModel (max 50 concurrent)
 * - GET /healthz → JSON health check
 * - Everything else → static asset from ASSETS binding (CF Pages KV)
 */

import { DemoSource } from "../packages/server/src/demo/source.js";
import { OfficeModel } from "../packages/server/src/model.js";
import type { Sink } from "../packages/server/src/sink.js";

declare const __VERSION__: string;

const MAX_CLIENTS = 50;

interface Env {
  ASSETS: Fetcher;
}

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// ---------------------------------------------------------------------------
// Singleton demo model — lives for the lifetime of the CF isolate (~30 s idle).
// ---------------------------------------------------------------------------
let sharedModel: OfficeModel | null = null;
let sharedSource: DemoSource | null = null;
let modelReady = false;
let modelReadyCallbacks: Array<() => void> = [];

function getModel(): Promise<OfficeModel> {
  if (modelReady && sharedModel) return Promise.resolve(sharedModel);
  return new Promise((resolve) => {
    if (modelReady && sharedModel) return resolve(sharedModel!);
    modelReadyCallbacks.push(() => resolve(sharedModel!));
    if (!sharedModel) initModel();
  });
}

function initModel(): void {
  const model = new OfficeModel({ demo: true, version: __VERSION__ });
  sharedModel = model;
  sharedSource = new DemoSource({ tickMs: 3000 });

  // Intercept ready() so we can notify getModel() waiters without patching
  // the prototype — OfficeModel.ready() is a public method on Sink.
  const sink: Sink = Object.create(model) as Sink;
  sink.ready = () => {
    model.ready();
    modelReady = true;
    const cbs = modelReadyCallbacks;
    modelReadyCallbacks = [];
    cbs.forEach((cb) => cb());
  };

  sharedSource.start(sink).catch((err: unknown) => {
    reportError(err instanceof Error ? err : new Error(String(err)));
  });
}

// ---------------------------------------------------------------------------
// Error reporting — structured to CF Workers Logpush / console.error for now.
// Drop-in ready for Sentry: replace body with Sentry.captureException(err).
// ---------------------------------------------------------------------------
function reportError(err: Error, context?: string): void {
  console.error(
    JSON.stringify({
      level: "error",
      name: err.name,
      message: err.message,
      context: context ?? null,
      version: __VERSION__,
      ts: new Date().toISOString(),
    })
  );
}

function addSecurityHeaders(resp: Response): Response {
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
}

// ---------------------------------------------------------------------------
// Fetch handler
// ---------------------------------------------------------------------------
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Only allow GET / HEAD
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD", ...SECURITY_HEADERS },
      });
    }

    // -----------------------------------------------------------------------
    // SSE  /events — same-origin only, max 50 concurrent
    // -----------------------------------------------------------------------
    if (url.pathname === "/events") {
      const origin = request.headers.get("origin");
      if (origin) {
        try {
          const requestOrigin = new URL(origin).origin;
          if (requestOrigin !== new URL(request.url).origin) {
            return new Response("Forbidden: cross-origin SSE not allowed", {
              status: 403,
              headers: SECURITY_HEADERS,
            });
          }
        } catch {
          return new Response("Bad Request", { status: 400, headers: SECURITY_HEADERS });
        }
      }

      const model = await getModel();

      // Rate-limit: refuse when isolate already at capacity
      if (model.clientCount >= MAX_CLIENTS) {
        return new Response("Too many clients", { status: 503, headers: SECURITY_HEADERS });
      }

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const enc = new TextEncoder();

      const writeSSE = (event: string, id: string, data: string): Promise<void> =>
        writer.write(enc.encode(`event: ${event}\nid: ${id}\ndata: ${data}\n\n`));

      (async () => {
        try {
          const snap = model.getSnapshot();
          await writeSSE("snapshot", String(snap.seq), JSON.stringify(snap));

          const unsub = model.subscribe(async (diff) => {
            try {
              await writeSSE("diff", String(diff.seq), JSON.stringify(diff));
            } catch {
              unsub();
            }
          });

          const pingInterval = setInterval(() => {
            writer
              .write(enc.encode(`event: ping\ndata: ${Date.now()}\n\n`))
              .catch(() => {
                clearInterval(pingInterval);
                unsub();
              });
          }, 15_000);

          request.signal.addEventListener("abort", () => {
            clearInterval(pingInterval);
            unsub();
            writer.close().catch(() => {});
          });
        } catch (err) {
          reportError(err instanceof Error ? err : new Error(String(err)), "/events setup");
          writer.close().catch(() => {});
        }
      })();

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store, no-transform",
          "X-Accel-Buffering": "no",
          ...SECURITY_HEADERS,
        },
      });
    }

    // -----------------------------------------------------------------------
    // Health check  /healthz
    // -----------------------------------------------------------------------
    if (url.pathname === "/healthz") {
      const clients = sharedModel?.clientCount ?? 0;
      return new Response(
        JSON.stringify({
          ok: true,
          name: "automicvault",
          version: __VERSION__,
          demo: true,
          modelReady,
          clients,
          maxClients: MAX_CLIENTS,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            ...SECURITY_HEADERS,
          },
        }
      );
    }

    // -----------------------------------------------------------------------
    // Static assets via CF Pages ASSETS binding
    // -----------------------------------------------------------------------
    try {
      const resp = await env.ASSETS.fetch(request);
      return addSecurityHeaders(resp);
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), "ASSETS.fetch");
      return new Response("Internal Server Error", { status: 500, headers: SECURITY_HEADERS });
    }
  },
} satisfies ExportedHandler<Env>;
