import { expect, test, type Page } from "@playwright/test";
import { openTill } from "./till";
import { TAXED, completeAndFetch, openTender, ring, rupees, saleWithLines, shopDefaultRate, stockTaxedShelf, withTax } from "./taxedShelf";

/**
 * A LINE IS ITSELF, AND ONLY ITSELF.
 *
 * ── The report ───────────────────────────────────────────────────────
 *
 *     "jb add to cart rows ati, kisi aik ko discount dy raha — wo aik or
 *      row py b apply ho raha. why?"
 *
 * A discount given to one line of the cart landed on another line as well.
 *
 * ── Why ──────────────────────────────────────────────────────────────
 *
 * Every line has a key, and everything a cashier does to a line — discount,
 * quantity, remove, price level, serial — finds it by that key. The key was a
 * counter: c1, c2, c3. The cart is also kept on the device, so a refresh in
 * the middle of a sale costs a blink and not the trolley. It came back with
 * its keys, c1 and c2 — and the counter came back at nought. The next item
 * rung was c1 again. Two lines, one key: whatever was done to either was done
 * to both.
 *
 * It needed a refresh mid-sale to happen, which is why no test had met it and
 * a shop had: a tablet that sleeps, a tab that reloads, an update banner
 * pressed with a customer at the counter.
 */

test.beforeAll(async ({ request }) => {
  await stockTaxedShelf(request);
});

const rows = (page: Page) => page.locator("[data-cart-row]");
const row = (page: Page, name: string) => rows(page).filter({ hasText: name }).first();

/** Two lines, a refresh, and a third — the cart every case here starts from. */
async function midSaleRefresh(page: Page): Promise<void> {
  await openTill(page);
  await ring(page, [TAXED.A.name, TAXED.B.name]);

  await page.reload();
  // The cart came back, and says so.
  await expect(rows(page)).toHaveCount(2, { timeout: 30_000 });

  await ring(page, [TAXED.C.name], 2);
}

/** Open a line's own sheet and check it IS that line's. */
async function edit(page: Page, name: string) {
  await row(page, name).getByText(name).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name, exact: true }) });
  // With two lines on one key, pressing the newer one opened the older one.
  await expect(sheet, `pressing ${name} opened another line's sheet`).toBeVisible();

  return sheet;
}

test("a discount on one line is that line's alone, after a refresh mid-sale", async ({ page, request }) => {
  await midSaleRefresh(page);

  const sheet = await edit(page, TAXED.C.name);
  await sheet.getByRole("spinbutton").fill("100");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();

  const due = await openTender(page, "Card");
  // A 4,956 and B 6,941 untouched; C 2,100 − 100 = 2,000 at the shop's rate.
  expect(due).toBe(4956 + 6941 + withTax(2000, await shopDefaultRate(request)));

  const sale = await saleWithLines(request, (await completeAndFetch(page, request)).id);
  const discountOn = (name: string) => Number(sale.items.find((i) => i.product_name === name)?.line_discount ?? NaN);

  expect(discountOn(TAXED.C.name)).toBe(100);
  expect(discountOn(TAXED.A.name), "the discount given to one line landed on another").toBe(0);
  expect(discountOn(TAXED.B.name)).toBe(0);
});

test("changing one line's quantity changes that line alone", async ({ page }) => {
  await midSaleRefresh(page);

  await row(page, TAXED.C.name).getByRole("button", { name: "Increase" }).click();

  const quantity = async (name: string) => Number(await row(page, name).locator("input").first().inputValue());
  expect(await quantity(TAXED.C.name)).toBe(2);
  expect(await quantity(TAXED.A.name), "another line's quantity moved with it").toBe(1);
  expect(await quantity(TAXED.B.name)).toBe(1);
});

test("removing one line removes that line alone", async ({ page }) => {
  await midSaleRefresh(page);

  await row(page, TAXED.C.name).getByRole("button", { name: /remove/i }).click();

  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, TAXED.A.name), "removing one line took another with it").toBeVisible();
  await expect(row(page, TAXED.B.name)).toBeVisible();

  // And the bill is the two that are left.
  const total = rupees(await page.locator("text=Grand Total").locator("..").innerText());
  expect(total).toBe(4956 + 6941);
});
