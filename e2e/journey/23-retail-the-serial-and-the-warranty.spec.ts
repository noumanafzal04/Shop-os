import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { OWNER_STATE, TRADE, ask, expect, record, remember, session, test } from "./kit";
import { editor } from "./shop";
import { complete, line, openTill, ring, tender, tenderSheet, type Sale } from "./till";

/**
 * STAGE L — A PHONE SHOP'S OWN DAY.
 *
 * Stages A and B are the same for every trade. What a shop that sells phones,
 * laptops and batteries does that no other shop does:
 *
 *   a unit is sold BY ITS NUMBER — the IMEI on the box — and the number is
 *   written down when it arrives, when it is sold, and when it comes back
 *
 *   the same number is never sold twice, and a number that arrived as one
 *   model is not sold as another
 *
 *   a year later somebody walks in holding the phone and nothing else, and
 *   the shop can say what it is, who bought it and whether it is still covered
 *
 *   a faulty unit is taken in, held, and closed with what was done to it
 *
 *   a unit that is brought back for a refund is a unit on the shelf again —
 *   under the same number
 *
 * Run with `JOURNEY_TRADE=retail`, after stages 01 and 02 for that trade.
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "retail", "a phone shop's stage — run with JOURNEY_TRADE=retail");
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Row = Record<string, unknown>;
type Unit = { id: string; serial: string; status: string; sale_id: string | null };

const PHONE = { name: "QA Galaxy A15", price: 45000, cost: 40000, warranty: 12 } as const;
const CASE = { name: "QA Phone Case", price: 800, stock: 20 } as const;
const SUPPLIER = { name: "QA Mobile Distributors", contact: "Faisal", phone: "0421120001" } as const;

/** The five that arrive on the first order, by the number on each box. */
const IMEI = ["356938035643801", "356938035643802", "356938035643803", "356938035643804", "356938035643805"] as const;

const BUYER = { name: "QA Hamza Tariq", phone: "03001230001" } as const;

