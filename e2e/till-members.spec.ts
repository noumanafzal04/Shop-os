import { expect, test } from "@playwright/test";
import { openTill } from "./till";
import {
  MEMBERS, TAXED, TRADE_ITEM, attach, completeAndFetch, list, openTender, ring, stockMembers, stockTaxedShelf,
} from "./taxedShelf";

/**
 * A CUSTOMER AT THE COUNTER, in a browser, against the server.
 *
 * Every money spec before this one rang a walk-in. The sale treats a known
 * customer differently in two ways — their group's percentage comes off, and a
 * trade group prices every line the cashier did not set — and the counter had
 * heard of neither. A member was shown the full retail figure, the cashier
 * read it out, and then:
 *
 *     by card   "No cash was handed over, so there is no change to give."
 *               Refused, with nothing to press that would get past it.
 *     by cash   recorded at a lower figure than the one on the screen.
 *
 * Every case pays the EXACT figure shown, so a till that is wrong in either
 * direction fails — over is no longer forgiven by handing back change.
 */

test.beforeAll(async ({ request }) => {
  await stockTaxedShelf(request);
  await stockMembers(request);
});

test("a member's percentage is on the screen before the card is charged", async ({ page, request }) => {
  await openTill(page);
  await ring(page, [TAXED.A.name]);
  await attach(page, MEMBERS.member);

  const due = await openTender(page, "Card");
  const sale = await completeAndFetch(page, request);

  // 4,200 less 10% = 3,780, taxed at 18% → 4,460.40.
  expect(due).toBe(4460.4);
  expect(Number(sale.total)).toBe(due);
  expect(Number(sale.discount)).toBe(420);
  expect(Number(sale.change_due ?? 0)).toBe(0);
});

test("a member paying cash is given the change the screen said", async ({ page, request }) => {
  await openTill(page);
  await ring(page, [TAXED.A.name]);
  await attach(page, MEMBERS.member);

  const due = await openTender(page, "Cash");
  await page.getByPlaceholder("Cash tendered").fill("5000");
  await expect(page.getByText(/Change due/i).locator("..")).toContainText((5000 - due).toLocaleString("en-PK"));

  const sale = await completeAndFetch(page, request);

  // The bill the cashier read out, not one the server made up afterwards.
  expect(Number(sale.total)).toBe(due);
  expect(Number(sale.change_due)).toBe(Math.round((5000 - due) * 100) / 100);
});

test("a trade customer's lines are rung at the trade price", async ({ page, request }) => {
  await openTill(page);
  await ring(page, [TRADE_ITEM.name]);
  await attach(page, MEMBERS.trade);

  const due = await openTender(page, "Card");
  const sale = await completeAndFetch(page, request);

  // 900 at 18%.
  expect(due).toBe(1062);
  expect(Number(sale.total)).toBe(due);
});

test("a line the cashier put back to retail is charged at retail", async ({ page, request }) => {
  await openTill(page);
  await ring(page, [TRADE_ITEM.name]);
  await attach(page, MEMBERS.trade);

  // The level is chosen on the cart row itself.
  const level = page.locator("[data-cart-row]").first().getByRole("combobox");
  // It FOLLOWS the customer until somebody says otherwise.
  await expect(level).toHaveValue("wholesale");
  await level.selectOption("retail");

  const due = await openTender(page, "Card");
  const sale = await completeAndFetch(page, request);

  // 1,000 at 18%. It used to be sent as "no preference", and the server
  // gave the trade customer the trade price the cashier had just taken away.
  expect(due).toBe(1180);
  expect(Number(sale.total)).toBe(due);
});

test("when the till does not know the group, the cashier is shown the real bill and can finish", async ({ page, request }) => {
  /**
   * The safety net, the other way round from the tax spec's. The lookup is
   * made to say nothing about the group — exactly what the till knew before
   * — so it shows retail. The REAL server then refuses the figure, says what
   * the bill is, and takes it on the second press.
   */
  await page.route("**/api/v1/customers-lookup?*", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data?: Record<string, unknown> | null };
    if (body.data) delete body.data.group;
    await route.fulfill({ response, json: body });
  });

  await openTill(page);
  await ring(page, [TAXED.A.name]);

  await page.getByTitle(/No customer attached|Customer:/).first().click();
  const sheet = page.getByRole("dialog").filter({ hasText: "Leave blank for a walk-in sale" });
  await sheet.getByPlaceholder("03xx-xxxxxxx").fill(MEMBERS.member.phone);
  await sheet.getByRole("button", { name: "Done" }).click();

  const shown = await openTender(page, "Card");
  expect(shown, "the lookup was meant to hide the group").toBe(4956);

  await page.getByRole("button", { name: /^Complete/ }).click();

  const corrected = page.getByTestId("tender-corrected");
  await expect(corrected).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("tender-amount-due")).toHaveText(/4,460\.40?(?!\d)/);

  // Nothing was charged by the refusal.
  const before = await list(request, "/sales?per_page=5");

  await page.getByRole("button", { name: /^Complete/ }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible({ timeout: 20_000 });

  const invoice = await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice");
  expect(before.some((r) => r.invoice_number === invoice), "the refused press made a sale").toBe(false);

  const sale = (await list(request, "/sales?per_page=20")).find((r) => r.invoice_number === invoice)!;
  expect(Number(sale.total)).toBe(4460.4);
  expect(Number(sale.change_due ?? 0)).toBe(0);
});
