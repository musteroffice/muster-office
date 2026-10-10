import { expect, test } from "@playwright/test";
import { openFixtureHome } from "../scripts/fixture-home.mjs";
import type { Snapshot } from "@muster-office/shared";

/**
 * The real (non-demo) pipeline in a browser: the server watches a Muster-shaped home on disk,
 * this test plays the part of Muster (atomic rename of project.json, appended desk lines),
 * and the UI must follow within about a second.
 */
const LIVE = "http://127.0.0.1:4796";

test("follows real file changes within about a second", async ({ page, request }) => {
  const home = process.env["MUSTER_OFFICE_E2E_LIVE_HOME"];
  expect(home, "the live home is created by playwright.config.ts").toBeTruthy();
  const muster = openFixtureHome(home!);

  await page.addInitScript(() => {
    localStorage.setItem("muster-office:view", '"board"');
    localStorage.setItem("muster-office:timelineOpen", "true"); // the list is collapsed by default in a short window
  });
  await page.goto(`${LIVE}/`);
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByTestId("demo-badge")).toHaveCount(0);

  const row = page.locator('[data-testid="agent-row"]', { hasText: "w-auth" });
  await expect(row).toHaveAttribute("data-state", "reported");
  await expect(page.getByTestId("agent-table")).toContainText("Pico");
  const snap0 = (await (await request.get(`${LIVE}/api/snapshot`)).json()) as Snapshot;
  expect(snap0.demo).toBe(false);
  expect(snap0.projects[0]?.deploy.source).toBe("VISION.md"); // VISION.md is read for the posture

  const t0 = Date.now();
  muster.setAgentState("w-auth", "failed");
  await expect(row).toHaveAttribute("data-state", "failed", { timeout: 3000 });
  expect(Date.now() - t0).toBeLessThan(2500);

  muster.appendDesk({ kind: "blocked", title: "Disk full on the build box" });
  await expect(page.getByTestId("desk-table")).toContainText("Disk full on the build box", { timeout: 3000 });
  await expect(page.getByTestId("timeline-list")).toContainText("w-auth reported → failed", { timeout: 3000 });
});
