import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { OWNER_STATE, TRADE, ask, expect, record, remember, session, settled, test } from "./kit";
import { editor } from "./shop";
import { complete, line, openTill, quantity, ring, tender, tenderSheet } from "./till";

/**
 * STAGE K — A CHEMIST'S OWN DAY.
 *
 * Stages A and B are the same for every trade. What a chemist does that no
 * other shop does:
 *
 *   a medicine is carded with its SALT, and its stock arrives in LOTS, each
 *   with an expiry — and a lot without one cannot be put on the shelf
 *
 *   the lot that expires FIRST is the one that is sold first, whichever
 *   arrived first
 *
 *   a prescription medicine is sold WITH the prescription written down, and a
 *   schedule-controlled one cannot be sold without it
 *
 *   an expired strip is not sold, and is taken off the shelf with a reason
 *
 *   the brand is out — the same salt is offered instead
 *
 *   a batch is recalled, and the shop can say who took it home
 *
 * Run with `JOURNEY_TRADE=pharmacy`, after stages 01 and 02 for that trade.
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "pharmacy", "a chemist's stage — run with JOURNEY_TRADE=pharmacy");
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Row = Record<string, unknown>;

/** A date `days` from today, as a date box takes it — on the calendar this machine is on. */
const dateIn = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);

  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
};

const PANADOL = {
  name: "QA Panadol 500mg", salt: "Paracetamol", strength: "500mg", form: "Tablet", price: 5, barcode: "8964000900017",
  lots: [
    { number: "QA-LOT-A", qty: 100, days: 20 },     // arrives first, expires first
    { number: "QA-LOT-B", qty: 200, days: 400 },
  ],
} as const;

const product = async (request: APIRequestContext, name: string): Promise<Row | undefined> =>
  (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`)).find((p) => p.name === name);

const lots = async (request: APIRequestContext, id: string) =>
  ask<Array<{ batch_number: string; quantity: string | number; expiry_date: string | null }>>(request, "owner", `/inventory/products/${id}/batches`);

/** The batch manager for one item, opened from Inventory. */
async function batchesOf(page: Page, name: string): Promise<Locator> {
  await page.goto("/tenant/inventory");
  await settled(page);
  await page.getByPlaceholder(/search/i).first().fill(name);
  const row = page.getByRole("row").filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button", { name: "Batches" }).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Batches — ${name}` }) });
  await expect(sheet).toBeVisible();

  return sheet;
}

test("K1 · a medicine is carded as a medicine: its salt, its strength, and a first lot that must carry an expiry", async ({ page, request }) => {
  if (!(await product(request, PANADOL.name))) {
    await page.goto("/tenant/products/new");
    const form = editor(page);
    await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });

    // A chemist's "Add item" opens as a MEDICINE — not a product that has no
    // batch and no expiry.
    await expect(form.getByRole("button", { name: "Medicine", exact: true })).toHaveAttribute("aria-pressed", "true");

    await form.getByLabel("Name *", { exact: true }).fill(PANADOL.name);
    await form.getByLabel("Price *", { exact: true }).fill(String(PANADOL.price));
    await form.getByLabel("Salt / generic name", { exact: true }).fill(PANADOL.salt);
    await form.getByLabel("Strength", { exact: true }).fill(PANADOL.strength);
    await form.getByLabel("Dosage form", { exact: true }).selectOption({ label: PANADOL.form });
    const description = form.getByLabel("Description *", { exact: true });
    if (await description.isVisible().catch(() => false)) await description.fill(`${PANADOL.name} — added by the QA journey.`);

    // A hundred tablets on the shelf — and no expiry given. It cannot be saved.
    await form.getByLabel("Opening stock", { exact: true }).fill(String(PANADOL.lots[0].qty));
    await form.getByLabel("Opening batch number", { exact: true }).fill(PANADOL.lots[0].number);
    const create = form.getByRole("button", { name: "Create item" });
    await expect(create, "a medicine with stock and no expiry could be created").toBeDisabled();

    await form.getByLabel(/^Opening batch expiry/).fill(dateIn(PANADOL.lots[0].days));
    await form.getByRole("button", { name: "Codes & packs" }).click();
    await form.getByLabel("Barcode", { exact: true }).fill(PANADOL.barcode);

    await expect(create).toBeEnabled();
    await create.click();
    await expect(form).toBeHidden({ timeout: 20_000 });
  }

  const held = (await product(request, PANADOL.name))!;
  expect(held, `${PANADOL.name} is not on the shelf`).toBeTruthy();
  remember({ panadol: String(held.id) });
  expect(held.item_type).toBe("medicine");
  expect(held.generic_name).toBe(PANADOL.salt);
  expect(held.strength).toBe(PANADOL.strength);
  expect(Number(held.stock_quantity)).toBeGreaterThanOrEqual(0);

  // The stock is IN A LOT, under the number that was typed, with its date.
  const first = (await lots(request, String(held.id))).find((b) => b.batch_number === PANADOL.lots[0].number);
  expect(first, "the opening stock was not filed as a lot").toBeTruthy();
  expect(String(first!.expiry_date).slice(0, 10)).toBe(dateIn(PANADOL.lots[0].days));
});

