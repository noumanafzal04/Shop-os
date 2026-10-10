import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { API, roomToWork, tradeAuth } from "./api";

/**
 * WHO OWES THE PLATFORM — through the screen.
 *
 * The commission screen was every shop on one page, in one grey table, under
 * a single figure. What a shop had been BILLED and not paid was a count of
 * invoices, not money, so the shop owing most could sit at the bottom. An
 * invoice could be raised for "this month" and nothing else, sight unseen.
 *
 * This walks what it is now:
 *
 *   four figures counted by the server — two of them the fastest way to the
 *     shops they count, and none of them moved by being pressed
 *   both piles as money on every row, ordered by the two together
 *   narrowed by standing, by whose rate, by name; put in another order; paged
 *   and all of that in the address, so it survives a refresh
 *   a shop's panel says what an invoice WOULD bill before it is raised, for a
 *     period that is chosen — and an invoice raised by mistake is withdrawn
 *
 * The one write is made on a QA shop and undone: the charges are outstanding
 * again when it ends.
 */

type Row = {
  id: string; business_name: string; outstanding_orders: number; outstanding_amount: number;
  unpaid_invoices: number; unpaid_amount: number; owed: number; commission_rate: number | null;
};
type Summary = {
  shops: number;
  unbilled: { shops: number; orders: number; amount: number };
  invoiced: { shops: number; invoices: number; amount: number };
  rates: { own: number; platform: number };
};
type Listing = { data: Row[]; meta: { pagination: { total: number; last_page: number }; summary: Summary } };

const admin = () => tradeAuth("admin");

async function listing(request: APIRequestContext, query = ""): Promise<Listing> {
  const res = await request.get(`${API}/admin/commission${query}`, { headers: admin() });
  expect(res.ok(), `the commission list could not be read for ${query || "everything"} (${res.status()})`).toBeTruthy();

  return (await res.json()) as Listing;
}

async function shopDetail(request: APIRequestContext, id: string) {
  const res = await request.get(`${API}/admin/commission/${id}`, { headers: admin() });
  expect(res.ok()).toBeTruthy();

  return ((await res.json()) as {
    data: {
      outstanding: { orders: number; amount: number };
      charges: Array<{ charged_at: string; amount: number }>;
      invoices: Array<{ id: string; number: string; status: string; amount: number }>;
    };
  }).data;
}

/** "Rs 73,513.51" → 73513.51 */
const amountIn = async (cell: Locator): Promise<number> => Number((await cell.innerText()).replace(/[^0-9.-]/g, ""));

const figures = (page: Page) => page.getByTestId("commission-figures");
const tile = (page: Page, label: string) => figures(page).getByText(label, { exact: true }).locator("xpath=ancestor::*[self::button or self::div][contains(@class,'rounded-2xl')][1]");
const table = (page: Page) => page.getByTestId("commission-table");
const names = async (page: Page): Promise<string[]> =>
  table(page).locator("tbody tr[data-shop]").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-shop") ?? ""));
const searchParams = (page: Page) => new URL(page.url()).searchParams;

// One signed-in admin, 240 requests a minute: wait for the minute to turn
// rather than be refused half-way through a test. See roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, tradeAuth("admin"));
});

