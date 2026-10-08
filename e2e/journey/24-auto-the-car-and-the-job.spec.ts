import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { OWNER_STATE, TRADE, ask, expect, record, remember, rupees, session, settled, test } from "./kit";
import { addItem, type Item } from "./shop";
import { complete, line, openTill, quantity, ring, tender, tenderSheet, type Sale } from "./till";

/**
 * STAGE M — A WORKSHOP'S OWN DAY.
 *
 * Stages A and B are the same for every trade. What a tyre shop and workshop
 * does that no other shop does:
 *
 *   its customer is a CAR — a plate, what it takes, whose it is, and what
 *   was last done to it at what reading
 *
 *   rubber ages on the shelf, and the counter is told how old the tyre it is
 *   about to hand over is
 *
 *   a dead battery comes across the counter in part-payment, and is stock
 *   the shop can count afterwards
 *
 *   a car is booked into the bay with what the customer said is wrong; parts
 *   and labour go on the job AS THE WORK IS DONE; it moves along the board —
 *   and back, when the road test fails; and it is billed for all of it, at
 *   the reading it leaves on
 *
 * Run with `JOURNEY_TRADE=automotive`, after stages 01 and 02 for that trade.
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "automotive", "a workshop's stage — run with JOURNEY_TRADE=automotive");
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Row = Record<string, unknown>;

const PADS: Item = { key: "pads", name: "QA Brake Pads", price: 4500, cost: 3000, stock: 10, effectiveTax: 0 };
const LABOUR: Item = { key: "labour", name: "QA Labour (hour)", type: "service", price: 1000, effectiveTax: 0 };
const CHECK: Item = { key: "check", name: "QA Diagnostic Check", type: "service", price: 1500, effectiveTax: 0 };
const BATTERY: Item = { key: "battery", name: "QA Battery 70Ah", price: 28000, cost: 22000, stock: 4, effectiveTax: 0 };
const SCRAP: Item = { key: "scrap", name: "QA Scrap Battery", price: 3000, stock: 0, effectiveTax: 0 };
const TYRE: Item = { key: "tyre", name: "QA Tyre 195-65 R15", price: 14000, cost: 11000, barcode: "8964000900024", effectiveTax: 0 };

/** Two lots of the same tyre: one off a 2019 mould, one from this summer. */
const LOTS = [
  { number: "QA-T-2019", dot: "1019", qty: 4 },
  { number: "QA-T-2026", dot: "3026", qty: 4 },
] as const;

const CAR = { typed: "LEA-4291", plate: "LEA4291", make: "Toyota", model: "Corolla", takes: "195/65 R15", owner: "QA Kamran Sheikh", phone: "03001240001" } as const;
const SECOND = { typed: "LEB-777", plate: "LEB777", owner: "QA Sana Motors", phone: "03001240002" } as const;
const COMPLAINT = "Grinding from the front left when braking";

