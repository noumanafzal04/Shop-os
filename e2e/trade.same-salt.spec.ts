import { test, expect, type APIRequestContext } from "@playwright/test";

import { API, tradeAuth } from "./api";

/**
 * THE BRAND IS OUT — WHAT ELSE HAS THE SAME SALT?
 *
 * The till has had the answer since the pharmacy work: a sheet, "Same salt,
 * in stock", opened when an out-of-stock medicine is pressed. And an
 * out-of-stock tile was a DISABLED button. The press never arrived; the only
 * way in was to arrow down to the product and press Enter on a keyboard, so
 * on a tablet — where a chemist's till is — the feature did not exist.
 *
 * Found by the chemist's journey (stage K, case K7), which settles its sale
 * once. This is the same thing somewhere it can be run every time: nothing
 * is sold, so the shelf it stands on never runs down.
 *
 * A chemist's spec. In every other trade's project it stands aside.
 */

/** Fixed names, never stamped: a fixture named for the moment it ran is one more row for ever. */
const OUT = "E2E Salt Brand";
const ALT = "E2E Salt Other";
const SALT = "E2E-Saltamol";

const nextYear = (): string => {
  const d = new Date();

  return `${d.getFullYear() + 1}-01-15`;
};

async function onTheShelf(request: APIRequestContext, name: string, stock: number): Promise<void> {
  const auth = tradeAuth("pharmacy");
  const found = await request.get(`${API}/products?search=${encodeURIComponent(name)}&per_page=10`, { headers: auth });
  if (((await found.json()) as { data: Array<{ name: string }> }).data.some((p) => p.name === name)) return;

  const made = await request.post(`${API}/products`, {
    headers: auth,
    data: {
      item_type: "medicine", name, description: "A fixture for the same-salt sheet.", price: 10, is_active: true,
      generic_name: SALT, strength: "500mg", dosage_form: "Tablet",
      track_inventory: true,
      ...(stock > 0 ? { stock_quantity: stock, opening_batch_number: "E2E-SALT-1", expiry_date: nextYear() } : { stock_quantity: 0 }),
    },
  });
  expect(made.ok(), `could not card ${name}: ${made.status()} ${await made.text()}`).toBeTruthy();
}

test("an out-of-stock medicine can be pressed, and offers what else has its salt", async ({ page, request }, info) => {
  test.skip(info.project.name !== "trade-pharmacy", "a chemist's till — the other trades have no salt to match");

  await onTheShelf(request, OUT, 0);
  await onTheShelf(request, ALT, 25);

  await page.goto("/tenant/pos");
  const search = page.getByPlaceholder(/scan barcode or search/i).first();
  await expect(search).toBeVisible({ timeout: 30_000 });
  // Whatever an earlier run left on the ticket is not this test's.
  // Its name is the word on it; "Empty this ticket" is only its tooltip.
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  if (await reset.isEnabled().catch(() => false)) await reset.click();

  await search.fill(OUT);
  const tile = page.locator("[data-pos-item]").filter({ hasText: OUT }).first();
  await expect(tile).toBeVisible({ timeout: 20_000 });

  // OUT, and it says what a press will do — and it CAN be pressed.
  await expect(tile).toContainText(/same salt/i);
  await expect(tile, "an out-of-stock medicine is a dead button, so nothing can offer its equivalent").toBeEnabled();
  await tile.click();

  // It was not rung. The sheet is.
  const cart = page.locator("[data-cart-row]");
  await expect(cart).toHaveCount(0);
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Same salt, in stock" }) });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet).toContainText(`Instead of ${OUT}`);
  const offer = sheet.getByRole("button").filter({ hasText: ALT });
  await expect(offer).toBeVisible({ timeout: 15_000 });

  await offer.click();
  await expect(cart.filter({ hasText: ALT }), "the equivalent was offered and not put on the bill").toHaveCount(1, { timeout: 15_000 });
  await expect(cart.filter({ hasText: OUT })).toHaveCount(0);

  // The till says what it did, and the search that found the dead brand is done.
  const notice = page.getByText(`Substituted with ${ALT}`).locator("visible=true");
  await expect(notice.first()).toBeVisible();
  await expect(search).toHaveValue("");

  // THE NEXT CUSTOMER. What was said about this bill goes with this bill —
  // it used to sit over an empty cart until somebody pressed the ✕.
  await reset.click();
  await expect(cart).toHaveCount(0);
  await expect(page.getByText(`Substituted with ${ALT}`).locator("visible=true")).toHaveCount(0);
});
