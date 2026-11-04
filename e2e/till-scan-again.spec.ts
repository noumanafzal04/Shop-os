import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API, ownerAuth } from "./api";
import { list } from "./taxedShelf";

/**
 * SCAN, ✕, SCAN AGAIN (#POS3).
 *
 * A shop with a USB scanner: the first scan rang, the line's ✕ (or Reset)
 * emptied the ticket — and the next scan rang nothing until the page was
 * reloaded. The ✕ took the cursor with it, the cursor fell to the page, and
 * the scanner typed slower than the page's scan catcher listened for.
 *
 * So the scanner here is a SLOW one — a key every 80 ms — and nothing is
 * clicked between the ✕ and the next scan, exactly as a cashier does it: the
 * hand is on the scanner, not the mouse.
 */
const ITEM = { name: "E2E Scan Again Item", sku: "E2E-SCAN-AGN", price: 120 } as const;

async function carded(request: APIRequestContext): Promise<void> {
  const held = await list(request, `/products?search=${encodeURIComponent(ITEM.name)}&per_page=5`);
  if (held.some((p) => p.name === ITEM.name)) return;

  const made = await request.post(`${API}/products`, {
    headers: ownerAuth(),
    data: {
      item_type: "physical_product", name: ITEM.name, sku: ITEM.sku, price: ITEM.price, is_active: true,
      description: "A fixture for scanning after a line is removed.", track_inventory: false, tax_rate: 0,
    },
  });
  expect(made.ok(), `could not card ${ITEM.name}: ${made.status()} ${await made.text()}`).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  await carded(request);
});

const box = (page: Page) => page.getByPlaceholder(/scan barcode or search/i).first();
const cart = (page: Page) => page.locator("[data-cart-row]");

/** A slow USB scanner: wherever the cursor is, a key every 80 ms, then Enter. */
async function slowScan(page: Page): Promise<void> {
  await page.keyboard.type(ITEM.sku, { delay: 80 });
  await page.keyboard.press("Enter");
}

async function emptyTill(page: Page): Promise<void> {
  await page.goto("/tenant/pos");
  await expect(box(page)).toBeVisible({ timeout: 30_000 });
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  if (await reset.isEnabled().catch(() => false)) await reset.click();
  await expect(cart(page)).toHaveCount(0);
  await box(page).focus();
}

test("after a line's ✕ the next scan rings, with nothing clicked in between", async ({ page }) => {
  await emptyTill(page);

  await slowScan(page);
  await expect(cart(page).filter({ hasText: ITEM.name }), "the first scan rang nothing").toHaveCount(1, { timeout: 15_000 });

  await cart(page).first().getByRole("button", { name: "Remove", exact: true }).click();
  await expect(cart(page)).toHaveCount(0);

  await slowScan(page);
  await expect(
    cart(page).filter({ hasText: ITEM.name }),
    "the scan after ✕ rang nothing — the cursor went with the line",
  ).toHaveCount(1, { timeout: 15_000 });
});

test("after Reset the next scan rings, with nothing clicked in between", async ({ page }) => {
  await emptyTill(page);

  await slowScan(page);
  await expect(cart(page).filter({ hasText: ITEM.name })).toHaveCount(1, { timeout: 15_000 });

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(cart(page)).toHaveCount(0);

  await slowScan(page);
  await expect(
    cart(page).filter({ hasText: ITEM.name }),
    "the scan after Reset rang nothing",
  ).toHaveCount(1, { timeout: 15_000 });
});
