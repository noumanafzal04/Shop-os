import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { API, tradeAuth } from "./api";

/**
 * A JOB GROWS AS THE WORK IS DONE — and the car it is on.
 *
 * Found by the workshop's journey (stage M), which lives its day once. This is
 * the same day somewhere it can be lived every time: one fixed car, booked in,
 * worked on, billed and gone by the end of each run.
 *
 * What the journey found, and what this holds in place:
 *
 *   a job card could not take a part or an hour of labour after it was booked
 *     in — so it was billed for the one line it arrived with
 *   it opened as a "Quotation", with nothing about the car on it
 *   a car promised for five o'clock was stored as ten at night
 *   the till had no way to put a sale on a car: the vehicle box was drawn
 *     only for a loyalty member or a prescription
 *   a car could not be given an owner from any screen
 *   a car booked in with no reading could not be given one when it left
 *   a quantity could only be pressed out one at a time, never typed
 *
 * A workshop's spec. In every other trade's project it stands aside.
 */

/** Fixed names, never stamped: a fixture named for the moment it ran is one more row for ever. */
const CHECK = { name: "E2E Job Check", price: 1500, service: true };
const LABOUR = { name: "E2E Job Labour", price: 1000, service: true };
const PART = { name: "E2E Job Part", price: 4500, service: false };
const CAR = { typed: "E2E-JOB-1", plate: "E2EJOB1" } as const;
const OWNERS = [
  { name: "E2E Owner One", phone: "03007770001" },
  { name: "E2E Owner Two", phone: "03007770002" },
] as const;

type Row = Record<string, unknown>;
const headers = () => tradeAuth("automotive");

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

/** The three things a job is made of here, carded once. Nothing is stocked, so nothing runs down. */
async function shelf(request: APIRequestContext): Promise<void> {
  const held = await get<Row[]>(request, `/products?search=${encodeURIComponent("E2E Job")}&per_page=20`);
  for (const item of [CHECK, LABOUR, PART]) {
    if (held.some((p) => p.name === item.name)) continue;
    await post(request, "/products", {
      item_type: item.service ? "service" : "physical_product", name: item.name, price: item.price, is_active: true,
      description: "A fixture for the job card.", tax_rate: 0,
      // A service keeps no stock and may not be told otherwise; the part is not counted.
      ...(item.service ? {} : { track_inventory: false }),
    });
  }
}

type Vehicle = Row & { id: string; registration: string; customer?: { name: string | null; phone: string | null } | null };
const theCar = async (request: APIRequestContext) =>
  (await get<Vehicle[]>(request, `/vehicles?search=${CAR.plate}`)).find((v) => v.registration === CAR.plate);

type Job = Row & { id: string; status: string; vehicle?: { registration: string } | null };
const openJobs = async (request: APIRequestContext) =>
  (await get<Job[]>(request, "/sale-documents?kind=job_card&status=open&per_page=100")).filter((j) => j.vehicle?.registration === CAR.plate);

/** The car on record, and not in the shop: whatever an earlier run left on the board for it is cancelled. */
async function carOutOfTheShop(request: APIRequestContext): Promise<Vehicle> {
  const car = (await theCar(request)) ?? (await post<Vehicle>(request, "/vehicles", { registration: CAR.typed, make: "Suzuki", model: "Mehran" }));
  for (const job of await openJobs(request)) await post(request, `/sale-documents/${job.id}/cancel`, { reason: "e2e: left by an earlier run" });

  return car;
}

const card = (page: Page): Locator => page.locator("div.rounded-xl").filter({ has: page.getByRole("link", { name: CAR.plate, exact: true }) });
const total = async (page: Page): Promise<number> =>
  Number((await page.getByText("Total", { exact: true }).locator("xpath=following-sibling::*[1]").innerText()).replace(/[^0-9.]/g, ""));
