import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.js";
import type { DataSource } from "./sink.js";

declare const __VERSION__: string | undefined;

const HELP = `muster-office — a read-only, localhost, live pixel-art office for pi-muster

Usage: muster-office [options]

  --demo              Run a deterministic synthetic simulator instead of reading Muster files
  --port <n>          Port to listen on (default 4747; 0 = any free port). Env: MUSTER_OFFICE_PORT
  --home <dir>        Home directory that holds .local/state/muster (default: $HOME).
                      Env: MUSTER_OFFICE_HOME
  --poll              Poll the filesystem instead of using native watchers
  --tick-ms <n>       Demo only: milliseconds per simulator step (default 2500). Env: MUSTER_OFFICE_DEMO_TICK_MS
  -h, --help          Show this help
  -v, --version       Show the version

The server binds to 127.0.0.1 only and never writes to any Muster path.
`;

interface Args {
  demo: boolean;
  port: number | null;
  home: string | null;
  poll: boolean;
  tickMs: number | null;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv): Args {
  const a: Args = { demo: false, port: null, home: null, poll: false, tickMs: null, help: false, version: false };
  const num = (v: string | undefined, flag: string): number => {
    const n = Number(v);
    if (v === undefined || !Number.isInteger(n) || n < 0) throw new Error(`${flag} needs a non-negative integer`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--demo":
        a.demo = true;
        break;
      case "--poll":
        a.poll = true;
        break;
      case "--port":
        a.port = num(argv[++i], "--port");
        break;
      case "--tick-ms":
        a.tickMs = num(argv[++i], "--tick-ms");
        break;
      case "--home": {
        const v = argv[++i];
        if (!v) throw new Error("--home needs a directory");
        a.home = v;
        break;
      }
      case "-h":
      case "--help":
        a.help = true;
        break;
      case "-v":
      case "--version":
        a.version = true;
        break;
      case "--host":
        throw new Error("the host is fixed to 127.0.0.1 and cannot be changed");
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  if (a.port === null && env["MUSTER_OFFICE_PORT"] !== undefined) a.port = num(env["MUSTER_OFFICE_PORT"], "MUSTER_OFFICE_PORT");
  if (a.tickMs === null && env["MUSTER_OFFICE_DEMO_TICK_MS"] !== undefined) a.tickMs = num(env["MUSTER_OFFICE_DEMO_TICK_MS"], "MUSTER_OFFICE_DEMO_TICK_MS");
  return a;
}

function findWebRoot(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, "../web"), resolve(here, "../../../dist/web")]) {
    if (existsSync(resolve(candidate, "index.html"))) return candidate;
  }
  return null;
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2), process.env);
  } catch (e) {
    console.error(`muster-office: ${(e as Error).message}\n`);
    console.error(HELP);
    process.exit(2);
  }
  const version = typeof __VERSION__ === "string" ? __VERSION__ : "dev";
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.version) {
    console.log(version);
    return;
  }

  const home = args.home ?? process.env["MUSTER_OFFICE_HOME"] ?? process.env["HOME"] ?? homedir();
  const noColor = process.env["NO_COLOR"] !== undefined && process.env["NO_COLOR"] !== "";
  const webRoot = findWebRoot();

  let source: DataSource | undefined;
  let demoReport: ((project: string, id: string) => string | null) | undefined;
  if (args.demo) {
    const { DemoSource } = await import("./demo/source.js");
    const demo = new DemoSource({ tickMs: args.tickMs ?? 2500 });
    source = demo;
    demoReport = (p, id) => demo.reportText(p, id);
  }

  const explicitPort = args.port !== null;
  const server = await startServer({
    home,
    port: args.port ?? 4747,
    portFallback: !explicitPort,
    demo: args.demo,
    ...(source ? { source } : {}),
    ...(demoReport ? { demoReport } : {}),
    webRoot,
    version,
    noColor,
    usePolling: args.poll,
    log: (m) => console.error(`[muster-office] ${m}`),
  });

  console.log(`Muster Office ${version}${args.demo ? " (demo mode: synthetic data)" : ""}`);
  console.log(`  listening on ${server.url}  (127.0.0.1 only, read-only)`);
  if (!args.demo) console.log(`  reading Muster state under ${home}`);
  if (webRoot === null) console.log("  warning: web app not found; run `npm run build` first (API only)");

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((e: unknown) => {
    console.error(`muster-office: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}

export { main };
