import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API } from "../api";
import { OWNER_STATE, ask, expect, record, remember, rupees, session, settled, test } from "./kit";
import type { APIRequestContext, Page } from "@playwright/test";
import { CASHIER, DEFAULT_TAX, TAX_GROUPS } from "./shop";
import { complete, openTill, ring, tender } from "./till";

/**
 * STAGE E — THE SAME SHOP WITH THOUSANDS IN IT.
 *
 * Everything before this stage was a shop on its first day: six items, ten
 * sales. A screen that is right with ten rows can be unusable with ten
 * thousand, and a total that is right over ten sales can drift over two
 * thousand. So the shelf is filled the way a real shop fills one — a CSV
 * through the import screen, at the importer's own limit — and then a
 * fortnight's worth of sales is rung.
 *
 * ── What is typed, and what is not ───────────────────────────────────
 *
 * The 2,000 products go in THROUGH THE SCREEN: one file, the Import button.
 * The 1,500 sales do not — at a counter's pace that is two hours of clicking
 * to learn nothing the first ten did not teach. They are rung against the
 * same endpoint the till uses, each paid at a figure THIS FILE works out for
 * itself, and half on a card: one paisa wrong on any of them and the server
 * refuses it. Then the screens are opened, by hand, on the result.
 */

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

const PRODUCTS = 2000;
const SALES = Number(process.env.JOURNEY_SALES ?? 1500);
const STOCK = 5000;

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Sale K of the fifteen hundred — which item, how many, and what it comes to.
 *
 * Worked out HERE, from the price list this file wrote into the import. Not
 * read back from the server: a test that adds up what the server said and
 * then asks the server whether it agrees has asked nothing.
 */
const worked = (k: number) => {
  const n = 1 + ((k * 13) % PRODUCTS);
  const b = bulk(n);
  const qty = 1 + (k % 3);
  const line = b.price * qty;
  const tax = cents((line * b.rate) / 100);

  return { n, b, qty, line, tax, due: cents(line + tax), cost: b.cost * qty, card: k % 2 === 0 };
};

/** All fifteen hundred, added up — what the books should have gained. */
const gained = () => {
  let revenue = 0, tax = 0, cogs = 0, cash = 0, card = 0;
  const sold = new Map<number, number>();
  for (let k = 0; k < SALES; k++) {
    const w = worked(k);
    revenue += w.due; tax += w.tax; cogs += w.cost;
    if (w.card) card += w.due; else cash += w.due;
    sold.set(w.n, (sold.get(w.n) ?? 0) + w.qty);
  }

  return { revenue: cents(revenue), tax: cents(tax), cogs: cents(cogs), cash: cents(cash), card: cents(card), sold };
};

type Totals = { sales_count: number; revenue: number; refunds: number; tax: number; cogs: number; gross_profit: number; net_profit: number; expenses: number; other_income: number };

/** The month as the server holds it — the second opinion on every card. */
const month = async (request: APIRequestContext): Promise<Totals> =>
  (await ask<{ totals: Totals }>(request, "owner", "/reports/summary?period=monthly")).totals;

const HEADER = [
  "Name", "Item Type", "SKU", "Parent SKU", "Barcode", "Barcodes", "PLU Code", "Brand", "Category", "Unit", "Sold By",
  "Price", "Cost", "Wholesale Price", "Discount Price", "Tax Rate", "Tax Group", "Stock Quantity", "Low Stock Threshold",
  "Min Order Qty", "Track Inventory", "Description", "Is Active", "Visible In Marketplace",
];
const CATEGORIES = ["Food & Beverages", "Household", "Personal Care", "Snacks", "Dairy"];

