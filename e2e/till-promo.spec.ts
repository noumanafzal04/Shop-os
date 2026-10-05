import { expect, test } from "@playwright/test";
import { openTill } from "./till";
import { PROMO_ITEM, completeAndFetch, openTender, ring, stockPromotion, stockTaxedShelf } from "./taxedShelf";

/**
 * AN AUTOMATIC PROMOTION, on a cart that is not at shelf price.
 *
 * The till shows a promotion by asking the server to preview one, and the
 * preview priced the cart itself: shelf price × quantity. The sale gives the
 * promotion on each line's REAL total. For a plain line those agree, which is
 * why nothing looked wrong. At a quantity break they do not:
 *
 *     3 × 1,000 on the shelf, 3 × 900 at the break
 *     the sale     ten percent of 2,700 =  270
 *     the preview  ten percent of 3,000 =  300
 *
 * So the screen was Rs 35.40 short of the bill, on a card — the reported
 * failure, by a different road. The promotion is scoped to this one product
 * so it moves nobody else's figures.
 */

test.beforeAll(async ({ request }) => {
  await stockTaxedShelf(request);
  await stockPromotion(request);
});

test("a promotion at a quantity break is the promotion the sale gives", async ({ page, request }) => {
  await openTill(page);
  await ring(page, [PROMO_ITEM.name]);

  const more = page.getByRole("button", { name: "Increase" }).first();
  await more.click();
  await more.click();

  // The promotion is on the cart before anything is tendered. Found by its
  // title, not its text: on a phone the pill keeps the amount and drops the
  // name, and the amount is the half a cashier needs.
  await expect(page.getByTitle(new RegExp(PROMO_ITEM.promotion)).first()).toBeVisible({ timeout: 15_000 });

  const due = await openTender(page, "Card");
  const sale = await completeAndFetch(page, request);

  // 2,700 less 270 = 2,430, taxed at 18% → 2,867.40.
  // The old preview made it 2,700 less 300 → 2,832: short by 35.40.
  expect(due).toBe(2867.4);
  expect(Number(sale.total)).toBe(due);
  expect(Number(sale.promo_discount)).toBe(270);
  expect(Number(sale.change_due ?? 0)).toBe(0);
});

test("below the break the same promotion is ten percent of the shelf price", async ({ page, request }) => {
  // The control: the case that always agreed.
  await openTill(page);
  await ring(page, [PROMO_ITEM.name]);

  await expect(page.getByTitle(new RegExp(PROMO_ITEM.promotion)).first()).toBeVisible({ timeout: 15_000 });

  const due = await openTender(page, "Card");
  const sale = await completeAndFetch(page, request);

  // 1,000 less 100 = 900, taxed at 18%.
  expect(due).toBe(1062);
  expect(Number(sale.promo_discount)).toBe(100);
});
