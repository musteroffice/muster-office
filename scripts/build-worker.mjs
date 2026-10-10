/**
 * Build a CF Pages _worker.js that:
 * - Handles /events as SSE with DemoSource
 * - Serves static assets from __STATIC_CONTENT
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

await build({
  entryPoints: ["worker/entry.ts"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
  outfile: "dist/web/_worker.js",
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    "process.env.NODE_ENV": '"production"',
  },
  logLevel: "info",
});
