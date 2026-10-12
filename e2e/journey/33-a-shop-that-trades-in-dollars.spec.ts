import fs from "node:fs";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { API } from "../api";
import { OWNER_STATE, TRADE, ask, expect, record, remember, session, settled, test } from "./kit";
import { editor } from "./shop";
import { complete, grandTotal, openTill, ring, tender, tenderSheet } from "./till";

/**
 * STAGE V — A SHOP THAT TRADES IN DOLLARS.
 *
 *     "currency type add kro — agr Pakistan main use kry to usy PKR chahye,
 *      USA main Dollar, India main INR — to wo select kr sky."
 *
 * The product spoke rupees to everybody: the mark on every figure, the commas
 * in it, the notes a drawer was counted in. A shop now chooses the money it
 * trades in — once, before it has traded, because nothing is ever converted.
 *
 *   the owner chooses it in Settings, and is shown how its amounts will read
 *
 *   everything that names a figure follows: the products list, the till, the
 *   change, the receipt
 *
 *   after the first sale it is FIXED, and the screen says why instead of
 *   offering a control that would be refused
 *
 *   the drawer is counted in dollars and cents — quarters and pennies, not
 *   five-thousand-rupee notes
 *
 * Run with `JOURNEY_TRADE=dollars`, after stages 01 and 02 for that trade.
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "dollars", "a shop in another currency — run with JOURNEY_TRADE=dollars");
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Row = Record<string, unknown>;

const COFFEE = { name: "QA Ground Coffee 1lb", price: 19.99 } as const;
const GRINDER = { name: "QA Burr Grinder", price: 1250 } as const;
const FLOAT = 100;

const token = (): string => {
  const state = JSON.parse(fs.readFileSync(OWNER_STATE, "utf8")) as { origins: Array<{ localStorage: Array<{ name: string; value: string }> }> };
  const auth = state.origins.flatMap((o) => o.localStorage).find((i) => i.name === "shopos-auth")!;

  return (JSON.parse(auth.value) as { state: { accessToken: string } }).state.accessToken;
};

const held = (request: APIRequestContext) => ask<Row & { currency: string; currency_symbol: string }>(request, "owner", "/shop/settings");

const product = async (request: APIRequestContext, name: string): Promise<Row | undefined> =>
  (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`)).find((p) => p.name === name);

/** The Currency card — on the FIRST page of Settings, with the rest of what the business is. */
async function theCurrencyCard(page: Page): Promise<Locator> {
  await page.goto("/tenant/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible({ timeout: 20_000 });
  await settled(page);
  const card = page.locator("section, div").filter({ has: page.getByRole("heading", { name: "Currency", exact: true }) }).last();
  await expect(page.getByRole("heading", { name: "Currency", exact: true })).toBeVisible();

  return card;
}

test("V1 · the owner chooses dollars before the shop has traded, and is shown how its money will read", async ({ page, request }) => {
  if ((await held(request)).currency !== "USD") {
    await theCurrencyCard(page);

    // It starts where every shop starts, and says how that is written.
    const choice = page.getByRole("combobox", { name: "Currency", exact: true });
    await expect(choice).toHaveValue("PKR");
    await expect(page.getByTestId("currency-example")).toContainText("Rs 1,234,567.50");

    // Rupees of India are written in lakhs — shown before anything is saved.
    await choice.selectOption("INR");
    await expect(page.getByTestId("currency-example")).toContainText("₹12,34,567.50");
    await expect(page.getByTestId("currency-example")).toContainText("₹4,000");

    await choice.selectOption("USD");
    await expect(page.getByTestId("currency-example")).toContainText("$1,234,567.50");
    // A whole dollar amount is still written to the cent.
    await expect(page.getByTestId("currency-example")).toContainText("$4,000.00");

    // The one bar on this page: it saves the profile and these settings alike.
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Settings saved.").first()).toBeVisible({ timeout: 15_000 });
  }

  const now = await held(request);
  expect(now.currency).toBe("USD");
  expect(now.currency_symbol, "the mark did not follow the code").toBe("$");

  // …and it is still chosen after a reload — and still free to change: nothing has been sold.
  await theCurrencyCard(page);
  await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toHaveValue("USD");
  await expect(page.getByTestId("currency-locked")).toHaveCount(0);
});

test("V2 · two items are carded, and the list writes their prices in dollars", async ({ page, request }) => {
  for (const item of [COFFEE, GRINDER]) {
    if (await product(request, item.name)) continue;

    await page.goto("/tenant/products/new");
    const form = editor(page);
    await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });
    await form.getByLabel("Name *", { exact: true }).fill(item.name);
    await form.getByLabel("Price *", { exact: true }).fill(String(item.price));
    await form.getByLabel("Tax rate % (optional)", { exact: true }).fill("0");
    await form.getByLabel("Opening stock", { exact: true }).fill("20");
    const description = form.getByLabel("Description *", { exact: true });
    if (await description.isVisible().catch(() => false)) await description.fill(`${item.name} — added by the QA journey.`);
    await form.getByRole("button", { name: "Create item" }).click();
    await expect(form).toBeHidden({ timeout: 20_000 });
  }

  await page.goto("/tenant/products");
  await page.getByPlaceholder("Search name or SKU…").fill("QA ");
  const coffee = page.getByRole("row").filter({ hasText: COFFEE.name }).first();
  const grinder = page.getByRole("row").filter({ hasText: GRINDER.name }).first();
  await expect(coffee).toBeVisible({ timeout: 15_000 });
  await expect(coffee, "a price of 19.99 is not written as dollars and cents").toContainText("$19.99");
  await expect(grinder).toContainText("$1,250.00");
  await expect(page.getByRole("table").first(), "a rupee mark is still on a dollar shop's list").not.toContainText("Rs ");
});

