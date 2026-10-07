import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { API, tradeAuth } from "./api";

/**
 * A UNIT IS SOLD BY ITS NUMBER — AND COMES BACK BY IT.
 *
 * Found by the phone shop's journey (stage L), which lives its day once. This
 * is the same day somewhere it can be lived every time: each unit that is
 * sold here is brought back before the test ends, so the shelf it stands on
 * never runs down and the numbers are free for the next run.
 *
 * What the journey found, and what this holds in place:
 *
 *   the till took the money for a phone with no number, without a word
 *   scanning the number on the box found nothing
 *   the phone just sold was offered, by its number, to the next customer
 *   a number could be written on two units of one bill
 *   a refunded phone stayed "sold" under its number — the returns desk never
 *     said which unit came back, because it had nowhere to say it
 *
 * A phone shop's spec. In every other trade's project it stands aside.
 */

// NOT serial: every case puts both units on the shelf itself, so each one
// stands or falls on its own and one failure does not hide the next.

/** Fixed names, never stamped: a fixture named for the moment it ran is one more row for ever. */
const HANDSET = "E2E Numbered Handset";
const PRICE = 1000;
const UNIT = ["E2E-UNIT-0001", "E2E-UNIT-0002"] as const;

type Unit = { serial: string; status: string; sale_id: string | null };
type Row = Record<string, unknown>;

