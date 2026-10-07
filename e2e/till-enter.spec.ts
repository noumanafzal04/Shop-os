import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API, ownerAuth } from "./api";
import { TAXED, list, stockTaxedShelf } from "./taxedShelf";

/**
 * ENTER, IN THE TILL'S SEARCH BOX.
 *
 * A scanner types a code and presses Enter in a tenth of a second. The list
 * of tiles answers a moment later. Enter used to add `tiles[highlighted]`
 * there and then — the answer to the LAST search — so a scanned `E2E-LBL-7X`
 * rang the first item on the shelf, whatever it was, and said nothing.
 *
 * Only a code of five or more digits was treated as a code. A shop's own
 * label, a Code-128 barcode with a letter in it, a serial number: all of
 * them took the other path. Found by the phone shop's journey, when a unit's
 * serial would not scan — and then, looking at why, by this.
 *
 * Every case here slows the product list down, because that is the only
 * honest way to stand where a scanner stands: ahead of the list.
 */

/**
 * Fixed, never stamped. A shop's own labels: letters, digits, dashes.
 *
 * TWO of them, so that whichever is first on the shelf the test can scan the
 * other — "the till rang the first tile" has to be told apart from "the till
 * rang what was scanned", and it cannot be when they are the same item.
 */
const CODED = [
  { name: "E2E Coded Item", sku: "E2E-LBL-7X", price: 100 },
  { name: "E2E Coded Other", sku: "E2E-LBL-8Y", price: 150 },
] as const;

async function coded(request: APIRequestContext): Promise<void> {
  const held = await list(request, `/products?search=${encodeURIComponent("E2E Coded")}&per_page=20`);
  for (const item of CODED) {
    if (held.some((p) => p.name === item.name)) continue;

    const made = await request.post(`${API}/products`, {
      headers: ownerAuth(),
      data: {
        item_type: "physical_product", name: item.name, sku: item.sku, price: item.price, is_active: true,
        description: "A fixture for the till's Enter key.", track_inventory: false, tax_rate: 0,
      },
    });
    expect(made.ok(), `could not card ${item.name}: ${made.status()} ${await made.text()}`).toBeTruthy();
  }
}

test.beforeAll(async ({ request }) => {
  await stockTaxedShelf(request);
  await coded(request);
});

const box = (page: Page) => page.getByPlaceholder(/scan barcode or search/i).first();
const cart = (page: Page) => page.locator("[data-cart-row]");

/**
 * The till between two scans: an empty ticket, an empty box, the shelf on
 * screen — and a product list that answers LATE from here on. Returns the
 * name on the first tile, which is what the old Enter would have rung.
 */
async function tillWithASlowList(page: Page): Promise<string> {
  await page.goto("/tenant/pos");
  await expect(box(page)).toBeVisible({ timeout: 30_000 });
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  if (await reset.isEnabled().catch(() => false)) await reset.click();
  await expect(cart(page)).toHaveCount(0);

  const first = page.locator("[data-pos-item]").first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  const onScreen = (await first.innerText()).split("\n")[0].trim();

  // From here on the list is slower than a scanner — as it is in a shop.
  await page.route("**/api/v1/products?*", async (route) => {
    await new Promise((r) => setTimeout(r, 900));
    await route.continue();
  });

  return onScreen;
}

/** As a scanner does: every character, then Enter, without waiting for anything. */
async function scanIn(page: Page, code: string): Promise<void> {
  await box(page).pressSequentially(code, { delay: 5 });
  await box(page).press("Enter");
}

test("a code typed faster than the list can answer rings THAT item — not whatever was on screen", async ({ page }) => {
  const onScreen = await tillWithASlowList(page);
  // Scan the one that is NOT first on the shelf.
  const scanned = CODED.find((c) => c.name !== onScreen)!;

  await scanIn(page, scanned.sku);

  await expect(cart(page).filter({ hasText: scanned.name }), "the scanned item is not on the bill").toHaveCount(1, { timeout: 15_000 });
  // One line, and it is the one that was scanned.
  await expect(cart(page)).toHaveCount(1);
  await expect(cart(page).first(), `the till rang ${onScreen}, which nobody scanned`).not.toContainText(onScreen);
  await expect(box(page)).toHaveValue("");
});

test("a code that nothing carries rings nothing, and the till says so", async ({ page }) => {
  await tillWithASlowList(page);

  await scanIn(page, "E2E-NOPE-9Z");

  await expect(page.getByText("No item found for that code.")).toBeVisible({ timeout: 15_000 });
  await expect(cart(page), "a code nobody carries put something on the bill").toHaveCount(0);
});

test("a name typed in a hurry adds the item that matches it — when the list has caught up", async ({ page }) => {
  const onScreen = await tillWithASlowList(page);
  const wanted = [TAXED.B.name, TAXED.A.name].find((n) => n !== onScreen)!;

  await scanIn(page, wanted);

  await expect(cart(page).filter({ hasText: wanted })).toHaveCount(1, { timeout: 15_000 });
  await expect(cart(page)).toHaveCount(1);
});

test("part of a label that is nobody's whole code is still a search: Enter adds the match", async ({ page }) => {
  await tillWithASlowList(page);

  // "LBL-7" has a digit and no space — it LOOKS like a code, and is looked up
  // as one first. Nothing carries it, so it is what the cashier was typing to
  // find: the one item whose label it is part of.
  await scanIn(page, "LBL-7");

  await expect(cart(page).filter({ hasText: CODED[0].name }), "a search that looks like a code added nothing").toHaveCount(1, { timeout: 15_000 });
  await expect(cart(page)).toHaveCount(1);
  await expect(page.getByText("No item found for that code."), "a miss on the way to the match was shown as an error").toHaveCount(0);
});

test("an Enter the box has moved on from is not spent on what was typed after it", async ({ page }) => {
  const onScreen = await tillWithASlowList(page);
  const next = [TAXED.B.name, TAXED.A.name].find((n) => n !== onScreen)!;

  // Enter, for a code — and before the list has answered, something else is typed. No Enter for THAT.
  await scanIn(page, "E2E-NOPE-9Z");
  await box(page).fill(next);

  // The list catches up with what is in the box now…
  await expect(page.locator("[data-pos-item]").filter({ hasText: next }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_500);
  // …and nothing is on the bill: nobody pressed Enter for it.
  await expect(cart(page), "an old Enter rang something that was typed after it").toHaveCount(0);
  await expect(page.getByText("No item found for that code."), "an old Enter looked up a code that is no longer in the box").toHaveCount(0);
});

test("Enter adds the match the arrow keys are on, not the first one", async ({ page }) => {
  await page.goto("/tenant/pos");
  await expect(box(page)).toBeVisible({ timeout: 30_000 });
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  if (await reset.isEnabled().catch(() => false)) await reset.click();

  // Three matches for one search: the taxed shelf.
  await box(page).fill("E2E Taxed Item");
  const tiles = page.locator("[data-pos-item]");
  await expect(tiles).toHaveCount(3, { timeout: 20_000 });
  const names = (await tiles.allInnerTexts()).map((t) => t.split("\n")[0].trim());

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await expect(cart(page)).toHaveCount(1, { timeout: 10_000 });
  await expect(cart(page).first(), `Enter added ${names[0]} although the highlight was on ${names[1]}`).toContainText(names[1]);
});
