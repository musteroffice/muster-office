import { expect, test, type Page } from "@playwright/test";

const debug = (page: Page) => page.evaluate(() => window.__office?.debug());

async function openOffice(page: Page, path = "/"): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("muster-office:view", '"office"');
      localStorage.setItem("muster-office:rosterOpen", "true");
      localStorage.setItem("muster-office:minimap", "true");
    } catch {
      /* blocked */
    }
  });
  await page.goto(path);
  await expect(page.getByTestId("office-canvas")).toBeVisible();
  await expect.poll(async () => (await debug(page))?.visibleActors ?? 0).toBeGreaterThanOrEqual(1);
}

test.describe("the chrome around the office", () => {
  test("shows vital signs, a crew list with portraits, and a minimap", async ({ page }) => {
    await openOffice(page);
    const vitals = page.getByTestId("vitals");
    await expect(vitals).toBeVisible();
    for (const label of ["Flow", "Crew", "Desk", "Delivery", "Machine", "Pulse"]) await expect(vitals).toContainText(label);
    const roster = page.getByTestId("roster");
    await expect(roster).toBeVisible();
    await expect(roster.locator("canvas.portrait").first()).toBeVisible();
    expect(await roster.locator("button.crew").count()).toBeGreaterThan(3);
    await expect(page.getByTestId("minimap")).toBeVisible();
  });

  test("clicking someone in the crew list opens them and flies the camera there", async ({ page }) => {
    await openOffice(page);
    const before = (await debug(page))!.cam;
    const card = page.getByTestId("roster").locator("button.crew", { hasText: /yaffle/i });
    await card.click();
    await expect(page.getByTestId("side-panel")).toContainText("Yaffle");
    await expect.poll(async () => (await debug(page))?.flying, { timeout: 5000 }).toBe(false);
    const after = (await debug(page))!;
    expect(Math.abs(after.cam.x - before.x) + Math.abs(after.cam.y - before.y)).toBeGreaterThan(5);
    expect(after.zoom).toBeGreaterThanOrEqual(3);
  });

  test("hovering a card outlines that person on the floor, and the panel can follow them", async ({ page }) => {
    await openOffice(page);
    const card = page.getByTestId("roster").locator("button.crew", { hasText: /ada/i }).first();
    await card.hover();
    await expect(card).toHaveClass(/pointed/);
    await card.click();
    const follow = page.getByTestId("side-panel").getByRole("button", { name: "Follow" });
    await follow.click();
    await expect(follow).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("side-panel")).toBeHidden();
  });

  test("the command palette finds an agent by typing and jumps to them", async ({ page }) => {
    await openOffice(page);
    await page.keyboard.press("Control+k");
    const palette = page.getByTestId("palette");
    await expect(palette).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Search" })).toBeFocused();
    await page.keyboard.type("yaff");
    await expect(palette.getByRole("option").first()).toContainText(/yaffle/i);
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    await expect(page.getByTestId("side-panel")).toContainText("Yaffle");
  });

  test("slash opens the palette, Escape closes it before anything else, and ? lists the shortcuts", async ({ page }) => {
    await openOffice(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("/");
    await expect(page.getByTestId("palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("palette")).toBeHidden();
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();
  });

  test("palette commands only move the view: switching to the board and back", async ({ page }) => {
    await openOffice(page);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("board view");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("board")).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.keyboard.type("office view");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("office-canvas")).toBeVisible();
  });

  test("failures and blocked work raise a toast whose button takes you there", async ({ page }) => {
    test.setTimeout(70_000);
    await openOffice(page);
    const first = page.locator("[data-sonner-toast]").first();
    await expect(first).toBeVisible({ timeout: 45_000 });
    const handle = await first.elementHandle();
    await first.getByRole("button", { name: "Show" }).click();
    // Pressing it takes you there and dismisses that very alert.
    await page.waitForFunction((el) => !el?.isConnected, handle, { timeout: 5000 });
  });

  test("the minimap moves the camera when you click it", async ({ page }) => {
    await openOffice(page);
    const mm = page.getByTestId("minimap").locator("canvas");
    const box = (await mm.boundingBox())!;
    const before = (await debug(page))!.cam;
    // The opening view sits where the agents are; the far top-left corner of the floor is somewhere else.
    await page.mouse.click(box.x + box.width * 0.05, box.y + box.height * 0.08);
    await expect.poll(async () => JSON.stringify((await debug(page))!.cam)).not.toBe(JSON.stringify(before));
  });

  test("director mode takes the camera on a tour of the floor by itself", async ({ page }) => {
    test.setTimeout(60_000);
    await openOffice(page);
    const auto = page.getByRole("button", { name: "auto" });
    await auto.click();
    await expect(auto).toHaveAttribute("aria-pressed", "true");
    const start = JSON.stringify((await debug(page))!.cam);
    await expect.poll(async () => JSON.stringify((await debug(page))!.cam), { timeout: 30_000, intervals: [500] }).not.toBe(start);
    await auto.click();
    await expect(auto).toHaveAttribute("aria-pressed", "false");
  });

  test("the settings menu switches theme, and the choice sticks", async ({ page }) => {
    await openOffice(page);
    await page.getByTestId("settings").click();
    await page.getByRole("menuitemradio", { name: "light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("the tab title counts what needs attention", async ({ page }) => {
    await openOffice(page);
    await expect.poll(() => page.title(), { timeout: 40_000 }).toMatch(/^(\(\d+\) )?(· )?Muster Office$/);
  });
});

test.describe("life in the office", () => {
  test("the wall pulse spikes with events, and the office cat is on the floor", async ({ page }) => {
    await openOffice(page);
    const d = (await debug(page))!;
    expect(d.critter).not.toBeNull();
    await expect.poll(async () => (await debug(page))?.pulseSpikes ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await debug(page))?.popups ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test("?hour pins the office clock so night lighting can be checked", async ({ page }) => {
    await openOffice(page, "/?hour=22");
    expect((await debug(page))!.hour).toBe(22);
  });

  test("reduced motion: the cat sleeps, nothing floats, and chrome animation is off", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await openOffice(page);
    await page.waitForTimeout(1500);
    const d = (await debug(page))!;
    expect(d.reduced).toBe(true);
    expect(d.critter?.mode).toBe("sleep");
    expect(d.popups).toBe(0);
    expect(d.pulseSpikes).toBe(0);
    await ctx.close();
  });
});
