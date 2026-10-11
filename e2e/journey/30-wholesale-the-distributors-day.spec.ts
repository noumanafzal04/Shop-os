import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { OWNER_STATE, TRADE, ask, expect, record, session, settled, test } from "./kit";
import { editor } from "./shop";
import { attach, complete, grandTotal, line, openTill, quantity, ring, tender, tenderSheet } from "./till";

/**
 * STAGE S — A DISTRIBUTOR'S DAY.
 *
 * Wholesale became a business type of its own: a maker, an importer or a
 * distributor, whose whole trade is selling ON to shops. Stages A and B are
 * the same for every trade. What a distributor does that a shop does not:
 *
 *   sells by the CARTON, at a carton's own price, and by the bottle when a
 *   dealer asks for six
 *
 *   gives a better rate at sixty and over — the price follows the quantity
 *   by itself, the salesman does not type it
 *
 *   sells on ACCOUNT to dealers it will see again, up to a limit each, and
 *   is refused — by name and by figure — the sale that would pass it
 *
 *   keeps what it holds in a godown, and is not on the public marketplace
 *
 * Every figure below is worked out by hand in the comment beside it.
 *
 * Run with `JOURNEY_TRADE=wholesale`, after stages 01 and 02 for that trade.
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "wholesale", "a distributor's stage — run with JOURNEY_TRADE=wholesale");
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Row = Record<string, unknown>;

/**
 * The dealer's rate IS the price. A carton is twelve bottles at its own
 * figure (6,600 — a little under twelve at 575), and sixty or more bottles
 * are 560 each.
 */
const OIL = { name: "QA Cooking Oil 1L", price: 575, cost: 540, stock: 600, carton: { name: "Carton", holds: 12, price: 6600 }, breakAt: 60, breakPrice: 560 } as const;
const DEALER = { name: "QA Al-Madina Kiryana", phone: "03004440001", limit: 50000 } as const;