test("K2 · a second lot arrives with a later date — and the shelf says which one is running out of time", async ({ page, request }) => {
  const id = String(record().panadol);

  if (!(await lots(request, id)).some((b) => b.batch_number === PANADOL.lots[1].number)) {
    const sheet = await batchesOf(page, PANADOL.name);
    const add = sheet.getByRole("button", { name: "Add batch (stock in)" });

    await sheet.getByLabel("Batch / lot no.", { exact: true }).fill(PANADOL.lots[1].number);
    await sheet.getByRole("spinbutton").first().fill(String(PANADOL.lots[1].qty));
    // No date, no lot — on the sheet as on the form.
    await expect(add, "a medicine lot with no expiry could be stocked in").toBeDisabled();
    await sheet.getByLabel(/^Expiry date/).fill(dateIn(PANADOL.lots[1].days));
    await expect(add).toBeEnabled();
    await add.click();

    // Both lots are listed, each with what is left in it.
    await expect(sheet.getByText(PANADOL.lots[1].number)).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText(PANADOL.lots[0].number)).toBeVisible();
  }

  const held = await lots(request, id);
  expect(held.map((b) => [b.batch_number, Number(b.quantity)]).sort()).toEqual(
    PANADOL.lots.map((l) => [l.number, l.qty]).sort(),
  );
  // 100 + 200 on the shelf.
  expect(Number((await product(request, PANADOL.name))!.stock_quantity)).toBe(300);

  // The lot with twenty days left is named at the top of Inventory. The one
  // with a year is not.
  await page.goto("/tenant/inventory");
  await settled(page);
  const warning = page.getByText(/Expiring stock — \d+ batch/).locator("xpath=ancestor::div[1]");
  await expect(warning).toBeVisible({ timeout: 20_000 });
  await expect(warning).toContainText(PANADOL.lots[0].number);
  await expect(warning).not.toContainText(PANADOL.lots[1].number);
  // Twenty days left is not expired, and is not called it.
  await expect(warning.getByText(PANADOL.lots[0].number).locator("xpath=ancestor::*[self::li or self::div][1]")).not.toContainText("EXPIRED");
});

test("K3 · at the counter: scanned, it warns which lot is short-dated — and the first to expire is the first sold", async ({ page, request }) => {
  const id = String(record().panadol);

  if (!record().fefoSale) {
    await openTill(page);
    // SCANNED, as a strip is. The till says which lot is running out.
    const search = page.getByPlaceholder(/scan barcode or search/i).first();
    await search.fill(PANADOL.barcode);
    await search.press("Enter");
    await expect(line(page, PANADOL.name), "scanning the strip's barcode put nothing in the cart").toBeVisible({ timeout: 15_000 });
    await expect(
      // The notice is drawn twice — once for a phone, once for a counter —
      // and one of the two is always hidden. The one a cashier can SEE.
      page.getByText(new RegExp(`${PANADOL.name}: batch ${PANADOL.lots[0].number} expires in ${PANADOL.lots[0].days} day`)).locator("visible=true").first(),
      "the till did not say the lot is short-dated",
    ).toBeVisible({ timeout: 15_000 });

    // 120 tablets: more than the first lot holds.
    await quantity(page, PANADOL.name, 120);
    const due = await tender(page, "Cash");
    expect(due).toBe(120 * PANADOL.price);
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    const sale = await complete(page, request);
    expect(Number(sale.total)).toBe(120 * PANADOL.price);
    remember({ fefoSale: String(sale.invoice_number), fefoSaleId: String(sale.id) });
  }

  // FIRST TO EXPIRE, FIRST OUT. Lot A is empty; the last twenty came from B.
  const after = await lots(request, id);
  const left = Object.fromEntries(after.map((b) => [b.batch_number, Number(b.quantity)]));
  expect(left[PANADOL.lots[0].number] ?? 0, "the short-dated lot was not sold first").toBe(0);
  expect(left[PANADOL.lots[1].number]).toBe(180);
  expect(Number((await product(request, PANADOL.name))!.stock_quantity)).toBe(180);
});

