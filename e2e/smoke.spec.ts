import { expect, test, type Page } from "@playwright/test";
import { AGENT_STATES, type Snapshot } from "@muster-office/shared";

const EMPTY = "http://127.0.0.1:4798";

const debug = (page: Page) => page.evaluate(() => window.__office?.debug());

async function openOffice(page: Page, path = "/"): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("muster-office:view", '"office"');
      localStorage.setItem("muster-office:tipSeen", "true");
      localStorage.setItem("muster-office:timelineOpen", "true"); // the list is collapsed by default in a short window
    } catch {
      /* blocked */
    }
  });
  await page.goto(path);
  await expect(page.getByTestId("office-canvas")).toBeVisible();
}

test.describe("demo office", () => {
  test("loads, says it is a demo, is live and shows at least one agent", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
    page.on("pageerror", (e) => problems.push(String(e)));
    await openOffice(page);
    await expect(page.getByTestId("demo-badge")).toBeVisible();
    await expect(page.getByTestId("connection")).toContainText("live");
    await expect.poll(async () => (await debug(page))?.visibleActors ?? 0).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole("application")).toHaveAttribute("aria-label", /Office floor of/);
    const d = await debug(page);
    expect(d?.frames).toBeGreaterThan(0);
    expect(d?.reduced).toBe(false);
    // The canvas explains itself to a screen reader, and nothing (CSP included) logs an error.
    await expect(page.locator("#office-summary")).toContainText("Agents —");
    await page.waitForTimeout(1500);
    expect(problems).toEqual([]);
  });

  test("receives SSE updates and the timeline fills", async ({ page, request }) => {
    await openOffice(page);
    const seq0 = ((await (await request.get("/api/snapshot")).json()) as Snapshot).seq;
    await expect.poll(async () => ((await (await request.get("/api/snapshot")).json()) as Snapshot).seq, { timeout: 10_000 }).toBeGreaterThan(seq0);
    const rows = page.getByTestId("timeline-list").locator("li");
    const n0 = await rows.count();
    await expect.poll(async () => rows.count(), { timeout: 15_000 }).toBeGreaterThan(Math.min(n0, 1));
    expect(n0).toBeGreaterThan(0);
  });

  test("a state change in the data starts an animation (walk, spin, hand-off) instead of teleporting", async ({ page }) => {
    await openOffice(page);
    let sawBusy = false;
    await expect
      .poll(
        async () => {
          const d = await debug(page);
          if ((d?.busyActors ?? 0) > 0) sawBusy = true;
          return d?.log.some((l) => !l.fast && l.steps.some((s) => s === "walkTo" || s === "spin" || s === "materialize" || s === "fade")) ?? false;
        },
        { timeout: 45_000, intervals: [200] },
      )
      .toBe(true);
    expect(sawBusy).toBe(true);
    const d = await debug(page);
    expect(d?.transitions).toBeGreaterThan(0);
  });

  test("one full demo cycle visits every one of the 13 lifecycle states", async ({ request }) => {
    test.setTimeout(80_000);
    const seen = new Set<string>();
    const start = Date.now();
    // 84 steps at 300 ms is about 25 s per cycle.
    while (Date.now() - start < 34_000 && seen.size < AGENT_STATES.length) {
      const snap = (await (await request.get("/api/snapshot")).json()) as Snapshot;
      for (const p of snap.projects) for (const a of p.agents) seen.add(a.state);
      await new Promise((r) => setTimeout(r, 150));
    }
    expect([...seen].sort()).toEqual([...AGENT_STATES].sort());
  });

  test("clicking a character opens its detail panel", async ({ page }) => {
    await openOffice(page);
    await expect.poll(async () => page.evaluate(() => window.__office?.focusAgent("yaffle") ?? false)).toBe(true);
    const box = await page.getByTestId("office-canvas").boundingBox();
    const pos = await page.evaluate(() => window.__office?.screenPosOf("yaffle"));
    expect(box && pos).toBeTruthy();
    await page.mouse.click(box!.x + pos!.x, box!.y + pos!.y);
    const panel = page.getByTestId("side-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Yaffle");
    await expect(panel).toContainText("State history");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("the keyboard reaches everything: N steps through agents, + and − zoom", async ({ page }) => {
    await openOffice(page);
    await page.getByTestId("office-canvas").focus();
    const z0 = await page.evaluate(() => window.__office?.zoom() ?? 0);
    await page.keyboard.press("+");
    // Zooming leaves the "fill the window" scale and takes the next whole step.
    await expect.poll(() => page.evaluate(() => window.__office?.zoom())).toBe(Math.min(8, Math.floor(z0) + 1));
    await page.keyboard.press("-");
    await page.keyboard.press("n");
    await expect(page.getByTestId("side-panel")).toBeVisible();
  });
});

