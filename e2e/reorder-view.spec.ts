import { expect, test } from "@playwright/test";

import { API, ownerAuth } from "./api";

/**
 * THE REORDER VIEW, WITH SOMETHING ACTUALLY ON IT.
 *
 * The screen draws a sub-row per size — `p.variants.map(...)`, unguarded. The
 * low-stock endpoint loaded `category` and nothing else, so `variants` was
 * absent from the payload and that map ran on `undefined`: the page threw and
 * went blank the moment the list had a sized row to draw.
 *
 * It had only ever been seen EMPTY. A shop reported "reordering shows empty"
 * and the empty state was the thing that saved them — the instant they set a
 * reorder level on anything sold in sizes, the screen would have gone white.
 *
 * TypeScript could not catch it (`variants: ProductVariant[]` is not optional
 * on the type, and a relation nobody loaded is missing at runtime anyway), and
 * neither could `chrome.spec`, which walks /tenant/inventory with no filter and
 * against a shop whose reorder list is empty.
 *
 * So this spec puts a low SIZED product in front of the screen, which is the
 * only arrangement that has ever shown the fault.
 */

/** Stable and reused — a fixture per run breeds strays that starve siblings. */
const ITEM = "E2E Low Sized Item";

test("the reorder view draws a sized row instead of going blank", async ({ page, request }) => {
  const auth = ownerAuth();

  const existing = await request.get(`${API}/products?search=${encodeURIComponent(ITEM)}`, { headers: auth });
  const found = existing.ok() ? ((await existing.json()).data ?? []) : [];

  if (found.length === 0) {
    const made = await request.post(`${API}/products`, {
      headers: auth,
      data: {
        name: ITEM,
        type: "product",
        item_type: "physical_product",
        price: 1200,
        track_inventory: true,
        // Low on purpose: two left against a level of twenty, so the shop is
        // told to reorder it and the row has sizes to draw.
        low_stock_threshold: 20,
        variants: [
          { name: "E2E Small", price: 1200, stock_quantity: 1 },
          { name: "E2E Large", price: 1400, stock_quantity: 1 },
        ],
      },
    });
    expect(made.ok(), `could not create the fixture: ${made.status()} ${await made.text()}`).toBeTruthy();
  }

  // THE DENOMINATOR. If the server does not consider this item low, the screen
  // below has nothing to draw and every assertion after it is about an empty
  // table — the exact blindness this spec exists to end.
  const low = await request.get(`${API}/inventory/low-stock`, { headers: auth });
  expect(low.ok()).toBeTruthy();
  const rows = (await low.json()).data as Array<{ name: string; variants?: unknown[] }>;
  const mine = rows.find((r) => r.name === ITEM);
  expect(mine, "the fixture is not on the reorder list, so the screen has nothing to draw").toBeTruthy();
  expect(Array.isArray(mine?.variants), "the list sent no sizes, and the screen maps over them").toBeTruthy();

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/tenant/inventory?filter=low");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(900);

  // The row, and its sizes beneath it.
  await expect(page.getByText(ITEM).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("E2E Large").first()).toBeVisible();

  // And nothing threw on the way. A blank page with a clean-looking DOM is how
  // this failed: the table simply was not there.
  expect(errors, `the reorder view threw: ${errors.join(" | ")}`).toEqual([]);
});
