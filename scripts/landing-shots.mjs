// THE FRONT PAGE'S PICTURES — how to take them again.
//
// The landing page shows real screens of a real shop (public/landing/*.webp).
// They go stale when the dashboard or the till changes. This retakes them.
//
//   1. Sign in as the shop to be photographed and save the session:
//        any Playwright script that ends with  ctx.storageState({ path })
//   2. STATE=<that file> OUT=<a folder> node scripts/landing-shots.mjs
//   3. Convert each PNG to WebP into public/landing/ at the widths the page
//      asks for: dashboard / pos at 2560 and 1280 wide, the two phone shots
//      at 804 wide. (Pillow: Image.save(..., "WEBP", quality=82, method=6))
//
// Taken at 1600 × 1000 — what a 1440-wide screen shows at 90% zoom — and at
// twice the pixels, so the picture is sharp on a laptop.
//
// Two things are done to the PAGE before the shutter, and neither to the shop:
//   - the appearance handle pinned to the right edge is hidden;
//   - a load-test shop's dishes are named "Chicken Karahi Half #1" — the
//     serial is taken off the words on screen.
// See docs/decisions/shopos-the-front-page-shows-the-product.md.
import { chromium } from "@playwright/test";

const OUT = process.env.OUT;
const STATE = process.env.STATE;
const BASE = process.env.BASE ?? "http://localhost:5177";
if (!OUT || !STATE) {
  console.error("STATE=<signed-in session file> OUT=<folder> node scripts/landing-shots.mjs");
  process.exit(1);
}

const desk = { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 };
const phone = { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const SHOTS = {
  dashboard: { ...desk, path: "/tenant" },
  pos: { ...desk, path: "/tenant/pos", sale: true },
  "dashboard-phone": { ...phone, path: "/tenant" },
  "pos-phone": { ...phone, path: "/tenant/pos", sale: true },
};

const TIDY = `[aria-label="Open appearance settings"] { display: none !important; }`;

const withoutSerials = () => {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (/ #\d+\b/.test(n.nodeValue ?? "")) n.nodeValue = n.nodeValue.replace(/ #\d+\b/g, "");
  }
};

const browser = await chromium.launch();
for (const [name, { path, sale, ...opts }] of Object.entries(SHOTS)) {
  const ctx = await browser.newContext({ baseURL: BASE, storageState: STATE, ...opts });
  // The install card is the browser's; a print window cannot be dismissed.
  await ctx.addInitScript(() => {
    try { localStorage.setItem("shopos-install-dismissed", String(Date.now())); } catch { /* blocked storage */ }
    window.print = () => {};
  });
  const page = await ctx.newPage();
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);

  if (sale) {
    // A sale in progress: four dishes, one of them twice. Nothing is paid.
    for (const nth of [0, 9, 5, 2, 0]) {
      await page.locator("[data-pos-item]").nth(nth).click();
      const add = page.getByRole("dialog").getByRole("button", { name: /^Add( to (cart|tab))?( ·|$)/ });
      await add.waitFor({ state: "visible", timeout: 4000 }).then(() => add.click()).catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  await page.addStyleTag({ content: TIDY });
  await page.evaluate(withoutSerials);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, "taken");
  await ctx.close();
}
await browser.close();