test("who owes the platform is a list that can be read, narrowed and acted on", async ({ page, request }) => {
  const whole = await listing(request);
  expect(whole.data.length, "this needs shops on the platform").toBeGreaterThan(0);

  await page.goto("/admin/commission");
  await expect(page.getByRole("heading", { name: "Commission", level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(table(page).locator("tbody tr[data-shop]").first()).toBeVisible({ timeout: 20_000 });

  // ── the figures are the server's ──────────────────────────────────
  const unbilledTile = tile(page, "Not yet billed");
  const invoicedTile = tile(page, "Billed, unpaid");
  expect(Math.abs((await amountIn(unbilledTile.locator("p").nth(1))) - whole.meta.summary.unbilled.amount)).toBeLessThan(0.01);
  await expect(unbilledTile).toContainText(`${whole.meta.summary.unbilled.orders} order`);
  await expect(unbilledTile).toContainText(`${whole.meta.summary.unbilled.shops} shop`);
  expect(Math.abs((await amountIn(invoicedTile.locator("p").nth(1))) - whole.meta.summary.invoiced.amount)).toBeLessThan(0.01);
  await expect(tile(page, "On a rate of their own").locator("p").nth(1)).toHaveText(String(whole.meta.summary.rates.own));

  // ── both piles on every row, the most owed first ──────────────────
  expect(await names(page)).toEqual(whole.data.map((r) => r.business_name));
  const top = whole.data[0];
  const topRow = table(page).locator(`tr[data-shop="${top.business_name}"]`);
  await expect(topRow.locator("td").nth(1)).toContainText(top.commission_rate === null ? "platform" : "own");
  if (top.owed > 0) expect(Math.abs((await amountIn(topRow.locator("td").nth(4))) - top.owed)).toBeLessThan(0.01);
  // Largest first: no row owes more than the one above it.
  const owed = whole.data.map((r) => r.owed);
  expect(owed, "the list is not ordered by what is owed").toEqual([...owed].sort((a, b) => b - a));

  // ── a figure is a filter, and pressing it does not move it ────────
  await unbilledTile.click();
  await expect(page).toHaveURL(/standing=unbilled/);
  await expect(unbilledTile).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Remove filter Standing: Not yet billed" })).toBeVisible();
  const unbilled = await listing(request, "?standing=unbilled");
  await expect.poll(() => names(page)).toEqual(unbilled.data.map((r) => r.business_name));
  await expect(page.getByText(`${unbilled.meta.pagination.total} shop`, { exact: false }).last()).toBeVisible();
  expect(Math.abs((await amountIn(unbilledTile.locator("p").nth(1))) - whole.meta.summary.unbilled.amount), "the figure moved when it was pressed").toBeLessThan(0.01);
  // Every row left has something not yet billed.
  for (const row of unbilled.data) expect(row.outstanding_orders).toBeGreaterThan(0);

  // ── narrowed further, and it is all in the address ────────────────
  await page.getByRole("combobox").nth(1).selectOption("platform");
  await expect(page).toHaveURL(/rate=platform/);
  const both = await listing(request, "?standing=unbilled&rate=platform");
  await expect.poll(() => names(page)).toEqual(both.data.map((r) => r.business_name));

  await page.reload();
  await expect(table(page).locator("tbody tr[data-shop]").first()).toBeVisible({ timeout: 20_000 });
  expect(searchParams(page).get("standing")).toBe("unbilled");
  expect(searchParams(page).get("rate")).toBe("platform");
  await expect.poll(() => names(page)).toEqual(both.data.map((r) => r.business_name));

  await page.getByRole("button", { name: "Clear all" }).click();
  expect(searchParams(page).has("standing")).toBeFalsy();
  expect(searchParams(page).has("rate")).toBeFalsy();
  await expect.poll(() => names(page)).toEqual(whole.data.map((r) => r.business_name));

  // ── another order ─────────────────────────────────────────────────
  await page.getByRole("combobox").nth(2).selectOption("name");
  await expect(page).toHaveURL(/sort=name/);
  const byName = await listing(request, "?sort=name");
  await expect.poll(() => names(page)).toEqual(byName.data.map((r) => r.business_name));

  // ── a page at a time ──────────────────────────────────────────────
  if (byName.meta.pagination.last_page > 1) {
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/page=2/);
    const second = await listing(request, "?sort=name&page=2");
    await expect.poll(() => names(page)).toEqual(second.data.map((r) => r.business_name));
    // A filter changed on page two starts again at page one.
    await page.getByRole("combobox").nth(2).selectOption("");
    expect(searchParams(page).has("page"), "changing the order kept a page number that may not exist").toBeFalsy();
  } else {
    await page.getByRole("combobox").nth(2).selectOption("");
  }

  // ── by name ───────────────────────────────────────────────────────
  const wanted = whole.data[whole.data.length - 1].business_name;
  await page.getByLabel("Search shops").fill(wanted);
  await expect.poll(() => names(page), { timeout: 15_000 }).toContain(wanted);
  const found = await listing(request, `?search=${encodeURIComponent(wanted)}`);
  await expect.poll(() => names(page)).toEqual(found.data.map((r) => r.business_name));
  await page.getByLabel("Search shops").fill("");
  await expect.poll(() => names(page), { timeout: 15_000 }).toEqual(whole.data.map((r) => r.business_name));
});

test("an invoice says what it would bill before it is raised, and one raised by mistake is withdrawn", async ({ page, request }) => {
  // A QA shop with something not yet billed. Never one of the demo shops a
  // person might be looking at.
  const unbilled = await listing(request, "?standing=unbilled&sort=name");
  const shop = unbilled.data.find((r) => /^(Sweep|QA) /.test(r.business_name) && r.unpaid_invoices === 0);
  test.skip(shop === undefined, "no QA shop has commission waiting to be billed — complete an online order on one");

  const before = await shopDetail(request, shop!.id);
  const summaryBefore = (await listing(request)).meta.summary;

  await page.goto(`/admin/commission?search=${encodeURIComponent(shop!.business_name)}`);
  await table(page).locator(`tr[data-shop="${shop!.business_name}"]`).getByRole("button", { name: `Open ${shop!.business_name}` }).click();
  const panel = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: shop!.business_name }) });
  await expect(panel).toBeVisible();
  const would = panel.getByTestId("invoice-would-bill");
  const raise = panel.getByRole("button", { name: "Raise invoice", exact: true });
  const period = panel.locator('button[aria-haspopup="listbox"]');

  // ── a period with nothing in it bills nothing, and says so ────────
  // Charges are filed by the day they were earned; find a named period that
  // holds none of this shop's, and one that holds all of them.
  const days = before.charges.map((c) => c.charged_at.slice(0, 10)).sort();
  const now = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const lastMonth = { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  const inLastMonth = days.filter((d) => d >= lastMonth.from && d <= lastMonth.to).length;

  await period.click();
  await page.getByRole("listbox", { name: "Period" }).getByRole("option", { name: /^Last month/ }).click();
  if (inLastMonth === 0) {
    await expect(would).toContainText("Nothing was earned in");
    await expect(raise, "an invoice for nothing could be raised").toBeDisabled();
  } else {
    await expect(would).toContainText(`${inLastMonth} of ${before.charges.length}`);
  }

  // ── a period that holds them all ──────────────────────────────────
  // Two picked dates: the day the oldest was earned, to today.
  await period.click();
  await page.getByRole("button", { name: /Custom range/ }).click();
  const picker = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Pick a custom range" }) });
  const cellFor = (day: string) =>
    page.evaluate(([y, m, d]) => new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }), day.split("-").map(Number));
  const first = picker.getByRole("button", { name: await cellFor(days[0]), exact: true });
  for (let back = 0; back < 12 && (await first.count()) === 0; back++) await picker.getByRole("button", { name: "Previous month" }).click();
  await first.first().click();
  const last = picker.getByRole("button", { name: await cellFor(iso(now)), exact: true });
  for (let on = 0; on < 12 && (await last.count()) === 0; on++) await picker.getByRole("button", { name: "Next month" }).click();
  await last.first().click();
  await picker.getByRole("button", { name: "Apply range" }).click();

  await expect(would).toContainText(`${before.charges.length} of ${before.charges.length}`);
  // …and for how much, before anything is raised.
  await expect(would).toContainText(before.outstanding.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  // ── raised: it is billed, and no longer "not yet" ─────────────────
  await raise.click();
  await expect(panel.getByText("unpaid", { exact: true })).toBeVisible({ timeout: 20_000 });
  const raised = await shopDetail(request, shop!.id);
  const invoice = raised.invoices.find((i) => i.status === "unpaid");
  expect(invoice, "no invoice was raised").toBeDefined();
  expect(Math.abs(invoice!.amount - before.outstanding.amount), "the invoice is not for what the panel said it would be").toBeLessThan(0.01);
  expect(raised.outstanding.orders, "billed orders are still shown as not yet billed").toBe(0);
  const summaryAfter = (await listing(request)).meta.summary;
  expect(Math.abs(summaryAfter.invoiced.amount - summaryBefore.invoiced.amount - before.outstanding.amount)).toBeLessThan(0.01);
  expect(Math.abs(summaryBefore.unbilled.amount - summaryAfter.unbilled.amount - before.outstanding.amount)).toBeLessThan(0.01);
  await expect(would).toContainText("Nothing has been earned that is not already on an invoice");

  // ── and withdrawn, with a reason: owed again, nothing lost ────────
  await panel.getByRole("button", { name: "Withdraw" }).click();
  const why = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Withdraw this invoice" }) });
  const confirm = why.getByRole("button", { name: "Confirm" });
  await expect(confirm, "an invoice could be withdrawn without saying why").toBeDisabled();
  await why.getByPlaceholder("Order was refunded in full").fill("Raised by an automated check — nothing to collect.");
  await confirm.click();
  await expect(panel.getByText("withdrawn", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  const after = await shopDetail(request, shop!.id);
  expect(after.outstanding.orders).toBe(before.outstanding.orders);
  expect(Math.abs(after.outstanding.amount - before.outstanding.amount)).toBeLessThan(0.01);
  expect((await listing(request)).meta.summary.unbilled.amount).toBeCloseTo(summaryBefore.unbilled.amount, 2);
});

test("a shop given a rate of its own says so, and stops saying so when it is handed back", async ({ page, request }) => {
  // A QA shop that follows the platform — and is put back that way at the end.
  const followers = await listing(request, "?rate=platform&sort=name");
  const shop = followers.data.find((r) => /^(Sweep|QA) /.test(r.business_name));
  test.skip(shop === undefined, "no QA shop follows the platform rate");
  const ownBefore = followers.meta.summary.rates.own;

  const handBack = async () => {
    const res = await request.put(`${API}/admin/commission/${shop!.id}/rate`, { headers: admin(), data: { commission_rate: null } });
    expect(res.ok(), `the shop could not be put back on the platform rate (${res.status()})`).toBeTruthy();
  };

  try {
    await page.goto(`/admin/commission?search=${encodeURIComponent(shop!.business_name)}`);
    const row = table(page).locator(`tr[data-shop="${shop!.business_name}"]`);
    await expect(row.locator("td").nth(1)).toContainText("platform", { timeout: 20_000 });

    await row.getByRole("button", { name: `Open ${shop!.business_name}` }).click();
    const panel = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: shop!.business_name }) });
    const box = panel.getByRole("spinbutton");
    // Blank is "follows the platform" — the box is empty, not showing a nought.
    await expect(box).toHaveValue("");
    await box.fill("3.5");
    await panel.getByRole("button", { name: "Save", exact: true }).click();

    await expect(row.locator("td").nth(1)).toContainText("3.5% · own", { timeout: 20_000 });
    await expect(tile(page, "On a rate of their own").locator("p").nth(1)).toHaveText(String(ownBefore + 1));
    // And it is found under "on a rate of their own".
    expect((await listing(request, "?rate=own")).data.map((r) => r.id)).toContain(shop!.id);

    // Handed back: blank, not nought. Nought would be a promise to charge nothing.
    await box.fill("");
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await expect(row.locator("td").nth(1)).toContainText("platform", { timeout: 20_000 });
    await expect(tile(page, "On a rate of their own").locator("p").nth(1)).toHaveText(String(ownBefore));
    expect((await listing(request, "?rate=own")).data.map((r) => r.id)).not.toContain(shop!.id);
  } finally {
    await handBack();
  }
});
