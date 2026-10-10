// Dev loop: rebuild + restart the server on change, and run Vite with a proxy to it.
import { context } from "esbuild";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const demo = process.argv.includes("--demo");
const ctx = await context({
  entryPoints: ["packages/server/src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/server/cli.js",
  external: ["hono", "hono/*", "@hono/node-server", "chokidar", "fsevents"],
  define: { __VERSION__: JSON.stringify(pkg.version) },
  sourcemap: true,
});
await ctx.rebuild();
await ctx.watch();

const run = (cmd, args) => spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
const server = run(process.execPath, ["--watch", "bin/automicvault.mjs", "--port", "4747", ...(demo ? ["--demo"] : [])]);
const vite = run("npx", ["vite", "packages/web", "--config", "packages/web/vite.config.ts"]);
const stop = () => {
  server.kill();
  vite.kill();
  void ctx.dispose();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
