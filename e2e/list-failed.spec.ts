import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { ownerAuth, roomToWork } from "./api";

/**
 * A LIST THAT DID NOT ARRIVE IS NOT AN EMPTY LIST — on every list, not only the till.
 *
 * The till was the first place it was seen: its product request was answered
 * 429 and it said "No products match." over a shelf of forty items. That was
 * fixed there. Every other list in the shop still did it — "No customers
 * yet", "No suppliers yet", "No purchase orders yet" — because every one of
 * them reaches its empty cell by `rows.length === 0`, and rows are
 * `data ?? []`.
 *
 * The cell answers for all three now (see TableEmpty, and ListEmpty for the
 * lists that are cards rather than tables). This walks the shop's lists with
 * each one's request failing and holds them to it:
 *
 *   it says THIS list could not be loaded, in the server's own words
 *   it does not say there is nothing
 *   Try again asks again — and the list, or its real empty state, is there
 *
 * Reads only.
 */

const SLOWED = "Too many requests. Please slow down.";

interface Listed {
  path: string;
  /** The screen's own file, under src/modules — where its empty sentence is written. */
  screen: string;
  /** The request the list is drawn from: its path under /api/v1, exactly. */
  api: string;
  /** What the screen calls it when it has not come. */
  says: string;
  /** What it used to say instead — and still does when there really is nothing. */
  empty: RegExp;
}

const LISTS: Listed[] = [
  { path: "/tenant/customers", screen: "customers/pages/CustomersPage.tsx", api: "/customers", says: "The customer list could not be loaded.", empty: /No customers yet/ },
  { path: "/tenant/suppliers", screen: "purchases/pages/SuppliersPage.tsx", api: "/suppliers", says: "The supplier list could not be loaded.", empty: /No suppliers yet/ },
  { path: "/tenant/purchases", screen: "purchases/pages/PurchaseOrdersPage.tsx", api: "/purchase-orders", says: "The purchase orders could not be loaded.", empty: /No purchase orders yet/ },
  { path: "/tenant/sales", screen: "sales/pages/SalesPage.tsx", api: "/sales", says: "The sales list could not be loaded.", empty: /No sales (yet|match)/ },
  { path: "/tenant/products", screen: "catalog/pages/ProductsPage.tsx", api: "/products", says: "The product list could not be loaded.", empty: /No (items|products) (yet|match)/ },
  { path: "/tenant/inventory", screen: "inventory/pages/InventoryPage.tsx", api: "/products", says: "The stock list could not be loaded.", empty: /No tracked products/ },
  { path: "/tenant/staff", screen: "staff/StaffPage.tsx", api: "/staff", says: "The staff list could not be loaded.", empty: /No staff yet|Nobody matches/ },
  { path: "/tenant/activity", screen: "activity/pages/ActivityPage.tsx", api: "/audit-logs", says: "The activity log could not be loaded.", empty: /Nothing here for that/ },
  { path: "/tenant/coupons", screen: "coupons/pages/CouponsPage.tsx", api: "/coupons", says: "The coupons could not be loaded.", empty: /No coupons yet/ },
  { path: "/tenant/promotions", screen: "promotions/pages/PromotionsPage.tsx", api: "/promotions", says: "The promotions could not be loaded.", empty: /No promotions yet/ },
  { path: "/tenant/expenses", screen: "expenses/pages/ExpensesPage.tsx", api: "/expenses", says: "The expenses could not be loaded.", empty: /No expenses (yet|recorded)/ },
  { path: "/tenant/income", screen: "income/pages/IncomePage.tsx", api: "/incomes", says: "The income entries could not be loaded.", empty: /No income recorded yet/ },
  { path: "/tenant/ledger", screen: "income/pages/LedgerPage.tsx", api: "/ledger", says: "The ledger could not be loaded.", empty: /Nothing (moved in this period|matches these filters)/ },
  { path: "/tenant/cashbook", screen: "income/pages/CashbookPage.tsx", api: "/cashbook", says: "The cashbook could not be loaded.", empty: /No money movement/ },
  // ── and the lists that are not tables: cards, tiles, panels ──────
  { path: "/tenant/categories", screen: "catalog/pages/CategoriesPage.tsx", api: "/categories", says: "The categories could not be loaded.", empty: /No categories yet/ },
  { path: "/tenant/collections", screen: "catalog/pages/CollectionsPage.tsx", api: "/collections", says: "The collections could not be loaded.", empty: /No collections yet/ },
  { path: "/tenant/stocktake", screen: "stocktake/pages/StocktakePage.tsx", api: "/inventory/counts", says: "The stock counts could not be loaded.", empty: /No counts yet/ },
  { path: "/tenant/riders", screen: "orders/pages/RidersPage.tsx", api: "/riders", says: "The riders could not be loaded.", empty: /No riders yet/ },
  { path: "/tenant/reviews", screen: "reviews/pages/OwnerReviewsPage.tsx", api: "/reviews", says: "The reviews could not be loaded.", empty: /No reviews yet/ },
];

