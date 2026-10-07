import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { OWNER_STATE, TRADE, ask, expect, record, remember, session, settled, test } from "./kit";
import { editor } from "./shop";
import { complete, line, openTill, quantity, ring, tender, tenderSheet, type Sale } from "./till";

/**
 * STAGE N — A PETROL PUMP'S OWN DAY.
 *
 * Stages A and B are the same for every trade. What a forecourt does that no
 * other shop does:
 *
 *   its stock is in the GROUND, measured by a dipstick, and leaves through a
 *   meter that only counts up
 *
 *   a tanker is recorded twice — what the invoice claims and what the dips
 *   say arrived — and what it cost becomes what the fuel cost
 *
 *   the customer asks for money, not litres: "do hazaar ka daal do"
 *
 *   the rate changes at midnight, on a notice that came at eight
 *
 *   a shift is closed by reading every meter and dipping every tank, and it
 *   says two different things: fuel that left the pump unbilled, and fuel
 *   that left the ground without crossing a meter
 *
 * Run with `JOURNEY_TRADE=petroleum`, after stages 01 and 02 for that trade.
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "petroleum", "a forecourt's stage — run with JOURNEY_TRADE=petroleum");
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Row = Record<string, unknown>;

const PETROL = { name: "QA Petrol", price: 290, cost: 265 } as const;
const DIESEL = { name: "QA Diesel", price: 285, cost: 262 } as const;
const TANKS = [
  { name: "QA Tank 1 — Petrol", holds: PETROL.name, capacity: 30000, dip: 2000, dead: 300 },
  { name: "QA Tank 2 — Diesel", holds: DIESEL.name, capacity: 20000, dip: 6000, dead: 200 },
] as const;
const PUMP = "QA Pump 1";
const NOZZLES = [
  { name: "A1", tank: TANKS[0].name, reading: 125000 },
  { name: "B1", tank: TANKS[1].name, reading: 48000 },
] as const;
const SUPPLIER = { name: "QA Oil Marketing Co", contact: "Depot desk", phone: "0421130001" } as const;
/** One tanker of petrol: 10,000 on the invoice, 9,900 by the dips. */
const LOAD = { invoiced: 10000, rate: 270, before: 2000, after: 11900, invoice: "QA-OMC-0001", tanker: "TLK-512" } as const;

