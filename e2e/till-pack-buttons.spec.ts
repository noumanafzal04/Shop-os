import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, ownerAuth, removeProductsNamed, roomToWork } from "./api";
import { openTill } from "./till";

/**
 * A STRIP IN ONE TAP (#POS4).
 *
 * A chemist sells a strip far more often than one tablet. The till's tap rang
 * one tablet, and a strip meant opening the line and changing its "Sale Unit".
 * Now an item in packs carries a button per pack under its row, priced as the
 * line will be — and a pack bigger than what is left is switched off.
 *
 * Measured all the way to the shelf: two strips and a box are 120 tablets.
 */
const ITEM = { name: "E2E Pack Tablets", price: 3, stock: 150 };

async function card(request: APIRequestContext): Promise<string> {
  await removeProductsNamed(request, ITEM.name);
  const made = await request.post(`${API}/products`, {
    headers: ownerAuth(),
    data: {
      item_type: "physical_product", name: ITEM.name, price: ITEM.price, unit: "Tablet", is_active: true,
      description: "A fixture for the pack buttons.", tax_rate: 0, track_inventory: true, stock_quantity: ITEM.stock,
      units: [{ name: "Strip", factor: 10, price: 30 }, { name: "Box", factor: 100, price: 290 }],
    },
  });
  expect(made.ok(), `the fixture could not be carded (${made.status()} ${await made.text()})`).toBeTruthy();

  return String(((await made.json()) as { data: { id: string } }).data.id);
}

async function onTheShelf(request: APIRequestContext, id: string): Promise<number> {
  const res = await request.get(`${API}/products/${id}`, { headers: ownerAuth() });
  expect(res.ok()).toBeTruthy();

  return Number(((await res.json()) as { data: { stock_quantity: number | string } }).data.stock_quantity);
}

test.beforeEach(async ({ request }) => {
  await roomToWork(request, ownerAuth(), 130, "/auth/me");
});

const box = (page: Page) => page.getByPlaceholder(/scan barcode or search/i).first();
const bill = (page: Page) => page.locator("[data-cart-row]");
const pack = (page: Page, label: string) => page.locator(`[data-pos-pack="${label}"]`).first();

async function findIt(page: Page): Promise<void> {
  await box(page).fill(ITEM.name);
  await expect(pack(page, "Strip (10)")).toBeVisible({ timeout: 15_000 });
}

test("two strips and a box from the row's buttons — billed as packs, and 120 tablets off the shelf", async ({ page, request }) => {
  const id = await card(request);
  await openTill(page);
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  if (await reset.isEnabled().catch(() => false)) await reset.click();

  await findIt(page);
  await expect(pack(page, "Tablet")).toHaveText(/\+ Tablet · Rs\s?3\b/);
  await expect(pack(page, "Strip (10)")).toHaveText(/\+ Strip \(10\) · Rs\s?30\b/);
  await expect(pack(page, "Box (100)")).toHaveText(/\+ Box \(100\) · Rs\s?290\b/);

  await pack(page, "Strip (10)").click();
  await findIt(page);
  await pack(page, "Strip (10)").click();
  await findIt(page);
  await pack(page, "Box (100)").click();

  await expect(bill(page).filter({ hasText: "Strip" }), "the strips are not on the bill as a strip line").toHaveCount(1);
  await expect(bill(page).filter({ hasText: "Strip" }).locator("input").first()).toHaveValue("2");
  await expect(bill(page).filter({ hasText: "Box" }), "the box is not on the bill as a box line").toHaveCount(1);

  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  await expect(page.getByRole("heading", { name: "Tender / Pay" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Complete sale/ }), "the bill is not two strips and a box").toContainText(/350/);
  await page.getByRole("button", { name: /^Complete sale/ }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible({ timeout: 20_000 });

  expect(await onTheShelf(request, id), "two strips and a box did not take 120 tablets off the shelf").toBe(ITEM.stock - 120);
});

test("a pack bigger than what is left is switched off, and says why", async ({ page, request }) => {
  const id = await card(request);
  const set = await request.post(`${API}/inventory/adjust`, {
    headers: ownerAuth(),
    data: { product_id: id, type: "set", new_quantity: 30, reason: "e2e: thirty tablets left" },
  });
  expect(set.ok(), `could not set the shelf (${set.status()} ${await set.text()})`).toBeTruthy();

  await openTill(page);
  await findIt(page);
  await expect(pack(page, "Strip (10)")).toBeEnabled();
  await expect(pack(page, "Box (100)"), "a box of 100 was offered with 30 tablets left").toBeDisabled();
  await expect(pack(page, "Box (100)")).toHaveAttribute("title", "Only 30 Tablet left");
});
