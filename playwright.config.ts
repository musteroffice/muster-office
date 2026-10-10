import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { makeFixtureHome } from "./scripts/fixture-home.mjs";

const DEMO_PORT = 4799;
const EMPTY_PORT = 4798;
const HOT_PORT = 4797;
const LIVE_PORT = 4796;
// A home with no Muster state at all, for the "nothing to show" and idle-freeze tests.
// Playwright evaluates this file again inside each worker, so homes are created once (main process)
// and handed on through the environment.
const once = (key: string, make: () => string): string => {
  const existing = process.env[key];
  if (existing) return existing;
  const value = make();
  process.env[key] = value;
  return value;
};
const emptyHome = once("MUSTER_OFFICE_E2E_EMPTY_HOME", () => mkdtempSync(join(tmpdir(), "muster-office-empty-")));
// A real-looking Muster home the live test rewrites while the (non-demo) server watches it.
const liveHome = once("MUSTER_OFFICE_E2E_LIVE_HOME", () => {
  const dir = mkdtempSync(join(tmpdir(), "muster-office-live-"));
  makeFixtureHome(dir);
  return dir;
});

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${DEMO_PORT}`, trace: "retain-on-failure", ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } },
  // The build must exist: `npm run test:e2e` builds first.
  webServer: [
    {
      command: `node bin/muster-office.mjs --demo --port ${DEMO_PORT} --tick-ms 300`,
      url: `http://127.0.0.1:${DEMO_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `node bin/muster-office.mjs --port ${EMPTY_PORT} --home "${emptyHome}"`,
      url: `http://127.0.0.1:${EMPTY_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `node bin/muster-office.mjs --demo --port ${HOT_PORT} --tick-ms 70`,
      url: `http://127.0.0.1:${HOT_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `node bin/muster-office.mjs --port ${LIVE_PORT} --home "${liveHome}"`,
      url: `http://127.0.0.1:${LIVE_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
