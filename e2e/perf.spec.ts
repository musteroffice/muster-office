import { expect, test, type Page } from "@playwright/test";
import type { Snapshot } from "@muster-office/shared";

/**
 * Perf budget under a hot stream: this server emits a new simulator step every 70 ms
 * (roughly 14 diffs a second, 850 a minute), more than the 500 events/min the brief asks for.
 */
const HOT = "http://127.0.0.1:4797";

const debug = (page: Page) => page.evaluate(() => window.__office?.debug());

// A trace recorder screencasts the page, which would be measured as part of the frame cost.
test.use({ trace: "off" });

test("stays smooth at 800+ events a minute", async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => localStorage.setItem("muster-office:view", '"office"'));
  await page.goto(`${HOT}/`);
  await expect(page.getByTestId("office-canvas")).toBeVisible();
  await expect.poll(async () => (await debug(page))?.visibleActors ?? 0).toBeGreaterThan(0);

  const s0 = ((await (await request.get(`${HOT}/api/snapshot`)).json()) as Snapshot).seq;
  const t0 = Date.now();
  await page.waitForTimeout(6000);
  const s1 = ((await (await request.get(`${HOT}/api/snapshot`)).json()) as Snapshot).seq;
  const perMin = ((s1 - s0) / (Date.now() - t0)) * 60_000;
  expect(perMin).toBeGreaterThan(500);

  const d = await debug(page);
  // Real frame cadence and the CPU time we spend per frame.
  // Headless Chromium rasterises in software, so this is a floor, not the 60 fps a real GPU gives.
  expect(d?.fps ?? 0).toBeGreaterThanOrEqual(40);
  expect(d?.frameMsAvg ?? 99).toBeLessThan(8);
  expect(d?.running).toBe(true);
  console.log(`events/min=${Math.round(perMin)} fps=${d?.fps} avg work=${d?.frameMsAvg.toFixed(2)}ms max=${d?.frameMsMax.toFixed(1)}ms`);
});