const headers = () => tradeAuth("retail");

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${API}${path}`, { headers: headers() });
  expect(res.ok(), `GET ${path} → ${res.status()} ${await res.text()}`).toBeTruthy();

  return ((await res.json()) as { data: T }).data;
}

async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const res = await request.post(`${API}${path}`, { headers: headers(), data });
  expect(res.ok(), `POST ${path} → ${res.status()} ${await res.text()}`).toBeTruthy();

  return ((await res.json()) as { data: T }).data;
}

/** The handset, carded once: sold by number, a year's cover, a shelf deep enough to never matter. */
async function handset(request: APIRequestContext): Promise<string> {
  const found = (await get<Row[]>(request, `/products?search=${encodeURIComponent(HANDSET)}&per_page=10`)).find((p) => p.name === HANDSET);
  if (found) return String(found.id);

  const made = await post<Row>(request, "/products", {
    item_type: "physical_product", name: HANDSET, description: "A fixture for selling by serial.", price: PRICE, is_active: true,
    track_inventory: true, stock_quantity: 500, tracks_serial: true, warranty_months: 12,
  });

  return String(made.id);
}

const units = (request: APIRequestContext, id: string) => get<Unit[]>(request, `/products/${id}/serials?status=all`);

/**
 * Both units on the shelf, by number, whatever the last run left behind.
 *
 * Through the shop's own doors: a unit the shop has never heard of is sold
 * once by a typed number and brought back — which is how a number that was
 * only ever typed at a till gets written down. A unit a dead run left "sold"
 * is brought back the same way.
 */
async function bothOnTheShelf(request: APIRequestContext, id: string): Promise<void> {
  for (const serial of UNIT) {
    const held = (await units(request, id)).find((u) => u.serial === serial);
    if (held?.status === "in_stock") continue;

    let saleId = held?.sale_id ?? null;
    if (!held) {
      saleId = String((await post<Row>(request, "/sales", {
        channel: "walk_in", payment_method: "cash", amount_paid: PRICE,
        items: [{ product_id: id, quantity: 1, serials: [serial] }],
      })).id);
    }
    const sale = await get<{ items: Array<{ id: string; product_id: string }> }>(request, `/sales/${saleId}`);
    const line = sale.items.find((i) => i.product_id === id)!;
    await post(request, `/sales/${saleId}/returns`, { items: [{ sale_item_id: line.id, quantity: 1, serials: [serial] }] });
  }

  const now = await units(request, id);
  for (const serial of UNIT) expect(now.find((u) => u.serial === serial)?.status, `${serial} could not be put on the shelf`).toBe("in_stock");
}

const scanBox = (page: Page): Locator => page.getByPlaceholder(/scan barcode or search/i).first();
const cartLine = (page: Page): Locator => page.locator("[data-cart-row]").filter({ hasText: HANDSET }).first();
const chip = (page: Page): Locator => cartLine(page).getByRole("button", { name: /^IMEI \d+\/\d+/ });
const numbers = (page: Page): Locator => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Serial / IMEI" }) });
const tenderSheet = (page: Page): Locator => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Tender / Pay" }) });
const tenderKey = (page: Page): Locator => page.getByRole("button", { name: /Tender \/ Pay/i });

async function till(page: Page): Promise<void> {
  await page.goto("/tenant/pos");
  await expect(scanBox(page)).toBeVisible({ timeout: 30_000 });
  // Whatever an earlier run left on the ticket is not this test's.
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  if (await reset.isEnabled().catch(() => false)) await reset.click();
  await expect(page.locator("[data-cart-row]")).toHaveCount(0);
}

async function scan(page: Page, code: string): Promise<void> {
  await scanBox(page).fill(code);
  await scanBox(page).press("Enter");
}

async function ringByName(page: Page): Promise<void> {
  await scanBox(page).fill(HANDSET);
  const tile = page.locator("[data-pos-item]").filter({ hasText: HANDSET }).first();
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await tile.click();
  await scanBox(page).fill("");
}

/** Pay cash, exact; return the invoice number the till shows. */
async function payCash(page: Page): Promise<string> {
  const sheet = tenderSheet(page);
  await expect(sheet).toBeVisible();
  await sheet.getByRole("group", { name: "Payment method" }).getByRole("button", { name: /^Cash/ }).click();
  await sheet.getByRole("button", { name: /^Exact ·/ }).click();
  await sheet.getByRole("button", { name: /^Complete/ }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" }), "the server refused the sale").toBeVisible({ timeout: 20_000 });
  const invoice = await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice");
  await page.getByRole("button", { name: "New sale" }).click();
  await expect(page.locator("[data-cart-row]")).toHaveCount(0);

  return String(invoice);
}

async function saleSheet(page: Page, invoice: string): Promise<Locator> {
  await page.goto("/tenant/sales");
  await page.getByRole("row").filter({ hasText: invoice }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: invoice }) });
  await expect(sheet).toBeVisible();

  return sheet;
}

/** Look a number up at the warranty desk; returns the banner it answers with. */
async function lookUp(page: Page, serial: string): Promise<Locator> {
  await page.goto("/tenant/warranty");
  await page.getByRole("button", { name: "Look up", exact: true }).first().click();
  await page.getByPlaceholder("Scan or type the serial / IMEI").fill(serial);
  await page.getByRole("button", { name: "Look up", exact: true }).last().click();

  return page.getByTestId("warranty-banner");
}

const saleByInvoice = async (request: APIRequestContext, invoice: string) => {
  const recent = await get<Array<{ id: string; invoice_number: string }>>(request, "/sales?per_page=20");
  const found = recent.find((s) => s.invoice_number === invoice);
  expect(found, `the till said ${invoice} and the server has no such sale`).toBeTruthy();

  return get<{ id: string; status: string; items: Row[]; serials: Array<{ serial: string; returned_at: string | null }> }>(request, `/sales/${found!.id}`);
};

test("the till asks for the number before the money, finds a unit by its number, and takes it back by it", async ({ page, request }, info) => {
  test.skip(info.project.name !== "trade-retail", "a phone shop's till — the other trades sell nothing by serial here");
  const id = await handset(request);
  await bothOnTheShelf(request, id);

  await till(page);

  // ── the number on the box, scanned ─────────────────────────────────
  await scan(page, UNIT[0]);
  await expect(cartLine(page), "scanning a unit's own number found nothing").toBeVisible({ timeout: 15_000 });
  await expect(chip(page)).toHaveText("IMEI 1/1");
  await expect(page.getByText(`${HANDSET}: unit ${UNIT[0]} is on the bill`).locator("visible=true").first()).toBeVisible();

  // ── a second handset, rung by name: no number ──────────────────────
  await ringByName(page);
  await expect(chip(page)).toHaveText("IMEI 1/2");

  // The money waits for it.
  await tenderKey(page).click();
  const sheet = numbers(page);
  await expect(sheet, "the till went to the money for a unit with no number").toBeVisible();
  await expect(sheet.getByTestId("numbers-asked")).toContainText("this unit has no number");
  await expect(tenderSheet(page)).toHaveCount(0);

  // The same number on both units is one of them wrong.
  await sheet.getByLabel("Serial / IMEI of unit 2").fill(UNIT[0]);
  await expect(sheet.getByText("This number is written on another unit of this bill.").first()).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();
  // Done, with a number written twice, is not the way to the money.
  await expect(tenderSheet(page)).toHaveCount(0);
  await tenderKey(page).click();
  await expect(sheet).toBeVisible();
  await expect(tenderSheet(page)).toHaveCount(0);
  await sheet.getByLabel("Serial / IMEI of unit 2").fill("");

  // "Sell without a number" is something the cashier SAYS — then the money.
  await sheet.getByRole("button", { name: "Sell without a number" }).click();
  await expect(tenderSheet(page)).toBeVisible();
  await tenderSheet(page).getByRole("button", { name: "Cancel" }).click();
  await expect(chip(page)).toHaveText(/IMEI 1\/2 · without/);

  // A number is written against the second unit after all…
  await chip(page).click();
  await sheet.getByLabel("Serial / IMEI of unit 2").fill("E2E-GHOST-0009");
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(chip(page)).toHaveText("IMEI 2/2");

  // …and then the customer takes only one. The second number is in a slot the
  // line no longer has: the sheet no longer draws it, and it must not be SENT.
  const qty = cartLine(page).locator("input").first();
  await qty.fill("1");
  await qty.press("Enter");
  await expect(chip(page)).toHaveText("IMEI 1/1");

  // Nothing owed: Tender goes straight to the money.
  await tenderKey(page).click();
  const invoice = await payCash(page);

  const sale = await saleByInvoice(request, invoice);
  expect(sale.serials.map((s) => s.serial), "the bill does not carry the unit that was scanned").toEqual([UNIT[0]]);
  expect((await units(request, id)).find((u) => u.serial === UNIT[0])?.status).toBe("sold");

  // ── the next customer, straight away ───────────────────────────────
  await ringByName(page);
  await chip(page).click();
  await expect(sheet.getByRole("button", { name: UNIT[1], exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByRole("button", { name: UNIT[0], exact: true }), "the unit just sold is offered to the next customer").toHaveCount(0);
  await sheet.getByRole("button", { name: "Done" }).click();
  await cartLine(page).getByRole("button", { name: "Remove" }).click();

  // ── the warranty desk, while it is out ─────────────────────────────
  let banner = await lookUp(page, UNIT[0]);
  await expect(banner).toHaveAttribute("data-state", "covered", { timeout: 15_000 });
  // A NUMBER OF DAYS: it read "365.9999999999884 days left".
  const said = (await banner.innerText()).match(/(\S+) days left/);
  expect(said, `the desk did not say how many days are left: ${await banner.innerText()}`).toBeTruthy();
  expect(said![1], "the days left are not a whole number").toMatch(/^\d+$/);
  const card = banner.locator("xpath=ancestor::div[1]");
  await expect(card).toContainText(invoice);
  await expect(card.getByText("Completed", { exact: true })).toBeVisible();

  // ── and it comes back ──────────────────────────────────────────────
  const detail = await saleSheet(page, invoice);
  await detail.getByRole("button", { name: "Return / Refund" }).click();
  await detail.getByLabel(`How many ${HANDSET} to return`).fill("1");
  // The only unit on the bill: nothing to choose, and the sheet says which number.
  await expect(detail.getByTestId("units-back-all")).toContainText(UNIT[0]);
  await detail.getByRole("button", { name: "Refund & restock" }).click();
  await expect(page.getByRole("row").filter({ hasText: invoice }).first()).toContainText(/refunded/i, { timeout: 20_000 });

  expect((await units(request, id)).find((u) => u.serial === UNIT[0])?.status, "the refunded unit is still 'sold' under its number").toBe("in_stock");
  const desk = await get<{ under_warranty: boolean; came_back: { as: string } | null; on_shelf: boolean; days_left: number }>(request, `/warranty/lookup?serial=${UNIT[0]}`);
  expect(desk.under_warranty, "a refunded unit is still under the customer's warranty").toBe(false);
  expect(desk.came_back?.as).toBe("returned");
  expect(desk.on_shelf).toBe(true);

  // …and the desk SAYS so, instead of a warranty verdict for somebody who has their money back.
  banner = await lookUp(page, UNIT[0]);
  await expect(banner, "a refunded unit still reads 'Under warranty' at the desk").toHaveAttribute("data-state", "came-back", { timeout: 15_000 });
  await expect(banner).toContainText("This unit came back");
  await expect(banner).toContainText("it is on the shelf again");
  await expect(banner.locator("xpath=ancestor::div[1]").getByText("Was sold to")).toBeVisible();
});

test("two units on one bill, one comes back — the returns sheet will not take it until it is told which", async ({ page, request }, info) => {
  test.skip(info.project.name !== "trade-retail", "a phone shop's till — the other trades sell nothing by serial here");
  const id = await handset(request);
  await bothOnTheShelf(request, id);

  await till(page);
  await scan(page, UNIT[0]);
  await expect(chip(page)).toHaveText("IMEI 1/1", { timeout: 15_000 });
  await scan(page, UNIT[1]);
  await expect(chip(page), "a second unit scanned by number did not join the line").toHaveText("IMEI 2/2", { timeout: 15_000 });
  await expect(page.locator("[data-cart-row]")).toHaveCount(1);

  await tenderKey(page).click();
  const invoice = await payCash(page);

  // ── one of the two ─────────────────────────────────────────────────
  let detail = await saleSheet(page, invoice);
  await detail.getByRole("button", { name: "Return / Refund" }).click();
  await detail.getByLabel(`How many ${HANDSET} to return`).fill("1");
  const which = detail.getByTestId("units-back-pick");
  await expect(which).toContainText(`Which unit of ${HANDSET} came back?`);
  const refund = detail.getByRole("button", { name: "Refund & restock" });
  await expect(refund, "one of two units could be refunded without saying which").toBeDisabled();

  await which.getByLabel(UNIT[1]).check();
  await expect(which.getByLabel(UNIT[0]), "a second unit could be ticked for a return of one").toBeDisabled();
  await expect(refund).toBeEnabled();
  await refund.click();
  await expect(detail.getByText("Partially refunded", { exact: true })).toBeVisible({ timeout: 20_000 });

  // THAT one is the shop's again; the other is still the customer's.
  let held = await units(request, id);
  expect(held.find((u) => u.serial === UNIT[1])?.status, "the unit that was named did not go back on the shelf").toBe("in_stock");
  expect(held.find((u) => u.serial === UNIT[0])?.status, "the unit that was NOT named was taken back too").toBe("sold");

  // The sale's own sheet says which came back.
  const listed = detail.getByText("Serials / IMEI").locator("xpath=ancestor::div[1]");
  await expect(listed.locator("div").filter({ hasText: UNIT[1] }).first()).toContainText("came back");
  await expect(listed.locator("div").filter({ hasText: UNIT[0] }).first()).toContainText("warranty to");

  // ── and then the other: the last unit on the bill needs no naming ──
  detail = await saleSheet(page, invoice);
  await detail.getByRole("button", { name: "Return / Refund" }).click();
  await detail.getByLabel(`How many ${HANDSET} to return`).fill("1");
  await expect(detail.getByTestId("units-back-all")).toContainText(UNIT[0]);
  await expect(detail.getByTestId("units-back-pick")).toHaveCount(0);
  await detail.getByRole("button", { name: "Refund & restock" }).click();
  await expect(page.getByRole("row").filter({ hasText: invoice }).first()).toContainText(/refunded/i, { timeout: 20_000 });

  held = await units(request, id);
  for (const serial of UNIT) expect(held.find((u) => u.serial === serial)?.status).toBe("in_stock");
});

test("a faulty unit is swapped for another: the exchange sheet takes one number in and writes the other going out", async ({ page, request }, info) => {
  test.skip(info.project.name !== "trade-retail", "a phone shop's till — the other trades sell nothing by serial here");
  const id = await handset(request);
  await bothOnTheShelf(request, id);

  await till(page);
  await scan(page, UNIT[0]);
  await expect(chip(page)).toHaveText("IMEI 1/1", { timeout: 15_000 });
  await tenderKey(page).click();
  const invoice = await payCash(page);

  const detail = await saleSheet(page, invoice);
  await detail.getByRole("button", { name: "Exchange", exact: true }).click();

  // Handed back: the one unit on the bill, said by its number.
  await detail.getByLabel(`How many ${HANDSET} to hand back`).fill("1");
  await expect(detail.getByTestId("units-back-all")).toContainText(UNIT[0]);

  // Going out: another of the same — and the sheet asks for ITS number.
  await detail.getByPlaceholder("Search products…").fill(HANDSET);
  await detail.getByRole("button", { name: new RegExp(`^${HANDSET}`) }).first().click();
  const out = detail.getByLabel(`Serial / IMEI of ${HANDSET} going out`);
  await expect(out, "the replacement goes out with nowhere to write its number").toBeVisible();
  await expect(detail.getByText("No number written — the warranty desk will not be able to find this unit.")).toBeVisible();
  // The unit on the shelf is offered; the one being handed back is not on it yet.
  await expect(detail.getByRole("button", { name: UNIT[0], exact: true })).toHaveCount(0);
  await detail.getByRole("button", { name: UNIT[1], exact: true }).click();
  await expect(out).toHaveValue(UNIT[1]);
  await expect(detail.getByText(/No number written/)).toHaveCount(0);

  await detail.getByRole("button", { name: "Complete exchange" }).click();
  await expect(page.getByRole("row").filter({ hasText: invoice }).first()).toContainText(/refunded/i, { timeout: 20_000 });

  // One in, one out — each under its own number.
  const held = await units(request, id);
  expect(held.find((u) => u.serial === UNIT[0])?.status, "the unit handed back is not on the shelf by its number").toBe("in_stock");
  expect(held.find((u) => u.serial === UNIT[1])?.status, "the replacement went out and is still on the shelf").toBe("sold");

  const desk = await get<{ under_warranty: boolean; sale: { invoice_number: string } }>(request, `/warranty/lookup?serial=${UNIT[1]}`);
  expect(desk.under_warranty, "the replacement left with no number on its bill").toBe(true);
  expect(desk.sale.invoice_number).not.toBe(invoice);
  // (The next run's first step brings UNIT[1] back.)
});

test("goods-in: an order of numbered units is received on the sheet that asks, and the sheet will not send numbers that do not add up", async ({ page, request }, info) => {
  test.skip(info.project.name !== "trade-retail", "a phone shop's goods-in — the other trades receive nothing by serial here");
  const id = await handset(request);

  // ONE order, placed once and never received: every run reads the same sheet
  // and presses Cancel, so nothing arrives and no number is ever used up.
  const SUPPLIER = "E2E Handset Supplier";
  let supplier = (await get<Row[]>(request, "/suppliers?per_page=100")).find((x) => x.name === SUPPLIER);
  supplier ??= await post<Row>(request, "/suppliers", { name: SUPPLIER });
  const waiting = (await get<Array<Row & { supplier?: { name?: string } }>>(request, "/purchase-orders?per_page=100"))
    .some((po) => po.status === "ordered" && po.supplier?.name === SUPPLIER);
  if (!waiting) {
    await post(request, "/purchase-orders", {
      supplier_id: supplier.id, order_date: new Date().toLocaleDateString("en-CA"), status: "ordered",
      items: [{ product_id: id, quantity: 2, unit_cost: 800 }],
    });
  }

  await page.goto("/tenant/purchases");
  await page.getByRole("row").filter({ hasText: SUPPLIER }).filter({ hasText: /ordered/i }).first().click();
  const detail = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Receive with details…" }) });
  await expect(detail).toBeVisible({ timeout: 15_000 });

  // ONE PRESS IS NOT OFFERED: it would shelve two handsets with no number against either.
  await expect(detail.getByRole("button", { name: /Receive all/ }), "numbered units could be received in one press, without their numbers").toHaveCount(0);
  await detail.getByRole("button", { name: "Receive with details…" }).click();

  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Receive goods" }) });
  const numbers = sheet.getByRole("textbox", { name: /^Serials \/ IMEIs/ });
  const receive = sheet.getByRole("button", { name: /^Receive → stock in/ });

  // Three numbers for two boxes.
  await numbers.fill("E2E-IN-1\nE2E-IN-2\nE2E-IN-3");
  await expect(sheet.getByText("More serials than units received.")).toBeVisible();
  await expect(receive, "three numbers could be sent against two boxes").toBeDisabled();

  // The same box scanned twice.
  await numbers.fill("E2E-IN-1\nE2E-IN-1");
  await expect(sheet.getByText("E2E-IN-1 is written twice.")).toBeVisible();
  await expect(receive, "a number written twice could be sent").toBeDisabled();

  // One number for two boxes is allowed — and the sheet says what it means.
  await numbers.fill("E2E-IN-1");
  await expect(sheet.getByTestId("receive-unnumbered")).toContainText("1 of 2 will go on the shelf with no number");
  await expect(receive).toBeEnabled();

  // Both: nothing left to say.
  await numbers.fill("E2E-IN-1\nE2E-IN-2");
  await expect(sheet.getByTestId("receive-unnumbered")).toHaveCount(0);
  await expect(receive).toBeEnabled();

  // Nothing is received: this order is the fixture.
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
});