test("V3 · the counter is opened with a hundred dollars in the drawer", async ({ page, request }) => {
  await openTill(page);
  if (!(await ask<unknown>(request, "owner", "/pos/session"))) {
    await page.getByRole("button", { name: "Open shift" }).first().click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Open shift" }) });
    await sheet.getByRole("spinbutton").first().fill(String(FLOAT));
    await sheet.getByRole("button", { name: "Open", exact: true }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
  }
  await expect(page.getByText(/Shift open/).first()).toBeVisible({ timeout: 15_000 });
  // The float on the till's own face is in the shop's money.
  await expect(page.getByText(/Shift open/).first()).toContainText("$");
});

test("V4 · a pound of coffee is rung: $19.99, a twenty handed over, a cent back — and the receipt says dollars", async ({ page, request }) => {
  let saleId = String(record().dollarSale ?? "");
  if (!saleId) {
    await openTill(page);
    await ring(page, COFFEE.name);

    // The till's face, and the figure the customer is asked for.
    await expect(page.getByText("Grand Total", { exact: true }).locator("xpath=following-sibling::div[1]")).toHaveText("$19.99");
    expect(await grandTotal(page)).toBe(19.99);
    expect(await tender(page, "Cash")).toBe(19.99);
    await expect(page.getByTestId("tender-amount-due")).toContainText("$19.99");
    await page.getByPlaceholder("Cash tendered").fill("20");
    await expect(tenderSheet(page).getByTestId("cash-outcome")).toContainText("$0.01");

    const sale = await complete(page, request);
    expect(Number(sale.total)).toBe(19.99);
    saleId = String(sale.id);
    remember({ dollarSale: saleId });
  }

  const res = await request.get(`${API}/sales/${saleId}/invoice`, { headers: { Accept: "text/html", Authorization: `Bearer ${token()}` } });
  expect(res.ok(), `the receipt could not be read (${res.status()})`).toBeTruthy();
  const paper = (await res.text()).replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(paper, "the receipt is not in dollars").toContain("$19.99");
  expect(paper, "a rupee mark is on a dollar receipt").not.toMatch(/\bRs\b/);
});

test("V5 · now that it has traded, the currency is fixed — and the screen says why", async ({ page, request }) => {
  await theCurrencyCard(page);

  const fixed = page.getByTestId("currency-locked");
  await expect(fixed, "a shop that has sold is still offered another currency").toBeVisible({ timeout: 15_000 });
  await expect(fixed).toContainText("US Dollar — $ (USD)");
  await expect(fixed).toContainText("fixed once trading has begun");
  await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toHaveCount(0);

  // The server holds the same line: asked directly, it refuses in the same words.
  const refused = await request.put(`${API}/shop/settings`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token()}` }, data: { currency: "PKR" },
  });
  expect(refused.status()).toBe(409);
  expect(((await refused.json()) as { meta: { error_code: string } }).meta.error_code).toBe("CURRENCY_LOCKED");
  expect((await held(request)).currency).toBe("USD");
});

test("V6 · the drawer is counted in dollars and cents, and it balances", async ({ page, request }) => {
  // Counted ONCE: a second run of this case finds the shift already closed, and still reads what it holds.
  if (await ask<unknown>(request, "owner", "/pos/session")) {
    await openTill(page);
    await page.getByRole("button", { name: "Close shift" }).first().click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Close shift", exact: true }) }).first();
    await expect(sheet).toBeVisible({ timeout: 15_000 });

    // A dollar drawer's own notes and coins — and not a rupee's.
    for (const d of ["100", "20", "1", "0.25", "0.01"]) await expect(sheet.locator(`[data-denomination="${d}"]`), `no box for ${d}`).toBeVisible();
    await expect(sheet.locator('[data-denomination="5000"]'), "a dollar drawer is asked for five-thousand-rupee notes").toHaveCount(0);
    await expect(sheet.getByLabel("How many 0.25 coins")).toBeVisible();

    // 100 float + 19.99 taken = 119.99:  100 + 10 + 5 + 4×1 + 3×0.25 + 2×0.10 + 4×0.01.
    const counts: Record<string, string> = { "100": "1", "10": "1", "5": "1", "1": "4", "0.25": "3", "0.1": "2", "0.01": "4" };
    for (const [d, n] of Object.entries(counts)) await sheet.locator(`[data-denomination="${d}"]`).fill(n);
    await expect(sheet, "the count does not come to the cent").toContainText("$119.99");

    await sheet.getByRole("button", { name: "Close shift", exact: true }).click();
    await expect(sheet).toBeHidden({ timeout: 20_000 });
  }

  const { sessions } = await ask<{ sessions: Array<Row & { status: string; counted_cash: string | number; expected_cash: string | number; variance: string | number; closing_denominations: Record<string, number> }> }>(
    request, "owner", "/pos/sessions",
  );
  const last = sessions[0];
  expect(last.status).toBe("closed");
  expect(Number(last.expected_cash)).toBe(119.99);
  expect(Number(last.counted_cash)).toBe(119.99);
  expect(Number(last.variance), "a drawer counted to the cent did not balance").toBe(0);
  // Three quarters, two dimes, four pennies — coins, kept as counted.
  expect([last.closing_denominations["0.25"], last.closing_denominations["0.1"], last.closing_denominations["0.01"]]).toEqual([3, 2, 4]);
});
