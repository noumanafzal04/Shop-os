import { test, expect, type Page } from "@playwright/test";

import { openTill, showPane } from "./till";

/**
 * A SHOP THAT SELLS THE SAME THING IN THREE SIZES.
 *
 * The shelf fixture carries one product with Small 500, Medium 750 and Large
 * 900, each with its own stock. Three obviously different prices, so nothing
 * here can pass by coincidence on the parent's 500.
 *
 * ── Both views, because they are two code branches ─────────────────────
 *
 * The sizes are asked for in a SHEET, in both views. Chips under every card was
 * the first build and the shop rejected it — a wall of cards each carrying its
 * own wall of buttons — so the tile now carries only a "from" in front of its
 * price and the question is asked on tap.
 *
 * `posLayout` is a per-device choice and the grid and the list are separate
 * branches rendering from one array, so both are driven here. A test that only
 * drove the default would have covered one of them, and the default is per TRADE
 * (`grid` for a restaurant, `list` for everyone else) — so which one it covered
 * would depend on which shop the suite happened to log into.
 *
 * ── Why this has to run in a browser ────────────────────────────────────
 *
 * Two of the things checked here are invisible to jsdom.
 *
 * The first is the bug that made the feature impossible before it was a feature:
 * a varianted tracked product read the PARENT's stock row, which the product
 * form seeds at zero, so the tile rendered "Out of stock" and `disabled` while a
 * full rail sat on the variants. `Product::effectiveStock()` on the server had
 * already said that the parent figure "must not be read as truth".
 *
 * The second is layout. A chip row lives inside a tile about 120 points wide on
 * a shop monitor — the catalog pane is `lg:col-span-6 xl:col-span-5`, so it
 * NARROWS as the screen widens — and on a phone that tile shares a 390-point
 * screen with the cart. That is the case this repo has got wrong repeatedly, so
 * the chips are measured rather than described.
 */

const SIZED = "E2E Sized Item";

/** Put the till in one of its two views and find the fixture's sized product. */
async function findSized(page: Page, view: "Picture tiles" | "Compact rows") {
  await openTill(page);
  await showPane(page, "Products");

  const toggle = page.getByTitle(view).first();
  await expect(toggle, `the ${view} toggle is not on screen`).toBeVisible({ timeout: 15_000 });
  await toggle.click();
  await page.waitForTimeout(400);

  // Searched rather than scrolled to, so the test does not depend on where the
  // product happens to sit in the grid.
  const search = page.getByRole("textbox", { name: /scan a barcode or search/i }).first();
  await search.fill(SIZED);
  await page.waitForTimeout(900);

  const item = page.locator("[data-pos-item]").filter({ hasText: SIZED }).first();
  await expect(item, "the sized product never appeared on the shelf").toBeVisible({ timeout: 15_000 });

  return item;
}

/** The cart line for the sized product, whichever pane it is behind. */
async function sizedCartRow(page: Page) {
  await showPane(page, "Cart");
  const row = page.locator("[data-cart-row]").filter({ hasText: SIZED }).first();
  await expect(row, "choosing a size added nothing to the cart").toBeVisible({ timeout: 10_000 });

  return row;
}

test("tiles: a sized item says \"from\", and the sheet charges the size's own price", async ({ page }) => {
  const tile = await findSized(page, "Picture tiles");

  // ── the bug that came first ──────────────────────────────────────────
  //
  // Before the parent-stock fix this tile was `disabled` under an "Out of stock"
  // veil: the parent row is seeded at zero and the rail lives on the variants,
  // so a full shelf read empty. Nothing below could have run.
  await expect(
    tile,
    "a product whose stock is all on its sizes was greyed out as if the shelf were empty",
  ).toBeEnabled();

  // No chips under the card. This is the shop's own decision, not an accident,
  // so it is asserted rather than assumed: "dont show under card, variant show
  // only in popup".
  await expect(
    page.locator("[data-pos-size]"),
    "sizes were drawn under the card — the shop asked for them in the sheet only",
  ).toHaveCount(0);

  // The tile has to WARN that its price is not the price. Without the word, a
  // tile reading Rs 650 that then charges Rs 1,350 is the screen misleading the
  // person holding it.
  await expect(
    tile,
    "a sized item showed a bare price, promising the cheapest size",
  ).toContainText(/from/i);

  await tile.click();

  const sheet = page.getByRole("dialog", { name: SIZED });
  await expect(sheet, "tapping a sized item did not ask which size").toBeVisible({ timeout: 10_000 });

  const large = sheet.locator('[data-pos-size="Large"]');
  await expect(large, "Large was not offered").toBeVisible();
  await expect(
    large,
    "Large is struck through — the fixture ran out of it rather than the picker being broken",
  ).toBeEnabled();

  // A real tap target, and on the screen. The sheet is the one place these live
  // now, so it is the one place worth measuring.
  const box = await large.boundingBox();
  expect(box, "the Large button has no box — it is not rendered").not.toBeNull();
  expect(box!.height, "the Large button is too short to press").toBeGreaterThan(28);
  expect(box!.x, "the sheet has run off the left of the screen").toBeGreaterThanOrEqual(0);
  expect(
    box!.x + box!.width,
    "the sheet has run off the right of the screen",
  ).toBeLessThanOrEqual(page.viewportSize()!.width + 1);

  await large.click();
  await page.waitForTimeout(600);

  const row = await sizedCartRow(page);

  // The name says which size. Without it a cashier cannot tell two lines of the
  // same product apart, and neither can the customer reading the receipt.
  await expect(row, "the cart line does not say which size it is").toContainText(/Large/);

  // THE assertion. 900 is Large; 500 is the parent. Before the picker existed
  // every tap produced the parent's price, so a shop selling three sizes charged
  // one — and this is the line that would have caught it.
  await expect(
    row,
    "the line was priced at the parent product's price, not the size's",
  ).toContainText(/900/);
});

test("rows: tapping the row asks which size, and every size is offered with its price", async ({ page }) => {
  const rowItem = await findSized(page, "Compact rows");

  // Same as tiles: nothing under the row, the question is asked on tap.
  await expect(
    page.locator("[data-pos-size]"),
    "a row rendered size chips",
  ).toHaveCount(0);

  await rowItem.click();

  // Named, not just "the dialog". The app keeps an always-mounted Appearance
  // drawer in the DOM, so a bare role lookup finds two — which is how that
  // panel's own `aria-hidden`/`inert` gap turned up.
  const sheet = page.getByRole("dialog", { name: SIZED });
  await expect(sheet, "tapping a product with sizes did not ask which one").toBeVisible({ timeout: 10_000 });

  // All three, each with its own price — a sheet that offered one size, or
  // offered them all at the same price, would be worse than no sheet.
  for (const [name, price] of [["Small", "500"], ["Medium", "750"], ["Large", "900"]] as const) {
    const chip = sheet.locator(`[data-pos-size="${name}"]`);
    await expect(chip, `${name} was not offered`).toBeVisible();
    await expect(chip, `${name} was not priced at its own price`).toContainText(price);
  }

  await sheet.locator('[data-pos-size="Medium"]').click();
  await page.waitForTimeout(600);

  const row = await sizedCartRow(page);
  await expect(row, "the cart line does not say which size it is").toContainText(/Medium/);
  await expect(row, "the line took a price that is not Medium's").toContainText(/750/);
});