const product = async (request: APIRequestContext, name: string): Promise<Row | undefined> =>
  (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`)).find((p) => p.name === name);
const onTheShelf = async (request: APIRequestContext) => Number((await product(request, OIL.name))!.stock_quantity);
const owes = async (request: APIRequestContext) =>
  Number((await ask<Array<{ phone: string; credit_balance: number | string }>>(request, "owner", "/customers?per_page=100")).find((c) => c.phone === DEALER.phone)?.credit_balance ?? 0);

/** The cart line's own options — where a carton is chosen. */
async function sellAs(page: Page, name: string, unit: RegExp): Promise<void> {
  // On its NAME: the middle of the row is the quantity box, which keeps the press.
  await line(page, name).getByText(name, { exact: true }).click();
  const options: Locator = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(options).toBeVisible();
  const units = options.locator("select").filter({ has: page.locator("option", { hasText: "(base)" }) });
  const label = (await units.locator("option").allTextContents()).find((t) => unit.test(t));
  expect(label, `the till does not offer ${unit} for ${name}`).toBeTruthy();
  await units.selectOption({ label: label! });
  await options.getByRole("button", { name: "Done", exact: true }).click();
  await expect(options).toBeHidden();
}

test("S1 · the business is a distributor: off the public marketplace, with its stock and its dealers' book", async ({ request }) => {
  const me = await ask<{ tenant: { business_type: string; features: Record<string, boolean> } }>(request, "owner", "/auth/me");

  expect(me.tenant.business_type).toBe("wholesale");
  // What a distributor cannot open without, on any plan.
  for (const key of ["products", "pos", "inventory", "customers"]) expect(me.tenant.features[key], key).toBe(true);
});

test("S2 · an item is carded at the dealer's rate, with a carton of twelve and a break at sixty", async ({ page, request }) => {
  if (await product(request, OIL.name)) return; // resumed

  await page.goto("/tenant/products/new");
  const form = editor(page);
  await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });

  const field = (label: string) => form.getByLabel(label, { exact: true });
  await field("Name *").fill(OIL.name);
  await field("Price *").fill(String(OIL.price));
  await field("Cost (optional)").fill(String(OIL.cost));
  await field("Tax rate % (optional)").fill("0");
  await field("Opening stock").fill(String(OIL.stock));
  const description = field("Description *");
  if (await description.isVisible().catch(() => false)) await description.fill("One-litre bottle, twelve to the carton.");

  await form.getByRole("button", { name: "Codes & packs" }).click();
  await form.getByRole("button", { name: "+ Add pack" }).click();
  await form.getByLabel("Pack 1: name").fill(OIL.carton.name);
  await form.getByLabel("Pack 1: how many base units").fill(String(OIL.carton.holds));
  await form.getByLabel("Pack 1: price").fill(String(OIL.carton.price));
  await form.getByRole("button", { name: "+ Add tier" }).click();
  await form.getByLabel("Tier 1: from quantity").fill(String(OIL.breakAt));
  await form.getByLabel("Tier 1: price each").fill(String(OIL.breakPrice));

  const create = form.getByRole("button", { name: "Create item" });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(form).toBeHidden({ timeout: 20_000 });
  await settled(page);

  const held = await ask<Row & { units: Array<{ name: string; factor: number | string; price: number | string }>; price_tiers: Array<{ min_qty: number | string; price: number | string }> }>(
    request, "owner", `/products/${String((await product(request, OIL.name))!.id)}`,
  );
  expect(Number(held.price)).toBe(OIL.price);
  expect(Number(held.stock_quantity)).toBe(OIL.stock);
  expect(held.units.map((u) => [u.name, Number(u.factor), Number(u.price)])).toEqual([[OIL.carton.name, OIL.carton.holds, OIL.carton.price]]);
  expect(held.price_tiers.map((t) => [Number(t.min_qty), Number(t.price)])).toEqual([[OIL.breakAt, OIL.breakPrice]]);
});

test("S3 · a dealer is given an account with a limit of Rs 50,000", async ({ page, request }) => {
  const held = await ask<Row[]>(request, "owner", "/customers?per_page=100");
  if (!held.some((c) => c.phone === DEALER.phone)) {
    await page.goto("/tenant/customers");
    await page.getByRole("button", { name: "+ Add customer" }).click();
    const form = page.getByRole("dialog", { name: "Add customer" });
    await form.getByRole("textbox", { name: "Name *" }).fill(DEALER.name);
    await form.getByRole("textbox", { name: "Phone" }).fill(DEALER.phone);
    await form.getByRole("spinbutton", { name: /Credit limit/ }).fill(String(DEALER.limit));
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }

  const looked = await ask<{ name: string; credit_limit: number | string | null }>(request, "owner", `/customers-lookup?phone=${DEALER.phone}`);
  expect(looked.name).toBe(DEALER.name);
  expect(Number(looked.credit_limit)).toBe(DEALER.limit);
});

test("S4 · the counter is opened", async ({ page, request }) => {
  await openTill(page);
  if (!(await ask<unknown>(request, "owner", "/pos/session"))) {
    await page.getByRole("button", { name: "Open shift" }).first().click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Open shift" }) });
    await sheet.getByRole("spinbutton").first().fill("5000");
    await sheet.getByRole("button", { name: "Open", exact: true }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
  }
  await expect(page.getByText(/Shift open/).first()).toBeVisible({ timeout: 15_000 });
});

test("S5 · three cartons on account: 19,800 on the dealer's book, thirty-six bottles off the shelf", async ({ page, request }) => {
  const before = { shelf: await onTheShelf(request), owed: await owes(request) };

  await openTill(page);
  await ring(page, OIL.name);
  await sellAs(page, OIL.name, /^Carton/);
  await quantity(page, OIL.name, 3);
  await attach(page, DEALER.phone);

  // 3 cartons × 6,600 = 19,800. No tax on this item.
  expect(await grandTotal(page)).toBe(19800);
  expect(await tender(page, "Khata")).toBe(19800);
  const sale = await complete(page, request);

  expect(Number(sale.total)).toBe(19800);
  expect(sale.payment_method).toBe("credit");
  // A carton is twelve off the shelf: 3 × 12 = 36.
  expect(await onTheShelf(request)).toBe(before.shelf - 36);
  expect(await owes(request)).toBe(before.owed + 19800);
});

test("S6 · sixty bottles would take the dealer past its limit — refused, by figure, and nothing moves", async ({ page, request, watch }) => {
  const before = { shelf: await onTheShelf(request), owed: await owes(request) };

  await openTill(page);
  await ring(page, OIL.name);
  await quantity(page, OIL.name, 60);
  await attach(page, DEALER.phone);

  // Sixty is the break: 560 each, 33,600 — and 19,800 + 33,600 = 53,400, over 50,000.
  expect(await grandTotal(page), "sixty bottles did not get the quantity break on the till").toBe(33600);
  await tender(page, "Khata");
  watch.expect(/CREDIT_LIMIT_EXCEEDED/);
  await tenderSheet(page).getByRole("button", { name: /^Complete/ }).click();
  await expect(page.getByText(/credit limit/i).first(), "the till did not say why the sale was refused").toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Sale complete" })).toHaveCount(0);

  expect(await onTheShelf(request), "a refused sale took stock").toBe(before.shelf);
  expect(await owes(request), "a refused sale was put on the account").toBe(before.owed);
});

test("S7 · forty-eight is under the break and inside the limit: 27,600 on account", async ({ page, request }) => {
  const before = { shelf: await onTheShelf(request), owed: await owes(request) };

  await openTill(page);
  await ring(page, OIL.name);
  await quantity(page, OIL.name, 48);
  await attach(page, DEALER.phone);

  // 48 × 575 = 27,600 — the break starts at sixty. 19,800 + 27,600 = 47,400.
  expect(await grandTotal(page)).toBe(27600);
  expect(await tender(page, "Khata")).toBe(27600);
  const sale = await complete(page, request);

  expect(Number(sale.total)).toBe(27600);
  expect(await onTheShelf(request)).toBe(before.shelf - 48);
  expect(await owes(request)).toBe(before.owed + 27600);
});

test("S8 · and the break itself, paid in cash: sixty at 560", async ({ page, request }) => {
  const before = await onTheShelf(request);

  await openTill(page);
  await ring(page, OIL.name);
  await quantity(page, OIL.name, 60);

  // 60 × 560 = 33,600.
  expect(await tender(page, "Cash")).toBe(33600);
  await page.getByPlaceholder("Cash tendered").fill("34000");
  await expect(tenderSheet(page).getByText(/Change due/i).locator("..")).toContainText("400");
  const sale = await complete(page, request);

  expect(Number(sale.total)).toBe(33600);
  expect(Number(sale.items[0].unit_price ?? sale.items[0].price)).toBe(560);
  expect(await onTheShelf(request)).toBe(before - 60);
});

test("S9 · the dealer's book: what it owes is the two sales on account, and the room it has left", async ({ page, request }) => {
  // 19,800 + 27,600 = 47,400 of 50,000.
  expect(await owes(request)).toBe(47400);

  await page.goto("/tenant/customers");
  await settled(page);
  const row = page.getByRole("row").filter({ hasText: DEALER.name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText("47,400");

  // 600 − 36 − 48 − 60 = 456 on the shelf.
  expect(await onTheShelf(request)).toBe(456);
  void record;
});