/** Item N of the bulk shelf — the same answer wherever it is asked. */
const bulk = (n: number) => {
  const group = n % 3 === 0 ? TAX_GROUPS[0] : n % 3 === 1 ? TAX_GROUPS[1] : null;

  return {
    name: `QA Bulk Item ${String(n).padStart(4, "0")}`,
    sku: `QB-${String(n).padStart(4, "0")}`,
    price: 50 + ((n * 37) % 950),
    // What the import file says it cost the shop: seventy percent, to the rupee.
    cost: Math.round((50 + ((n * 37) % 950)) * 0.7),
    category: CATEGORIES[n % CATEGORIES.length],
    group: group?.name ?? "",
    rate: group?.rate ?? DEFAULT_TAX,
  };
};

const csv = (count: number, from = 1): string => {
  const cell = (v: string | number) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [HEADER.map(cell).join(",")];
  for (let n = from; n < from + count; n++) {
    const b = bulk(n);
    rows.push([
      b.name, "physical_product", b.sku, "", "", "", "", "QA", b.category, "Piece", "unit",
      b.price, b.cost, "", "", "", b.group, STOCK, 10, "", 1, "Imported by the QA journey", 1, 0,
    ].map(cell).join(","));
  }

  return rows.join("\n") + "\n";
};

const upload = async (page: import("@playwright/test").Page, content: string, name: string) => {
  const file = path.join(os.tmpdir(), name);
  fs.writeFileSync(file, content);

  await page.goto("/tenant/products");
  await page.getByRole("button", { name: "Import CSV" }).click();
  const sheet = page.getByRole("dialog", { name: "Import products from CSV" });
  await sheet.locator('input[type="file"]').setInputFiles(file);
  await sheet.getByRole("button", { name: "Import", exact: true }).click();

  return sheet;
};

test("E1 · a file one row over the limit is refused, and says what the limit is", async ({ page, watch }) => {
  watch.expect(/422 POST \/products\/import — IMPORT_TOO_LARGE/);

  const sheet = await upload(page, csv(PRODUCTS + 1, 90001), "qa-too-many.csv");
  await expect(sheet.getByText(/import at most 2000 products per file/i)).toBeVisible({ timeout: 60_000 });
});

test("E1 · two thousand products are imported through the screen", async ({ page, request }) => {
  test.setTimeout(600_000);

  const before = await ask<Array<Record<string, unknown>>>(request, "owner", `/products?search=${encodeURIComponent("QA Bulk Item 2000")}`);
  if (before.length === 0) {
    const started = Date.now();
    const sheet = await upload(page, csv(PRODUCTS), "qa-bulk.csv");
    await expect(sheet.getByText(new RegExp(`${PRODUCTS} created`)), "the import did not report every row created").toBeVisible({ timeout: 420_000 });
    await expect(sheet.getByText(/failed/)).toHaveCount(0);
    remember({ importSeconds: Math.round((Date.now() - started) / 1000) });
  }

  // The list says how many it holds: the six by hand and the two thousand.
  await page.goto("/tenant/products");
  await settled(page);
  await expect(page.getByText(/2,?006 items/).first()).toBeVisible({ timeout: 30_000 });
});

test("E1 · one of two thousand is found by name and by SKU, and the list pages", async ({ page, request }) => {
  const b = bulk(1337);

  await page.goto("/tenant/products");
  const search = page.getByPlaceholder("Search name or SKU…");

  await search.fill(b.name);
  const byName = page.getByRole("row").filter({ hasText: b.name }).first();
  await expect(byName).toBeVisible({ timeout: 20_000 });
  expect(((await byName.innerText()).match(/Rs\s?[0-9,]+/g) ?? []).map(rupees)).toContain(b.price);

  await search.fill(b.sku);
  await expect(page.getByRole("row").filter({ hasText: b.name }).first(), "an item could not be found by its SKU").toBeVisible({ timeout: 20_000 });

  // It was imported as typed: price, category, tax group and stock.
  const held = (await ask<Array<Record<string, unknown>>>(request, "owner", `/products?search=${b.sku}`)).find((p) => p.sku === b.sku)!;
  expect(Number(held.price)).toBe(b.price);
  expect(Number(held.tax_group_rate ?? DEFAULT_TAX)).toBe(b.rate);
  expect(Number(held.cost)).toBe(b.cost);

  // Page two is not page one.
  await search.fill("");
  await settled(page);
  const first = await page.getByRole("row").nth(1).innerText();
  await page.getByRole("button", { name: /next/i }).first().click();
  await expect.poll(async () => page.getByRole("row").nth(1).innerText(), { timeout: 20_000 }).not.toBe(first);
});

