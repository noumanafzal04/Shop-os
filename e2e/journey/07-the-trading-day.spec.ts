import { OWNER_STATE, ask, expect, record, remember, session, test } from "./kit";
import { COUPON, customer, item } from "./shop";
import { attach, complete, discount, grandTotal, openTill, quantity, ring, tender, tenderSheet } from "./till";

/**
 * STAGE C — A TRADING DAY.
 *
 * Ten sales, each one a different thing a counter does, every one paid at the
 * EXACT figure the till showed. The expected figures are worked out by hand
 * in the comments and written as numbers — not computed by the same rule the
 * till uses, which would only prove the rule agrees with itself.
 *
 * The shop: default tax 5%, tax added on top, no coin rounding.
 *   oil     2,850   GST 18%
 *   rice    1,950   shop default 5%   trade 1,800   10+ at 1,900
 *   sugar     160/kg  own rate 0%
 *   tea     1,299 (sale price)  Reduced 10%
 *   soap      120   5%   — 20% off by promotion
 *   delivery  150   5%   (a service)
 */

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

/**
 * Written down the moment it is rung, not at the end of the file: a day that
 * stops at its ninth sale has still made nine, and the stage after this one
 * has to find every one of them in the ledger.
 */
const keep = (name: string, sale: Record<string, unknown>) => {
  const day = (record().day as Array<Record<string, unknown>> | undefined) ?? [];
  if (day.some((d) => d.invoice === sale.invoice_number)) return;
  remember({
    day: [...day, { case: name, invoice: String(sale.invoice_number), total: Number(sale.total), method: String(sale.payment_method) }],
  });
};