const product = async (request: APIRequestContext, name: string): Promise<Row | undefined> =>
  (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`)).find((p) => p.name === name);
const tanks = async (request: APIRequestContext) => ask<Array<Row & { name: string }>>(request, "owner", "/fuel/tanks");
const pumps = async (request: APIRequestContext) => ask<Array<Row & { name: string; nozzles?: Array<Row & { name: string }> }>>(request, "owner", "/fuel/pumps");
const deliveries = async (request: APIRequestContext) => ask<Array<Row & { supplier?: { name: string } | null }>>(request, "owner", "/fuel/deliveries");

/** Card a fuel: by the litre, measured, with what it is thought to cost. */
async function card(page: Page, fuel: { name: string; price: number; cost: number }): Promise<void> {
  await page.goto("/tenant/products/new");
  const form = editor(page);
  await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });
  await form.getByLabel("Name *", { exact: true }).fill(fuel.name);
  await form.getByLabel("Price *", { exact: true }).fill(String(fuel.price));
  await form.getByLabel("Cost (optional)", { exact: true }).fill(String(fuel.cost));
  const description = form.getByLabel("Description *", { exact: true });
  if (await description.isVisible().catch(() => false)) await description.fill(`${fuel.name} — added by the QA journey.`);
  await form.getByRole("button", { name: "Codes & packs" }).click();
  await form.getByPlaceholder("pcs, kg, box…").fill("Litre");
  await form.getByLabel("Sold by", { exact: true }).selectOption({ label: "Weight / measure (0.5, 1.25…)" });
  const create = form.getByRole("button", { name: "Create item" });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(form).toBeHidden({ timeout: 20_000 });
}

const sheet = (page: Page, title: string): Locator => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test("N1 · the fuels are carded by the litre, and the forecourt is built: tanks, a pump, its hoses", async ({ page, request }) => {
  for (const fuel of [PETROL, DIESEL]) if (!(await product(request, fuel.name))) await card(page, fuel);
  for (const fuel of [PETROL, DIESEL]) {
    const held = (await product(request, fuel.name))!;
    expect(held.sold_by).toBe("weight");
    expect(held.unit).toBe("Litre");
  }
  remember({ petrol: String((await product(request, PETROL.name))!.id), diesel: String((await product(request, DIESEL.name))!.id) });

  await page.goto("/tenant/fuel/setup");
  await expect(page.getByRole("heading", { name: "Tanks & pumps" })).toBeVisible({ timeout: 20_000 });

  for (const tank of TANKS) {
    if ((await tanks(request)).some((t) => t.name === tank.name)) continue;
    await page.getByRole("button", { name: "Add tank" }).click();
    const form = sheet(page, "Add tank");
    await form.getByPlaceholder("Tank 1 — Petrol").fill(tank.name);
    await form.getByRole("combobox").selectOption({ label: tank.holds });
    const add = form.getByRole("button", { name: "Add tank" });
    // A tank is not installed until somebody says how much it holds.
    await expect(add, "a tank could be added with no capacity").toBeDisabled();
    await form.getByLabel("Capacity (L) *", { exact: true }).fill(String(tank.capacity));
    await form.getByLabel("Current dip (L)", { exact: true }).fill(String(tank.dip));
    await form.getByLabel("Dead stock (L)", { exact: true }).fill(String(tank.dead));
    await add.click();
    await expect(form).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(tank.name).first()).toBeVisible();
  }

  if (!(await pumps(request)).some((p) => p.name === PUMP)) {
    await page.getByRole("button", { name: "Add pump" }).click();
    const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add pump" }) });
    await form.getByPlaceholder("Pump 1").fill(PUMP);
    await form.getByRole("button", { name: "Add pump" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }

  for (const nozzle of NOZZLES) {
    const pump = (await pumps(request)).find((p) => p.name === PUMP)!;
    if ((pump.nozzles ?? []).some((n) => n.name === nozzle.name)) continue;
    await page.reload();
    await page.getByRole("button", { name: "Add nozzle" }).first().click();
    const form = sheet(page, "Add nozzle");
    await form.getByPlaceholder("A1").fill(nozzle.name);
    await form.getByRole("combobox").selectOption({ label: nozzle.tank });
    const add = form.getByRole("button", { name: "Add nozzle" });
    // A hose is not carded until somebody reads its meter — and nought is a reading.
    await expect(add, "a nozzle could be added without its meter reading").toBeDisabled();
    await form.getByLabel("Meter reading now", { exact: true }).fill(String(nozzle.reading));
    await add.click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }

  const held = await tanks(request);
  expect(held.map((t) => [t.name, Number(t.capacity_litres)]).sort()).toEqual(TANKS.map((t) => [t.name, t.capacity]).sort());
  remember({ petrolTank: String(held.find((t) => t.name === TANKS[0].name)!.id), dieselTank: String(held.find((t) => t.name === TANKS[1].name)!.id) });

  // …and ON THE SHELF. A tank installed with 6,000 litres in it left the shelf
  // at nought, and the till called the station's own diesel out of stock.
  // (Until a shift is running: after that the shelf moves with the till and the ground waits for the dipstick.)
  if (!record().shift) {
    expect(Number((await product(request, DIESEL.name))!.stock_quantity), "the diesel in the tank is not on the shelf").toBe(Number(held.find((t) => t.name === TANKS[1].name)!.current_dip_litres));
    expect(Number(held.find((t) => t.name === TANKS[1].name)!.current_dip_litres)).toBe(TANKS[1].dip);
  }
});

test("N2 · a tanker arrives: what the invoice claims, what the dips say, who it came from — and what the fuel now costs", async ({ page, request }) => {
  if (!(await deliveries(request)).some((d) => d.invoice_number === LOAD.invoice)) {
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

    await page.goto("/tenant/fuel/deliveries");
    await page.getByRole("button", { name: "Record delivery" }).click();
    const form = sheet(page, "Record delivery");
    const save = form.getByRole("button", { name: "Record", exact: true });
    await form.getByRole("combobox").first().selectOption({ label: TANKS[0].name });
    // WHO it came from. The list has always had the column; the form never asked.
    const from = form.getByLabel("Who the tanker came from");
    await expect(from, "a delivery cannot say which supplier it came from").toBeVisible();
    await from.selectOption({ label: SUPPLIER.name });
    await form.getByLabel("Invoiced litres", { exact: true }).fill(String(LOAD.invoiced));
    await form.getByLabel("Rate per litre", { exact: true }).fill(String(LOAD.rate));

    // One dip says nothing by itself, and is not quietly dropped.
    await form.getByLabel("Dip before", { exact: true }).fill(String(LOAD.before));
    await expect(form.getByTestId("one-dip")).toBeVisible();
    await expect(save, "a delivery with one dip could be recorded — on the invoice, in silence").toBeDisabled();
    await form.getByLabel("Dip after", { exact: true }).fill(String(LOAD.after));
    await expect(form.getByTestId("one-dip")).toHaveCount(0);

    await form.getByLabel("Invoice no.", { exact: true }).fill(LOAD.invoice);
    await form.getByLabel("Tanker no.", { exact: true }).fill(LOAD.tanker);
    await save.click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }

  // 9,900 arrived for 10,000 billed: received by the dips, and 100 short on the record.
  const load = (await deliveries(request)).find((d) => d.invoice_number === LOAD.invoice)!;
  expect(Number(load.received_litres)).toBe(9900);
  expect(Number(load.shortage_litres)).toBe(100);
  expect(load.supplier?.name, "the delivery does not say who it came from").toBe(SUPPLIER.name);

  await page.goto("/tenant/fuel/deliveries");
  await settled(page);
  const row = page.getByRole("row").filter({ hasText: LOAD.invoice }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(SUPPLIER.name);
  await expect(row).toContainText("10,000 L");
  await expect(row).toContainText("9,900 L");
  await expect(row).toContainText("100 L");
  await expect(row).toContainText("2,673,000");

  // In the ground, and on the shelf: 2,000 + 9,900.
  if (!record().shift) {
    const tank = (await tanks(request)).find((t) => t.name === TANKS[0].name)!;
    expect(Number(tank.current_dip_litres)).toBe(11900);
    expect(Number((await product(request, PETROL.name))!.stock_quantity)).toBe(11900);
  }

  // WHAT THE PETROL COST. (2,000 × 265 + 9,900 × 270) ÷ 11,900 — it stayed at 265 for ever.
  expect(Number((await product(request, PETROL.name))!.cost), "the tanker's rate did not reach the fuel's cost").toBeCloseTo(269.16, 2);
  expect(Number((await product(request, DIESEL.name))!.cost)).toBe(DIESEL.cost);
});

// ── the shift ────────────────────────────────────────────────────────

type Shift = Row & { id: string; number: string; status: string; readings: Array<Row & { nozzle_name: string }>; dips: Array<Row & { tank_name: string }> };
const current = async (request: APIRequestContext) => ask<Shift | null>(request, "owner", "/fuel/shifts/current");

test("N3 · a shift starts where every meter and tank stands — and the plant is frozen while it runs", async ({ page, request }) => {
  if (!(await current(request)) && !record().shift) {
    await page.goto("/tenant/fuel");
    await page.getByRole("button", { name: "Start shift" }).first().click();
    const start = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Start a shift" }) });
    // Nobody named on a hose: a one-man pump still runs.
    await expect(start).toContainText("Nobody named — the close will report the station as a whole.");
    await start.getByRole("button", { name: "Start shift" }).click();
    await expect(start).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Meter readings" })).toBeVisible({ timeout: 15_000 });
  }

  const shift = await current(request);
  if (shift) {
    remember({ shift: shift.id, shiftNumber: shift.number });
    expect(Object.fromEntries(shift.readings.map((r) => [r.nozzle_name, Number(r.opening_reading)]))).toEqual({ A1: 125000, B1: 48000 });
    expect(Object.fromEntries(shift.dips.map((d) => [d.tank_name, Number(d.opening_dip)]))).toEqual({ [TANKS[0].name]: 11900, [TANKS[1].name]: 6000 });

    // The plant holds this shift's opening readings: nothing is added or moved under it.
    await page.goto("/tenant/fuel/setup");
    await expect(page.getByText(/is running — the forecourt is frozen/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Add tank" })).toBeDisabled();
  }
});

test("N4 · \"do hazaar ka daal do\" — fuel is sold by the money, and by the litre", async ({ page, request }) => {
  if (!record().fuelSale) {
    await openTill(page);
    await ring(page, PETROL.name);

    // BY RUPEES, on an ordinary till. It lived only on the on-screen keypad's
    // sheet, behind a switch that is off by default.
    const byRupees = line(page, PETROL.name).getByRole("button", { name: `Sell ${PETROL.name} by rupees` });
    await expect(byRupees, "the till has no way to sell fuel by the money").toBeVisible();
    await byRupees.click();
    const pad = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: PETROL.name }) });
    await expect(pad).toBeVisible();
    // Typed on the keyboard this counter has.
    await page.keyboard.type("2000");
    await expect(pad).toContainText("≈ 6.897 Litre at Rs 290");
    await page.keyboard.press("Enter");
    await expect(pad).toBeHidden();
    // The money is the figure; the litres are what it buys.
    await expect(line(page, PETROL.name)).toContainText("for Rs 2,000");
    await expect(line(page, PETROL.name).locator("input").first()).toHaveValue("6.897");

    // And twenty litres of diesel, asked for as litres.
    await ring(page, DIESEL.name);
    await quantity(page, DIESEL.name, 20);

    const due = await tender(page, "Cash");
    expect(due, "Rs 2,000 of petrol is not Rs 2,000 on the bill").toBe(2000 + 20 * DIESEL.price);
    await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
    const sale = await complete(page, request);
    remember({ fuelSale: String(sale.invoice_number), fuelSaleId: String(sale.id) });
  }

  const sale = await ask<Sale>(request, "owner", `/sales/${String(record().fuelSaleId)}`);
  const lines = Object.fromEntries(sale.items.map((i) => [String(i.product_name), i]));
  // Charged the money that was asked for — to the rupee, not 6.897 × 290 = 2,000.13.
  expect(Number(lines[PETROL.name].line_total)).toBe(2000);
  expect(Number(lines[PETROL.name].quantity)).toBeCloseTo(6.897, 3);
  expect(Number(lines[DIESEL.name].line_total)).toBe(5700);
  expect(Number(sale.total)).toBe(7700);
});

test("N5 · the rate changes at midnight, on a notice that came at eight — recorded now, at the pumps then", async ({ page, request }) => {
  type Change = Row & { new_price: string; applied_at: string | null; effective_at: string };
  const changes = async () => ask<Change[]>(request, "owner", "/fuel/prices");

  if (!(await changes()).some((c) => Number(c.new_price) === 295)) {
    await page.goto("/tenant/fuel/deliveries");
    await page.getByRole("button", { name: "New rate" }).click();
    const form = sheet(page, "New rate");
    await form.getByRole("combobox").selectOption({ label: PETROL.name });
    await form.getByLabel("New rate", { exact: true }).fill("295");

    // WHEN. The form could only say "now" — so somebody had to be at the
    // screen at midnight, on the busiest night of the fortnight.
    const later = form.getByRole("button", { name: "At a time" });
    await expect(later, "a rate can only be entered for this very moment").toBeVisible();
    await later.click();
    const when = form.getByLabel("When the rate takes effect").last();
    // Offered: midnight tonight.
    await expect(when).toHaveValue(/T00:00$/);
    const record_ = form.getByRole("button", { name: "Record", exact: true });

    // An hour that has gone is not "later".
    await when.fill("2020-01-01T00:00");
    await expect(form.getByText(/That time has passed/)).toBeVisible();
    await expect(record_).toBeDisabled();

    const d = new Date();
    d.setDate(d.getDate() + 1);
    const midnight = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}T00:00`;
    await when.fill(midnight);
    await form.getByPlaceholder("OGRA notification").fill("OGRA notification, effective midnight");
    await expect(record_).toBeEnabled();
    await record_.click();
    await expect(form).toBeHidden({ timeout: 15_000 });
    remember({ midnight });
  }

  // Recorded, and waiting: tonight's petrol is still tonight's price.
  const waiting = (await changes()).find((c) => Number(c.new_price) === 295)!;
  expect(waiting.applied_at, "tomorrow's rate is already at the pumps").toBeNull();
  expect(new Date(waiting.effective_at).getTime()).toBe(new Date(String(record().midnight)).getTime());
  expect(Number((await product(request, PETROL.name))!.price)).toBe(290);

  await page.goto("/tenant/fuel/deliveries");
  await settled(page);
  const row = page.locator("div").filter({ has: page.getByTestId("rate-waiting") }).filter({ hasText: PETROL.name }).last();
  await expect(row).toContainText("Not at the pumps yet", { timeout: 15_000 });
  await expect(row).toContainText("from ");
  await expect(row).toContainText("OGRA notification, effective midnight");
});