const product = async (request: APIRequestContext, name: string): Promise<Row | undefined> =>
  (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`)).find((p) => p.name === name);
const stockOf = async (request: APIRequestContext, name: string): Promise<number> => Number((await product(request, name))!.stock_quantity);
const car = async (request: APIRequestContext, plate: string) =>
  (await ask<Array<Row & { customer?: { name: string | null; phone: string | null } | null }>>(request, "owner", `/vehicles?search=${plate}`)).find((v) => v.registration === plate);
const jobs = async (request: APIRequestContext) =>
  ask<Array<Row & { vehicle?: { registration: string } | null }>>(request, "owner", "/sale-documents?kind=job_card&per_page=50");
const jobOf = async (request: APIRequestContext, plate: string) => (await jobs(request)).find((j) => j.vehicle?.registration === plate);
const doc = async (request: APIRequestContext, id: string) => ask<Row & { items: Row[]; sale?: Row | null }>(request, "owner", `/sale-documents/${id}`);

/** A date `days` from today, as a date box takes it — on the calendar this machine is on. */
const dateIn = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);

  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
};

// ── the board ────────────────────────────────────────────────────────

const column = (page: Page, stage: string): Locator =>
  page.locator("div.rounded-2xl").filter({ has: page.getByRole("heading", { name: new RegExp(`^${stage}`) }) });
const card = (page: Page, plate: string): Locator =>
  page.locator("div.rounded-xl").filter({ has: page.getByRole("link", { name: plate, exact: true }) });
async function board(page: Page): Promise<void> {
  await page.goto("/tenant/workshop");
  await expect(page.getByRole("heading", { name: "Workshop", exact: true })).toBeVisible({ timeout: 20_000 });
  await settled(page);
}

/** The job card's own page, opened from its card on the board. */
async function openJob(page: Page, plate: string): Promise<void> {
  await board(page);
  await card(page, plate).getByRole("link", { name: plate, exact: true }).click();
  await expect(page.getByTestId("job-details")).toBeVisible({ timeout: 20_000 });
}
const jobTotal = async (page: Page): Promise<number> =>
  rupees(await page.getByText("Total", { exact: true }).locator("xpath=following-sibling::*[1]").innerText());
const jobLine = (page: Page, name: string): Locator => page.getByRole("row").filter({ hasText: name });

test("M1 · the shelf: parts, labour, a battery, what a dead one is taken in as — and a tyre in two lots, one off a 2019 mould", async ({ page, request }) => {
  for (const item of [PADS, LABOUR, CHECK, BATTERY, SCRAP, TYRE]) {
    if (!(await product(request, item.name))) await addItem(page, item);
  }
  remember({ tyre: String((await product(request, TYRE.name))!.id) });
  expect((await product(request, LABOUR.name))!.type).toBe("service");

  const id = String(record().tyre);
  const held = async () => ask<Array<{ batch_number: string; quantity: string; dot_code: string | null; age_status: string | null }>>(request, "owner", `/inventory/products/${id}/batches`);

  for (const lot of LOTS) {
    if ((await held()).some((b) => b.batch_number === lot.number)) continue;

    await page.goto("/tenant/inventory");
    await settled(page);
    await page.getByPlaceholder(/search/i).first().fill(TYRE.name);
    const row = page.getByRole("row").filter({ hasText: TYRE.name }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "Batches" }).click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Batches — ${TYRE.name}` }) });
    await sheet.getByLabel("Batch / lot no.", { exact: true }).fill(lot.number);
    await sheet.getByLabel("DOT code (tyres)", { exact: true }).fill(lot.dot);
    await sheet.getByLabel("Quantity", { exact: true }).fill(String(lot.qty));
    await sheet.getByRole("button", { name: "Add batch (stock in)" }).click();
    await expect(sheet.getByText(lot.number)).toBeVisible({ timeout: 15_000 });
  }

  // Eight on the shelf; the 2019 lot is OLD and says so, the 2026 lot does not.
  const lots = await held();
  expect(Object.fromEntries(lots.map((b) => [b.batch_number, b.dot_code]))).toMatchObject({ "QA-T-2019": "1019", "QA-T-2026": "3026" });
  expect(lots.find((b) => b.batch_number === "QA-T-2019")!.age_status).toBe("old");
  expect(lots.find((b) => b.batch_number === "QA-T-2026")!.age_status).toBe("fresh");
});