test.describe("board view (accessible fallback)", () => {
  test("shows every lane and agent as tables, and agrees with the data", async ({ page, request }) => {
    await page.addInitScript(() => localStorage.setItem("muster-office:view", '"board"'));
    await page.goto("/");
    await expect(page.getByTestId("board")).toBeVisible();
    const snap = (await (await request.get("/api/snapshot")).json()) as Snapshot;
    const selected = snap.projects[0]!;
    // The first project tab is selected by default when it has agents.
    await page.getByRole("tab", { name: selected.label }).click();
    await expect(page.getByTestId("agent-table")).toBeVisible();
    await expect(page.getByTestId("lane-table")).toBeVisible();
    await expect(page.getByTestId("flowline")).toContainText("WIP");
    const rows = await page.getByTestId("agent-row").count();
    expect(rows).toBeGreaterThan(0);
    // Switch layout to kanban and back.
    await page.getByRole("radio", { name: "Kanban" }).click();
    await expect(page.getByTestId("kanban")).toBeVisible();
    await page.getByRole("radio", { name: "Table" }).click();
    await expect(page.getByTestId("lane-table")).toBeVisible();
    // Details are reachable without the canvas.
    await page.getByTestId("agent-table").getByRole("button").first().click();
    await expect(page.getByTestId("side-panel")).toBeVisible();
  });

  test("bodies stay hidden until the toggle is on", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("muster-office:view", '"board"'));
    await page.goto("/");
    await expect(page.getByTestId("board")).toBeVisible();
    await page.getByRole("tab", { name: "Harbor API" }).click();
    const bodiesSeen: string[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/api/body")) bodiesSeen.push(r.url());
    });
    await page.getByTestId("agent-table").getByRole("button", { name: /ada/i }).first().click();
    await expect(page.getByTestId("side-panel")).toContainText("Body hidden");
    expect(bodiesSeen).toEqual([]);
    await page.getByRole("switch", { name: "show bodies" }).check();
    await expect.poll(() => bodiesSeen.length, { timeout: 8000 }).toBeGreaterThan(0);
  });
});

test.describe("motion, idle and visibility", () => {
  test("prefers-reduced-motion: static poses, nobody walks, the loop is not running at 60 fps", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await openOffice(page);
    await expect.poll(async () => (await debug(page))?.reduced).toBe(true);
    const f0 = (await debug(page))?.frames ?? 0;
    let busy = 0;
    for (let i = 0; i < 20; i++) {
      busy = Math.max(busy, (await debug(page))?.busyActors ?? 0);
      await page.waitForTimeout(100);
    }
    const f1 = (await debug(page))?.frames ?? 0;
    expect(busy).toBe(0);
    expect(f1 - f0).toBeLessThan(80); // ~60 fps would be ~120 frames in 2 s
    await ctx.close();
  });

  test("freezes when nothing happens and wakes on input", async ({ page }) => {
    await openOffice(page, `${EMPTY}/?freezeMs=800`);
    await expect.poll(async () => (await debug(page))?.frozen, { timeout: 10_000 }).toBe(true);
    const f0 = (await debug(page))?.frames ?? 0;
    await page.waitForTimeout(500);
    expect((await debug(page))?.frames).toBe(f0); // not a single frame while frozen
    await page.mouse.move(300, 300);
    await expect.poll(async () => (await debug(page))?.frozen).toBe(false);
  });

  test("pauses while the tab is hidden and resumes when it is visible again", async ({ page }) => {
    await openOffice(page);
    await expect.poll(async () => (await debug(page))?.running).toBe(true);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await debug(page))?.running).toBe(false);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await debug(page))?.running).toBe(true);
  });

  test("with no Muster data at all it explains itself instead of crashing", async ({ page }) => {
    await openOffice(page, `${EMPTY}/`);
    await expect(page.getByText(/No project to show/)).toBeVisible();
    await expect(page.getByTestId("connection")).toContainText("live");
    await expect(page.getByTestId("demo-badge")).toHaveCount(0);
  });
});

test.describe("security surface", () => {
  test("the server offers no way to write: every non-GET is refused", async ({ request }) => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"] as const) {
      const r = await request.fetch("/api/body", { method });
      expect(r.status(), method).toBe(405);
    }
    expect((await request.get("/healthz")).ok()).toBe(true);
  });
});