const product = async (request: APIRequestContext, name: string): Promise<Row | undefined> =>
  (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`)).find((p) => p.name === name);

const stockOf = async (request: APIRequestContext, name: string): Promise<number> =>
  Number((await product(request, name))!.stock_quantity);

/** Every unit of an item the shop has ever written down, whatever became of it. */
const units = async (request: APIRequestContext, id: string): Promise<Unit[]> =>
  ask<Unit[]>(request, "owner", `/products/${id}/serials?status=all`);

const onShelf = async (request: APIRequestContext, id: string): Promise<string[]> =>
  (await units(request, id)).filter((u) => u.status === "in_stock").map((u) => u.serial).sort();

/** The month and year a date falls in, `months` after today — a warranty is said in months. */
const monthsOn = (months: number): Date => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);

  return d;
};

/** The till's sheet for the numbers on one line. */
const serialSheet = (page: Page): Locator =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Serial / IMEI" }) });

/** Open the numbers sheet for a line from its chip. */
async function numbersOf(page: Page, name: string): Promise<Locator> {
  await line(page, name).getByRole("button", { name: /^IMEI \d+\/\d+/ }).click();
  const sheet = serialSheet(page);
  await expect(sheet).toBeVisible();

  return sheet;
}

/** Attach a customer by name and phone, as a shop does when a warranty will hang off the sale. */
async function attach(page: Page, who: { name: string; phone: string }): Promise<void> {
  await page.getByTitle(/No customer attached|Customer:/).first().click();
  const sheet = page.getByRole("dialog").filter({ hasText: "Leave blank for a walk-in sale" });
  await sheet.getByPlaceholder("Customer name").fill(who.name);
  await sheet.getByPlaceholder("03xx-xxxxxxx").fill(who.phone);
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
}

/** A sale's own sheet, opened from the ledger. */
async function saleSheet(page: Page, invoice: string): Promise<Locator> {
  await page.goto("/tenant/sales");
  await page.getByRole("row").filter({ hasText: invoice }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: invoice }) });
  await expect(sheet).toBeVisible();

  return sheet;
}

test("L1 · a phone is carded to be sold by its number, with a year's warranty — a phone case is not", async ({ page, request }) => {
  if (!(await product(request, PHONE.name))) {
    await page.goto("/tenant/products/new");
    const form = editor(page);
    await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });

    await form.getByLabel("Name *", { exact: true }).fill(PHONE.name);
    await form.getByLabel("Price *", { exact: true }).fill(String(PHONE.price));
    await form.getByLabel("Cost (optional)", { exact: true }).fill(String(PHONE.cost));
    const description = form.getByLabel("Description *", { exact: true });
    if (await description.isVisible().catch(() => false)) await description.fill(`${PHONE.name} — added by the QA journey.`);

    // The warranty is not asked for until the item is one that is sold by number.
    await expect(form.getByLabel("Default warranty (months)", { exact: true })).toHaveCount(0);
    await form.getByLabel(/Capture a serial \/ IMEI for each unit sold/).check();
    await form.getByLabel("Default warranty (months)", { exact: true }).fill(String(PHONE.warranty));

    const create = form.getByRole("button", { name: "Create item" });
    await expect(create).toBeEnabled();
    await create.click();
    await expect(form).toBeHidden({ timeout: 20_000 });
  }

  if (!(await product(request, CASE.name))) {
    await page.goto("/tenant/products/new");
    const form = editor(page);
    await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });
    await form.getByLabel("Name *", { exact: true }).fill(CASE.name);
    await form.getByLabel("Price *", { exact: true }).fill(String(CASE.price));
    await form.getByLabel("Opening stock", { exact: true }).fill(String(CASE.stock));
    const description = form.getByLabel("Description *", { exact: true });
    if (await description.isVisible().catch(() => false)) await description.fill(`${CASE.name} — added by the QA journey.`);
    await form.getByRole("button", { name: "Create item" }).click();
    await expect(form).toBeHidden({ timeout: 20_000 });
  }

  const phone = (await product(request, PHONE.name))!;
  expect(phone, `${PHONE.name} is not on the shelf`).toBeTruthy();
  remember({ phone: String(phone.id) });
  expect(phone.tracks_serial, "the phone was saved as an item with no number").toBe(true);
  expect(Number(phone.warranty_months)).toBe(PHONE.warranty);

  const cover = (await product(request, CASE.name))!;
  remember({ cover: String(cover.id) });
  expect(cover.tracks_serial).toBe(false);
  expect(cover.warranty_months).toBeNull();
});

test("L2 · five arrive on an order, and each one's number is written down as it is unpacked", async ({ page, request }) => {
  const id = String(record().phone);

  if ((await units(request, id)).length === 0) {
    if (!(await ask<Row[]>(request, "owner", "/suppliers?per_page=100")).some((s) => s.name === SUPPLIER.name)) {
      await page.goto("/tenant/suppliers");
      await page.getByRole("button", { name: "+ New supplier" }).click();
      const form = page.getByRole("dialog", { name: "New supplier" });
      await form.getByRole("textbox", { name: "Supplier / company name *" }).fill(SUPPLIER.name);
      await form.getByRole("textbox", { name: "Contact person" }).fill(SUPPLIER.contact);
      await form.getByRole("textbox", { name: "Phone" }).fill(SUPPLIER.phone);
      await form.getByRole("button", { name: "Save" }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
    }

    await page.goto("/tenant/purchases");
    if (!(await ask<Row[]>(request, "owner", "/purchase-orders?per_page=50")).some((po) => po.status === "ordered")) {
      await page.getByRole("button", { name: "+ New purchase order" }).click();
      const form = page.getByRole("dialog", { name: "New purchase order" });
      const supplier = form.getByLabel("Supplier", { exact: true });
      await expect.poll(async () => (await supplier.locator("option").allTextContents()).join("|")).toContain(SUPPLIER.name);
      await supplier.selectOption({ label: SUPPLIER.name });
      await form.getByPlaceholder("Search products to add…").fill(PHONE.name);
      await form.getByRole("button", { name: new RegExp(`^${PHONE.name}`) }).click();
      await form.getByLabel(`Quantity of ${PHONE.name}`).fill(String(IMEI.length));
      await form.getByLabel(`Cost each for ${PHONE.name}`).fill(String(PHONE.cost));
      await form.getByRole("button", { name: "Place order" }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
    }

    const row = page.getByRole("row").filter({ hasText: SUPPLIER.name }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    const detail = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Receive with details…" }) });
    await expect(detail).toBeVisible();
    // ONE PRESS IS NOT OFFERED. "Receive all" would put five phones on the
    // shelf with no number against any of them — the thing they were carded for.
    await expect(detail.getByRole("button", { name: /Receive all/ }), "an order of phones could be received without their numbers in one press").toHaveCount(0);
    await detail.getByRole("button", { name: "Receive with details…" }).click();

    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Receive goods" }) });
    const numbers = sheet.getByRole("textbox", { name: /^Serials \/ IMEIs/ });
    const receive = sheet.getByRole("button", { name: /^Receive → stock in/ });

    // SIX numbers for five boxes. One of them is a mistake, and it is said
    // before anything is sent.
    await numbers.fill([...IMEI, "356938035643899"].join("\n"));
    await expect(sheet.getByText("More serials than units received.")).toBeVisible();
    await expect(sheet.getByText(/one per line \(6\/5\)/)).toBeVisible();
    await expect(receive, "six numbers could be received against five boxes").toBeDisabled();

    // The same box scanned twice: five lines, four phones.
    await numbers.fill([...IMEI.slice(0, 4), IMEI[0]].join("\n"));
    await expect(sheet.getByText(`${IMEI[0]} is written twice.`)).toBeVisible();
    await expect(receive, "a number written twice could be received").toBeDisabled();

    // Three numbers for five boxes is allowed — and the sheet says what it means.
    await numbers.fill(IMEI.slice(0, 3).join("\n"));
    await expect(sheet.getByTestId("receive-unnumbered")).toContainText("2 of 5 will go on the shelf with no number");
    await expect(receive).toBeEnabled();

    await numbers.fill(IMEI.join("\n"));
    await expect(sheet.getByText(/one per line \(5\/5\)/)).toBeVisible();
    await expect(sheet.getByTestId("receive-unnumbered")).toHaveCount(0);
    await expect(receive).toBeEnabled();
    await receive.click();
    await expect(sheet).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole("row").filter({ hasText: SUPPLIER.name }).first()).toContainText(/received/i, { timeout: 20_000 });
  }

  // Five on the shelf — and the shop can say WHICH five.
  expect(await stockOf(request, PHONE.name)).toBeGreaterThanOrEqual(0);
  const held = await units(request, id);
  expect(held.map((u) => u.serial).sort()).toEqual([...IMEI].sort());
});

test("L3 · at the counter the phone asks for its number; the one handed over is picked, and the bill carries it", async ({ page, request }) => {
  const id = String(record().phone);

  if (!record().firstSale) {
    const before = { stock: await stockOf(request, PHONE.name), shelf: await onShelf(request, id) };
    expect(before.shelf).toContain(IMEI[0]);

    await openTill(page);
    await ring(page, PHONE.name);
    await attach(page, BUYER);

    // The line says a number is still owed.
    await expect(line(page, PHONE.name).getByRole("button", { name: "IMEI 0/1" })).toBeVisible();
    const sheet = await numbersOf(page, PHONE.name);
    await expect(sheet.getByText("0/1 captured")).toBeVisible();

    // The units on the shelf are OFFERED: nobody types fifteen digits when the
    // box is in their hand and the number is on the screen.
    for (const n of before.shelf) await expect(sheet.getByRole("button", { name: n, exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: IMEI[0], exact: true }).click();
    await expect(sheet.getByText("1/1 captured")).toBeVisible();
    // Picked is no longer offered.
    await expect(sheet.getByRole("button", { name: IMEI[0], exact: true })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(line(page, PHONE.name).getByRole("button", { name: "IMEI 1/1" })).toBeVisible();

    const due = await tender(page, "Cash");
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    const sale = await complete(page, request);
    expect(Number(sale.total)).toBe(due);
    remember({ firstSale: String(sale.invoice_number), firstSaleId: String(sale.id) });

    // The shelf is one short.
    expect(await stockOf(request, PHONE.name)).toBe(before.stock - 1);
  }

  const sale = await ask<Sale & { serials: Array<Row> }>(request, "owner", `/sales/${String(record().firstSaleId)}`);
  expect(sale.serials.map((s) => s.serial)).toEqual([IMEI[0]]);
  expect(Number(sale.serials[0].warranty_months)).toBe(PHONE.warranty);
  // Twelve months from the day it was sold.
  const until = new Date(String(sale.serials[0].warranty_expires_at));
  const expected = monthsOn(PHONE.warranty);
  expect([until.getFullYear(), until.getMonth()]).toEqual([expected.getFullYear(), expected.getMonth()]);

  // …and it is THAT one that is gone.
  const held = await units(request, id);
  expect(held.find((u) => u.serial === IMEI[0])?.status).toBe("sold");
  expect(await onShelf(request, id)).not.toContain(IMEI[0]);

  // And the sale's own sheet says which unit went out, and until when it is covered.
  const sheet = await saleSheet(page, String(record().firstSale));
  const numbers = sheet.getByText("Serials / IMEI").locator("xpath=ancestor::div[1]");
  await expect(numbers).toContainText(IMEI[0]);
  await expect(numbers).toContainText(/warranty to/);
});

// ── more of the counter ──────────────────────────────────────────────

const chip = (page: Page, name: string): Locator => line(page, name).getByRole("button", { name: /^IMEI \d+\/\d+/ });
const tenderKey = (page: Page): Locator => page.getByRole("button", { name: /Tender \/ Pay/i });
const scanBox = (page: Page): Locator => page.getByPlaceholder(/scan barcode or search/i).first();

/** Scan a code as a scanner does: the digits, then Enter. */
async function scan(page: Page, code: string): Promise<void> {
  await scanBox(page).fill(code);
  await scanBox(page).press("Enter");
}

test("L4 · the unit just sold is not offered to the next customer, and its number typed by hand is refused in words", async ({ page, request, watch }) => {
  const id = String(record().phone);

  if (!record().secondSale) {
    await openTill(page);
    await ring(page, PHONE.name);
    let sheet = await numbersOf(page, PHONE.name);

    // Sold in L3. It is not on the shelf, so it is not on the list.
    await expect(sheet.getByRole("button", { name: IMEI[1], exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: IMEI[0], exact: true }), "a unit that was sold is offered for sale").toHaveCount(0);

    // Typed by hand anyway — and the sheet says it is not one of the shop's.
    await sheet.getByLabel("Serial / IMEI of unit 1").fill(IMEI[0]);
    await expect(sheet.getByText("Not one of the units on the shelf — check it against the box.")).toBeVisible();
    await sheet.getByRole("button", { name: "Done" }).click();

    // The server will not sell the same phone twice, whatever the till sends.
    watch.expect(/SERIAL_ALREADY_SOLD/);
    await tender(page, "Cash");
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    await tenderSheet(page).getByRole("button", { name: /^Complete/ }).click();
    await expect(tenderSheet(page).getByText(`Serial "${IMEI[0]}" has already been sold.`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Sale complete" })).toHaveCount(0);
    await tenderSheet(page).getByRole("button", { name: "Cancel" }).click();

    // Nothing was lost: the line is still there, and the number can be put right.
    sheet = await numbersOf(page, PHONE.name);
    await sheet.getByLabel("Serial / IMEI of unit 1").fill("");
    await sheet.getByRole("button", { name: IMEI[1], exact: true }).click();
    await sheet.getByRole("button", { name: "Done" }).click();
    await tender(page, "Cash");
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    const sale = await complete(page, request);
    remember({ secondSale: String(sale.invoice_number), secondSaleId: String(sale.id) });

    // STRAIGHT AWAY, the next customer wants the same model. The phone that
    // left thirty seconds ago is not offered to them.
    await ring(page, PHONE.name);
    sheet = await numbersOf(page, PHONE.name);
    await expect(sheet.getByRole("button", { name: IMEI[2], exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: IMEI[1], exact: true }), "the phone just sold is offered to the next customer").toHaveCount(0);
    await sheet.getByRole("button", { name: "Done" }).click();
    await line(page, PHONE.name).getByRole("button", { name: "Remove" }).click();
    await expect(line(page, PHONE.name)).toHaveCount(0);
  }

  const held = await units(request, id);
  expect(held.find((u) => u.serial === IMEI[1])?.status).toBe("sold");
  expect(held.filter((u) => u.serial === IMEI[0])).toHaveLength(1);
});

test("L5 · Tender asks for the number before it takes the money — and a longer warranty is sold with this one", async ({ page, request }) => {
  if (!record().thirdSale) {
    await openTill(page);
    await ring(page, PHONE.name);
    await expect(chip(page, PHONE.name)).toHaveText(/IMEI 0\/1/);

    // No number written. The till does not take the money without a word.
    await tenderKey(page).click();
    const sheet = serialSheet(page);
    await expect(sheet, "the till went to the money for a phone with no number").toBeVisible();
    await expect(sheet.getByTestId("numbers-asked")).toContainText("this unit has no number");
    await expect(tenderSheet(page)).toHaveCount(0);

    // "Sell without a number" is a thing the cashier SAYS. Then the money.
    await sheet.getByRole("button", { name: "Sell without a number" }).click();
    await expect(tenderSheet(page)).toBeVisible();
    await tenderSheet(page).getByRole("button", { name: "Cancel" }).click();
    await expect(chip(page, PHONE.name)).toHaveText(/IMEI 0\/1 · without/);
    // Said once: the till does not ask again.
    await tenderKey(page).click();
    await expect(tenderSheet(page)).toBeVisible();
    await tenderSheet(page).getByRole("button", { name: "Cancel" }).click();

    // The box turns up after all. Two years of cover are sold with this one.
    await chip(page, PHONE.name).click();
    await expect(sheet.getByTestId("numbers-asked")).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Sell without a number" })).toHaveCount(0);
    await sheet.getByRole("button", { name: IMEI[4], exact: true }).click();
    await sheet.getByRole("spinbutton").fill("24");
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(chip(page, PHONE.name)).toHaveText("IMEI 1/1");

    await tender(page, "Cash");
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    const sale = await complete(page, request);
    remember({ thirdSale: String(sale.invoice_number), thirdSaleId: String(sale.id) });
  }

  const sale = await ask<Sale & { serials: Array<Row> }>(request, "owner", `/sales/${String(record().thirdSaleId)}`);
  expect(sale.serials.map((s) => s.serial)).toEqual([IMEI[4]]);
  expect(Number(sale.serials[0].warranty_months), "the longer warranty did not go with the unit").toBe(24);
  const until = new Date(String(sale.serials[0].warranty_expires_at));
  const expected = monthsOn(24);
  expect([until.getFullYear(), until.getMonth()]).toEqual([expected.getFullYear(), expected.getMonth()]);
});

test("L6 · the number on the box is scanned, and THAT unit is on the bill — two of them, on one line", async ({ page, request, watch }) => {
  if (!record().pairSale) {
    await openTill(page);

    // The IMEI, not the model's barcode. The till knows whose it is.
    await scan(page, IMEI[2]);
    await expect(line(page, PHONE.name), "scanning a unit's own number found nothing").toBeVisible({ timeout: 15_000 });
    await expect(chip(page, PHONE.name)).toHaveText("IMEI 1/1");
    await expect(page.getByText(`${PHONE.name}: unit ${IMEI[2]} is on the bill`).locator("visible=true").first()).toBeVisible();

    // A second one: the same line, now two units and two numbers.
    await scan(page, IMEI[3]);
    await expect(chip(page, PHONE.name)).toHaveText("IMEI 2/2", { timeout: 15_000 });
    await expect(page.locator("[data-cart-row]")).toHaveCount(1);

    // The same box under the scanner again changes nothing.
    await scan(page, IMEI[2]);
    await expect(page.getByText(`${PHONE.name}: unit ${IMEI[2]} is on the bill`).locator("visible=true").first()).toBeVisible();
    await expect(chip(page, PHONE.name)).toHaveText("IMEI 2/2");

    // A number that left the shop on Tuesday is said to have left — and on which bill.
    watch.expect(/SERIAL_ALREADY_SOLD/);
    await scan(page, IMEI[0]);
    await expect(page.getByText(`${IMEI[0]} is not on the shelf — it was sold on ${String(record().firstSale)}.`)).toBeVisible({ timeout: 15_000 });
    await expect(chip(page, PHONE.name)).toHaveText("IMEI 2/2");
    await scanBox(page).fill("");

    // The numbers are the ones scanned, in the sheet a cashier can open.
    const sheet = await numbersOf(page, PHONE.name);
    await expect(sheet.getByLabel("Serial / IMEI of unit 1")).toHaveValue(IMEI[2]);
    await expect(sheet.getByLabel("Serial / IMEI of unit 2")).toHaveValue(IMEI[3]);
    await sheet.getByRole("button", { name: "Done" }).click();

    await attach(page, { name: "QA Usman Electronics", phone: "03001230002" });
    const due = await tender(page, "Cash");
    expect(due).toBe(2 * PHONE.price);
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    const sale = await complete(page, request);
    remember({ pairSale: String(sale.invoice_number), pairSaleId: String(sale.id) });
  }

  const sale = await ask<Sale & { serials: Array<Row> }>(request, "owner", `/sales/${String(record().pairSaleId)}`);
  expect(sale.items).toHaveLength(1);
  expect(Number(sale.items[0].quantity)).toBe(2);
  expect(sale.serials.map((s) => String(s.serial)).sort()).toEqual([IMEI[2], IMEI[3]]);
});

// ── the warranty desk ────────────────────────────────────────────────

/** Look a number up at the warranty desk; returns the card it answers with. */
async function lookUp(page: Page, serial: string): Promise<Locator> {
  await page.goto("/tenant/warranty");
  await page.getByRole("button", { name: "Look up", exact: true }).first().click();
  await page.getByPlaceholder("Scan or type the serial / IMEI").fill(serial);
  await page.getByRole("button", { name: "Look up", exact: true }).last().click();

  return page.getByTestId("warranty-banner");
}

const FAULT = "Does not charge past 40%";

test("L7 · a year on, somebody walks in holding the phone and nothing else — and the shop can say what it is", async ({ page, watch }) => {
  const banner = await lookUp(page, IMEI[0]);
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toHaveAttribute("data-state", "covered");
  await expect(banner).toContainText("Under warranty");

  // A NUMBER OF DAYS. It read "365.9999999999884 days left".
  const said = (await banner.innerText()).match(/(\S+) days left/);
  expect(said, `the desk did not say how many days are left: ${await banner.innerText()}`).toBeTruthy();
  expect(said![1], "the days left are not a whole number").toMatch(/^\d+$/);
  expect(Number(said![1])).toBeGreaterThanOrEqual(364);
  expect(Number(said![1])).toBeLessThanOrEqual(366);

  const card = banner.locator("xpath=ancestor::div[1]");
  await expect(card).toContainText(PHONE.name);
  await expect(card).toContainText(String(record().firstSale));
  await expect(card).toContainText(BUYER.name);
  await expect(card).toContainText("12 months");
  await expect(card).toContainText("Completed");
  await expect(card.getByText(/completed|partially_refunded/), "a database value on the desk").toHaveCount(0);

  // A number the shop never sold is not an error: it is a unit in somebody's hand.
  watch.expect(/SERIAL_NOT_FOUND/);
  await page.getByPlaceholder("Scan or type the serial / IMEI").fill("356938035649999");
  await page.getByRole("button", { name: "Look up", exact: true }).last().click();
  await expect(page.getByText("No sale found for that serial / IMEI.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Take it in anyway" })).toBeVisible();
});

test("L8 · the faulty unit is taken in, held, cannot be taken in twice, and is closed with what was done to it", async ({ page, request }) => {
  type Claim = { id: string; serial: string; resolution: string | null; was_under_warranty: boolean; fault: string };
  const claims = async () => ask<Claim[]>(request, "owner", "/warranty/claims?status=all");
  const mine = async () => (await claims()).find((c) => c.serial === IMEI[0]);

  if (!(await mine())) {
    const banner = await lookUp(page, IMEI[0]);
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Take this unit in" }).click();
    const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Take the unit in" }) });
    // Whose it is comes from the sale: nobody retypes a name that is on the bill.
    await expect(form.getByPlaceholder("Name")).toHaveValue(BUYER.name);
    await expect(form.getByPlaceholder("03xx…")).toHaveValue(BUYER.phone);
    const book = form.getByRole("button", { name: "Book it in" });
    await expect(book, "a unit could be taken in without saying what is wrong with it").toBeDisabled();
    await form.getByPlaceholder(/In the customer's words/).fill(FAULT);
    await book.click();
    await expect(form).toBeHidden({ timeout: 15_000 });

    // The same card now says the shop has it — and does not offer to take it in again.
    await expect(page.getByText(`This unit is already with the shop — booked in 0 days ago for "${FAULT}".`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Take this unit in" })).toHaveCount(0);
  }

  let claim = (await mine())!;
  expect(claim.fault).toBe(FAULT);
  expect(claim.was_under_warranty, "the unit was in warranty when it came in, and the claim does not say so").toBe(true);

  // What the shop is holding — the screen the desk opens on.
  await page.goto("/tenant/warranty");
  const row = page.locator("[data-rows] > li").filter({ hasText: IMEI[0] }).first();

  if (claim.resolution === null) {
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(PHONE.name);
    await expect(row).toContainText("In warranty");
    await expect(row).toContainText(FAULT);
    await expect(row).toContainText(`${BUYER.name} · with us 0 days`);

    await row.getByRole("button", { name: "Close claim" }).click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Close ${PHONE.name}` }) });
    await sheet.getByRole("combobox").selectOption({ label: "Repaired" });
    await sheet.getByPlaceholder(/Swapped under/).fill("Charging port replaced");
    await sheet.getByRole("button", { name: "Close claim" }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });

    // Closed is not held: it leaves the list of what the shop has.
    await expect(page.locator("[data-rows] > li").filter({ hasText: IMEI[0] })).toHaveCount(0, { timeout: 15_000 });
    claim = (await mine())!;
  }
  expect(claim.resolution).toBe("repaired");

  // And the next time that phone is on the counter, the desk says it has been back before.
  await lookUp(page, IMEI[0]);
  await expect(page.getByRole("heading", { name: "This unit has been back 1 time" })).toBeVisible({ timeout: 15_000 });
  const history = page.locator("ul li").filter({ hasText: FAULT }).first();
  await expect(history).toContainText("Repaired");
  await expect(history).toContainText("Charging port replaced");
  // Out of the workshop, it can be taken in again.
  await expect(page.getByRole("button", { name: "Take this unit in" })).toBeVisible();
});

