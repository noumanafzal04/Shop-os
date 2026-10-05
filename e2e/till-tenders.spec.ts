import { expect, test } from "@playwright/test";
import { openTill } from "./till";
import { TAXED, completeAndFetch, openTender, ring, rupees, shopDefaultRate, stockTaxedShelf, withTax } from "./taxedShelf";

/**
 * EVERY WAY MONEY CROSSES THE COUNTER, rung in a browser against the server.
 *
 * *"u did not properly test pos screen in detailed."* The till had been
 * tested in detail for LAYOUT — it has a suite about tiles, chips, overlays
 * and breakpoints. It had one test about money, and that one could not fail:
 * a cash sale of untaxed goods, where over-tendering is ordinary and there is
 * no tax to be short by.
 *
 * So this file asks the question the other one could not, for each tender and
 * each thing a cashier does to a bill before taking payment:
 *
 *     is the figure on the screen the figure the server charges?
 *
 * Every case rings TAXED goods and, wherever the tender allows it, pays the
 * EXACT amount shown — because an exact tender is the only one with no change
 * to hide a difference in. `completeAndFetch` fails the case if the server
 * had to correct the till, even when the sale then went through.
 *
 * The expected figures are worked out in the comments so a failure can be
 * checked by hand: A is Rs 4,200 at 18%, B is Rs 6,310 at 10%, C is Rs 2,100
 * at the shop default.
 */

test.beforeAll(async ({ request }) => {
  await stockTaxedShelf(request);
});

test("a wallet takes the exact bill", async ({ page, request }) => {
  await openTill(page);
  await ring(page, [TAXED.A.name]);

  const due = await openTender(page, "Wallet");
  const sale = await completeAndFetch(page, request);

  // 4,200 at 18% → 756 of tax. The figure is stated, not only compared: a
  // till and a server can agree with each other about the wrong bill.
  expect(due).toBe(4956);
  expect(Number(sale.total)).toBe(due);
  expect(Number(sale.tax)).toBe(756);
  expect(sale.payment_method).toBe("wallet");
  // A wallet is not cash: nothing comes back across the counter.
  expect(Number(sale.change_due ?? 0)).toBe(0);
});

test("cash to the rupee leaves no change", async ({ page, request }) => {
  await openTill(page);
  await ring(page, [TAXED.A.name, TAXED.B.name]);

  const due = await openTender(page, "Cash");

  // The one quick button that is exactly right says so — it used to compare
  // itself to the unrounded bill and lose the word.
  const exact = page.getByRole("button", { name: /^Exact ·/ });
  await expect(exact).toBeVisible();
  await exact.click();

  const sale = await completeAndFetch(page, request);

  // 4,956 + 6,941.
  expect(due).toBe(11897);
  expect(Number(sale.total)).toBe(due);
  expect(Number(sale.amount_paid)).toBe(due);
  expect(Number(sale.change_due ?? 0)).toBe(0);
  expect(Number(sale.tax)).toBe(1387);
});

test("cash over the bill hands back the difference, and says how much", async ({ page, request }) => {
  await openTill(page);
  await ring(page, [TAXED.B.name]);

  const due = await openTender(page, "Cash");
  // 6,310 at 10%.
  expect(due).toBe(6941);
  const handed = due + 500;

  await page.getByPlaceholder("Cash tendered").fill(String(handed));

  // The cashier reads the change off the screen before the drawer opens. It
  // has to be the server's change, or the drawer is out by the difference.
  await expect(page.getByText(/Change due/i).locator("..")).toContainText("500");

  const sale = await completeAndFetch(page, request);

  expect(Number(sale.amount_paid)).toBe(handed);
  expect(Number(sale.change_due)).toBe(500);
});