// ── prescriptions ────────────────────────────────────────────────────

interface Medicine {
  name: string; salt: string; strength: string; form: string; price: number;
  rx?: boolean; schedule?: string;
  lot?: { number: string; qty: number; days: number };
}

const AMOXIL: Medicine = { name: "QA Amoxil 250mg", salt: "Amoxicillin", strength: "250mg", form: "Capsule", price: 20, rx: true, lot: { number: "QA-AMX-1", qty: 50, days: 400 } };
const XANAX: Medicine = { name: "QA Xanax 0.5mg", salt: "Alprazolam", strength: "0.5mg", form: "Tablet", price: 30, schedule: "G", lot: { number: "QA-XNX-1", qty: 30, days: 400 } };
const BRUFEN: Medicine = { name: "QA Brufen 400mg", salt: "Ibuprofen", strength: "400mg", form: "Tablet", price: 8 };
const NUROFEN: Medicine = { name: "QA Nurofen 400mg", salt: "Ibuprofen", strength: "400mg", form: "Tablet", price: 12, lot: { number: "QA-NUR-1", qty: 40, days: 400 } };

/** Card a medicine through the form, if it is not on the shelf already. */
async function card(page: Page, request: APIRequestContext, m: Medicine): Promise<string> {
  const have = await product(request, m.name);
  if (have) return String(have.id);

  await page.goto("/tenant/products/new");
  const form = editor(page);
  await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });
  await form.getByLabel("Name *", { exact: true }).fill(m.name);
  await form.getByLabel("Price *", { exact: true }).fill(String(m.price));
  await form.getByLabel("Salt / generic name", { exact: true }).fill(m.salt);
  await form.getByLabel("Strength", { exact: true }).fill(m.strength);
  await form.getByLabel("Dosage form", { exact: true }).selectOption({ label: m.form });
  if (m.rx) await form.getByLabel(/Requires a doctor's prescription/).check();
  if (m.schedule) await form.getByLabel(/^Controlled schedule/).fill(m.schedule);
  const description = form.getByLabel("Description *", { exact: true });
  if (await description.isVisible().catch(() => false)) await description.fill(`${m.name} — added by the QA journey.`);
  if (m.lot) {
    await form.getByLabel("Opening stock", { exact: true }).fill(String(m.lot.qty));
    await form.getByLabel("Opening batch number", { exact: true }).fill(m.lot.number);
    await form.getByLabel(/^Opening batch expiry/).fill(dateIn(m.lot.days));
  }
  const create = form.getByRole("button", { name: "Create item" });
  await expect(create, `the form will not let ${m.name} be created`).toBeEnabled();
  await create.click();
  await expect(form).toBeHidden({ timeout: 20_000 });

  return String((await product(request, m.name))!.id);
}

const rxBox = (page: Page): Locator =>
  page.getByText("Prescription details").locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");

async function writeThePrescription(page: Page, rx: { number: string; patient: string; prescriber: string }): Promise<void> {
  const box = rxBox(page);
  await box.getByPlaceholder("Rx number").fill(rx.number);
  await box.getByPlaceholder("Patient name").fill(rx.patient);
  await box.getByPlaceholder("Prescriber / doctor").fill(rx.prescriber);
}

/** The dispensing register's row for one drug on one bill. */
async function registerRow(page: Page, drug: string, invoice: string): Promise<Locator> {
  await page.goto("/tenant/pharmacy");
  await settled(page);
  const row = page.getByRole("row").filter({ hasText: drug }).filter({ hasText: invoice }).first();
  await expect(row, `${drug} on ${invoice} is not in the dispensing register`).toBeVisible({ timeout: 20_000 });

  return row;
}