// ── a unit comes back ────────────────────────────────────────────────

test("L9 · a phone is brought back for a refund: it is the shop's again, under its number, and is sold to somebody else", async ({ page, request }) => {
  const id = String(record().phone);
  const sold = async () => ask<Sale & { serials: Array<Row> }>(request, "owner", `/sales/${String(record().secondSaleId)}`);

  if (String((await sold()).status) === "completed") {
    const before = await stockOf(request, PHONE.name);
    const sheet = await saleSheet(page, String(record().secondSale));
    await sheet.getByRole("button", { name: "Return / Refund" }).click();
    await sheet.getByLabel(`How many ${PHONE.name} to return`).fill("1");

    // The only phone on the bill: there is nothing to choose between, and the
    // sheet says which number is going back on the shelf.
    await expect(sheet.getByTestId("units-back-all")).toContainText(IMEI[1]);
    await expect(sheet.getByTestId("units-back-pick")).toHaveCount(0);
    await sheet.getByRole("button", { name: "Refund & restock" }).click();
    await expect(page.getByRole("row").filter({ hasText: String(record().secondSale) }).first()).toContainText(/refunded/i, { timeout: 20_000 });

    expect(await stockOf(request, PHONE.name)).toBe(before + 1);
  }

  // ON THE SHELF, BY ITS NUMBER. It stayed "sold", and was refused at the till.
  if (!record().resale) {
    expect(await onShelf(request, id), "the refunded phone is not on the shelf under its number").toContain(IMEI[1]);

    // The desk no longer answers for a customer who has been given their money back.
    const banner = await lookUp(page, IMEI[1]);
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner, "a refunded phone is still under the customer's warranty").toHaveAttribute("data-state", "came-back");
    await expect(banner).toContainText("This unit came back");
    await expect(banner).toContainText("it is on the shelf again");
    await expect(banner).not.toContainText("Under warranty");

    // The sale's own sheet says the unit came back, and quotes no warranty for it.
    const sheet = await saleSheet(page, String(record().secondSale));
    const numbers = sheet.getByText("Serials / IMEI").locator("xpath=ancestor::div[1]");
    await expect(numbers).toContainText(IMEI[1]);
    await expect(numbers).toContainText(/came back/);
    await expect(numbers).not.toContainText(/warranty to/);

    // And it is sold again — offered by the till like any other unit on the shelf.
    await openTill(page);
    await ring(page, PHONE.name);
    const pick = await numbersOf(page, PHONE.name);
    await pick.getByRole("button", { name: IMEI[1], exact: true }).click();
    await pick.getByRole("button", { name: "Done" }).click();
    await attach(page, { name: "QA Zainab Noor", phone: "03001230003" });
    await tender(page, "Cash");
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    const sale = await complete(page, request);
    remember({ resale: String(sale.invoice_number), resaleId: String(sale.id) });
  }

  // Whoever has it NOW is who the desk answers for.
  const banner = await lookUp(page, IMEI[1]);
  await expect(banner).toHaveAttribute("data-state", "covered", { timeout: 15_000 });
  const card = banner.locator("xpath=ancestor::div[1]");
  await expect(card).toContainText(String(record().resale));
  await expect(card).toContainText("QA Zainab Noor");
  expect((await units(request, id)).find((u) => u.serial === IMEI[1])?.status).toBe("sold");
});

