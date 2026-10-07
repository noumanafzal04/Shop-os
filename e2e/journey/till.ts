import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { ask, expect, rupees } from "./kit";

/**
 * THE TILL, as the journey uses it.
 *
 * Every helper here does one thing a cashier does and nothing else, so a case
 * reads as a sale: ring this, this many, for this customer, on this tender.
 * None of them retries a press — a till that drops a tap should fail the case,
 * not be forgiven by the test.
 */

export type Tender = "Cash" | "Card" | "Wallet" | "Khata" | "Split";
export type Sale = Record<string, unknown> & { items: Array<Record<string, unknown>> };

export async function openTill(page: Page): Promise<void> {
  await page.goto("/tenant/pos");
  await expect(page.getByPlaceholder(/scan barcode or search/i).first()).toBeVisible({ timeout: 30_000 });
}

const cartRows = (page: Page): Locator => page.locator("[data-cart-row]");

/** Find one product by name and tap it once. Waits for the search to be answered first. */
export async function ring(page: Page, name: string): Promise<void> {
  const search = page.getByPlaceholder(/scan barcode or search/i).first();
  const answered = page
    .waitForResponse((r) => r.url().includes("/products") && decodeURIComponent(r.url().replace(/\+/g, " ")).includes(name), { timeout: 15_000 })
    .catch(() => null);
  await search.fill(name);
  await answered;

  const items = page.locator("[data-pos-item]");
  await expect(items.first(), `the till's search did not settle on ${name}`).toContainText(name, { timeout: 15_000 });

  const before = await cartRows(page).count();
  await items.filter({ hasText: name }).first().click();
  await expect(cartRows(page), `tapping ${name} put nothing in the cart`).toHaveCount(before + 1, { timeout: 10_000 });
  await search.fill("");
}

/** The cart line for a product. */
export const line = (page: Page, name: string): Locator => cartRows(page).filter({ hasText: name }).first();

/** Type a quantity into a line and commit it, as a cashier does: type, Enter. */
export async function quantity(page: Page, name: string, qty: number): Promise<void> {
  const box = line(page, name).locator("input").first();
  await box.fill(String(qty));
  await box.press("Enter");
  await expect(box).toHaveValue(String(qty));
}

/** Attach a customer by phone. Waits for the till to say who they are when they are in a group. */
export async function attach(page: Page, phone: string, group?: string): Promise<void> {
  await page.getByTitle(/No customer attached|Customer:/).first().click();
  const sheet = page.getByRole("dialog").filter({ hasText: "Leave blank for a walk-in sale" });
  await sheet.getByPlaceholder("03xx-xxxxxxx").fill(phone);
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
  if (group) await expect(page.getByText(new RegExp(`· ${group}`)).first(), "the till never named the customer's group").toBeVisible({ timeout: 15_000 });
}

/** The discount sheet: a keyed amount, a coupon, or both. */
export async function discount(page: Page, opts: { amount?: number; coupon?: string }): Promise<void> {
  await page.getByRole("button", { name: /discount/i }).first().click();
  const sheet = page.getByRole("dialog").filter({ hasText: "Manual discount" });
  await expect(sheet).toBeVisible();
  if (opts.amount !== undefined) await sheet.getByRole("spinbutton").fill(String(opts.amount));
  if (opts.coupon) {
    await sheet.getByPlaceholder("Coupon code").fill(opts.coupon);
    await sheet.getByRole("button", { name: "Apply" }).click();
    await expect(sheet.getByText(new RegExp(`${opts.coupon} · −`)), `the coupon ${opts.coupon} was not accepted`).toBeVisible({ timeout: 15_000 });
  }
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
}

export const tenderSheet = (page: Page): Locator =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Tender / Pay" }) });

/** Open the tender sheet on a method; returns the amount the till says is due. */
export async function tender(page: Page, method: Tender): Promise<number> {
  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  const sheet = tenderSheet(page);
  await expect(sheet).toBeVisible();
  await sheet.getByRole("group", { name: "Payment method" }).getByRole("button", { name: new RegExp(`^${method}`) }).click();

  return rupees(await page.getByTestId("tender-amount-due").innerText());
}

/**
 * Press Complete; return the sale as the SERVER recorded it.
 *
 * Fails if the till's own figure had to be corrected: every case that calls
 * this is saying the screen was right the first time.
 */
export async function complete(page: Page, request: APIRequestContext): Promise<Sale> {
  await expect(page.getByTestId("tender-corrected"), "the till's figure was wrong and the server corrected it").toHaveCount(0);
  await tenderSheet(page).getByRole("button", { name: /^Complete/ }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" }), "the server refused the sale").toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("tender-corrected")).toHaveCount(0);

  const invoice = await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice");
  const recent = await ask<Sale[]>(request, "owner", "/sales?per_page=30");
  const sale = recent.find((s) => s.invoice_number === invoice);
  expect(sale, `the till said ${invoice} and the server has no such sale`).toBeTruthy();

  await page.getByRole("button", { name: "New sale" }).click();
  await expect(cartRows(page)).toHaveCount(0);

  return ask<Sale>(request, "owner", `/sales/${String(sale!.id)}`);
}

/** The Grand Total on the till's face, before the tender sheet is opened. */
export async function grandTotal(page: Page): Promise<number> {
  return rupees(await page.getByText("Grand Total", { exact: true }).locator("xpath=following-sibling::div[1]").innerText());
}

/**
 * Open today's trading day again, at Day & banking, as a manager would.
 *
 * A journey run from the top in one sitting closes the day in stage C and
 * then needs a drawer in the stages after it. That used to be the end of
 * those cases until tomorrow; it is now what a shop does about a day closed
 * at the wrong hour — see stage I, which is about this screen. Here it is a
 * step on the way to something else.
 */
export async function reopenToday(page: Page, reason: string): Promise<void> {
  await page.goto("/tenant/day");
  await page.getByTestId("closed-today").getByRole("button", { name: "Open today again" }).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByText("Why is it being opened again?") });
  await sheet.getByRole("textbox").fill(reason);
  await sheet.getByRole("button", { name: "Open it again" }).click();
  await expect(sheet, "the day would not open again").toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId("day-reopened")).toBeVisible({ timeout: 20_000 });
}
