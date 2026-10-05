import { expect, test, type APIRequestContext } from "@playwright/test";
import { openTill } from "./till";
import { TAXED, list, openTender, ring, rupees, stockTaxedShelf, type Row } from "./taxedShelf";

/**
 * THE TILL CHARGES WHAT IT SHOWED — rung in a browser, against the server.
 *
 * ── The report ───────────────────────────────────────────────────────
 *
 *     Amount due   Rs 12,610
 *     Sale failed  Amount paid (12,610.00) is less than the total (14,023.94).
 *
 * *"u did not properly test pos screen in detailed."* That is fair, and this
 * file is the specific thing that was missing.
 *
 * ── Why the suite that existed could not see it ──────────────────────
 *
 * `selling.spec` rings a sale on this same till. It rings it in CASH, where
 * handing over more than the bill is ordinary, from a shelf whose every
 * product is created with `tax_rate: 0`. A sale with no tax on it cannot be
 * short by the tax, and a cash tender forgives a shortfall anyway.
 *
 * So the one browser test of the counter was structurally unable to notice
 * that the counter and the server disagreed about tax. This one is the
 * opposite on both axes: products on a TAX GROUP, paid by CARD — an exact
 * tender, with no change to absorb a single paisa.
 *
 * ── The fixture is named, and it does not breed ──────────────────────
 *
 * Fixed names, found and reused. A fixture that mints a new product on every
 * run is twenty stray products by the end of the week, and the spec after
 * this one fills its cart from them.
 */

test.beforeAll(async ({ request }) => {
  await stockTaxedShelf(request);
});

const ITEMS = Object.values(TAXED);

async function saleByInvoice(request: APIRequestContext, invoice: string): Promise<Row> {
  const sale = (await list(request, "/sales?per_page=20")).find((r) => r.invoice_number === invoice);
  expect(sale, `the till said ${invoice} but the server has no such sale`).toBeTruthy();

  return sale!;
}

test("a card sale of items on a tax group is charged exactly what the till showed", async ({ page, request }) => {
  await openTill(page);
  await ring(page, ITEMS.map((i) => i.name));

  const due = await openTender(page, "Card");

  // The bill was NOT corrected by the server. If this alert is up, the sale
  // below may still complete — through the safety net — and the test would
  // pass while the till's own arithmetic was wrong. That is the other spec's
  // subject; here the till has to be right first time.
  await expect(page.getByTestId("tender-corrected"), "the till's own figure was wrong and had to be corrected").toHaveCount(0);

  await page.getByRole("button", { name: /^Complete sale/ }).click();

  // The reported failure, exactly: this heading never arrived, "Sale failed"
  // did, and the amount in the refusal was higher than the amount on screen.
  await expect(page.getByRole("heading", { name: "Sale complete" }), "the server refused the sale").toBeVisible({ timeout: 20_000 });

  const invoice = await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice");
  const sale = await saleByInvoice(request, String(invoice));

  // To the paisa. A card tender has no change: one paisa under is a refusal
  // and one over is a wrong charge.
  expect(Number(sale.total), "the server charged a different total than the till showed").toBe(due);

  // THE DENOMINATOR. Without tax on the sale this whole test proves nothing
  // about tax — it would pass on a shelf of untaxed goods, which is exactly
  // how the suite that existed stayed green.
  expect(Number(sale.tax), "the sale carried no tax, so this run proved nothing about it").toBeGreaterThan(0);
  expect(sale.payment_method).toBe("card");
});

test("when the till IS wrong, the cashier is shown the real bill and can still finish", async ({ page, request }) => {
  /**
   * The till prices a cart itself. That is a mirror of the server, and a
   * mirror can be wrong — it was, by the tax, and the cashier was left with
   * "Sale failed" beside a button that would be refused every time.
   *
   * This reproduces the old payload rather than inventing a failure: the
   * products list is intercepted and `tax_group_rate` is taken out of it, so
   * the page prices the cart exactly as it used to. Everything after that is
   * the REAL server — it refuses, it says what the bill is, and it accepts
   * the corrected tender.
   */
  await page.route("**/api/v1/products?*", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data?: Row[] };

    for (const product of body.data ?? []) delete product.tax_group_rate;

    await route.fulfill({ response, json: body });
  });

  await openTill(page);
  await ring(page, [ITEMS[0].name]);

  const wrong = await openTender(page, "Card");

  await page.getByRole("button", { name: /^Complete sale/ }).click();

  // Not "Sale failed". Nothing failed: the bill was corrected, and the screen
  // says so, with both figures, and that no money has moved.
  const corrected = page.getByTestId("tender-corrected");
  await expect(corrected).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Sale failed")).toHaveCount(0);

  const right = rupees(await page.getByTestId("tender-amount-due").innerText());

  // The amount due MOVED, and upward — the till was short, which is the only
  // direction this refusal exists for.
  expect(right, "the amount due did not change after the server corrected it").toBeGreaterThan(wrong);
  await expect(corrected).toContainText(right.toLocaleString("en-PK"));

  // Nothing was sold by the refused attempt. A recovery that had quietly
  // rung the sale at the higher price would also "work".
  await expect(page.getByRole("heading", { name: "Sale complete" })).toHaveCount(0);

  // The cashier presses again, having seen the new figure — and that is all
  // it takes. This is the line the old screen could never reach.
  await page.getByRole("button", { name: /^Complete sale/ }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible({ timeout: 20_000 });

  const invoice = await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice");
  const sale = await saleByInvoice(request, String(invoice));

  expect(Number(sale.total)).toBe(right);
});

test("changing the cart drops a corrected figure rather than carrying it", async ({ page }) => {
  await page.route("**/api/v1/products?*", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data?: Row[] };
    for (const product of body.data ?? []) delete product.tax_group_rate;
    await route.fulfill({ response, json: body });
  });

  await openTill(page);
  await ring(page, [ITEMS[0].name]);

  await openTender(page, "Card");
  await page.getByRole("button", { name: /^Complete sale/ }).click();
  await expect(page.getByTestId("tender-corrected")).toBeVisible({ timeout: 20_000 });

  // The server's figure is true of the cart it was given for. Switching the
  // tender is a different bill — cash rounds, card does not — so the
  // correction has to go, or the screen is showing the server's name on a
  // number the server never gave.
  await page.getByRole("group", { name: "Payment method" }).getByRole("button", { name: /^Wallet/ }).click();

  await expect(page.getByTestId("tender-corrected")).toHaveCount(0);
});