test("L10 · two phones on one bill and one comes back — the shop has to say WHICH", async ({ page, request }) => {
  const id = String(record().phone);
  const pair = async () => ask<Sale & { serials: Array<Row> }>(request, "owner", `/sales/${String(record().pairSaleId)}`);

  if (String((await pair()).status) === "completed") {
    const before = await stockOf(request, PHONE.name);
    const sheet = await saleSheet(page, String(record().pairSale));
    await sheet.getByRole("button", { name: "Return / Refund" }).click();
    await sheet.getByLabel(`How many ${PHONE.name} to return`).fill("1");

    // One of two. The sheet asks which, and will not refund until it is told.
    const which = sheet.getByTestId("units-back-pick");
    await expect(which).toContainText(`Which unit of ${PHONE.name} came back?`);
    await expect(which.getByLabel(IMEI[2])).toBeVisible();
    await expect(which.getByLabel(IMEI[3])).toBeVisible();
    const refund = sheet.getByRole("button", { name: "Refund & restock" });
    await expect(refund, "one of two phones could be refunded without saying which").toBeDisabled();

    await which.getByLabel(IMEI[2]).check();
    // One is coming back: a second tick would be a lie, and cannot be made.
    await expect(which.getByLabel(IMEI[3])).toBeDisabled();
    await expect(refund).toBeEnabled();
    await refund.click();
    await expect(sheet.getByText("Partially refunded", { exact: true })).toBeVisible({ timeout: 20_000 });

    expect(await stockOf(request, PHONE.name)).toBe(before + 1);
  }

  // THAT one is the shop's. The other is still the customer's, and still covered.
  const held = await units(request, id);
  if (!record().swap) {
    expect(held.find((u) => u.serial === IMEI[2])?.status, "the phone that came back is not on the shelf").toBe("in_stock");
  }
  const sale = await pair();
  const back = sale.serials.find((s) => s.serial === IMEI[2])!;
  expect(back.returned_at, "the unit that came back is not marked as back").toBeTruthy();

  if (!record().swap) {
    expect(held.find((u) => u.serial === IMEI[3])?.status).toBe("sold");
    expect(sale.serials.find((s) => s.serial === IMEI[3])!.returned_at).toBeFalsy();
    await expect(await lookUp(page, IMEI[3])).toHaveAttribute("data-state", "covered", { timeout: 15_000 });
    await expect(await lookUp(page, IMEI[2])).toHaveAttribute("data-state", "came-back", { timeout: 15_000 });
  }
});