test("M2 · a car is put on record with what it takes — and WHOSE it is", async ({ page, request }) => {
  if (!(await car(request, CAR.plate))) {
    await page.goto("/tenant/vehicles");
    await page.getByRole("button", { name: "+ Add vehicle" }).click();
    const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add a vehicle" }) });
    await form.getByPlaceholder("LEA-1234").fill(CAR.typed);
    await form.getByPlaceholder("Toyota").fill(CAR.make);
    await form.getByPlaceholder("Corolla GLi").fill(CAR.model);
    await form.getByPlaceholder("195/65 R15").fill(CAR.takes);
    // The list has always had an Owner column. The form had nowhere to say one.
    await form.getByPlaceholder("03xx-xxxxxxx").fill(CAR.phone);
    await form.getByLabel("Owner’s name").fill(CAR.owner);
    await form.getByRole("button", { name: "Add vehicle" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }

  await page.goto("/tenant/vehicles");
  await settled(page);
  const row = page.getByRole("row").filter({ hasText: CAR.plate }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(`${CAR.make} ${CAR.model}`);
  await expect(row).toContainText(CAR.takes);
  await expect(row, "the car was saved and nobody's").toContainText(CAR.owner);

  const held = (await car(request, CAR.plate))!;
  expect(held.customer?.phone).toBe(CAR.phone);
  remember({ car: String(held.id) });
});

test("M3 · at the counter: the tyre's age is said, the oldest lot goes first, and the sale is on the car at its reading", async ({ page, request }) => {
  const id = String(record().tyre);
  const lots = async () => ask<Array<{ batch_number: string; quantity: string }>>(request, "owner", `/inventory/products/${id}/batches`);

  if (!record().tyreSale) {
    await openTill(page);
    const search = page.getByPlaceholder(/scan barcode or search/i).first();
    await search.fill(TYRE.barcode!);
    await search.press("Enter");
    await expect(line(page, TYRE.name)).toBeVisible({ timeout: 15_000 });
    // Rubber ages on the shelf. The counter is told which lot it is about to hand over, and how old.
    await expect(
      page.getByText(new RegExp(`${TYRE.name}: lot QA-T-2019 is .* past what you call old`)).locator("visible=true").first(),
      "the till did not say the tyre is old",
    ).toBeVisible({ timeout: 15_000 });
    await quantity(page, TYRE.name, 2);

    // The car on the ramp, found by its plate — typed with the dash, stored without.
    await page.getByPlaceholder("Registration — e.g. LEA-1234").fill(CAR.typed);
    await page.getByRole("button", { name: new RegExp(`^${CAR.plate}`) }).click();
    await expect(page.getByText(`${CAR.make} ${CAR.model} · takes ${CAR.takes}`).locator("visible=true").first()).toBeVisible();
    await page.getByPlaceholder("Odometer").fill("84000");

    const due = await tender(page, "Cash");
    expect(due).toBe(2 * TYRE.price);
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    const sale = await complete(page, request);
    remember({ tyreSale: String(sale.invoice_number), tyreSaleId: String(sale.id) });
  }

  const sale = await ask<Sale>(request, "owner", `/sales/${String(record().tyreSaleId)}`);
  expect(sale.vehicle_id).toBe(record().car);
  expect(Number(sale.odometer)).toBe(84000);

  // OLDEST RUBBER FIRST — whichever lot was stocked first.
  const left = Object.fromEntries((await lots()).map((b) => [b.batch_number, Number(b.quantity)]));
  expect(left["QA-T-2019"], "the old lot was not the one sold from").toBe(2);
  expect(left["QA-T-2026"]).toBe(4);

  // What was done to this car, and at what reading: the reason a workshop keeps records.
  await page.goto("/tenant/vehicles");
  await page.getByRole("button", { name: CAR.plate, exact: true }).click();
  const history = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: CAR.plate }) });
  await expect(history).toContainText(String(record().tyreSale), { timeout: 15_000 });
  await expect(history).toContainText(TYRE.name);
  await expect(history).toContainText("84,000");
});

test("M4 · a dead battery comes across the counter in part-payment — the bill keeps its price, and the scrap is stock", async ({ page, request }) => {
  if (!record().batterySale) {
    const scrapBefore = await stockOf(request, SCRAP.name);
    await openTill(page);
    await ring(page, BATTERY.name);
    expect(await tender(page, "Cash")).toBe(BATTERY.price);

    const sheet = tenderSheet(page);
    await sheet.getByPlaceholder(/Search the item taken in/).fill(SCRAP.name);
    await sheet.getByRole("button", { name: SCRAP.name, exact: true }).click();
    await sheet.getByPlaceholder("Allowance").fill("3000");
    await sheet.getByPlaceholder("e.g. Osaka 70Ah").fill("Old AGS 65Ah");

    // A TENDER, not a discount: the battery is still Rs 28,000; Rs 25,000 changes hands.
    await expect(sheet.getByText("Traded in")).toBeVisible();
    await expect(page.getByTestId("tender-amount-due")).toHaveText(/25,000/);
    await sheet.getByRole("button", { name: /^Exact ·/ }).click();
    const sale = await complete(page, request);
    remember({ batterySale: String(sale.invoice_number), batterySaleId: String(sale.id), scrapBefore });
  }

  const sale = await ask<Sale & { payments: Array<{ method: string; amount: string }>; trade_ins: Row[] }>(request, "owner", `/sales/${String(record().batterySaleId)}`);
  expect(Number(sale.total), "the trade-in was taken off the price").toBe(BATTERY.price);
  expect(Number(sale.discount)).toBe(0);
  expect(Number(sale.trade_in_total)).toBe(3000);
  expect(sale.trade_ins).toHaveLength(1);
  const paid = Object.fromEntries(sale.payments.map((p) => [p.method, Number(p.amount)]));
  expect(paid).toMatchObject({ trade_in: 3000, cash: 25000 });

  // The dead battery is on the shelf as what it is.
  expect(await stockOf(request, SCRAP.name)).toBe(Number(record().scrapBefore) + 1);
});

