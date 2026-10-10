import { expect, test } from "@playwright/test";

import { ownerAuth, roomToWork } from "./api";

/**
 * THE SMALLEST PHONE STILL IN A CASHIER'S POCKET — 320 pixels wide.
 *
 * Every layout check in this suite stops at 390 (an iPhone 14). At 320 the
 * shop's header — menu button, the full brand lock-up, the bell and the
 * account button — came to 344 pixels: the bar ran 24px past the screen, and
 * because it is the first thing on every page, every page could be dragged
 * sideways by that much.
 *
 * The NAME gives way there and the mark stays. This holds the bar inside the
 * screen at 320, and checks the brand link did not lose its name with it.
 */

// One owner, 240 requests a minute — see roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, ownerAuth(), 130, "/auth/me");
});

const SCREENS = ["/tenant", "/tenant/products", "/tenant/sales", "/tenant/expenses", "/tenant/settings"];

test("at 320 pixels the header stays inside the screen, on every page it heads", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one project sets its own width for this; the others would only repeat it");

  await page.setViewportSize({ width: 320, height: 640 });

  for (const path of SCREENS) {
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => {});
    const header = page.locator("header").first();
    await expect(header).toBeVisible({ timeout: 20_000 });

    const measured = await header.evaluate((bar) => {
      const screen = document.documentElement.clientWidth;
      const past = [...bar.querySelectorAll("*")]
        .filter((el) => {
          const box = el.getBoundingClientRect();

          return box.width > 0 && box.right > screen + 0.5;
        })
        .map((el) => `${el.tagName.toLowerCase()} → ${Math.round(el.getBoundingClientRect().right)}`);

      return { screen, bar: bar.scrollWidth, past: past.slice(0, 4) };
    });

    expect(measured.past, `${path}: these run past the edge of a ${measured.screen}px screen`).toEqual([]);
    expect(measured.bar, `${path}: the header is wider than the screen it is on`).toBeLessThanOrEqual(measured.screen);
  }

  // The front page itself cannot be dragged sideways either.
  await page.goto("/tenant");
  await page.waitForLoadState("networkidle").catch(() => {});
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways, "the dashboard scrolls sideways at 320px").toBeLessThanOrEqual(0);

  // The name is not drawn at this width; the link still has one.
  const home = page.locator("header").getByRole("link", { name: /home$/ }).first();
  await expect(home).toBeVisible();
  await expect(home.locator("img, svg").first(), "the brand mark went with the name").toBeVisible();

  // And where there is room the full lock-up is back — it only gives way
  // where it must. On the shop side that is 480 now, not 360: a phone's
  // header there also carries search and the branch (see header.spec), and
  // the name is what made room for them.
  // Read from the link's own label, so a renamed product does not break this.
  const firstWord = ((await home.getAttribute("aria-label")) ?? "").replace(/ home$/, "").split(" ")[0];
  expect(firstWord.length, "the brand link has no name to read").toBeGreaterThan(0);
  await expect(home.getByText(firstWord).first(), "the name is drawn at 320px — the bar has no room for it").toBeHidden();
  await page.setViewportSize({ width: 390, height: 760 });
  await expect(home.getByText(firstWord).first(), "the name is drawn at 390px, beside search and the branch — one of them is being squeezed").toBeHidden();
  await page.setViewportSize({ width: 480, height: 760 });
  await expect(home.getByText(firstWord).first(), "the name did not come back at 480px").toBeVisible();
});
