import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, ownerAuth } from "./api";
import { showPane } from "./till";

/**
 * A SHELF WITH TAX ON IT — the fixture the counter was never tested against.
 *
 * `shelf.setup` builds the suite's products with `tax_rate: 0`. That is right
 * for specs about layout and wrong for anything about money: a sale with no
 * tax on it cannot be short by the tax, and for a long time the only browser
 * test that rang a sale rang one of those, in cash.
 *
 * These three are the shape of a real shop's catalogue instead:
 *
 *   A   on a group at 18%, no rate of its own   — the reported failure
 *   B   on a group at 10%
 *   C   on no group and with no rate            — the shop default
 *
 * Their prices add to Rs 12,610, which is the figure in the bug report. That
 * is deliberate: a failure here prints the number somebody already knows.
 *
 * ── Fixed names, found and reused ────────────────────────────────────
 *
 * Never `Date.now()` in a fixture name. A fixture that mints a product per
 * run is twenty strays by the end of the week, and the spec after this one
 * fills its cart from them.
 */

export const GROUP_STD = "E2E Tax Std 18";
export const GROUP_RED = "E2E Tax Red 10";

export const TAXED = {
  A: { name: "E2E Taxed Item A", price: 4200, group: GROUP_STD, rate: 18 },
  B: { name: "E2E Taxed Item B", price: 6310, group: GROUP_RED, rate: 10 },
  C: { name: "E2E Taxed Item C", price: 2100, group: null, rate: null },
} as const;

export type Row = Record<string, unknown>;

export async function list(request: APIRequestContext, path: string): Promise<Row[]> {
  const res = await request.get(`${API}${path}`, { headers: ownerAuth() });
  expect(res.ok(), `${path} unreadable (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Row[] }).data;
}

async function group(request: APIRequestContext, name: string, rate: number): Promise<string> {
  const found = (await list(request, "/tax-groups")).find((g) => g.name === name);
  if (found) return String(found.id);

  const made = await request.post(`${API}/tax-groups`, { headers: ownerAuth(), data: { name, rate } });
  expect(made.ok(), `could not create tax group ${name} (${made.status()})`).toBeTruthy();

  return String(((await made.json()) as { data: Row }).data.id);
}

/** Idempotent: safe to call from every spec that needs the taxed shelf. */
export async function stockTaxedShelf(request: APIRequestContext): Promise<void> {
  const groups: Record<string, string> = {
    [GROUP_STD]: await group(request, GROUP_STD, 18),
    [GROUP_RED]: await group(request, GROUP_RED, 10),
  };

  const existing = await list(request, "/products?search=E2E%20Taxed%20Item&per_page=100");

  for (const item of Object.values(TAXED)) {
    if (existing.some((p) => p.name === item.name)) continue;

    const made = await request.post(`${API}/products`, {
      headers: ownerAuth(),
      data: {
        item_type: "physical_product",
        name: item.name,
        price: item.price,
        cost: Math.round(item.price * 0.6),
        // On a GROUP with no rate of its own — the exact row that produced
        // the report. The old screen read `tax_rate` alone and fell through.
        tax_rate: null,
        tax_group_id: item.group ? groups[item.group] : null,
        // Not stocked: these specs are about money and must not fail on a shelf.
        track_inventory: false,
      },
    });
    expect(made.ok(), `could not create ${item.name} (${made.status()}: ${await made.text()})`).toBeTruthy();
  }
}

/**
 * What C is taxed at: the shop's own default, read from where the till reads it.
 *
 * Not hard-coded. The fixture shop's default is a setting somebody can change,
 * and a spec that assumed it would fail the day they did — about nothing.
 */
export async function shopDefaultRate(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${API}/pos/catalog`, { headers: ownerAuth() });
  expect(res.ok(), `the till's catalog call failed (${res.status()})`).toBeTruthy();

  const body = (await res.json()) as { data?: { settings?: { default_tax_rate?: string | number | null } } };

  return Number(body.data?.settings?.default_tax_rate ?? 0);
}

/** A price with its tax on top, rounded the way a rupee is. */
export function withTax(price: number, rate: number): number {
  return Math.round(price * (100 + rate)) / 100;
}

/** "Rs 14,023.94" → 14023.94 */
export function rupees(text: string): number {
  const m = text.replace(/,/g, "").match(/[0-9]+(?:\.[0-9]+)?/);

  return m ? Number(m[0]) : NaN;
}

/**
 * How many lines the till says are in the cart.
 *
 * On a phone the cart rows are not drawn while the Products pane is showing,
 * so the count is read off the Cart tab, which is. Zero where there is no tab
 * (a wide screen shows both panes, and the rows themselves can be counted).
 */
async function cartCount(page: Page): Promise<number> {
  const tab = page.getByRole("button", { name: /^Cart/ }).first();
  if (!(await tab.isVisible().catch(() => false))) return 0;

  const m = ((await tab.textContent()) ?? "").match(/[0-9]+/);

  return m ? Number(m[0]) : 0;
}