test("C1 · a shift is opened with a float of Rs 5,000", async ({ page, request }) => {
  await openTill(page);

  const already = await ask<unknown>(request, "owner", "/pos/session");
  if (!already) {
    await page.getByRole("button", { name: "Open shift" }).first().click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Open shift" }) });
    await sheet.getByRole("spinbutton").first().fill("5000");
    await sheet.getByRole("button", { name: "Open", exact: true }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
  }

  await expect(page.getByText(/Shift open · float Rs 5,000/).first()).toBeVisible({ timeout: 15_000 });
  const report = await ask<{ drawer: { expected_cash: number } }>(request, "owner", "/pos/session/report");
  expect(report.drawer.expected_cash).toBeGreaterThanOrEqual(5000);
});

test("C2 · cash: oil and tea, two tax groups on one bill, change given", async ({ page, request }) => {
  await openTill(page);
  await ring(page, item("oil").name);
  await ring(page, item("tea").name);

  // 2,850 + 1,299 = 4,149.  Tax 513.00 + 129.90 = 642.90.  Bill 4,791.90.
  expect(await grandTotal(page)).toBe(4791.9);
  expect(await tender(page, "Cash")).toBe(4791.9);
  await page.getByPlaceholder("Cash tendered").fill("5000");
  await expect(tenderSheet(page).getByText(/Change due/i).locator("..")).toContainText("208.10");

  const sale = await complete(page, request);
  expect(Number(sale.subtotal)).toBe(4149);
  expect(Number(sale.tax)).toBe(642.9);
  expect(Number(sale.total)).toBe(4791.9);
  expect(Number(sale.change_due)).toBe(208.1);
  expect(sale.payment_method).toBe("cash");
  keep("C2", sale);
});

test("C2 · card: two bags of rice at the shop's default tax", async ({ page, request }) => {
  await openTill(page);
  await ring(page, item("rice").name);
  await quantity(page, item("rice").name, 2);

  // 2 × 1,950 = 3,900.  5% = 195.  Bill 4,095.
  expect(await tender(page, "Card")).toBe(4095);
  const sale = await complete(page, request);
  expect(Number(sale.tax)).toBe(195);
  expect(Number(sale.total)).toBe(4095);
  expect(sale.payment_method).toBe("card");
  keep("C2", sale);
});

test("C2 · wallet: two and a half kilos of sugar, weighed, tax-exempt", async ({ page, request }) => {
  await openTill(page);
  await ring(page, item("sugar").name);
  await quantity(page, item("sugar").name, 2.5);

  // 2.5 × 160 = 400.  Its own rate is 0 — exempt, NOT the shop's 5%.
  expect(await tender(page, "Wallet")).toBe(400);
  const sale = await complete(page, request);
  expect(Number(sale.tax), "an exempt item was taxed at the shop default").toBe(0);
  expect(Number(sale.total)).toBe(400);
  expect(Number(sale.items[0].quantity)).toBe(2.5);
  expect(sale.payment_method).toBe("wallet");
  keep("C2", sale);
});

test("C3 · a member's ten percent comes off before the tax", async ({ page, request }) => {
  const sara = customer("member");
  await openTill(page);
  await ring(page, item("oil").name);
  await attach(page, sara.phone, "QA Members");

  // 2,850 − 285 = 2,565.  18% = 461.70.  Bill 3,026.70.
  expect(await tender(page, "Card")).toBe(3026.7);
  const sale = await complete(page, request);
  expect(Number(sale.discount)).toBe(285);
  expect(Number(sale.tax)).toBe(461.7);
  expect(Number(sale.total)).toBe(3026.7);
  expect(sale.customer_phone).toBe(sara.phone);
  keep("C3", sale);
});

test("C3 · a trade customer buys ten bags at the trade price, on khata", async ({ page, request }) => {
  const bilal = customer("trader");
  await openTill(page);
  await ring(page, item("rice").name);
  await quantity(page, item("rice").name, 10);
  await attach(page, bilal.phone, "QA Trade");

  // Trade 1,800 beats the 10+ break of 1,900.  10 × 1,800 = 18,000.  5% = 900.  Bill 18,900.
  expect(await tender(page, "Khata")).toBe(18900);
  const sale = await complete(page, request);
  expect(Number(sale.items[0].unit_price), "the trade price was not charged").toBe(1800);
  expect(Number(sale.total)).toBe(18900);
  expect(sale.payment_method).toBe("credit");
  keep("C3", sale);

  // …and he now OWES it.
  const book = await ask<{ credit_balance: number }>(request, "owner", `/customers-lookup?phone=${bilal.phone}`);
  expect(book.credit_balance, "the khata did not take the sale").toBe(18900);
});

test("C3 · the promotion takes twenty percent off soap, and says so on the cart", async ({ page, request }) => {
  await openTill(page);
  await ring(page, item("soap").name);
  await quantity(page, item("soap").name, 5);

  await expect(page.getByTitle(/QA Soap 20 off/).first(), "the promotion is not shown on the cart").toBeVisible({ timeout: 15_000 });

  // 5 × 120 = 600.  20% = 120.  480 + 5% (24) = 504.
  expect(await tender(page, "Cash")).toBe(504);
  await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
  const sale = await complete(page, request);
  expect(Number(sale.promo_discount)).toBe(120);
  expect(Number(sale.tax)).toBe(24);
  expect(Number(sale.total)).toBe(504);
  keep("C3", sale);
});

test("C3 · a coupon is spent, and stops at its cap", async ({ page, request }) => {
  await openTill(page);
  await ring(page, item("tea").name);
  await quantity(page, item("tea").name, 2);
  await discount(page, { coupon: COUPON.code });

  // 2 × 1,299 = 2,598.  10% is 259.80 — capped at 200.  2,398 + 10% (239.80) = 2,637.80.
  expect(await tender(page, "Card")).toBe(2637.8);
  const sale = await complete(page, request);
  expect(Number(sale.discount), "the coupon's cap did not hold").toBe(200);
  expect(sale.coupon_code).toBe(COUPON.code);
  expect(Number(sale.total)).toBe(2637.8);
  keep("C3", sale);
});

test("C2 · split: part in notes, the rest on a card", async ({ page, request }) => {
  await openTill(page);
  await ring(page, item("oil").name);
  await quantity(page, item("oil").name, 2);

  // 2 × 2,850 = 5,700.  18% = 1,026.  Bill 6,726.
  expect(await tender(page, "Split")).toBe(6726);
  const sheet = tenderSheet(page);
  const amounts = sheet.getByPlaceholder("Amount");
  await amounts.first().fill("2000");
  await expect(sheet.getByText(/^Remaining/)).toContainText("4,726");
  await sheet.getByRole("button", { name: /Add tender/ }).click();
  await sheet.getByRole("combobox").nth(1).selectOption({ label: "Card" });
  await amounts.nth(1).fill("4726");

  const sale = await complete(page, request);
  expect(Number(sale.total)).toBe(6726);
  expect(Number(sale.amount_paid)).toBe(6726);
  expect(Number(sale.change_due ?? 0)).toBe(0);
  keep("C2", sale);
});

test("C3 · a keyed discount on goods and a service together", async ({ page, request }) => {
  await openTill(page);
  await ring(page, item("rice").name);
  await ring(page, item("delivery").name);
  await discount(page, { amount: 100 });

  // 1,950 + 150 = 2,100.  Less 100 = 2,000.  Both lines are 5%: 100.  Bill 2,100.
  expect(await tender(page, "Cash")).toBe(2100);
  await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
  const sale = await complete(page, request);
  expect(Number(sale.discount)).toBe(100);
  expect(Number(sale.tax)).toBe(100);
  expect(Number(sale.total)).toBe(2100);
  keep("C3", sale);
});

test("C4 · a ticket is held, comes back the same, and is paid", async ({ page, request }) => {
  await openTill(page);
  await ring(page, item("soap").name);
  await quantity(page, item("soap").name, 2);
  await ring(page, item("sugar").name);

  // Soap 240 + sugar 160 = 400.  Promotion 48 off.  352.  Tax is on each line's
  // SHARE of what is left: soap 240 × 352/400 = 211.20 at 5% = 10.56; sugar 0.
  const before = await grandTotal(page);
  expect(before).toBe(362.56);

  // The bottom bar's Hold — "Hold F4". The legend's chip reads "F4 Hold".
  await page.getByRole("button", { name: /^Hold\b/ }).click();
  await page.getByPlaceholder(/Customer name, or/).fill("QA held ticket");
  await page.getByRole("button", { name: "Hold ticket" }).click();
  await expect(page.locator("[data-cart-row]")).toHaveCount(0, { timeout: 15_000 });

  await page.getByRole("button", { name: /Drafts/ }).first().click();
  await page.getByRole("button", { name: "Resume" }).last().click();
  await expect(page.locator("[data-cart-row]")).toHaveCount(2, { timeout: 15_000 });
  expect(await grandTotal(page), "the bill changed by being parked").toBe(before);

  expect(await tender(page, "Card")).toBe(362.56);
  const sale = await complete(page, request);
  expect(Number(sale.total)).toBe(362.56);
  keep("C4", sale);
});
