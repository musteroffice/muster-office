// Takes screenshots of a running Muster Office with Playwright (read-only: it only loads the page).
//
//   npm run demo                                   # in one terminal
//   node scripts/screenshot.mjs --out shot.png     # in another
//
// Options:
//   --url <url>        default http://127.0.0.1:4747
//   --out <file>       default screenshot.png (with --frames N, "-001", "-002"… are appended)
//   --size <WxH>       viewport, default 1600x1000
//   --view <office|board>   default office
//   --project <slug>   project tab to show
//   --zoom <n>         press "+" until this integer zoom (office view)
//   --wait <ms>        wait before the first shot, default 1500
//   --frames <n>       take n shots …
//   --every <ms>       … this far apart (use with ffmpeg or gifski to make a GIF), default 500
//   --focus <x,y>      centre the camera on a world pixel (the floor is 752 px wide)
//   --select <agent>   click an agent in the office to open its panel
//   --theme <system|dark|light|mono>
import { chromium } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
    return acc;
  }, []),
);
const [width, height] = (args.size ?? "1600x1000").split("x").map(Number);
const url = args.url ?? "http://127.0.0.1:4747";
const out = args.out ?? "screenshot.png";
const frames = Number(args.frames ?? 1);
const every = Number(args.every ?? 500);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(args.dpr ?? 1) });
await page.addInitScript(
  ({ view, theme, project }) => {
    try {
      localStorage.setItem("muster-office:view", JSON.stringify(view));
      if (theme) localStorage.setItem("muster-office:theme", JSON.stringify(theme));
      if (project) localStorage.setItem("muster-office:project", JSON.stringify(project));
    } catch {
      /* ignore */
    }
  },
  { view: args.view ?? "office", theme: args.theme, project: args.project },
);
await page.goto(url);
await page.waitForSelector(args.view === "board" ? "[data-testid=board]" : args.view === "sprites" ? "canvas" : "[data-testid=office-canvas]");
await page.waitForTimeout(Number(args.wait ?? 1500));
if (args.zoom) {
  await page.locator("[data-testid=office-canvas]").focus();
  const target = Number(args.zoom);
  for (let i = 0; i < 8; i++) {
    const z = await page.evaluate(() => window.__office?.zoom());
    if (z === target) break;
    await page.keyboard.press(z < target ? "+" : "-");
  }
}
if (args.focus) {
  const [fx, fy] = args.focus.split(",").map(Number);
  await page.evaluate(([x, y]) => window.__office?.centerOn(x, y), [fx, fy]);
  await page.waitForTimeout(200);
}
if (args.select) {
  const pos = await page.evaluate((n) => window.__office?.screenPosOf(n), args.select);
  const box = await page.locator("[data-testid=office-canvas]").boundingBox();
  if (pos && box) await page.mouse.click(box.x + pos.x, box.y + pos.y);
  await page.waitForTimeout(400);
}
for (let i = 0; i < frames; i++) {
  const file = frames > 1 ? out.replace(/(\.\w+)$/, `-${String(i + 1).padStart(3, "0")}$1`) : out;
  await page.screenshot({ path: file });
  console.log(file);
  if (i < frames - 1) await page.waitForTimeout(every);
}
await browser.close();