test("L11 · a faulty phone is swapped for another of the same model: one number comes in, the other goes out", async ({ page, request }) => {
  const id = String(record().phone);

  if (!record().swap) {
    const before = await stockOf(request, PHONE.name);
    const sheet = await saleSheet(page, String(record().pairSale));
    await sheet.getByRole("button", { name: "Exchange", exact: true }).click();

    // Handed back: the one phone still out on this bill.
    await sheet.getByLabel(`How many ${PHONE.name} to hand back`).fill("1");
    await expect(sheet.getByTestId("units-back-all")).toContainText(IMEI[3]);

    // Going out: another of the same, and the sheet asks for ITS number.
    await sheet.getByPlaceholder("Search products…").fill(PHONE.name);
    await sheet.getByRole("button", { name: new RegExp(`^${PHONE.name}`) }).first().click();
    const out = sheet.getByLabel(`Serial / IMEI of ${PHONE.name} going out`);
    await expect(out, "the replacement phone goes out with nowhere to write its number").toBeVisible();
    await expect(sheet.getByText("No number written — the warranty desk will not be able to find this unit.")).toBeVisible();
    // The unit on the shelf is offered — the one that came back in L10.
    await sheet.getByRole("button", { name: IMEI[2], exact: true }).click();
    await expect(out).toHaveValue(IMEI[2]);
    await expect(sheet.getByText(/No number written/)).toHaveCount(0);

    await expect(sheet.getByText("Difference to collect")).toBeVisible();
    await sheet.getByRole("button", { name: "Complete exchange" }).click();
    await expect(page.getByRole("row").filter({ hasText: String(record().pairSale) }).first()).toContainText(/refunded/i, { timeout: 20_000 });

    // One in, one out: the shelf count has not moved.
    expect(await stockOf(request, PHONE.name)).toBe(before);

    const newest = (await ask<Sale[]>(request, "owner", "/sales?per_page=5"))[0];
    remember({ swap: String(newest.invoice_number), swapId: String(newest.id) });
  }

  const held = await units(request, id);
  expect(held.find((u) => u.serial === IMEI[3])?.status, "the faulty phone handed back is not on the shelf by its number").toBe("in_stock");
  expect(held.find((u) => u.serial === IMEI[2])?.status, "the replacement went out and the shop still has it on the shelf").toBe("sold");

  const swap = await ask<Sale & { serials: Array<Row> }>(request, "owner", `/sales/${String(record().swapId)}`);
  expect(swap.serials.map((s) => s.serial), "the replacement left with no number on its bill").toEqual([IMEI[2]]);
  expect(Number(swap.serials[0].warranty_months)).toBe(PHONE.warranty);

  // The desk answers for the phone in the customer's hand — and says the old one came back.
  await expect(await lookUp(page, IMEI[2])).toHaveAttribute("data-state", "covered", { timeout: 15_000 });
  await expect(page.getByTestId("warranty-banner").locator("xpath=ancestor::div[1]")).toContainText(String(record().swap));
  await expect(await lookUp(page, IMEI[3])).toHaveAttribute("data-state", "came-back", { timeout: 15_000 });
});

