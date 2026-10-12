// THE FRONT PAGE'S PICTURES — how to take them again.
//
// The landing page shows real screens of real shops (public/landing/*.webp).
// They go stale when the dashboard or the till changes. This retakes them.
//
//   1. Sign in as the shop to be photographed and save the session:
//        any Playwright script that ends with  ctx.storageState({ path })
//   2. STATE=<that file> OUT=<a folder> node scripts/landing-shots.mjs
//        ONLY=dashboard,pos          a subset of the four (see SHOTS below)
//        TRADE=pharmacy              that trade's phone screen instead — for
//                                    the "Nine trades" section. Sign in as a
//                                    shop of that trade first.
//        CLOCK=2026-10-12T21:10:00+05:00
//                                    the hour on the wall, as the page reads
//                                    it (see below)
//   3. Convert each PNG to WebP into public/landing/ at the widths the page
//      asks for: dashboard / pos at 2560 and 1280 wide; every phone shot
//      (the two "-phone" ones and each "trade-<code>") at 804 wide.
//      (Pillow: Image.save(..., "WEBP", quality=82, method=6))
//
// Taken at 1600 × 1000 — what a 1440-wide screen shows at 90% zoom — and at
// twice the pixels, so the picture is sharp on a laptop.
//
// Three things are done to the PAGE before the shutter, and none to the shop:
//   - the appearance handle pinned to the right edge is hidden;
//   - a load-test shop's dishes are named "Chicken Karahi Half #1" — the
//     serial is taken off the words on screen;
//   - the dashboard is photographed with the FULL menu ("full menu k sth
//     screenshot"): the page says twelve parts of a shop, and the Simple
//     menu shows seven of them. That is this browser's own switch
//     (`ui_mode`), the one the rail's "Full view" button presses.
// And one that may be: CLOCK sets the hour the PAGE believes it is. A shop's
// day turns at five in the morning, so sales rung at two belong to the
// evening before — and a dashboard photographed then says "Good morning,
// Tuesday" over a "Today" that is Monday's. Given an evening hour of the
// shop's own day, the greeting, the date and the figures agree. Nothing is
// sent to the server differently: its day is the server's.
// See docs/decisions/shopos-the-front-page-shows-the-product.md.
import { chromium } from "@playwright/test";

const OUT = process.env.OUT;
const STATE = process.env.STATE;
const BASE = process.env.BASE ?? "http://localhost:5177";
const TRADE = process.env.TRADE;
const CLOCK = process.env.CLOCK;
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
if (!OUT || !STATE) {
  console.error("STATE=<signed-in session file> OUT=<folder> [ONLY=dashboard,…] [TRADE=<code>] node scripts/landing-shots.mjs");
  process.exit(1);
}

const desk = { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 };
const phone = { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const FOUR = {
  dashboard: { ...desk, path: "/tenant", fullMenu: true },
  pos: { ...desk, path: "/tenant/pos", sale: [0, 9, 5, 2, 0] },
  "dashboard-phone": { ...phone, path: "/tenant" },
  "pos-phone": { ...phone, path: "/tenant/pos", sale: [0, 9, 5, 2, 0] },
};
// A trade's own till, in a hand: the first three things on its shelf that can
// be sold. A trade with no till (a finance office) lands on its home screen,
// and that is its picture.
const SHOTS = TRADE
  ? { [`trade-${TRADE}`]: { ...phone, path: "/tenant/pos", sale: "the first three" } }
  : Object.fromEntries(Object.entries(FOUR).filter(([name]) => ONLY.length === 0 || ONLY.includes(name)));

const TIDY = `[aria-label="Open appearance settings"] { display: none !important; }`;

const withoutSerials = () => {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (/ #\d+\b/.test(n.nodeValue ?? "")) n.nodeValue = n.nodeValue.replace(/ #\d+\b/g, "");
  }
};

/** Press one thing on the shelf, and answer whatever it asks. True if the cart grew. */
async function ring(page, item, nth) {
  const cart = () => page.getByText(/^Cart/).first().innerText().catch(() => "");
  const before = await cart();
  await item.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(450);

  const sheet = page.getByRole("dialog");
  if (await sheet.count()) {
    // A dish asks how it is wanted and has an Add button; a design asks which
    // size, and each size is the button.
    const add = sheet.getByRole("button", { name: /^Add( to (cart|tab|sale))?( ·|$)/ }).first();
    const sizes = sheet.getByRole("button", { name: /\bleft\b/ });
    if (await add.isEnabled().catch(() => false)) await add.click().catch(() => {});
    else if (await sizes.count()) await sizes.nth(Math.min(1 + nth * 2, (await sizes.count()) - 1)).click().catch(() => {});
    await page.waitForTimeout(450);
    if (await sheet.count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); }
  }

  return (await cart()) !== before;
}

const browser = await chromium.launch();
for (const [name, { path, sale, fullMenu, ...opts }] of Object.entries(SHOTS)) {
  const ctx = await browser.newContext({ baseURL: BASE, storageState: STATE, ...opts });
  // The install card is the browser's; a print window cannot be dismissed.
  await ctx.addInitScript((full) => {
    try {
      localStorage.setItem("shopos-install-dismissed", String(Date.now()));
      if (full) localStorage.setItem("ui_mode", "advanced");
    } catch { /* blocked storage */ }
    window.print = () => {};
  }, fullMenu === true);
  const page = await ctx.newPage();
  // The hour only: every timer still runs, so the page loads as it does.
  if (CLOCK) await page.clock.setFixedTime(new Date(CLOCK));
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);

  const items = page.locator("[data-pos-item]");
  if (Array.isArray(sale)) {
    // A sale in progress: four dishes, one of them twice. Nothing is paid.
    for (const nth of sale) await ring(page, items.nth(nth), 0);
  } else if (sale && new URL(page.url()).pathname.endsWith("/pos")) {
    let rung = 0;
    for (let i = 0; i < Math.min(await items.count(), 8) && rung < 3; i++) {
      // Sold out, or offered only as "the same salt from another maker".
      if (await items.nth(i).getByText(/^(out|same salt\?)$/i).count()) continue;
      if (await ring(page, items.nth(i), rung)) rung++;
    }
    await items.first().scrollIntoViewIfNeeded().catch(() => {});
    console.log(name, `${rung} lines rung`);
  }

  await page.addStyleTag({ content: TIDY });
  await page.evaluate(withoutSerials);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, "taken");
  await ctx.close();
}
await browser.close();