test("K4 · a prescription medicine is sold with the prescription written down, and the register has it", async ({ page, request }) => {
  const id = await card(page, request, AMOXIL);
  remember({ amoxil: id });
  const RX = { number: "RX-QA-1001", patient: "Bilal Ahmed", prescriber: "Dr Sana Malik" };

  if (!record().rxSale) {
    await openTill(page);
    // No prescription box until there is something on the bill that needs one.
    await expect(page.getByText("Prescription details")).toHaveCount(0);
    await ring(page, AMOXIL.name);

    // The cashier is told, and asked.
    await expect(page.getByText(`℞ ${AMOXIL.name} requires a prescription`).locator("visible=true").first()).toBeVisible({ timeout: 15_000 });
    await expect(rxBox(page)).toBeVisible();
    await writeThePrescription(page, RX);
    // How to take it — per medicine, for the label the patient reads.
    await rxBox(page).getByPlaceholder("1 tablet twice daily after meals").fill("1 capsule three times a day");

    await quantity(page, AMOXIL.name, 21);
    expect(await tender(page, "Cash")).toBe(21 * AMOXIL.price);
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    const sale = await complete(page, request);
    remember({ rxSale: String(sale.invoice_number), rxSaleId: String(sale.id) });
  }

  // The prescription is ON the sale.
  const sale = await ask<Row & { items: Row[] }>(request, "owner", `/sales/${String(record().rxSaleId)}`);
  expect(sale.prescription_number).toBe(RX.number);
  expect(sale.patient_name).toBe(RX.patient);
  expect(sale.prescriber_name).toBe(RX.prescriber);
  expect(sale.items[0].directions).toBe("1 capsule three times a day");

  // And the register a drug inspector asks to see has the line: what, how
  // many, which lot, for whom, on whose word.
  const row = await registerRow(page, AMOXIL.name, String(record().rxSale));
  await expect(row).toContainText("21");
  await expect(row).toContainText(AMOXIL.lot!.number);
  await expect(row).toContainText(RX.patient);
  await expect(row).toContainText(RX.prescriber);
  await expect(row).toContainText(RX.number);
  // Paracetamol sold over the counter is not a register entry.
  await expect(page.getByRole("row").filter({ hasText: PANADOL.name })).toHaveCount(0);
});