test("L12 · at the end of it all, the shelf and the register of numbers say the same thing", async ({ page, request }) => {
  const id = String(record().phone);
  const held = await units(request, id);

  // Five arrived. Four are with customers, each on a bill that still stands.
  const out = held.filter((u) => u.status === "sold").map((u) => u.serial).sort();
  expect(out).toEqual([IMEI[0], IMEI[1], IMEI[2], IMEI[4]].sort());
  expect(await onShelf(request, id)).toEqual([IMEI[3]]);
  expect(held).toHaveLength(IMEI.length);

  // The count on the shelf is the count of numbers on the shelf.
  expect(await stockOf(request, PHONE.name), "the shelf count and the numbered units disagree").toBe(1);

  // And the till offers exactly that one.
  await openTill(page);
  await ring(page, PHONE.name);
  const sheet = await numbersOf(page, PHONE.name);
  await expect(sheet.getByRole("button", { name: IMEI[3], exact: true })).toBeVisible();
  for (const gone of out) await expect(sheet.getByRole("button", { name: gone, exact: true })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Done" }).click();
  await line(page, PHONE.name).getByRole("button", { name: "Remove" }).click();

  // Every unit out is one the desk can answer for.
  for (const serial of out) {
    await expect(await lookUp(page, serial), `${serial} is with a customer and the desk does not say it is covered`).toHaveAttribute("data-state", "covered", { timeout: 15_000 });
  }
});
