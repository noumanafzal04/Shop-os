import { expect, test } from "@playwright/test";

/**
 * WHILE AN OVERLAY IS OPEN, THE PAGE BEHIND IT HOLDS STILL.
 *
 * ── What the shop saw ───────────────────────────────────────────────────
 *
 * "sidebar scroll bhi issue kar raha / body scroll ho rahi tab pe / body bhi
 * kuch sidebar niche aa rahi." Open the menu on a tablet, drag, and the
 * dashboard moved behind it; drag past the last menu item and the page took
 * over the gesture.
 *
 * ── What it measured before the fix ─────────────────────────────────────
 *
 * In WebKit at 810 and again at 390, with the drawer open:
 *
 *     window.scrollBy(0, 400)  →  scrollY 0 → 400
 *     getComputedStyle(document.body).overflow  →  "visible"
 *     nav overscroll-behavior-y                 →  "auto"
 *
 * Nothing was locked and nothing was contained. A modal DID lock the page —
 * so the app answered the same question two ways, and the drawer had the
 * wrong answer.
 *
 * ── Why the mechanism is asserted and not only the effect ───────────────
 *
 * `overflow: hidden` on `<body>` stops a scripted `window.scrollBy` in every
 * engine while a real drag on iOS Safari scrolls the document anyway — the
 * body is not the scroller there. A spec that only scrolled by script would
 * go green on the half-fix and the shop would still see the page move. So
 * this also asserts the body is actually OUT OF FLOW, which is the part iOS
 * cannot scroll past. See src/layout/scrollLock.ts.
 */

const DRAWER_BELOW = 1024;

test("an open drawer holds the page behind it still", async ({ page }) => {
  await page.goto("/tenant");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);

  const width = page.viewportSize()!.width;

  // THE DENOMINATOR. On a page that cannot scroll, "the page did not scroll"
  // is true of every build, broken or not.
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(scrollable, "the dashboard was too short to scroll, so this proves nothing")
    .toBeGreaterThan(200);

  if (width >= DRAWER_BELOW) {
    // The rail is pinned here: there is no overlay, so nothing may be locked.
    // This half exists so a lock that is never released fails somewhere.
    const position = await page.evaluate(() => getComputedStyle(document.body).position);
    expect(position, "the page is locked with no overlay open").not.toBe("fixed");

    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY), "a pinned layout would not scroll")
      .toBeGreaterThan(0);
    return;
  }

  // Park the page somewhere that is not the top, so a lock that forgets to
  // restore the offset is visible as a jump rather than as nothing.
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(200);
  const parked = await page.evaluate(() => window.scrollY);
  expect(parked, "the page would not park away from the top").toBeGreaterThan(100);

  await page.getByLabel("Toggle Sidebar").first().click();
  await page.waitForTimeout(500);

  const aside = page.locator("aside").first();
  expect((await aside.boundingBox())!.x, "the drawer never opened").toBeGreaterThanOrEqual(-1);

  expect(
    await page.evaluate(() => getComputedStyle(document.body).position),
    "the body is still in flow, so an iOS drag will scroll the page behind the menu",
  ).toBe("fixed");

  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(() => window.scrollY),
    "the page scrolled behind an open drawer",
  ).toBe(0);

  // Closing gives the page back — at the same place, not at the top.
  //
  // Closed the way a shop closes it: a tap on the scrim. Reaching back for the
  // header button is what a TEST would do and it hung for the full five
  // minutes — the scrim sits at z-100001 and the header at z-99999, so with the
  // menu open that button is deliberately unreachable. Playwright refusing to
  // click through an overlay was the layout answering correctly.
  await page.mouse.click(page.viewportSize()!.width - 16, 240);
  await page.waitForTimeout(600);

  expect(
    await page.evaluate(() => getComputedStyle(document.body).position),
    "the lock outlived the drawer",
  ).not.toBe("fixed");
  expect(
    await page.evaluate(() => window.scrollY),
    "closing the menu threw the reader back to the top of the page",
  ).toBeGreaterThan(100);
});

test("the sidebar's own list does not hand its scroll to the page", async ({ page }) => {
  await page.goto("/tenant");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);

  const nav = page.locator("aside nav").first();
  await expect(nav, "the rail has no scrolling list to ask about").toBeAttached();

  expect(
    await nav.evaluate((el) => getComputedStyle(el).overscrollBehaviorY),
    "reaching the end of the menu carries on into the page behind it",
  ).toBe("contain");
});
