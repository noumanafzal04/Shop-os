import type { APIRequestContext, Page } from "@playwright/test";

import { API, foodAuth } from "./api";
import { expect, expectTheAppStillAnswers, test, type PrintWindow } from "./printWindow";
import { PLAIN_ITEM, openTill } from "./till";
import { payBy } from "./payBy";

/**
 * AFTER A PRINT, THE SHOP CARRIES ON — in a restaurant.
 *
 * ── The report ───────────────────────────────────────────────────────
 *
 *     "take away py maine aik order lia, print nikala to dobara print py
 *      click ni huwa — or fire to kitchen, usk bad again wahn click ni huwa,
 *      na settle py click hua."
 *
 * A kitchen that works off paper prints a slip the moment an order is sent.
 * That print was the last thing the tab ever did: the slip came out, and Send,
 * Bill and Settle sat on the screen and answered nothing. This is that
 * evening, with the browser's real print window — see `e2e/printWindow.ts`.
 */

test.use({ signedInAs: "e2e/.auth/food.json" });
test.describe.configure({ mode: "serial" });

const KARAHI = { name: "E2E Bill Karahi", price: 1890 };
const CHAI = { name: "E2E Bill Chai", price: 235, tax_rate: 18 };
const GUEST = "E2E After The Print";
const PRICED = /Rs\s?[1-9]/;

