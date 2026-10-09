#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "server", "cli.js");
if (!existsSync(cli)) {
  console.error("muster-office: the project is not built yet. Run `npm run build` first.");
  process.exit(1);
}
const { main } = await import(pathToFileURL(cli).href);
await main();
