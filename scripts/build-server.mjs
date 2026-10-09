// Bundles the server (and @muster-office/shared) into one ESM file. Runtime deps stay external.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
await build({
  entryPoints: ["packages/server/src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/server/cli.js",
  external: ["hono", "hono/*", "@hono/node-server", "chokidar", "fsevents"],
  define: { __VERSION__: JSON.stringify(pkg.version) },
  sourcemap: true,
  logLevel: "info",
});