// ── the workshop ─────────────────────────────────────────────────────

const bookIn = (page: Page): Locator => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Book a car in" }) });

test("M5 · a car is booked into the bay: the plate finds the car and its owner, and five o'clock is five o'clock", async ({ page, request }) => {
  if (!(await jobOf(request, CAR.plate))) {
    await board(page);
    await page.getByRole("button", { name: "Book a car in" }).first().click();
    const form = bookIn(page);
    const book = form.getByRole("button", { name: "Book in" });

    // Typed with the dash. The car is already on record — found, not typed twice.
    await form.getByPlaceholder("LEA-4291").fill(CAR.typed);
    await form.getByRole("button", { name: new RegExp(`^${CAR.plate}`) }).click();
    await expect(form.getByText("Known car — its history will be here.")).toBeVisible();
    // The car remembers whose it is; the form does not ask again.
    await expect(form.getByLabel("Customer", { exact: true })).toHaveValue(CAR.owner);
    await expect(form.getByLabel("Phone", { exact: true })).toHaveValue(CAR.phone);

    await form.getByPlaceholder("Noise from front left when braking").fill(COMPLAINT);
    await form.getByLabel("Odometer coming in", { exact: true }).fill("84500");
    await form.getByLabel("Promised back", { exact: true }).fill(`${dateIn(1)}T17:00`);

    // A job needs something to open it with — and nothing here is a price.
    await expect(book, "a car could be booked in with nothing on the job").toBeDisabled();
    await form.getByPlaceholder("Search a part or a labour item").fill("QA Diagnostic");
    await form.getByRole("button", { name: CHECK.name, exact: true }).click();
    await expect(book).toBeEnabled();
    await book.click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }

  const job = (await jobOf(request, CAR.plate))!;
  remember({ job: String(job.id), jobNumber: String(job.number) });
  expect(job.complaint).toBe(COMPLAINT);
  expect(Number(job.odometer_in)).toBe(84500);
  expect(Number(job.total)).toBe(CHECK.price);
  // FIVE IN THE AFTERNOON, HERE. Sent as typed it was read as five o'clock UTC —
  // ten at night in Lahore — and the car was "due" for five hours after it was late.
  expect(new Date(String(job.promised_at)).getTime(), "the promised time moved between the sheet and the server").toBe(new Date(`${dateIn(1)}T17:00`).getTime());

  // On the board: in the bay, by its plate, with what the customer said and when it is due.
  await board(page);
  const onBoard = card(page, CAR.plate);
  if (job.status === "open" && job.work_status === "received") {
    await expect(column(page, "In the bay").filter({ has: onBoard })).toBeVisible({ timeout: 15_000 });
  }
  if (job.status === "open") {
    await expect(onBoard).toContainText(`${CAR.make} ${CAR.model} · ${CAR.owner}`);
    await expect(onBoard).toContainText(COMPLAINT);
    await expect(onBoard, "the board does not show the hour that was promised").toContainText(/Due .* 05:00/);
  }
});