test("a discount on the bill comes off before the tax, on screen and on the server", async ({ page, request }) => {
  await openTill(page);
  await ring(page, [TAXED.A.name]);

  await page.getByRole("button", { name: /discount/i }).first().click();

  // INSIDE the dialog. The page's first number box is the cart line's
  // QUANTITY, and a test that typed 200 there sold two hundred of the item
  // and still agreed with the server — about a different bill.
  const sheet = page.getByRole("dialog").filter({ hasText: "Discount & coupon" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("spinbutton").fill("200");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();

  const due = await openTender(page, "Card");
  const sale = await completeAndFetch(page, request);

  // 4,200 − 200 = 4,000, taxed at 18% → 4,720. Tax on the DISCOUNTED base:
  // taxing the full 4,200 would make it 4,756 and the till short by 36.
  expect(due).toBe(4720);
  expect(Number(sale.total)).toBe(due);
  expect(Number(sale.discount)).toBe(200);
  expect(Number(sale.tax)).toBe(720);
});

test("three of an item is three times the tax", async ({ page, request }) => {
  await openTill(page);
  await ring(page, [TAXED.B.name]);

  const more = page.getByRole("button", { name: "Increase" }).first();
  await more.click();
  await more.click();

  const due = await openTender(page, "Card");
  const sale = await completeAndFetch(page, request);

  // 3 × 6,310 = 18,930 at 10% → 20,823.
  expect(due).toBe(20823);
  expect(Number(sale.total)).toBe(due);
});

test("a bill split across cash and card adds up to the bill", async ({ page, request }) => {
  await openTill(page);
  await ring(page, [TAXED.A.name, TAXED.C.name]);

  const due = await openTender(page, "Split");

  // A at its group's 18%, C at whatever the shop's default is today.
  expect(due).toBe(4956 + withTax(TAXED.C.price, await shopDefaultRate(request)));

  const amounts = page.getByPlaceholder("Amount");
  await amounts.first().fill("1000");

  // Until the parts cover the bill the screen says what is still owed — and
  // the figure is the bill's, tax included.
  await expect(page.getByText(/^Remaining/)).toContainText((due - 1000).toLocaleString("en-PK"));

  await page.getByRole("button", { name: /Add tender/ }).click();
  await amounts.nth(1).fill(String(due - 1000));

  const sale = await completeAndFetch(page, request);

  expect(Number(sale.total)).toBe(due);
  expect(Number(sale.amount_paid)).toBe(due);
  expect(Number(sale.change_due ?? 0)).toBe(0);
});

test("a parked ticket comes back knowing what it will be taxed at", async ({ page, request }) => {
  /**
   * The fifth door into the cart. A held ticket is stored as its lines, and
   * a line restored without its tax fields is a line taxed at the shop
   * default — so parking a sale and resuming it used to change the bill.
   */
  await openTill(page);
  await ring(page, [TAXED.A.name, TAXED.B.name]);

  const before = rupees(await page.locator("text=Grand Total").locator("..").innerText());

  // By its NAME, not its tooltip: the tooltip now names the keys ("Hold · F4
  // or Alt+H"), and a test hanging off a title broke the day it was reworded.
  await page.getByRole("button", { name: /^Hold\b/ }).click();
  const label = "E2E tax ticket";
  await page.getByPlaceholder(/Customer name, or/).fill(label);
  await page.getByRole("button", { name: "Hold ticket" }).click();

  // Parked: the cart is empty and the ticket is in the drafts.
  await expect(page.locator("[data-cart-row]")).toHaveCount(0, { timeout: 15_000 });

  await page.getByRole("button", { name: /Drafts/ }).first().click();
  const ticket = page.locator("li, tr, div").filter({ hasText: label }).filter({ has: page.getByRole("button", { name: "Resume" }) }).last();
  await ticket.getByRole("button", { name: "Resume" }).click();

  await expect(page.locator("[data-cart-row]")).toHaveCount(2, { timeout: 15_000 });

  // The SAME bill it was parked at.
  const after = rupees(await page.locator("text=Grand Total").locator("..").innerText());
  expect(after, "the bill changed by being parked and resumed").toBe(before);

  const due = await openTender(page, "Card");
  const sale = await completeAndFetch(page, request);

  // 4,200 + 756, 6,310 + 631.
  expect(due).toBe(11897);
  expect(Number(sale.total)).toBe(due);
});