const tomorrowAt = (time: string): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);

  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}T${time}`;
};

test("a car is booked in, the job grows as it is worked on, and it is billed for all of it", async ({ page, request }, info) => {
  test.skip(info.project.name !== "trade-automotive", "a workshop's board — the other trades book no car in");
  await shelf(request);
  await carOutOfTheShop(request);

  // ── booked in ──────────────────────────────────────────────────────
  await page.goto("/tenant/workshop");
  await page.getByRole("button", { name: "Book a car in" }).first().click();
  const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Book a car in" }) });
  await form.getByPlaceholder("LEA-4291").fill(CAR.typed);
  await form.getByRole("button", { name: new RegExp(`^${CAR.plate}`) }).click();
  await form.getByPlaceholder("Noise from front left when braking").fill("Rattle over bumps");
  // No odometer: the keys were in somebody's hand.
  const promised = tomorrowAt("17:00");
  await form.getByLabel("Promised back", { exact: true }).fill(promised);
  await form.getByPlaceholder("Search a part or a labour item").fill(CHECK.name);
  await form.getByRole("button", { name: CHECK.name, exact: true }).click();
  await form.getByRole("button", { name: "Book in" }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });

  const [job] = await openJobs(request);
  expect(job, "the car was booked in and is not in the shop").toBeTruthy();
  // FIVE IN THE AFTERNOON, HERE — not five o'clock UTC.
  expect(new Date(String(job.promised_at)).getTime(), "the promised time moved between the sheet and the server").toBe(new Date(promised).getTime());
  await expect(card(page), "the board does not show the hour that was promised").toContainText(/Due .* 05:00/, { timeout: 15_000 });

  // ── its own page ───────────────────────────────────────────────────
  await card(page).getByRole("link", { name: CAR.plate, exact: true }).click();
  const facts = page.getByTestId("job-details");
  await expect(facts).toContainText(CAR.plate, { timeout: 15_000 });
  await expect(facts).toContainText("Rattle over bumps");
  await expect(facts).toContainText(/05:00/);
  await expect(page.getByText("Job card", { exact: true }), "a job card is called a quotation").toBeVisible();
  await expect(page.getByText("Quotation", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "← Workshop" })).toBeVisible();
  expect(await total(page)).toBe(1500);

  // ── it grows ───────────────────────────────────────────────────────
  const add = page.getByLabel("Add a part or labour to this job");
  await expect(add, "a job card has no way to take a part").toBeVisible();
  await add.fill(PART.name);
  await page.getByRole("button", { name: `+ ${PART.name}`, exact: true }).click();
  await expect.poll(() => total(page), { message: "the part did not go on the job" }).toBe(6000);

  await add.fill(LABOUR.name);
  await page.getByRole("button", { name: `+ ${LABOUR.name}`, exact: true }).click();
  await expect.poll(() => total(page)).toBe(7000);
  await page.getByRole("button", { name: `One more ${LABOUR.name}` }).click();
  await expect.poll(() => total(page), { message: "a second hour did not go on" }).toBe(8000);
  await page.getByRole("button", { name: `One fewer ${LABOUR.name}` }).click();
  await expect.poll(() => total(page)).toBe(7000);

  // A number is typed, not pressed out one at a time: three hours, then back to one.
  const hours = page.getByLabel(`How many ${LABOUR.name}`, { exact: true });
  await hours.fill("3");
  await hours.press("Enter");
  await expect.poll(() => total(page), { message: "a typed quantity did not reach the job" }).toBe(9000);
  await hours.fill("1");
  await hours.press("Enter");
  await expect.poll(() => total(page)).toBe(7000);

  // Half a part is refused by the server — and the box says what is really on the job.
  const parts = page.getByLabel(`How many ${PART.name}`, { exact: true });
  await parts.fill("0.5");
  await parts.press("Enter");
  await expect(parts, "a refused quantity stayed in the box as if it had been taken").toHaveValue("1", { timeout: 15_000 });
  expect(await total(page)).toBe(7000);

  // The check comes off: it was not charged after all.
  await page.getByRole("button", { name: `Take ${CHECK.name} off the job` }).click();
  await expect.poll(() => total(page), { message: "the line did not come off" }).toBe(5500);
  await expect(page.getByRole("row").filter({ hasText: CHECK.name })).toHaveCount(0);

  // ── billed, at the reading it leaves on ────────────────────────────
  await page.getByRole("button", { name: "Bill & hand over" }).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Bill & hand over" }) });
  await expect(sheet).toContainText("Take Rs 5,500 and the goods go out.");
  const reading = sheet.getByLabel("Odometer on handover", { exact: true });
  await expect(reading, "a car booked in without a reading cannot be given one when it leaves").toBeVisible();
  const car = (await theCar(request))!;
  const leaves = Math.max(Number(car.odometer ?? 0), 50_000) + 10;
  await reading.fill(String(leaves));
  await sheet.getByLabel("Amount taken", { exact: true }).fill("5500");
  await sheet.getByRole("button", { name: "Bill it" }).click();
  await expect(sheet).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(/^Billed as INV-/).first()).toBeVisible({ timeout: 20_000 });
  // Billed is finished.
  await expect(page.getByLabel("Add a part or labour to this job")).toHaveCount(0);

  const billed = await get<Row & { status: string; sale: { id: string } }>(request, `/sale-documents/${job.id}`);
  expect(billed.status).toBe("converted");
  const sale = await get<Row & { items: Row[] }>(request, `/sales/${billed.sale.id}`);
  expect(Number(sale.total), "the job was not billed for everything on it").toBe(5500);
  expect(sale.items.map((i) => String(i.product_name)).sort()).toEqual([LABOUR.name, PART.name].sort());
  expect(Number(sale.odometer)).toBe(leaves);
  expect(Number((await theCar(request))!.odometer)).toBe(leaves);

  // The car has gone.
  await page.goto("/tenant/workshop");
  await expect(page.getByRole("heading", { name: "Workshop", exact: true })).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(card(page)).toHaveCount(0);
});

test("the till can put a sale on a car — the plate finds it, and its reading is taken", async ({ page, request }, info) => {
  test.skip(info.project.name !== "trade-automotive", "a workshop's till — the other trades sell to no car");
  await shelf(request);
  await carOutOfTheShop(request);

  await page.goto("/tenant/pos");
  const search = page.getByPlaceholder(/scan barcode or search/i).first();
  await expect(search).toBeVisible({ timeout: 30_000 });
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  if (await reset.isEnabled().catch(() => false)) await reset.click();

  const plate = page.getByPlaceholder("Registration — e.g. LEA-1234");
  // Nothing to put a car on yet.
  await expect(plate).toHaveCount(0);

  await search.fill(LABOUR.name);
  await page.locator("[data-pos-item]").filter({ hasText: LABOUR.name }).first().click();
  await search.fill("");

  // A bill: now there is.
  await expect(plate.locator("visible=true").first(), "the till has no way to put this sale on a car").toBeVisible({ timeout: 10_000 });
  await plate.locator("visible=true").first().fill(CAR.typed);
  await page.getByRole("button", { name: new RegExp(`^${CAR.plate}`) }).locator("visible=true").first().click();
  await expect(page.getByText("Suzuki Mehran").locator("visible=true").first()).toBeVisible();
  await expect(page.getByPlaceholder("Odometer").locator("visible=true").first()).toBeVisible();

  // Nothing is rung: this is about the door, not the sale.
  await page.getByRole("button", { name: "Remove vehicle" }).locator("visible=true").first().click();
  await reset.click();
});

test("a car can be told whose it is, from the screen that lists cars", async ({ page, request }, info) => {
  test.skip(info.project.name !== "trade-automotive", "a workshop's cars — the other trades keep none");
  const car = await carOutOfTheShop(request);
  // Whoever it is NOT now, so the change is one this run made.
  const next = OWNERS.find((o) => o.phone !== (car.customer?.phone ?? ""))!;

  await page.goto("/tenant/vehicles");
  await page.getByPlaceholder("Registration, make or model…").fill(CAR.plate);
  const row = page.getByRole("row").filter({ hasText: CAR.plate }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button", { name: "Edit" }).click();
  const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Edit ${CAR.plate}` }) });
  const phone = form.getByLabel("Owner’s phone");
  await expect(phone, "the vehicle form has nowhere to say whose car it is").toBeVisible();
  await phone.fill(next.phone);
  await form.getByLabel("Owner’s name").fill(next.name);
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });

  await expect(row, "the owner was typed and the car is not theirs").toContainText(next.name, { timeout: 15_000 });
  expect((await theCar(request))!.customer?.phone).toBe(next.phone);
});