test("M5 · a plate nobody has seen is registered as it is booked in — and belongs to whoever brought it", async ({ page, request }) => {
  if (!(await jobOf(request, SECOND.plate))) {
    await board(page);
    await page.getByRole("button", { name: "Book a car in" }).first().click();
    const form = bookIn(page);
    await form.getByPlaceholder("LEA-4291").fill(SECOND.typed);
    await expect(form.getByText("New plate. It will be registered when you book the car in.")).toBeVisible({ timeout: 15_000 });
    await form.getByPlaceholder("Noise from front left when braking").fill("Oil change due");
    await form.getByLabel("Customer", { exact: true }).fill(SECOND.owner);
    await form.getByLabel("Phone", { exact: true }).fill(SECOND.phone);
    // No reading taken: the keys were in somebody's hand.
    await form.getByPlaceholder("Search a part or a labour item").fill("QA Diagnostic");
    await form.getByRole("button", { name: CHECK.name, exact: true }).click();
    await form.getByRole("button", { name: "Book in" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }

  // The car is on record under the plate as stored — and it is THEIR car.
  const held = await car(request, SECOND.plate);
  expect(held, "the new plate was not registered").toBeTruthy();
  expect(held!.customer?.phone, "a car booked in for a customer is still nobody's").toBe(SECOND.phone);
  remember({ secondJob: String((await jobOf(request, SECOND.plate))!.id) });
});

test("M6 · parts and labour go on the job as the work is done — and the job comes to all of them", async ({ page, request }) => {
  const id = String(record().job);
  const padsBefore = await stockOf(request, PADS.name);

  if ((await doc(request, id)).status === "open" && (await doc(request, id)).items.length === 1) {
    await openJob(page, CAR.plate);

    // It says what it is — it opened as "Quotation", under "← Quotations & advances".
    await expect(page.getByText("Job card", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "← Workshop" })).toBeVisible();
    const facts = page.getByTestId("job-details");
    await expect(facts).toContainText(CAR.plate);
    await expect(facts).toContainText(COMPLAINT);
    await expect(facts).toContainText("84,500 km");
    await expect(facts).toContainText("In the bay");
    expect(await jobTotal(page)).toBe(1500);

    const add = page.getByLabel("Add a part or labour to this job");
    await expect(add, "a job card has no way to take a part").toBeVisible();

    // The pads.
    await add.fill("QA Brake");
    await page.getByRole("button", { name: `+ ${PADS.name}`, exact: true }).click();
    await expect(jobLine(page, PADS.name)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => jobTotal(page)).toBe(6000);

    // An hour of labour — and then it took two.
    await add.fill("QA Labour");
    await page.getByRole("button", { name: `+ ${LABOUR.name}`, exact: true }).click();
    await expect.poll(() => jobTotal(page)).toBe(7000);
    await page.getByRole("button", { name: `One more ${LABOUR.name}` }).click();
    await expect(jobLine(page, LABOUR.name).getByTestId("job-line-qty")).toHaveValue("2", { timeout: 15_000 });
    await expect.poll(() => jobTotal(page)).toBe(8000);
    // Back to one, and to two again: the figure follows both ways.
    await page.getByRole("button", { name: `One fewer ${LABOUR.name}` }).click();
    await expect.poll(() => jobTotal(page)).toBe(7000);
    await page.getByRole("button", { name: `One more ${LABOUR.name}` }).click();
    await expect.poll(() => jobTotal(page)).toBe(8000);

    // A battery goes on by mistake, and comes off.
    await add.fill("QA Battery");
    await page.getByRole("button", { name: `+ ${BATTERY.name}`, exact: true }).click();
    await expect.poll(() => jobTotal(page)).toBe(36000);
    await page.getByRole("button", { name: `Take ${BATTERY.name} off the job` }).click();
    await expect(jobLine(page, BATTERY.name)).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => jobTotal(page)).toBe(8000);
  }

  const job = await doc(request, id);
  if (job.status === "open") {
    expect(job.items.map((i) => [i.product_name, Number(i.quantity), Number(i.line_total)]).sort()).toEqual(
      [[CHECK.name, 1, 1500], [PADS.name, 1, 4500], [LABOUR.name, 2, 2000]].sort(),
    );
    expect(Number(job.total)).toBe(8000);
    // Nothing has left the shelf: the pads are on the car, the bill is not written.
    expect(await stockOf(request, PADS.name)).toBe(padsBefore);

    // The board carries the same figure.
    await board(page);
    await expect(card(page, CAR.plate)).toContainText("Rs 8,000");
  }
});

test("M7 · the car moves along the board — and back, when the road test fails", async ({ page, request }) => {
  const id = String(record().job);
  if ((await doc(request, id)).status !== "open") return;

  await board(page);
  const move = async (to: string) => {
    await card(page, CAR.plate).getByRole("button", { name: `→ ${to}` }).click();
    await expect(column(page, to).filter({ has: card(page, CAR.plate) }), `the car did not move to ${to}`).toBeVisible({ timeout: 15_000 });
  };

  if ((await doc(request, id)).work_status === "received") await move("Being worked on");
  if ((await doc(request, id)).work_status === "in_progress") await move("Ready");
  expect((await doc(request, id)).work_status).toBe("ready");

  // Ready fails its road test: back on the ramp, then ready again.
  await move("Being worked on");
  expect((await doc(request, id)).work_status).toBe("in_progress");
  // The stage it is NOT in is the one offered; the one it is in is not.
  await expect(card(page, CAR.plate).getByRole("button", { name: "→ Being worked on" })).toHaveCount(0);
  await move("Ready");
  expect((await doc(request, id)).work_status).toBe("ready");
});

