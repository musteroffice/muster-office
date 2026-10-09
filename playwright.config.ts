import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const DEMO_PORT = 4799;
const EMPTY_PORT = 4798;
// A home with no Muster state at all, for the "nothing to show" and idle-freeze tests.
const emptyHome = mkdtempSync(join(tmpdir(), "muster-office-empty-"));

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
  ],
});