const settings = async (request: APIRequestContext, patch?: Record<string, unknown>) => {
  const res = patch
    ? await request.put(`${API}/shop/settings`, { headers: foodAuth(), data: patch })
    : await request.get(`${API}/shop/settings`, { headers: foodAuth() });
  expect(res.ok(), `the restaurant's settings ${patch ? "did not save" : "could not be read"} (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Record<string, unknown> }).data;
};

async function dish(request: APIRequestContext, what: { name: string; price: number; tax_rate?: number }): Promise<string> {
  const auth = foodAuth();
  const found = await request.get(`${API}/products?search=${encodeURIComponent(what.name)}&per_page=10`, { headers: auth });
  const have = ((await found.json()) as { data: Array<{ id: string; name: string }> }).data.find((p) => p.name === what.name);
  if (have) return have.id;

  const made = await request.post(`${API}/products`, {
    headers: auth,
    data: { item_type: "food_item", description: "A fixture for the table's bill.", is_active: true, ...what },
  });
  expect(made.ok(), `could not make the fixture dish: ${made.status()} ${await made.text()}`).toBeTruthy();

  return ((await made.json()) as { data: { id: string } }).data.id;
}

/** Every window that comes up for one press, closed in turn — a slip per station is right. */
async function closeEach(printWindow: PrintWindow, what: string, atLeast = 1): Promise<number> {
  let closed = 0;
  while (await printWindow.comesUp(closed === 0 ? 20_000 : 4_000)) {
    await printWindow.close();
    closed++;
  }
  expect(closed, `${what}: no print window came up`).toBeGreaterThanOrEqual(atLeast);

  return closed;
}

async function ringDish(page: Page, nth: number): Promise<void> {
  const rows = page.locator("[data-cart-row]");
  const before = await rows.count();
  await page.locator(PLAIN_ITEM).filter({ hasText: PRICED }).nth(nth).click();
  const add = page.getByRole("dialog").getByRole("button", { name: /^Add( to (cart|tab))?( ·|$)/ });
  await expect
    .poll(async () => (await rows.count()) > before || (await add.isVisible().catch(() => false)), { timeout: 10_000, message: "the dish neither reached the cart nor asked its options" })
    .toBe(true);
  if (await add.isVisible().catch(() => false)) await add.click();
  await expect(rows, "the dish did not reach the cart").toHaveCount(before + 1, { timeout: 10_000 });
}

let before: Record<string, unknown> = {};
let toClear: string | null = null;

test.beforeAll(async ({ request }) => {
  before = await settings(request);
  // A kitchen that works off paper, and a counter that prints the receipt when asked.
  await settings(request, { kot_auto_print: true, pos_auto_print: false, receipt_width: "thermal_80" });
});

test.afterAll(async ({ request }) => {
  await settings(request, {
    kot_auto_print: before.kot_auto_print ?? true,
    pos_auto_print: before.pos_auto_print ?? false,
    receipt_width: before.receipt_width ?? "standard",
  });
});

test.afterEach(async ({ request }) => {
  if (toClear === null) return;
  await request.post(`${API}/restaurant/tickets/${toClear}/cancel`, { headers: foodAuth(), data: { reason: "e2e fixture" } }).catch(() => {});
  toClear = null;
});

test("a tab: the order is sent and its slip prints — then the bill prints, twice, and the tab is settled", async ({ page, printWindow, request }) => {
  const karahi = await dish(request, KARAHI);
  const chai = await dish(request, CHAI);
  const opened = await request.post(`${API}/restaurant/tickets`, { headers: foodAuth(), data: { order_type: "takeaway", customer_name: GUEST } });
  expect(opened.ok(), `the tab could not be opened (${opened.status()} ${await opened.text()})`).toBeTruthy();
  const id = ((await opened.json()) as { data: { id: string } }).data.id;
  toClear = id;
  const added = await request.post(`${API}/restaurant/tickets/${id}/items`, {
    headers: foodAuth(),
    data: { items: [{ product_id: karahi, quantity: 2 }, { product_id: chai, quantity: 3 }] },
  });
  expect(added.ok(), `the dishes could not be put on the tab (${added.status()} ${await added.text()})`).toBeTruthy();

  await page.goto(`/tenant/dine-in/tickets/${id}`);
  await expect(page.getByRole("heading", { name: GUEST, level: 1 })).toBeVisible({ timeout: 20_000 });

  // ── "fire to kitchen" ────────────────────────────────────────────────
  const send = page.getByRole("button", { name: /^Send to kitchen/ });
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  await closeEach(printWindow, "the kitchen's slip");
  // What the screen has to DRAW once the order has gone: the lines move under
  // "In the kitchen" and there is nothing left to send. (The toast that says
  // so has usually timed out by now — it was up while the window was.)
  const sent = page.getByRole("region", { name: "In the kitchen" });
  await expect(sent, "the tab never showed the order as sent").toContainText(KARAHI.name, { timeout: 10_000 });
  await expect(sent).toContainText(CHAI.name);
  await expect(send, "there was still something to send").toBeDisabled();

  // ── "usk bad again wahn click ni huwa" ───────────────────────────────
  const bill = page.getByTestId("print-bill");
  for (const press of ["the bill", "the bill, asked for again"]) {
    await expect(bill, `${press}: the button cannot be pressed`).toBeEnabled({ timeout: 10_000 });
    await bill.click();
    await closeEach(printWindow, press);
  }
  await expect(bill, "after the bill printed its button never came back").toBeEnabled({ timeout: 10_000 });

  // ── "na settle py click hua" ─────────────────────────────────────────
  await page.getByRole("button", { name: "Settle", exact: true }).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Settle tab" }) });
  await expect(sheet, "Settle opened nothing").toBeVisible({ timeout: 10_000 });
  // The figure on the button is the one the till takes. Two karahi and three
  // teas, the tea at its own 18%: the sheet used to say 4,485 — the dishes
  // with no tax on them — and the till refused that as "less than the total".
  await expect(sheet.getByTestId("settle-bill"), "the sheet does not show what the till will ask for").toHaveText(/4,611\.90/, { timeout: 10_000 });
  const take = sheet.getByRole("button", { name: /^Take / });
  await expect(take).toHaveText(/4,611\.90/);
  await take.click();
  // A receipt may print here, if the shop has it set to; either way the tab closes.
  while (await printWindow.comesUp(3_000)) await printWindow.close();
  await expect(page, "a settled tab did not go back to the floor").toHaveURL(/\/tenant\/dine-in\/?$/, { timeout: 15_000 });
  const after = await request.get(`${API}/restaurant/tickets/${id}`, { headers: foodAuth() });
  expect(((await after.json()) as { data: { status: string } }).data.status, "the tab was not settled").toBe("closed");
  toClear = null;
});

test("at the counter: a takeaway is paid, the kitchen's slip prints, then the receipt — twice — and the next order is rung", async ({ page, printWindow }) => {
  await openTill(page);
  await expect(page.locator(PLAIN_ITEM).filter({ hasText: PRICED }).first(), "the restaurant's till shows nothing to ring").toBeVisible({ timeout: 20_000 });
  await ringDish(page, 0);

  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  await payBy(page, "Cash");
  await page.getByRole("button", { name: /^Exact ·/ }).click();
  await page.getByRole("button", { name: /^Complete/ }).click();

  // The kitchen's slip prints by itself the moment the sale is paid.
  await closeEach(printWindow, "the kitchen's slip");
  await expect(page.getByRole("heading", { name: "Sale complete" }), "after the kitchen's slip the sale sheet never appeared").toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("kitchen-slip-note")).toContainText(/Kitchen slip #\d+ sent to the printer/, { timeout: 10_000 });

  // "print nikala to dobara print py click ni huwa"
  const print = page.getByRole("button", { name: /^(Print receipt|Printing…|Print again)$/ });
  await print.click();
  await closeEach(printWindow, "the customer's receipt");
  await expect(print, "after one print the button never came back").toHaveText("Print again", { timeout: 10_000 });
  await print.click();
  await closeEach(printWindow, "the customer's receipt, again");
  await expect(print).toHaveText("Print again", { timeout: 10_000 });
  await expect(print).toBeEnabled();

  // The slip again, from its own button.
  await page.getByRole("button", { name: "Kitchen slip", exact: true }).click();
  await closeEach(printWindow, "the kitchen's slip, asked for again");

  await page.getByRole("button", { name: "New sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeHidden({ timeout: 10_000 });
  await ringDish(page, 0);
  // And the one way out of the till still leads out of it.
  await expectTheAppStillAnswers(page, /Exit/, /\/tenant\/?$/);
});
