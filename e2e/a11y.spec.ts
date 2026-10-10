import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Automated accessibility checks (axe-core, WCAG 2 A and AA) over the office, the board, the open
 * dialogs and menus, in the light and dark themes. Automated checks catch about a third of real issues,
 * so this is a floor, not a certificate.
 */

async function open(page: Page, view: "office" | "board", theme: "dark" | "light"): Promise<void> {
  await page.addInitScript(
    ([v, t]) => {
      localStorage.setItem("muster-office:view", JSON.stringify(v));
      localStorage.setItem("muster-office:theme", JSON.stringify(t));
      localStorage.setItem("muster-office:tipSeen", "true");
    },
    [view, theme] as const,
  );
  await page.goto("/");
  await expect(page.getByTestId(view === "office" ? "office-canvas" : "board")).toBeVisible();
  await page.waitForTimeout(1200);
}

// Alerts fade in over a few hundred ms, and axe measures contrast mid-fade, so they are left out of the scan.
const TRANSIENT = ["[data-sonner-toaster]"];

const scan = async (page: Page, exclude: string[] = TRANSIENT) => {
  let b = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  for (const e of exclude) b = b.exclude(e);
  const r = await b.analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
};

for (const theme of ["dark", "light"] as const) {
  test(`office view has no detectable accessibility violations (${theme})`, async ({ page }) => {
    await open(page, "office", theme);
    // The pixel canvas is described by its label and summary; its pixels are not text.
    expect(await scan(page)).toEqual([]);
  });

  test(`board view has no detectable accessibility violations (${theme})`, async ({ page }) => {
    await open(page, "board", theme);
    expect(await scan(page)).toEqual([]);
  });
}

test("the command palette, shortcuts dialog and settings menu are accessible", async ({ page }) => {
  await open(page, "office", "dark");
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.waitForTimeout(400);
  expect(await scan(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.waitForTimeout(400);
  expect(await scan(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByTestId("settings").click();
  await page.waitForTimeout(300);
  expect(await scan(page)).toEqual([]);
});