/**
 * Put these products in the cart, one of each, by name.
 *
 * `already` — lines the cart held before this call (a cart restored after a
 * refresh, say), so the count at the end is of the whole cart.
 */
export async function ring(page: Page, names: readonly string[], already = 0): Promise<void> {
  await showPane(page, "Products");
  const search = page.getByPlaceholder(/scan barcode or search/i).first();

  for (const name of names) {
    /*
     * WAIT FOR THE LIST TO STOP MOVING, then tap.
     *
     * The search is answered by the server. Until it is, the unfiltered list
     * is still on screen — and these products are new, so they are already in
     * it, a few rows down. A tap aimed at row three lands on nothing once the
     * answer arrives and the list shrinks to one row. That failed three runs
     * in eighteen on the phone and none anywhere else, and read exactly like
     * a till that drops taps.
     *
     * So the answer is waited for, and the tap is made once. It is NOT
     * retried: a retry would also hide a till that really does drop one.
     */
    const answered = page.waitForResponse(
      (r) => r.url().includes("/products") && decodeURIComponent(r.url().replace(/\+/g, " ")).includes(name),
      { timeout: 15_000 },
    ).catch(() => null);
    await search.fill(name);
    await answered;

    const items = page.locator("[data-pos-item]");
    const tile = items.filter({ hasText: name }).first();
    await expect(tile, `${name} is not on the till`).toBeVisible({ timeout: 15_000 });
    // …and drawn: the first row IS the one asked for.
    await expect(items.first(), "the list has not settled on the search").toContainText(name, { timeout: 15_000 });

    const before = await page.locator("[data-cart-row]").count();
    await tile.click();
    await expect
      .poll(async () => (await cartCount(page)) > before || (await page.locator("[data-cart-row]").count()) > before, {
        message: `tapping ${name} put nothing in the cart`, timeout: 10_000,
      })
      .toBe(true);
  }

  await search.fill("");
  await showPane(page, "Cart");
  await expect(page.locator("[data-cart-row]"), "not every item reached the cart").toHaveCount(already + names.length);
}

