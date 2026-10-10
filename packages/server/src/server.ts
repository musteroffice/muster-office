import { createAdaptorServer } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp, type BodyProvider } from "./app.js";
import { FsSource } from "./fs-source.js";
import { OfficeModel, capBody } from "./model.js";
import type { DataSource } from "./sink.js";

export interface StartOptions {
  /** Muster home directory (`--home` > MUSTER_OFFICE_HOME > HOME > os.homedir()). */
  home: string;
  /** 0 picks a free port. */
  port: number;
  /** When the requested port is busy, try the next ones (used when the user did not pick a port). */
  portFallback?: boolean;
  demo?: boolean;
  /** Provide a custom source (the demo simulator). Defaults to the filesystem source. */
  source?: DataSource;
  /** Optional report reader for sources with no filesystem (demo). */
  demoReport?: (project: string, packetId: string) => string | null;
  webRoot: string | null;
  version: string;
  noColor?: boolean;
  log?: (msg: string) => void;
  rescanMs?: number;
  usePolling?: boolean;
  watch?: boolean;
}

export interface RunningServer {
  url: string;
  port: number;
  model: OfficeModel;
  source: DataSource;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error): void => reject(e);
    server.once("error", onError);
    server.listen(port, HOST, () => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const startedAt = Date.now();
  const model = new OfficeModel({ demo: opts.demo ?? false, noColor: opts.noColor ?? false, version: opts.version });
  const fsSource =
    opts.source === undefined
      ? new FsSource({
          home: opts.home,
          ...(opts.rescanMs !== undefined ? { rescanMs: opts.rescanMs } : {}),
          ...(opts.usePolling !== undefined ? { usePolling: opts.usePolling } : {}),
          ...(opts.watch !== undefined ? { watch: opts.watch } : {}),
          ...(opts.log ? { log: opts.log } : {}),
        })
      : null;
  const source: DataSource = opts.source ?? (fsSource as FsSource);

  const bodies: BodyProvider = {
    desk: (project, id) => model.deskBody(project, id),
    owner: (id) => model.ownerBody(id),
    report: async (project, packetId) => {
      if (fsSource) {
        const path = model.reportPath(project, packetId);
        if (path === undefined) return null;
        const text = await fsSource.reader.readText(path, 512 * 1024);
        return text === null ? null : capBody(text);
      }
      const t = opts.demoReport?.(project, packetId) ?? null;
      return t === null ? null : capBody(t);
    },
  };

  let boundPort = 0;
  const app = createApp({
    model,
    bodies,
    webRoot: opts.webRoot,
    getPort: () => boundPort,
    version: opts.version,
    demo: opts.demo ?? false,
    startedAt,
  });
  const server = createAdaptorServer({ fetch: app.fetch, hostname: HOST }) as Server;

  // Load the data first so the very first client always receives the baseline snapshot.
  await source.start(model);

  let tries = 0;
  let port = opts.port;
  for (;;) {
    try {
      boundPort = await listen(server, port);
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE" && opts.portFallback && port !== 0 && tries < 20) {
        tries++;
        port++;
        continue;
      }
      await source.stop();
      throw e;
    }
  }

  return {
    url: `http://${HOST}:${boundPort}`,
    port: boundPort,
    model,
    source,
    async close() {
      await source.stop();
      model.flush();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
