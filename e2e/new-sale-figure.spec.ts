import { expect, test } from "@playwright/test";

import { roomToWork, ownerAuth } from "./api";
import { TAXED, list, rupees, shopDefaultRate, stockTaxedShelf, withTax } from "./taxedShelf";

/**
 * THE HAND-WRITTEN SALE SAYS WHAT IT WILL TAKE.
 *
 * ── What it did ──────────────────────────────────────────────────────
 *
 *     "Complete Sale · Rs 4,200" — pressed — "Amount paid (4,200.00) is less
 *      than the total (4,956.00)."
 *
 * New sale ("an invoice, written by hand") multiplied price by quantity and
 * called it the total: no tax in it. An item with tax on it could not be sold
 * there for the figure on its own button, and the change it showed was wrong
 * by the tax.
 *
 * This writes that invoice the way a person does — and pays EXACTLY what the
 * screen says, with the screen's own button. A test that pays more than the
 * bill proves nothing about the bill.
 */

test.beforeAll(async ({ request }) => {
  await stockTaxedShelf(request);
});

test.beforeEach(async ({ request }) => {
  await roomToWork(request, ownerAuth(), 130, "/auth/me");
});

test("a taxed item is shown with its tax, and paying exactly the figure on the button completes the sale", async ({ page, request }) => {
  await page.goto("/tenant/sales/new");

  const search = page.getByPlaceholder(/search/i).first();
  await search.fill(TAXED.A.name);
  await page.getByRole("button", { name: new RegExp(TAXED.A.name) }).first().click();
  await search.fill(TAXED.C.name);
  await page.getByRole("button", { name: new RegExp(TAXED.C.name) }).first().click();

  // A at its own group's rate, C at the shop's — two rates on one bill, which
  // is what a single multiplication cannot get right.
  const rate = await shopDefaultRate(request);
  const bill = withTax(TAXED.A.price, 18) + withTax(TAXED.C.price, rate);
  const total = page.getByTestId("sale-total");
  await expect(total, "the total has no tax in it").toHaveText(new RegExp(`${bill.toLocaleString("en-US")}(\\.00)?$`), { timeout: 15_000 });
  await expect(page.getByTestId("sale-tax")).toBeVisible();

  const complete = page.getByRole("button", { name: /^Complete Sale/ });
  // The button says the same figure, and will not be pressed for less.
  expect(rupees(await complete.innerText()), "the button and the total disagree").toBe(bill);
  await page.getByLabel("Amount paid").fill(String(bill - 1));
  await expect(complete, "a rupee short was accepted").toBeDisabled();

  // Exactly it, by the screen's own button.
  await page.getByRole("button", { name: "Exact", exact: true }).click();
  await expect(page.getByLabel("Amount paid")).toHaveValue(String(bill));
  await expect(complete).toBeEnabled();
  await complete.click();
  await expect(page, "the sale was refused").toHaveURL(/\/tenant\/sales\/?$/, { timeout: 20_000 });

  const [newest] = await list(request, "/sales?per_page=5");
  expect(Number(newest.total), "the sale rung is not for the figure the screen showed").toBe(bill);
  expect(Number(newest.change_due), "paying the figure on the button left change").toBe(0);
});

test("money handed over above the bill comes back as change, counted from the real bill", async ({ page }) => {
  await page.goto("/tenant/sales/new");
  const search = page.getByPlaceholder(/search/i).first();
  await search.fill(TAXED.A.name);
  await page.getByRole("button", { name: new RegExp(TAXED.A.name) }).first().click();

  const bill = withTax(TAXED.A.price, 18);
  await expect(page.getByTestId("sale-total")).toHaveText(new RegExp(`${bill.toLocaleString("en-US")}(\\.00)?$`), { timeout: 15_000 });

  // 5,000 for a 4,956 bill is 44 back — it used to say 800, the tax having been left out of the bill.
  await page.getByLabel("Amount paid").fill("5000");
  expect(rupees(await page.getByTestId("sale-change").innerText())).toBe(5000 - bill);
});