test("K5 · a schedule-controlled drug cannot leave the shop without its prescription", async ({ page, request, watch }) => {
  const id = await card(page, request, XANAX);
  remember({ xanax: id });
  // Giving it a schedule made it prescription-only. Nobody ticked that box.
  const held = (await product(request, XANAX.name))!;
  expect(held.drug_schedule).toBe(XANAX.schedule);
  expect(held.requires_prescription, "a scheduled drug is not marked prescription-only").toBe(true);

  const RX = { number: "RX-QA-2002", patient: "Hina Qureshi", prescriber: "Dr Omar Farooq" };

  if (!record().controlledSale) {
    await openTill(page);
    await ring(page, XANAX.name);
    await expect(rxBox(page)).toBeVisible({ timeout: 15_000 });

    // WITHOUT the prescription: refused, in words, and nothing is sold.
    watch.expect(/PRESCRIPTION_REQUIRED/);
    const before = (await ask<Row[]>(request, "owner", "/sales?per_page=1"))[0]?.invoice_number;
    await tender(page, "Cash");
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    await tenderSheet(page).getByRole("button", { name: /^Complete/ }).click();
    await expect(
      page.getByText(/schedule-controlled — record the prescription number and prescriber/).locator("visible=true").first(),
      "a controlled drug was not refused, or was refused without saying why",
    ).toBeVisible({ timeout: 15_000 });
    expect((await ask<Row[]>(request, "owner", "/sales?per_page=1"))[0]?.invoice_number, "a controlled drug was SOLD with no prescription").toBe(before);
    expect(Number((await product(request, XANAX.name))!.stock_quantity)).toBe(XANAX.lot!.qty);

    // A number alone is not enough either: it needs who wrote it.
    const close = tenderSheet(page).getByRole("button", { name: /Cancel|Close|Back/ }).first();
    if (await close.isVisible().catch(() => false)) await close.click();
    await rxBox(page).getByPlaceholder("Rx number").fill(RX.number);
    await tender(page, "Cash");
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    await tenderSheet(page).getByRole("button", { name: /^Complete/ }).click();
    await expect(page.getByText(/schedule-controlled/).locator("visible=true").first()).toBeVisible({ timeout: 15_000 });
    expect((await ask<Row[]>(request, "owner", "/sales?per_page=1"))[0]?.invoice_number).toBe(before);

    // With both, it is dispensed.
    if (await close.isVisible().catch(() => false)) await close.click();
    await writeThePrescription(page, RX);
    expect(await tender(page, "Cash")).toBe(XANAX.price);
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    const sale = await complete(page, request);
    remember({ controlledSale: String(sale.invoice_number) });
  }

  // "Controlled only" is the narrower book: the Xanax, not the Amoxil.
  const row = await registerRow(page, XANAX.name, String(record().controlledSale));
  await expect(row).toContainText(RX.prescriber);
  await page.getByRole("button", { name: "Controlled only" }).click();
  await expect(page.getByRole("row").filter({ hasText: XANAX.name }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("row").filter({ hasText: AMOXIL.name })).toHaveCount(0);
});

// ── the shelf ────────────────────────────────────────────────────────

const EXPIRED_LOT = { number: "QA-AMX-OLD", qty: 10 } as const;

test("K6 · an expired strip is not sold, and comes off the shelf with a reason", async ({ page, request, watch }) => {
  const id = String(record().amoxil);
  const good = AMOXIL.lot!.qty - 21;                 // 29 left of the live lot after K4

  // A box found at the back, a day past its date.
  if (!record().expiredRemoved && !(await lots(request, id)).some((b) => b.batch_number === EXPIRED_LOT.number)) {
    const sheet = await batchesOf(page, AMOXIL.name);
    await sheet.getByLabel("Batch / lot no.", { exact: true }).fill(EXPIRED_LOT.number);
    await sheet.getByRole("spinbutton").first().fill(String(EXPIRED_LOT.qty));
    await sheet.getByLabel(/^Expiry date/).fill(dateIn(-1));
    await sheet.getByRole("button", { name: "Add batch (stock in)" }).click();
    // The list says what it is.
    const listed = sheet.getByText(EXPIRED_LOT.number).locator("xpath=ancestor::div[1]");
    await expect(listed).toContainText("EXPIRED", { timeout: 15_000 });
    // …and does NOT say it of the lot with a year left.
    await expect(sheet.getByText(AMOXIL.lot!.number).locator("xpath=ancestor::div[1]")).not.toContainText("EXPIRED");
  }

  if (!record().expiredRemoved) {
    // 39 on the shelf by count; 29 of them can be sold.
    expect(Number((await product(request, AMOXIL.name))!.stock_quantity)).toBe(good + EXPIRED_LOT.qty);

    // THIRTY is one more than can honestly be sold. Refused, with the number.
    watch.expect(/STOCK_EXPIRED/);
    await openTill(page);
    await ring(page, AMOXIL.name);
    await writeThePrescription(page, { number: "RX-QA-3003", patient: "Asad Mir", prescriber: "Dr Sana Malik" });
    await quantity(page, AMOXIL.name, good + 1);
    await tender(page, "Cash");
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    await tenderSheet(page).getByRole("button", { name: /^Complete/ }).click();
    await expect(
      page.getByText(new RegExp(`Only ${good} sellable in stock — ${EXPIRED_LOT.qty} is in expired batch`)).locator("visible=true").first(),
      "selling into an expired lot was not refused, or not in words",
    ).toBeVisible({ timeout: 15_000 });
    const after = await lots(request, id);
    expect(Number(after.find((b) => b.batch_number === EXPIRED_LOT.number)!.quantity), "the expired lot was dispensed").toBe(EXPIRED_LOT.qty);
    expect(Number(after.find((b) => b.batch_number === AMOXIL.lot!.number)!.quantity)).toBe(good);

    // It is at the top of Inventory, called what it is, with the way to deal
    // with it beside it.
    await page.goto("/tenant/inventory");
    await settled(page);
    const row = page.getByText(EXPIRED_LOT.number).locator("visible=true").first().locator("xpath=ancestor::*[self::li or self::div][1]");
    await expect(row).toContainText("EXPIRED", { timeout: 20_000 });
    await row.getByRole("button", { name: "Remove" }).click();

    const sheet = page.getByRole("dialog").filter({ hasText: EXPIRED_LOT.number });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: /Written off|Write off|Binned/ }).first().click().catch(() => {});
    await sheet.getByRole("button", { name: /^Expired$/ }).click().catch(() => {});
    await sheet.getByRole("button", { name: /Remove|Write off|Confirm/ }).last().click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
    remember({ expiredRemoved: true });
  }

  // Gone from the lots, gone from the count — and the shelf is what can be sold.
  expect((await lots(request, id)).filter((b) => Number(b.quantity) > 0).map((b) => b.batch_number)).toEqual([AMOXIL.lot!.number]);
  expect(Number((await product(request, AMOXIL.name))!.stock_quantity)).toBe(good);

  // It is on the record of what was thrown away, with why.
  await page.goto("/tenant/disposals");
  await settled(page);
  // The screen opens on what a supplier still owes; a binned lot is a loss,
  // and is under its own heading.
  await page.getByRole("button", { name: "Written off", exact: true }).click();
  const disposed = page.getByRole("row").filter({ hasText: EXPIRED_LOT.number }).first();
  await expect(disposed, "the written-off lot is not on the disposals list").toBeVisible({ timeout: 20_000 });
  await expect(disposed).toContainText(AMOXIL.name);
  await expect(disposed).toContainText(/expired/i);
});