test("E3 · the till finds one of two thousand and sells it", async ({ page, request }) => {
  // ONCE. The stages after this one count sales, and a case that rings
  // another every time the file is run again would move the count under them.
  if (record().volumeTillInvoice) return;

  const b = bulk(777);
  await openTill(page);

  const started = Date.now();
  await ring(page, b.name);
  const found = Date.now() - started;
  expect(found, `the till took ${found}ms to find one product among two thousand`).toBeLessThan(8000);

  // The figure this file works out, to the paisa.
  const due = cents((b.price * (100 + b.rate)) / 100);
  expect(await tender(page, "Card")).toBe(due);
  const sale = await complete(page, request);
  expect(Number(sale.total)).toBe(due);
  remember({ volumeTillInvoice: String(sale.invoice_number), volumeTillSeconds: found / 1000 });
});

test("E2 · fifteen hundred sales are rung, each paid at a figure worked out here", async ({ request }) => {
  test.setTimeout(40 * 60_000);
  const r = record();
  if (Number(r.volumeSales ?? 0) >= SALES) return; // resumed

  // WHAT THE BOOKS SAID BEFORE. Stage D held these to hand-worked figures;
  // from here the question is what fifteen hundred sales ADD to them.
  if (!r.before) {
    remember({ before: await month(request) });
  }

  // Two people at two tills: the owner and the cashier. Each has their own
  // request budget, which is the product's rate limit doing its job.
  const ownerToken = JSON.parse(fs.readFileSync(OWNER_STATE, "utf8")).origins
    .flatMap((o: { localStorage: Array<{ name: string; value: string }> }) => o.localStorage)
    .find((i: { name: string }) => i.name === "shopos-auth");
  const login = await request.post(`${API}/auth/login`, { data: { identifier: String(r.cashierEmail), password: CASHIER.password } });
  expect(login.ok(), "the cashier could not sign in").toBeTruthy();
  const tokens = [
    (JSON.parse(ownerToken.value) as { state: { accessToken: string } }).state.accessToken,
    ((await login.json()) as { data: { access_token: string } }).data.access_token,
  ];

  // The product ids, a page at a time. This is the loop that found the
  // paging bug: 1,989 of 2,000 came back, eleven of them twice.
  const ids = new Map<number, string>();
  let rows = 0;
  for (let page = 1; page <= PRODUCTS / 100; page++) {
    const res = await request.get(`${API}/products?search=${encodeURIComponent("QA Bulk Item")}&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${tokens[0]}`, Accept: "application/json" },
    });
    for (const p of ((await res.json()) as { data: Array<{ id: string; sku: string }> }).data) {
      rows++;
      ids.set(Number(p.sku.replace("QB-", "")), p.id);
    }
  }
  expect(rows, "twenty pages of a hundred did not hold two thousand rows").toBe(PRODUCTS);
  expect(ids.size, "a product was on two pages, so another was on none").toBe(PRODUCTS);

  const refused: string[] = [];
  const invoices = new Map<number, string>();

  const till = async (who: number) => {
    for (let k = who; k < SALES; k += tokens.length) {
      const w = worked(k);

      for (let attempt = 0; attempt < 6; attempt++) {
        const started = Date.now();
        const res = await request.post(`${API}/sales`, {
          headers: { Authorization: `Bearer ${tokens[who]}`, Accept: "application/json" },
          data: {
            channel: "pos",
            // Half on a card: a card has no change, so an exact figure is the
            // only one the server will take.
            payment_method: w.card ? "card" : "cash",
            amount_paid: w.due,
            expected_payable: w.due,
            items: [{ product_id: ids.get(w.n), quantity: w.qty }],
            // The same key if this run is started again: a sale that was
            // already made comes back as itself rather than twice.
            idempotency_key: `qa-${r.stamp}-${k}`,
          },
        });

        if (res.status() === 429) {
          await new Promise((done) => setTimeout(done, (Number(res.headers()["retry-after"]) || 20) * 1000 + 500));
          continue;
        }
        if (res.status() === 201 || res.status() === 200) {
          const sale = ((await res.json()) as { data: { invoice_number: string; total: string; tax: string } }).data;
          if (Number(sale.total) !== w.due) refused.push(`sale ${k}: charged ${sale.total}, worked out ${w.due}`);
          if (Number(sale.tax) !== w.tax) refused.push(`sale ${k}: taxed ${sale.tax}, worked out ${w.tax}`);
          invoices.set(k, sale.invoice_number);
        } else {
          refused.push(`sale ${k} (${w.b.name} × ${w.qty}, ${w.due}): ${res.status()} ${(await res.text()).slice(0, 160)}`);
        }
        // A counter's pace, within each person's budget of 240 a minute.
        await new Promise((done) => setTimeout(done, Math.max(0, 265 - (Date.now() - started))));
        break;
      }
    }
  };

  const started = Date.now();
  await Promise.all(tokens.map((_, who) => till(who)));

  expect(refused.slice(0, 5), `${refused.length} of ${SALES} sales were not made at the figure worked out`).toEqual([]);
  expect(invoices.size).toBe(SALES);
  // No two sales were given the same number, with two tills ringing at once.
  expect(new Set(invoices.values()).size, "two sales were given the same invoice number").toBe(SALES);
  remember({
    volumeSales: SALES,
    volumeInvoice: invoices.get(Math.floor(SALES / 2)),
    volumeMinutes: Math.round((Date.now() - started) / 6000) / 10,
  });
});

