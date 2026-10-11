import { expect, test, type Page } from "@playwright/test";

import { ownerAuth, roomToWork } from "./api";

/**
 * A SHOP WITH ONE PLACE IS NOT SHOWN THE SCREENS ABOUT PLACES.
 *
 *     "warehouse compulsory hai? … bht sari shops, shops main e apna sb manage
 *      krti — branch main un ka warehouse ni hota"
 *
 * A warehouse is not compulsory, and most shops will never have one. Every
 * plan ALLOWS one, though, and the panel drew from the allowance: a
 * one-counter grocer was shown Stock by place (one column), Stock transfers
 * (to nowhere), a Branch column reading "Main" down every sales list, and
 * asked the server for its list of branches on every page to draw nothing.
 *
 * A second place existing is the switch — how every other stock system does
 * it. The server says how many places are OPEN with the settings the panel
 * already holds, and this holds the panel to that answer in both directions:
 * the same shop, told it has one place and then told the truth.
 *
 * Reads only. The fixture shop really has several branches and a godown; the
 * "one place" half is the same shop with that one line of its settings
 * answered differently, which is exactly the fact the panel is meant to
 * follow.
 */

// One owner, 240 requests a minute — see roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, ownerAuth(), 110, "/auth/me");
});

const rail = (page: Page) => page.locator("aside").first().locator("nav");
const inRail = (page: Page, href: string) => rail(page).locator(`a[href="${href}"]`);

/** Full view, said before the app's own scripts: the rule is about what the shop has, not how short its menu is. */
async function inFullView(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("ui_mode", "advanced"));
}

type Open = { shops: number; warehouses: number };

/**
 * The shop's settings, with the places it has open answered as the test
 * says — or as the server says, when it says nothing (`null`).
 *
 * One listener for the whole test, told what to answer: taking a listener
 * off while a page is still asking through it ends the page's session.
 */
async function answering(page: Page): Promise<{ has: (places: Open | null) => void }> {
  let places: Open | null = null;

  await page.route("**/api/v1/shop/settings", async (route) => {
    if (route.request().method() !== "GET" || places === null) return route.continue();
    const answer = await route.fetch();
    const body = (await answer.json()) as { data: Record<string, unknown> };
    await route.fulfill({ response: answer, json: { ...body, data: { ...body.data, places } } });
  });

  return { has: (next) => { places = next; } };
}

test("with one place there is nothing about places — and the day there is a second, all of it is there", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "a rule about what is offered, not about a layout");
  await inFullView(page);
  const told = await answering(page);

  // ── as the shop really is: branches and a godown ──────────────────
  await page.goto("/tenant");
  await expect(inRail(page, "/tenant/branches"), "a business with several places has lost its places screen").toHaveCount(1, { timeout: 20_000 });
  await expect(inRail(page, "/tenant/stock-by-place")).toHaveCount(1);
  await expect(inRail(page, "/tenant/transfers")).toHaveCount(1);
  await expect(page.getByTestId("branch-switcher")).toBeVisible();

  await page.goto("/tenant/sales");
  await expect(page.getByRole("columnheader", { name: "Branch", exact: true }), "a shop with several branches lost the Branch column").toBeVisible({ timeout: 20_000 });

  // ── the same shop, with one place open ────────────────────────────
  told.has({ shops: 1, warehouses: 0 });
  const askedForBranches: string[] = [];
  page.on("request", (r) => { if (/\/api\/v1\/branches(\?|$)/.test(r.url())) askedForBranches.push(r.url()); });

  await page.goto("/tenant");
  await expect(rail(page).getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(1, { timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => {});

  // Where a godown would be ADDED is still there — the plan allows one…
  await expect(inRail(page, "/tenant/branches")).toHaveCount(1);
  // …and nothing that needs a second place to mean anything.
  await expect(inRail(page, "/tenant/stock-by-place"), "Stock by place is offered to a shop with one place").toHaveCount(0);
  await expect(inRail(page, "/tenant/transfers"), "Stock transfers is offered to a shop with nowhere to transfer to").toHaveCount(0);
  await expect(page.getByTestId("branch-switcher"), "a switcher with one place to switch to").toHaveCount(0);
  // The stock it has is still there, as it was.
  await expect(inRail(page, "/tenant/inventory")).toHaveCount(1);
  // And it did not ask for a list of branches to learn it had one.
  expect(askedForBranches, "a one-place shop fetched its branch list to draw nothing").toEqual([]);

  await page.goto("/tenant/sales");
  await expect(page.getByRole("heading", { name: "Sales", level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("columnheader", { name: "Invoice", exact: false }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("columnheader", { name: "Branch", exact: true }), "a Branch column for a shop with one branch").toHaveCount(0);

  // ── a shop with a counter and a godown: stock can be elsewhere, sales cannot ──
  told.has({ shops: 1, warehouses: 1 });
  await page.goto("/tenant/sales");
  await expect(page.getByRole("heading", { name: "Sales", level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(inRail(page, "/tenant/stock-by-place"), "a shop with a godown is not shown what each place holds").toHaveCount(1, { timeout: 20_000 });
  await expect(inRail(page, "/tenant/transfers")).toHaveCount(1);
  await expect(page.getByRole("columnheader", { name: "Branch", exact: true }), "one counter and a godown is still one place that sells").toHaveCount(0);
});

test("on the Simple view a one-place shop has no places row at all; with a second place it is there", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "a rule about what is offered, not about a layout");

  await page.addInitScript(() => {
    localStorage.setItem("ui_mode", "basic");
    for (const key of Object.keys(localStorage)) if (key.startsWith("shopos-simple-menu")) localStorage.removeItem(key);
  });

  const told = await answering(page);
  told.has({ shops: 1, warehouses: 0 });
  await page.goto("/tenant");
  await expect(rail(page).getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(1, { timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(inRail(page, "/tenant/branches"), "the Simple view shows a places screen to a shop with one place").toHaveCount(0);
  // Stock is one press, not a group of one.
  await expect(rail(page).getByRole("link", { name: "Inventory", exact: true })).toHaveAttribute("href", "/tenant/inventory");

  told.has(null);
  await page.reload();
  await expect(inRail(page, "/tenant/branches"), "a business with several places has no places row on its Simple view").toHaveCount(1, { timeout: 20_000 });
});