test("N6 · the shift is closed on every meter and every dip — and says where the fuel went, twice over", async ({ page, request }) => {
  const id = String(record().shift);
  const shiftOf = async () => ask<Shift>(request, "owner", `/fuel/shifts/${id}`);

  if ((await shiftOf()).status === "open") {
    await page.goto("/tenant/fuel");
    await expect(page.getByRole("heading", { name: "Meter readings" })).toBeVisible({ timeout: 15_000 });
    const close = page.getByRole("button", { name: "Close & reconcile" });
    const nozzle = (name: string) => page.getByRole("row").filter({ hasText: `${PUMP} · ${name}` }).locator("input");
    const dip = (tank: string) => page.getByRole("row").filter({ hasText: tank }).locator("input").first();

    // A1 pumped the 6.897 litres that were sold, and 5 more into a test can that went back in the tank.
    await nozzle("A1").nth(0).fill("125011.897");
    await nozzle("A1").nth(1).fill("5");
    await expect(page.getByRole("row").filter({ hasText: `${PUMP} · A1` })).toContainText("6.897 L");
    // Not until EVERY meter is read and EVERY tank dipped.
    await expect(close, "a shift could be closed with a meter unread").toBeDisabled();
    await nozzle("B1").nth(0).fill("48020");
    await expect(close).toBeDisabled();

    // Petrol: the book says 11,893.103; the stick says 11,880. Diesel: to the litre.
    await dip(TANKS[0].name).fill("11880");
    await dip(TANKS[1].name).fill("5980");
    await expect(close).toBeEnabled();
    await close.click();
    await expect(page.getByText("No shift is running.")).toBeVisible({ timeout: 20_000 });
  }

  const shift = await shiftOf();
  expect(shift.status).toBe("closed");
  // METERS: 26.897 litres sold, 5 tested — and the test litres are neither.
  expect(Number(shift.litres_sold)).toBeCloseTo(26.897, 3);
  expect(Number(shift.test_litres)).toBe(5);
  // TILL: the same 26.897. Nothing left a hose unbilled.
  expect(Number(shift.pos_fuel_litres)).toBeCloseTo(26.897, 3);
  expect(Number(shift.unbilled_litres), "fuel that was rung is reported as unbilled").toBeCloseTo(0, 3);
  // GROUND: 13.103 litres of petrol are not where the book says. A different finding.
  expect(Math.abs(Number(shift.tank_variance_litres))).toBeCloseTo(13.103, 3);
  // A rate was recorded during it — but it has not reached the pumps, so the shift did not straddle one.
  expect(shift.price_changed_during).toBe(false);

  // The shelf is what the stick said.
  expect(Number((await product(request, PETROL.name))!.stock_quantity)).toBe(11880);
  expect(Number((await product(request, DIESEL.name))!.stock_quantity)).toBe(5980);

  // The closed shift says both things, apart.
  await page.goto(`/tenant/fuel/shifts/${id}`);
  await expect(page.getByRole("heading", { name: String(record().shiftNumber) })).toBeVisible({ timeout: 20_000 });
  const face = page.locator("body");
  await expect(face).toContainText("26.897 L");
  await expect(face).toContainText("5 L tested");
  await expect(face).toContainText("Left a nozzle, never rung up");
  await expect(face).toContainText("Left the tank, crossed no meter");
  await expect(page.getByRole("row").filter({ hasText: TANKS[0].name })).toContainText("13.103 L");
  // Diesel was to the litre: no variance drawn against it.
  await expect(page.getByRole("row").filter({ hasText: TANKS[1].name })).not.toContainText("Rs");

  // And the plant is free again, with the meters where the shift left them.
  const pump = (await pumps(request)).find((p) => p.name === PUMP)!;
  expect(Object.fromEntries((pump.nozzles ?? []).map((n) => [n.name, Number(n.current_reading)]))).toEqual({ A1: 125011.897, B1: 48020 });
  await page.goto("/tenant/fuel/setup");
  await expect(page.getByRole("button", { name: "Add tank" })).toBeEnabled({ timeout: 15_000 });
});