test("E2 · the sales list holds them all, finds one by its number, and pages", async ({ page }) => {
  const r = record();
  const before = r.before as Totals;

  await page.goto("/tenant/sales");
  await settled(page);

  const count = rupees((await page.getByText(/[0-9,]+ sales/).first().innerText()));
  expect(count).toBe(before.sales_count + Number(r.volumeSales));

  await page.getByPlaceholder(/Search invoice/).fill(String(r.volumeInvoice));
  await expect(page.getByRole("row").filter({ hasText: String(r.volumeInvoice) })).toHaveCount(1, { timeout: 20_000 });

  await page.getByPlaceholder(/Search invoice/).fill("");
  await settled(page);
  const first = await page.getByRole("row").nth(1).innerText();
  await page.getByRole("button", { name: /next/i }).first().click();
  await expect.poll(async () => page.getByRole("row").nth(1).innerText(), { timeout: 20_000 }).not.toBe(first);
});

test("E2 · every sale is on exactly one page of the list", async ({ request }) => {
  test.setTimeout(300_000);
  const r = record();
  const expected = (r.before as Totals).sales_count + Number(r.volumeSales);

  // The same walk a person does with the Next button, to the end. Sales made
  // by two tills in the same second are exactly the rows that tie.
  const seen: string[] = [];
  for (let page = 1; page <= Math.ceil(expected / 100) + 1; page++) {
    const rows = await ask<Array<{ invoice_number: string }>>(request, "owner", `/sales?per_page=100&page=${page}`);
    if (rows.length === 0) break;
    seen.push(...rows.map((s) => s.invoice_number));
  }

  expect(seen.length, "the pages do not add up to the count the list shows").toBe(expected);
  expect(new Set(seen).size, "a sale is on two pages, so another is on none").toBe(expected);
});

/** A report card: the figure whose own label, right beside it, is this one. */
const card = async (page: Page, label: string): Promise<number> => {
  const value = page.locator(`xpath=//h4[preceding-sibling::*[1][normalize-space(.)="${label}"]]`).first();
  await expect(value, `the "${label}" card is not on the screen`).toBeVisible({ timeout: 30_000 });

  return rupees((await value.innerText()).replace("Rs -", "-"));
};