/** One sale with its lines, as the server holds it. */
export async function saleWithLines(request: APIRequestContext, id: unknown): Promise<Row & { items: Row[] }> {
  const res = await request.get(`${API}/sales/${String(id)}`, { headers: ownerAuth() });
  expect(res.ok(), `sale ${String(id)} unreadable (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Row & { items: Row[] } }).data;
}

export type Method = "Cash" | "Card" | "Wallet" | "Khata" | "Split";

/** Open the tender sheet on a method and return the amount due it shows. */
export async function openTender(page: Page, method: Method): Promise<number> {
  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  await expect(page.getByRole("heading", { name: "Tender / Pay" })).toBeVisible();

  await page
    .getByRole("group", { name: "Payment method" })
    .getByRole("button", { name: new RegExp(`^${method}`) })
    .click();

  const due = rupees(await page.getByTestId("tender-amount-due").innerText());
  expect(due, "the till showed no amount due").toBeGreaterThan(0);

  return due;
}

/**
 * Press Complete and return the sale the server recorded.
 *
 * Asserts FIRST that the till's own figure was not corrected. If that alert
 * is up the sale may still go through — via the safety net — and a spec
 * would pass while the till's arithmetic was wrong. Every spec that calls
 * this is claiming the till was right the first time.
 */
export async function completeAndFetch(page: Page, request: APIRequestContext): Promise<Row> {
  await expect(
    page.getByTestId("tender-corrected"),
    "the till's own figure was wrong and the server had to correct it",
  ).toHaveCount(0);

  await page.getByRole("button", { name: /^Complete/ }).click();

  await expect(
    page.getByRole("heading", { name: "Sale complete" }),
    "the server refused the sale",
  ).toBeVisible({ timeout: 20_000 });

  // Checked again AFTER: a correction that arrived and was then paid on a
  // second press would also end at "Sale complete".
  await expect(page.getByTestId("tender-corrected")).toHaveCount(0);

  const invoice = await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice");
  const sale = (await list(request, "/sales?per_page=20")).find((r) => r.invoice_number === invoice);
  expect(sale, `the till said ${invoice} but the server has no such sale`).toBeTruthy();

  return sale!;
}

// ── People the bill depends on ───────────────────────────────────────
//
// A sale reads the customer's group off the phone number and acts on it: the
// group's percentage comes off the bill, and a trade group's level prices
// every line the cashier did not set. The counter was never tested with a
// customer attached at all, so neither had ever been seen on the screen.

/** A product with a trade price, on the 18% group. */
export const TRADE_ITEM = { name: "E2E Trade Item", price: 1000, wholesale: 900, group: GROUP_STD } as const;

export const MEMBERS = {
  /** Ten percent off, at retail. */
  member: { phone: "03009990101", name: "E2E Member", group: "E2E Members 10", level: "retail", pct: 10 },
  /** Rung at trade prices, nothing off. */
  trade: { phone: "03009990102", name: "E2E Trader", group: "E2E Trade Level", level: "wholesale", pct: 0 },
} as const;

/** Idempotent: the groups, the customers in them, and a product with a trade price. */
export async function stockMembers(request: APIRequestContext): Promise<void> {
  const groups = await list(request, "/customer-groups?per_page=100");

  for (const who of Object.values(MEMBERS)) {
    let groupId = groups.find((g) => g.name === who.group)?.id as string | undefined;
    if (groupId === undefined) {
      const made = await request.post(`${API}/customer-groups`, {
        headers: ownerAuth(),
        data: { name: who.group, price_level: who.level, discount_percent: who.pct },
      });
      expect(made.ok(), `could not create group ${who.group} (${made.status()}: ${await made.text()})`).toBeTruthy();
      groupId = String(((await made.json()) as { data: Row }).data.id);
    }

    const found = await request.get(`${API}/customers-lookup?phone=${who.phone}`, { headers: ownerAuth() });
    const existing = ((await found.json()) as { data: Row | null }).data;
    if (existing === null) {
      const made = await request.post(`${API}/customers`, {
        headers: ownerAuth(),
        data: { name: who.name, phone: who.phone, customer_group_id: groupId },
      });
      expect(made.ok(), `could not create ${who.name} (${made.status()}: ${await made.text()})`).toBeTruthy();
    }
  }

  const products = await list(request, `/products?search=${encodeURIComponent(TRADE_ITEM.name)}`);
  if (!products.some((p) => p.name === TRADE_ITEM.name)) {
    const groupId = (await list(request, "/tax-groups")).find((g) => g.name === TRADE_ITEM.group)?.id;
    const made = await request.post(`${API}/products`, {
      headers: ownerAuth(),
      data: {
        item_type: "physical_product",
        name: TRADE_ITEM.name,
        price: TRADE_ITEM.price,
        wholesale_price: TRADE_ITEM.wholesale,
        cost: 600,
        tax_rate: null,
        tax_group_id: groupId ?? null,
        track_inventory: false,
      },
    });
    expect(made.ok(), `could not create ${TRADE_ITEM.name} (${made.status()}: ${await made.text()})`).toBeTruthy();
  }
}

/** Attach a customer by phone, and wait until the till knows their group. */
export async function attach(page: Page, who: { phone: string; group: string }): Promise<void> {
  await page.getByTitle(/No customer attached|Customer:/).first().click();
  const sheet = page.getByRole("dialog").filter({ hasText: "Leave blank for a walk-in sale" });
  await expect(sheet).toBeVisible();
  await sheet.getByPlaceholder("03xx-xxxxxxx").fill(who.phone);
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();

  // The group is NAMED on the screen once it is known. Waiting for the name
  // is waiting for the bill to be the one the sale will make.
  await expect(page.getByText(new RegExp(`· ${who.group}`)).first()).toBeVisible({ timeout: 15_000 });
}

// ── An automatic promotion, on a line that is not at shelf price ──────
//
// Scoped to ONE product so it cannot move any other spec's bill. The product
// has a quantity break, which is the point: a preview that prices the cart at
// shelf price takes ten percent off the wrong number.

export const PROMO_ITEM = {
  name: "E2E Promo Item", price: 1000, breakAt: 3, breakPrice: 900, group: GROUP_STD, pct: 10,
  promotion: "E2E Ten Off Promo Item",
} as const;

/** Idempotent: the product with its quantity break, and the promotion on it. */
export async function stockPromotion(request: APIRequestContext): Promise<void> {
  let product = (await list(request, `/products?search=${encodeURIComponent(PROMO_ITEM.name)}`))
    .find((p) => p.name === PROMO_ITEM.name);

  if (product === undefined) {
    const groupId = (await list(request, "/tax-groups")).find((g) => g.name === PROMO_ITEM.group)?.id;
    const made = await request.post(`${API}/products`, {
      headers: ownerAuth(),
      data: {
        item_type: "physical_product",
        name: PROMO_ITEM.name,
        price: PROMO_ITEM.price,
        cost: 600,
        price_tiers: [{ min_qty: PROMO_ITEM.breakAt, price: PROMO_ITEM.breakPrice }],
        tax_rate: null,
        tax_group_id: groupId ?? null,
        track_inventory: false,
      },
    });
    expect(made.ok(), `could not create ${PROMO_ITEM.name} (${made.status()}: ${await made.text()})`).toBeTruthy();
    product = ((await made.json()) as { data: Row }).data;
  }

  const promotions = await list(request, "/promotions");
  if (!promotions.some((p) => p.name === PROMO_ITEM.promotion)) {
    const made = await request.post(`${API}/promotions`, {
      headers: ownerAuth(),
      data: {
        name: PROMO_ITEM.promotion, type: "percent", value: PROMO_ITEM.pct,
        scope: "product", product_ids: [product.id], is_active: true,
      },
    });
    expect(made.ok(), `could not create the promotion (${made.status()}: ${await made.text()})`).toBeTruthy();
  }
}
