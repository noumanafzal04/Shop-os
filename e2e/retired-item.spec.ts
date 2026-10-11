import { expect, test, type APIRequestContext } from "@playwright/test";

import { API, ownerAuth } from "./api";

/**
 * A PRODUCT SWITCHED OFF IS NOT OFFERED ANYWHERE THAT SELLS.
 *
 * Found by accident, on a phone: two products carded switched OFF were the
 * first two rows on the till, each with an Add button. The server refuses a
 * retired product at the sale — "An item in this sale is no longer available"
 * — so the till offered something it would turn down at the last press, with
 * the customer waiting and nothing on screen to say which line. The exchange
 * picker and Take Order had the same fault: they read the catalogue's own
 * list, which shows everything, because the catalogue is where a retired
 * product is switched back on. The New Sale form hid them itself, after the
 * page had arrived; it asks the server now, like the rest.
 *
 * Two fixtures that differ in exactly one thing, so the search that must find
 * nothing is proved able to find something.
 */

const RETIRED = "E2E Retired Soap";
const ON_SALE = "E2E Onsale Soap";

type Item = { id: string; name: string; is_active: boolean };

async function soap(request: APIRequestContext, name: string, active: boolean): Promise<void> {
  const res = await request.get(`${API}/products?search=${encodeURIComponent(name)}&per_page=20`, { headers: ownerAuth() });
  const found = (((await res.json()) as { data: Item[] }).data ?? []).find((p) => p.name === name);
  if (found) {
    // Held to what the test needs, whatever an earlier run or a person left it as.
    if (found.is_active !== active) {
      const put = await request.put(`${API}/products/${found.id}`, { headers: ownerAuth(), data: { is_active: active } });
      expect(put.ok(), `could not set ${name} ${active ? "on" : "off"} sale (${put.status()})`).toBeTruthy();
    }
    return;
  }

  const made = await request.post(`${API}/products`, {
    headers: ownerAuth(),
    data: {
      item_type: "physical_product", name, price: 120, is_active: active, track_inventory: true, stock_quantity: 9,
      description: "A fixture for the retired-item check.", tax_rate: 0,
    },
  });
  expect(made.ok(), `the fixture could not be carded (${made.status()} ${await made.text()})`).toBeTruthy();
}

test("a product switched off is on no screen that sells, and still in the catalogue", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "one walk is enough: this is about which list a screen reads, not its layout");

  await soap(request, RETIRED, false);
  await soap(request, ON_SALE, true);

  // ── the till ──────────────────────────────────────────────────────
  await page.goto("/tenant/pos");
  const till = page.getByPlaceholder(/scan barcode or search/i).first();
  await expect(till).toBeVisible({ timeout: 30_000 });
  await till.fill("E2E Onsale");
  await expect(page.getByText(ON_SALE).first(), "the till's search finds nothing at all, so finding no retired item proves nothing").toBeVisible({ timeout: 15_000 });
  await till.fill("E2E Retired");
  await expect(page.getByText(/No products match|No matches/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(RETIRED), "a product switched off is offered on the till").toHaveCount(0);

  // ── the New Sale form ─────────────────────────────────────────────
  await page.goto("/tenant/sales/new");
  const sale = page.getByPlaceholder("Search items to add…");
  await sale.fill("E2E Onsale");
  await expect(page.getByText(ON_SALE).first()).toBeVisible({ timeout: 15_000 });
  await sale.fill("E2E Retired");
  await expect(page.getByText(ON_SALE)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(RETIRED), "a product switched off is offered on the New Sale form").toHaveCount(0);

  // ── Take Order ────────────────────────────────────────────────────
  await page.goto("/tenant/orders/new");
  const order = page.getByPlaceholder("Search products…");
  await order.fill("E2E Onsale");
  await expect(page.getByText(ON_SALE).first()).toBeVisible({ timeout: 15_000 });
  await order.fill("E2E Retired");
  await expect(page.getByText(ON_SALE)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(RETIRED), "a product switched off is offered on Take Order").toHaveCount(0);

  // ── and the catalogue still has it: that is where it is switched back on ─
  await page.goto("/tenant/products");
  await page.getByPlaceholder("Search name or SKU…").fill("E2E Retired");
  await expect(page.getByRole("row").filter({ hasText: RETIRED }), "a retired product has vanished from the catalogue too").toBeVisible({ timeout: 15_000 });
});