test("E4 · the books gained exactly what fifteen hundred sales come to", async ({ page }) => {
  const before = record().before as Totals;
  const g = gained();

  const started = Date.now();
  await page.goto("/tenant/reports");
  const sales = await card(page, "Sales");
  const took = Date.now() - started;

  expect(sales).toBe(before.sales_count + SALES);
  expect(await card(page, "Revenue")).toBe(cents(before.revenue + g.revenue));
  expect(await card(page, "Sales Tax (not yours)")).toBe(cents(before.tax + g.tax));
  expect(await card(page, "Cost of Goods")).toBe(cents(before.cogs + g.cogs));
  // Nothing was returned and nothing spent: those two do not move.
  expect(await card(page, "Refunds")).toBe(before.refunds);
  expect(await card(page, "Expenses")).toBe(before.expenses);
  // The shop's own money: what was taken, less the tax in it, less what the goods cost.
  expect(await card(page, "Gross Profit")).toBe(cents(before.gross_profit + g.revenue - g.tax - g.cogs));
  expect(await card(page, "Net Profit")).toBe(cents(before.net_profit + g.revenue - g.tax - g.cogs));

  expect(took, `Reports took ${took}ms to show a month of ${before.sales_count + SALES} sales`).toBeLessThan(10_000);
  remember({ reportsSeconds: took / 1000 });
});

test("E4 · the tax to file moved by the tax on them, and by nothing else", async ({ page }) => {
  const before = record().before as Totals;
  const g = gained();

  await page.goto("/tenant/reports");
  await page.getByRole("button", { name: "Tax", exact: true }).click();

  expect(await card(page, "Tax payable")).toBe(cents(before.tax + g.tax));
  expect(await card(page, "Gross sales")).toBe(cents(before.revenue + g.revenue));
});

test("E5 · the shelf went down by what was sold, item by item", async ({ page, request }) => {
  const g = gained();
  const tillSold = new Map([[777, 1]]); // the one rung at the till in E3

  // Every tenth item that sold, and a few that never did.
  const check = [...g.sold.keys()].filter((_, i) => i % 10 === 0).concat([2, 3, 4].filter((n) => !g.sold.has(n)));
  expect(check.length).toBeGreaterThan(50);

  const wrong: string[] = [];
  for (const n of check.slice(0, 80)) {
    const b = bulk(n);
    const held = (await ask<Array<Record<string, unknown>>>(request, "owner", `/products?search=${b.sku}`)).find((p) => p.sku === b.sku)!;
    const want = STOCK - (g.sold.get(n) ?? 0) - (tillSold.get(n) ?? 0);
    if (Number(held.stock_quantity) !== want) wrong.push(`${b.sku}: holds ${held.stock_quantity}, should hold ${want}`);
  }
  expect(wrong).toEqual([]);

  // …and the Inventory screen says so for one of them.
  const n = check[0];
  await page.goto("/tenant/inventory");
  await page.getByPlaceholder(/search/i).first().fill(bulk(n).name);
  const row = page.getByRole("row").filter({ hasText: bulk(n).name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  // Plain digits: a quantity is not money, and the shop's quantity format
  // has no separators on purpose (4999, not 4,999).
  await expect(row).toContainText(String(STOCK - g.sold.get(n)!));
});

test("E6 · every screen opens with thousands behind it — nothing refused, nothing slow", async ({ page }) => {
  test.setTimeout(900_000);
  const screens = record().screens as string[];

  const slow: string[] = [];
  const bounced: string[] = [];
  const blank: string[] = [];
  const timings: Record<string, number> = {};
  for (const href of screens) {
    const started = Date.now();
    await page.goto(href);
    await settled(page);
    const took = Date.now() - started;
    timings[href] = took;
    // Generous: this is a development server, not a tuned one. It is here to
    // catch a screen that asks for all two thousand rows at once.
    if (took > 12_000) slow.push(`${href} took ${(took / 1000).toFixed(1)}s`);
    await page.waitForTimeout(250);
    if (new URL(page.url()).pathname.replace(/\/$/, "") !== href.replace(/\/$/, "")) bounced.push(`${href} → ${new URL(page.url()).pathname}`);
    if ((await page.locator("body").innerText()).trim().length < 40) blank.push(href);
  }

  remember({ slowest: Object.entries(timings).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h, t]) => `${h} ${(t / 1000).toFixed(1)}s`) });
  expect(bounced).toEqual([]);
  expect(blank).toEqual([]);
  expect(slow).toEqual([]);
});