test("K7 · the brand is out: the same salt is offered, and that is what is sold", async ({ page, request }) => {
  await card(page, request, BRUFEN);
  await card(page, request, NUROFEN);

  if (!record().substituteSale) {
    await openTill(page);
    const search = page.getByPlaceholder(/scan barcode or search/i).first();
    await search.fill(BRUFEN.name);
    const tile = page.locator("[data-pos-item]").filter({ hasText: BRUFEN.name }).first();
    await expect(tile).toBeVisible({ timeout: 15_000 });
    // OUT, AND STILL PRESSABLE — with a finger. It was a disabled button, so
    // the sheet below could only be reached by arrowing to it on a keyboard.
    await expect(tile).toContainText("Out — tap for same salt");
    await expect(tile, "an out-of-stock medicine cannot be tapped, so nothing can offer its equivalent").toBeEnabled();
    await tile.click();
    // It was not rung.
    await expect(line(page, BRUFEN.name)).toHaveCount(0);

    // Not just "out of stock": the customer needs the salt.
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Same salt, in stock" }) });
    await expect(sheet, "an out-of-stock medicine was refused with no equivalent offered").toBeVisible({ timeout: 15_000 });
    await expect(sheet).toContainText(`Instead of ${BRUFEN.name}`);
    const offer = sheet.getByRole("button").filter({ hasText: NUROFEN.name });
    await expect(offer).toBeVisible();
    await expect(offer).toContainText("Ibuprofen · 400mg");
    await expect(offer).toContainText("40 in stock");
    // Same strength, same form: no warning badge to stop and read.
    await expect(offer).not.toContainText("Different strength");
    // Paracetamol is not ibuprofen, however much of it is on the shelf.
    await expect(sheet).not.toContainText(PANADOL.name);

    await offer.click();
    await expect(line(page, NUROFEN.name), "the substitute was not put on the bill").toBeVisible({ timeout: 15_000 });
    await expect(line(page, BRUFEN.name)).toHaveCount(0);

    // At ITS price — 12, not the brand's 8.
    expect(await tender(page, "Cash")).toBe(NUROFEN.price);
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    const sale = await complete(page, request);
    remember({ substituteSale: String(sale.invoice_number) });
  }

  expect(Number((await product(request, NUROFEN.name))!.stock_quantity)).toBe(NUROFEN.lot!.qty - 1);
});

test("K8 · a batch is recalled: what is left to pull, and who took it home", async ({ page }) => {
  await page.goto("/tenant/pharmacy");
  await settled(page);
  await page.getByRole("button", { name: "Batch recall" }).click();

  await page.getByPlaceholder("As printed on the recall notice").fill(PANADOL.lots[0].number);
  await page.getByRole("button", { name: "Find it" }).click();

  // All hundred went out in K3 — nothing to pull…
  await expect(page.getByText("None of this lot is left in stock.")).toBeVisible({ timeout: 20_000 });
  // …and one sale to chase, for exactly the hundred that came from this lot
  // (the other twenty on that bill were from the lot behind it).
  await expect(page.getByRole("heading", { name: "People to call · 1" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: String(record().fefoSale) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("100");
  // A walk-in left no number, and the screen says that is a problem.
  await expect(page.getByText("1 sale with no phone number")).toBeVisible();

  // The lot behind it: 180 still on the shelf, twenty gone on the same bill.
  await page.getByPlaceholder("As printed on the recall notice").fill(PANADOL.lots[1].number);
  await page.getByRole("button", { name: "Find it" }).click();
  await expect(page.getByText(/180 in stock/)).toBeVisible({ timeout: 20_000 });
  const second = page.getByRole("row").filter({ hasText: String(record().fefoSale) });
  await expect(second).toContainText("20");
});