async function failIts(page: Page, list: Listed, status: number, message: string): Promise<{ asked: () => number }> {
  let asked = 0;
  await page.route((url) => url.pathname.endsWith(`/api/v1${list.api}`), (route) => {
    if (route.request().method() !== "GET") return route.continue();
    asked++;

    return route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ success: false, message, data: null, errors: {}, meta: {} }),
    });
  });

  return { asked: () => asked };
}

test("this test still knows what each list says when it IS empty", () => {
  // "Did not say X" proves nothing about a screen that never says X. Each
  // pattern below is checked against the words in the screen's own file, so a
  // sentence that is reworded fails here — not silently, by never matching.
  for (const list of LISTS) {
    const written = fs.readFileSync(path.join(process.cwd(), "src/modules", list.screen), "utf8");
    expect(written, `${list.screen} no longer says ${list.empty} — find what it says now when it is empty`).toMatch(list.empty);
  }
});

// One owner, 240 requests a minute — see roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, ownerAuth(), 130, "/auth/me");
});

for (const list of LISTS) {
  test(`${list.path}: a list that failed to arrive says so — not that there is nothing`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one walk is enough; it is a sentence, not a layout");

    const held = await failIts(page, list, 429, SLOWED);
    await page.goto(list.path);

    const failed = page.getByRole("alert").filter({ hasText: list.says });
    await expect(failed, `${list.path} did not say its list had failed to load`).toBeVisible({ timeout: 30_000 });
    expect(held.asked(), "the request this test fails was never made — it is failing the wrong one").toBeGreaterThan(0);
    // In the server's own words…
    await expect(failed).toContainText(SLOWED);
    // …and never as a shop with nothing in it.
    await expect(page.getByText(list.empty), `${list.path} called a failed list an empty one`).toHaveCount(0);
    // …nor as one still being counted: nothing is.
    await expect(page.getByText("Counting…"), `${list.path} says it is counting a list that did not load`).toHaveCount(0);

    // The line recovers. Lifted now the page is still: lifted mid-load, an
    // interception can leave one of the page's own files unanswered.
    await page.unrouteAll({ behavior: "wait" });
    const before = held.asked();
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(failed, "Try again did not bring the list back").toHaveCount(0, { timeout: 20_000 });
    expect(held.asked(), "the list came back without being asked for").toBe(before);
    await expect(page.getByRole("alert").filter({ hasText: "could not be loaded" })).toHaveCount(0);
  });
}

test("on a phone the message is whole — inside its card, not cut off at the edge", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one project sets its own width for this");
  // Every list is a table wider than a phone inside a card that scrolls. A
  // sentence centred in the wrong block is a little off; a bordered box is
  // sliced. Measured at 390px before this: its right edge was past the card's.
  await page.setViewportSize({ width: 390, height: 844 });
  const list = LISTS[0];
  await failIts(page, list, 429, SLOWED);
  await page.goto(list.path);

  const failed = page.getByRole("alert").filter({ hasText: list.says });
  await expect(failed).toBeVisible({ timeout: 30_000 });
  const box = (await failed.boundingBox())!;
  const card = await failed.evaluate((el) => {
    let scroller = el.parentElement;
    while (scroller && getComputedStyle(scroller).overflowX !== "auto") scroller = scroller.parentElement;
    const r = scroller!.getBoundingClientRect();

    return { left: r.left, right: r.right };
  });
  expect(box.x, "the message starts before its card does").toBeGreaterThanOrEqual(card.left);
  expect(box.x + box.width, "the message runs past the right edge of its card and is cut off").toBeLessThanOrEqual(card.right);
  await expect(failed.getByRole("button", { name: "Try again" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("a server that fails outright is said the same way, once it has stopped being asked", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one walk is enough");
  // A 500 is asked again a few times before the screen gives up on it; a 429
  // is not. Both end in the same sentence.
  info.setTimeout(120_000);
  const list = LISTS[0];
  const held = await failIts(page, list, 500, "Server Error");
  await page.goto(list.path);

  const failed = page.getByRole("alert").filter({ hasText: list.says });
  await expect(failed).toBeVisible({ timeout: 60_000 });
  await expect(failed).toContainText("Server Error");
  expect(held.asked(), "a failing server was asked only once").toBeGreaterThan(1);
  await expect(page.getByText(list.empty)).toHaveCount(0);
});

test("a list that is really empty still says so — that sentence is for THAT", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one walk is enough");
  // The same request, answered properly with nothing in it.
  const list = LISTS.find((l) => l.path === "/tenant/coupons")!;
  await page.route((url) => url.pathname.endsWith(`/api/v1${list.api}`), (route) =>
    route.request().method() !== "GET"
      ? route.continue()
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, message: "OK", data: [], errors: {}, meta: { pagination: { current_page: 1, per_page: 20, total: 0, last_page: 1 } } }),
        }),
  );
  await page.goto(list.path);

  await expect(page.getByText(list.empty)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("alert").filter({ hasText: "could not be loaded" })).toHaveCount(0);
});