test("E6 · no answer the screens were sent is heavier than a page of it should be", async ({ page }) => {
  test.setTimeout(600_000);

  // A list that sends everything works with ten rows and is the whole
  // catalogue with two thousand. Measured where it is felt: on the wire.
  const heavy: string[] = [];
  page.on("response", async (res) => {
    if (!res.url().includes("/api/") || res.request().method() !== "GET") return;
    const size = Number(res.headers()["content-length"] ?? 0) || (await res.body().catch(() => Buffer.alloc(0))).length;
    const where = new URL(res.url()).pathname.replace("/api/v1", "");
    // The one answer that is MEANT to be the whole shelf: a till keeps its own
    // copy so it can sell with the line down. It comes a thousand at a time
    // and only on a device's first load — the next case holds it to that.
    if (/^\/pos\/(bootstrap|catalog)$/.test(where)) return;
    if (size > 400_000) heavy.push(`${where} — ${(size / 1024).toFixed(0)} KB`);
  });

  for (const href of ["/tenant", "/tenant/products", "/tenant/inventory", "/tenant/sales", "/tenant/pos", "/tenant/reports", "/tenant/purchase-orders", "/tenant/promotions"]) {
    await page.goto(href);
    await settled(page);
  }

  expect([...new Set(heavy)]).toEqual([]);
});

test("E7 · the till's own copy of the shelf holds every one of them, once", async ({ page }) => {
  test.setTimeout(180_000);

  // A browser that has never been a till: this is a device's first load.
  const rounds: number[] = [];
  page.on("response", async (res) => {
    if (!/\/pos\/(bootstrap|catalog)(\?|$)/.test(res.url())) return;
    const body = (await res.json().catch(() => null)) as { data?: { products?: { items?: unknown[] } } } | null;
    rounds.push(body?.data?.products?.items?.length ?? -1);
  });

  await openTill(page);

  const held = async () =>
    page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((done, fail) => {
        const open = indexedDB.open("shopos-till");
        open.onsuccess = () => done(open.result);
        open.onerror = () => fail(open.error);
      });
      if (!db.objectStoreNames.contains("catalog")) { db.close(); return { bulk: 0, distinct: 0 }; }
      const rows = await new Promise<Array<{ id: string; name?: string }>>((done, fail) => {
        const all = db.transaction("catalog").objectStore("catalog").getAll();
        all.onsuccess = () => done(all.result as Array<{ id: string; name?: string }>);
        all.onerror = () => fail(all.error);
      });
      db.close();
      const bulk = rows.filter((r) => String(r.name ?? "").startsWith("QA Bulk Item"));

      return { bulk: bulk.length, distinct: new Set(bulk.map((r) => r.name)).size };
    });

  // Two thousand imported in one second is exactly the case a cursor of time
  // alone steps over: a thousand arrive, and the rest of that second is lost.
  await expect.poll(async () => (await held()).bulk, { timeout: 90_000, message: "the till never finished copying the shelf" }).toBe(PRODUCTS);
  expect((await held()).distinct).toBe(PRODUCTS);

  // …and it came in pieces, not as one answer the size of the shop.
  expect(rounds.length, "the shelf was copied in a single request").toBeGreaterThanOrEqual(2);
  expect(Math.max(...rounds)).toBeLessThanOrEqual(1000);
});