test("M8 · billed for everything that went on it, at the reading it leaves on — and the car's history has it", async ({ page, request }) => {
  const id = String(record().job);

  if ((await doc(request, id)).status === "open") {
    const padsBefore = await stockOf(request, PADS.name);
    await board(page);
    await card(page, CAR.plate).getByRole("link", { name: "Bill it" }).click();
    await page.getByRole("button", { name: "Bill & hand over" }).click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Bill & hand over" }) });
    await expect(sheet).toContainText("Take Rs 8,000 and the goods go out.");

    // An odometer only counts up.
    const reading = sheet.getByLabel("Odometer on handover", { exact: true });
    const bill = sheet.getByRole("button", { name: "Bill it" });
    await reading.fill("84000");
    await sheet.getByLabel("Amount taken", { exact: true }).fill("8000");
    await expect(sheet.getByText(/Below the 84,500 km taken when it came in/)).toBeVisible();
    await expect(bill, "a job could be billed at a reading below the one it came in on").toBeDisabled();
    await reading.fill("84520");
    await expect(bill).toBeEnabled();
    await bill.click();
    await expect(sheet).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(/^Billed as INV-/).first()).toBeVisible({ timeout: 20_000 });
    // Billed is finished: nothing more goes on it.
    await expect(page.getByLabel("Add a part or labour to this job")).toHaveCount(0);

    expect(await stockOf(request, PADS.name), "the pads did not leave the shelf when the job was billed").toBe(padsBefore - 1);
  }

  const job = await doc(request, id);
  expect(job.status).toBe("converted");
  const sale = await ask<Sale>(request, "owner", `/sales/${String((job.sale as Row).id)}`);
  remember({ jobSale: String(sale.invoice_number) });
  expect(Number(sale.total), "the job was not billed for everything that went on it").toBe(8000);
  expect(sale.items.map((i) => String(i.product_name)).sort()).toEqual([CHECK.name, LABOUR.name, PADS.name].sort());
  expect(sale.vehicle_id).toBe(record().car);
  expect(Number(sale.odometer), "the invoice carries the reading it arrived on, not the one it left on").toBe(84520);
  expect(sale.customer_name).toBe(CAR.owner);

  // The car has gone: it is not on the board. The other one still is.
  await board(page);
  await expect(card(page, SECOND.plate)).toBeVisible({ timeout: 15_000 });
  await expect(card(page, CAR.plate)).toHaveCount(0);

  // The car's own record: two visits, and the reading it left on.
  expect(Number((await car(request, CAR.plate))!.odometer)).toBe(84520);
  await page.goto("/tenant/vehicles");
  await page.getByRole("button", { name: CAR.plate, exact: true }).click();
  const history = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: CAR.plate }) });
  await expect(history).toContainText(String(record().jobSale), { timeout: 15_000 });
  await expect(history).toContainText(String(record().tyreSale));
  await expect(history).toContainText(PADS.name);
  await expect(history).toContainText("84,520");
});

test("M9 · a car that came in with no reading can still leave with one", async ({ page, request }) => {
  const id = String(record().secondJob);

  if ((await doc(request, id)).status === "open") {
    await openJob(page, SECOND.plate);
    await expect(page.getByTestId("job-details")).toContainText("Oil change due");
    await page.getByRole("button", { name: "Bill & hand over" }).click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Bill & hand over" }) });
    const reading = sheet.getByLabel("Odometer on handover", { exact: true });
    await expect(reading, "a car booked in without a reading cannot be given one when it leaves").toBeVisible();
    await expect(sheet).toContainText("No reading was taken when it came in.");
    await reading.fill("12000");
    await sheet.getByLabel("Amount taken", { exact: true }).fill("1500");
    await sheet.getByRole("button", { name: "Bill it" }).click();
    await expect(sheet).toBeHidden({ timeout: 20_000 });
  }

  const job = await doc(request, id);
  expect(job.status).toBe("converted");
  const sale = await ask<Sale>(request, "owner", `/sales/${String((job.sale as Row).id)}`);
  expect(Number(sale.odometer)).toBe(12000);
  expect(Number((await car(request, SECOND.plate))!.odometer)).toBe(12000);

  // Nothing is left in the shop.
  await board(page);
  await expect(page.getByText("No cars in the shop.")).toBeVisible({ timeout: 15_000 });
});
