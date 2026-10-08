import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { OWNER_STATE, TRADE, ask, expect, record, remember, rupees, session, settled, test } from "./kit";
import { addItem, type Item } from "./shop";
import { complete, openTill, quantity, ring, tender, type Sale } from "./till";

/**
 * STAGE O — A LAUNDRY'S OWN DAY.
 *
 * Stages A and B are the same for every trade. What a laundry, a tailor or a
 * repair counter does that no other shop does:
 *
 *   what it sells is WORK — nothing on a shelf, nothing to count
 *
 *   most of it is TAKEN IN: eight shirts over the counter with what the
 *   customer wants done, a name, a phone and a day to come back — and no car,
 *   no odometer, nothing "wrong" with any of it
 *
 *   money is left with it, and the slip the customer takes away says so
 *
 *   it grows (two more shirts the next morning, the collars starched), moves
 *   along the board, and is billed for all of it with the advance taken off
 *
 *   a customer who never comes back is cancelled, and what happens to their
 *   advance is said, not assumed
 *
 * Run with `JOURNEY_TRADE=services`, after stages 01 and 02 for that trade.
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "services", "a laundry's stage — run with JOURNEY_TRADE=services");
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Row = Record<string, unknown>;

// Exempt on purpose: this stage is about the work, and the bills it adds up are
// easier to read without a tax line. Stage C is where tax is judged.
const WASH: Item = { key: "wash", name: "QA Shirt Wash and Press", type: "service", price: 150, taxRate: 0, effectiveTax: 0 };
const STARCH: Item = { key: "starch", name: "QA Collar Starch", type: "service", price: 50, taxRate: 0, effectiveTax: 0 };
const SUIT: Item = { key: "suit", name: "QA Suit Dry Clean", type: "service", price: 900, taxRate: 0, effectiveTax: 0 };
const PRESS: Item = { key: "press", name: "QA Express Press", type: "service", price: 100, taxRate: 0, effectiveTax: 0 };

const SANA = { name: "QA Sana Iqbal", phone: "03001240101", spoken: "0300 124 0101" } as const;
const BILAL = { name: "QA Bilal Ahmed", phone: "03001240102" } as const;
const ASKED = "8 shirts, light starch, no bleach";

const product = async (request: APIRequestContext, name: string): Promise<Row | undefined> =>
  (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`)).find((p) => p.name === name);
type Job = Row & { id: string; number: string; status: string; items: Row[]; payments?: Row[]; sale?: Row | null };
const jobs = async (request: APIRequestContext) => ask<Job[]>(request, "owner", "/sale-documents?kind=job_card&per_page=50");
const jobFor = async (request: APIRequestContext, phone: string) => (await jobs(request)).find((j) => j.customer_phone === phone);
const doc = async (request: APIRequestContext, id: string) => ask<Job>(request, "owner", `/sale-documents/${id}`);

/** A date `days` from today, as a date box takes it — on the calendar this machine is on. */
const dateIn = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);

  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
};

// ── the board ────────────────────────────────────────────────────────

const column = (page: Page, stage: string): Locator =>
  page.locator("div.rounded-2xl").filter({ has: page.getByRole("heading", { name: new RegExp(`^${stage}`) }) });
const card = (page: Page, number: string): Locator =>
  page.locator("div.rounded-xl").filter({ has: page.getByRole("link", { name: number, exact: true }) });
const cards = (page: Page): Locator => page.locator("div.rounded-xl").filter({ has: page.getByRole("link", { name: /^JOB-/ }) });
const takeIn = (page: Page): Locator => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Take work in" }) });

async function board(page: Page): Promise<void> {
  await page.goto("/tenant/workshop");
  await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible({ timeout: 20_000 });
  await settled(page);
}

async function openJob(page: Page, number: string): Promise<void> {
  await board(page);
  await card(page, number).getByRole("link", { name: number, exact: true }).click();
  await expect(page.getByTestId("job-details")).toBeVisible({ timeout: 20_000 });
}

const figure = async (page: Page, label: string): Promise<number> =>
  rupees(await page.getByText(label, { exact: true }).locator("xpath=following-sibling::*[1]").innerText());

/** Take work in through the sheet, as the counter does. */
async function takeWorkIn(page: Page, work: { who: { name: string; phone: string }; asked: string; item: Item; search: string; howMany: number; back: string }): Promise<void> {
  await board(page);
  await page.getByRole("button", { name: "Take work in" }).first().click();
  const form = takeIn(page);
  await form.getByLabel("What they want done", { exact: true }).fill(work.asked);
  await form.getByLabel("Customer", { exact: true }).fill(work.who.name);
  await form.getByLabel("Phone", { exact: true }).fill(work.who.phone);
  await form.getByLabel("Promised back", { exact: true }).fill(work.back);
  await form.getByPlaceholder("Search the work or an item").fill(work.search);
  await form.getByRole("button", { name: work.item.name, exact: true }).click();
  await form.getByLabel("How many", { exact: true }).fill(String(work.howMany));
  await form.getByRole("button", { name: "Take it in" }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
}

/** An advance, through the job's own page. */
async function takeAnAdvance(page: Page, amount: number, method: string): Promise<void> {
  await page.getByRole("button", { name: "Take an advance" }).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Take an advance" }) });
  await sheet.getByLabel("Amount", { exact: true }).fill(String(amount));
  await sheet.getByRole("button", { name: method, exact: true }).click();
  await sheet.getByRole("button", { name: "Record" }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });
}

test("O1 · the shelf: what a laundry sells is work — carded as services, with nothing to count", async ({ page, request }) => {
  for (const item of [WASH, STARCH, SUIT, PRESS]) {
    if (!(await product(request, item.name))) await addItem(page, item);
  }

  for (const item of [WASH, STARCH, SUIT, PRESS]) {
    const held = (await product(request, item.name))!;
    expect(held.type, `${item.name} was carded as something other than a service`).toBe("service");
    expect(Boolean(held.track_inventory), `${item.name} would be counted off a shelf it is not on`).toBe(false);
    expect(Number(held.price)).toBe(item.price);
  }
});

test("O2 · a walk-in at the counter: three shirts pressed while they wait, rung and paid", async ({ page, request }) => {
  if (!record().pressSale) {
    await openTill(page);
    await ring(page, PRESS.name);
    await quantity(page, PRESS.name, 3);
    expect(await tender(page, "Cash")).toBe(300);
    const sale = await complete(page, request);
    remember({ pressSale: String(sale.invoice_number) });
  }

  const sale = (await ask<Sale[]>(request, "owner", "/sales?per_page=50")).find((s) => s.invoice_number === record().pressSale)!;
  const full = await ask<Sale>(request, "owner", `/sales/${String(sale.id)}`);
  expect(Number(full.total)).toBe(300);
  expect(full.items.map((i) => [i.product_name, Number(i.quantity)])).toEqual([[PRESS.name, 3]]);
});

test("O3 · eight shirts are taken in: what they want done, whose they are, when they are back — and nothing about a car", async ({ page, request }) => {
  if (!(await jobFor(request, SANA.phone))) {
    await board(page);
    await page.getByRole("button", { name: "Take work in" }).first().click();
    const form = takeIn(page);

    // A laundry is not a workshop: no plate, no reading, nothing "wrong" with a shirt.
    await expect(form.getByText("Registration", { exact: true }), "a laundry was asked for a registration").toHaveCount(0);
    await expect(form.getByText("Odometer coming in", { exact: true })).toHaveCount(0);
    await expect(form, "a laundry was spoken to about parts and labour").not.toContainText(/labour|diagnostic|\bparts?\b/i);
    await expect(form.getByRole("button", { name: "Take it in" }), "work could be taken in with nothing on it").toBeDisabled();
    await form.getByRole("button", { name: "Cancel" }).click();

    await takeWorkIn(page, { who: SANA, asked: ASKED, item: WASH, search: "QA Shirt", howMany: 8, back: `${dateIn(1)}T18:00` });
  }

  const job = (await jobFor(request, SANA.phone))!;
  remember({ laundryJob: job.id, laundryJobNumber: job.number });
  expect(job.complaint).toBe(ASKED);
  expect(job.customer_name).toBe(SANA.name);
  if (job.status === "open" && (await doc(request, job.id)).items.length === 1) {
    // EIGHT shirts, typed — not one shirt and seven presses of "+".
    expect((await doc(request, job.id)).items.map((i) => [i.product_name, Number(i.quantity), Number(i.line_total)])).toEqual([[WASH.name, 8, 1200]]);
    expect(Number(job.total)).toBe(1200);
  }
  expect(new Date(String(job.promised_at)).getTime(), "the promised time moved between the sheet and the server").toBe(new Date(`${dateIn(1)}T18:00`).getTime());

  if (job.status === "open") {
    await board(page);
    const onBoard = card(page, job.number);
    if (job.work_status === "received") await expect(column(page, "Taken in").filter({ has: onBoard })).toBeVisible({ timeout: 15_000 });
    await expect(onBoard).toContainText(SANA.name);
    await expect(onBoard).toContainText(ASKED);
    await expect(onBoard, "the board does not show the hour that was promised").toContainText(/Due .* 06:00/);
  }
});

test("O4 · the customer is found by the number they give, and leaves an advance — on the job, and on what is still owed", async ({ page, request }) => {
  const id = String(record().laundryJob);
  const number = String(record().laundryJobNumber);
  if ((await doc(request, id)).status !== "open") return;

  // A second customer's work on the board, so finding one means something.
  if (!(await jobFor(request, BILAL.phone))) {
    await takeWorkIn(page, { who: BILAL, asked: "Suit, dry clean only", item: SUIT, search: "QA Suit", howMany: 1, back: `${dateIn(2)}T12:00` });
  }
  remember({ suitJob: (await jobFor(request, BILAL.phone))!.id });

  await board(page);
  const find = page.getByLabel("Find a job — slip number, name or phone", { exact: true });
  await expect(find, "a full board has no way to find one customer's work").toBeVisible();
  // Said the way people say it: in groups, with spaces.
  await find.fill(SANA.spoken);
  await expect(cards(page)).toHaveCount(1);
  await expect(card(page, number)).toBeVisible();
  await find.fill("QA Nobody Here");
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText("No job in the shop matches “QA Nobody Here”.")).toBeVisible();
  await find.fill(number);
  await card(page, number).getByRole("link", { name: number, exact: true }).click();

  // Its own page: a job card, back to Jobs, the customer's instructions — no car.
  const facts = page.getByTestId("job-details");
  await expect(facts).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Job card", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "← Jobs" })).toBeVisible();
  await expect(facts).toContainText("Instructions");
  await expect(facts).toContainText(ASKED);
  await expect(facts, "a laundry's job asks about a car").not.toContainText(/Vehicle|Odometer/);

  if (Number((await doc(request, id)).deposit_paid) === 0) {
    await expect(page.getByRole("button", { name: "Take an advance" }), "a job has no way to take an advance").toBeVisible();
    await takeAnAdvance(page, 500, "Cash");
  }

  expect(Number((await doc(request, id)).deposit_paid), "the advance did not reach the job").toBe(500);
  await expect(page.getByText("Advance paid", { exact: true }), "an advance taken on a job is nowhere on it").toBeVisible({ timeout: 15_000 });
  expect(await figure(page, "Advance paid")).toBe(500);
  await expect(page.getByText("Payments received")).toBeVisible();
});

test("O5 · the work grows: the collars are starched, and two more shirts come in the next morning", async ({ page, request }) => {
  const id = String(record().laundryJob);
  const number = String(record().laundryJobNumber);

  if ((await doc(request, id)).status === "open" && (await doc(request, id)).items.length === 1) {
    await openJob(page, number);

    const add = page.getByLabel("Add work or an item to this job", { exact: true });
    await expect(add, "a laundry's job has no box for more work — or calls it parts and labour").toBeVisible();
    await add.fill("QA Collar");
    await page.getByRole("button", { name: `+ ${STARCH.name}`, exact: true }).click();
    await expect.poll(() => figure(page, "Total")).toBe(1250);

    // Typed, not pressed out one at a time.
    const shirts = page.getByLabel(`How many ${WASH.name}`, { exact: true });
    await shirts.fill("10");
    await shirts.press("Enter");
    await expect.poll(() => figure(page, "Total"), { message: "two more shirts did not reach the job" }).toBe(1550);
    const collars = page.getByLabel(`How many ${STARCH.name}`, { exact: true });
    await collars.fill("10");
    await collars.press("Enter");
    await expect.poll(() => figure(page, "Total")).toBe(2000);
  }

  const job = await doc(request, id);
  if (job.status === "open") {
    expect(job.items.map((i) => [i.product_name, Number(i.quantity), Number(i.line_total)]).sort()).toEqual(
      [[STARCH.name, 10, 500], [WASH.name, 10, 1500]].sort(),
    );
    expect(Number(job.total)).toBe(2000);

    // What is still owed follows the work, not the day it came in.
    await openJob(page, number);
    expect(await figure(page, "Balance due"), "the balance did not follow the work").toBe(1500);
    await board(page);
    await expect(card(page, number)).toContainText("Rs 2,000");
  }
});

test("O6 · the slip the customer takes away says it is a job, what they asked for, and the money they left", async ({ page, request }) => {
  const id = String(record().laundryJob);
  if ((await doc(request, id)).status !== "open") return;

  await openJob(page, String(record().laundryJobNumber));
  const answered = page.waitForResponse((r) => r.url().includes(`/sale-documents/${id}/print`), { timeout: 20_000 });
  await page.getByRole("button", { name: "Print", exact: true }).click();
  const slip = await (await answered).text();

  // It printed as a QUOTATION before: a price "valid until", with the shop's
  // quotation terms and nothing the customer said.
  expect(slip, "the slip is not called a job card").toContain("Job Card");
  expect(slip).not.toContain("Quotation");
  expect(slip).not.toContain("Valid until");
  expect(slip).toContain("Instructions");
  expect(slip).toContain(ASKED);
  expect(slip).toContain(SANA.name);
  expect(slip, "a laundry's slip asks about a car").not.toMatch(/Vehicle|Odometer/);
  // The money they left, and that this is not the bill yet.
  expect(slip).toContain("Advance paid");
  expect(slip).toContain("Total so far");
  expect(slip).toContain("not the final bill");
});

test("O7 · it moves along the board, and back when a stain is found at the counter", async ({ page, request }) => {
  const id = String(record().laundryJob);
  const number = String(record().laundryJobNumber);
  if ((await doc(request, id)).status !== "open") return;

  await board(page);
  const move = async (to: string) => {
    await card(page, number).getByRole("button", { name: `→ ${to}` }).click();
    await expect(column(page, to).filter({ has: card(page, number) }), `the job did not move to ${to}`).toBeVisible({ timeout: 15_000 });
  };

  if ((await doc(request, id)).work_status === "received") await move("Being worked on");
  if ((await doc(request, id)).work_status === "in_progress") await move("Ready");
  await move("Being worked on");
  expect((await doc(request, id)).work_status).toBe("in_progress");
  await move("Ready");
  expect((await doc(request, id)).work_status).toBe("ready");
});

test("O8 · collected: billed for all of it, the advance taken off what is asked for — and the board is clear of it", async ({ page, request }) => {
  const id = String(record().laundryJob);
  const number = String(record().laundryJobNumber);

  if ((await doc(request, id)).status === "open") {
    await board(page);
    await card(page, number).getByRole("link", { name: "Bill it" }).click();
    await page.getByRole("button", { name: "Bill & hand over" }).click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Bill & hand over" }) });
    // Rs 2,000 of work, Rs 500 already in hand.
    await expect(sheet, "the advance was not taken off what the customer is asked for").toContainText("Take Rs 1,500");
    await expect(sheet.getByLabel("Odometer on handover", { exact: true }), "a laundry is asked for an odometer").toHaveCount(0);
    await sheet.getByLabel("Amount taken", { exact: true }).fill("1500");
    await sheet.getByRole("button", { name: "Bill it" }).click();
    await expect(sheet).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(/^Billed as INV-/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Add work or an item to this job")).toHaveCount(0);
  }

  const job = await doc(request, id);
  expect(job.status).toBe("converted");
  const sale = await ask<Sale & { payments?: Row[] }>(request, "owner", `/sales/${String((job.sale as Row).id)}`);
  expect(Number(sale.total), "the job was not billed for everything that went on it").toBe(2000);
  expect(sale.items.map((i) => [String(i.product_name), Number(i.quantity)]).sort()).toEqual([[STARCH.name, 10], [WASH.name, 10]].sort());
  expect(sale.customer_name).toBe(SANA.name);
  // The advance is a tender on the bill, not a discount off it.
  const paid = (sale.payments ?? []).map((p) => [String(p.method), Number(p.amount)]).sort();
  expect(paid, "the bill does not show the advance as paid").toEqual([["cash", 1500], ["deposit", 500]].sort());

  await board(page);
  await expect(card(page, number)).toHaveCount(0);
});

test("O9 · a customer who never comes back: the job is cancelled and the advance is split, as the counter says", async ({ page, request }) => {
  const id = String(record().suitJob);

  if ((await doc(request, id)).status === "open") {
    const number = String((await doc(request, id)).number);
    if (Number((await doc(request, id)).deposit_paid) === 0) {
      await openJob(page, number);
      await takeAnAdvance(page, 300, "Cash");
      await expect.poll(async () => Number((await doc(request, id)).deposit_paid)).toBe(300);
    }

    await openJob(page, number);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Cancel this job" }) });
    await expect(sheet, "cancelling a job is called cancelling a document").toBeVisible();
    // A job held nothing off a shelf, and a layaway's fee is not a laundry's.
    await expect(sheet, "a job's cancel sheet speaks of goods going back on a shelf").not.toContainText("shelf");
    const kept = sheet.getByLabel("Cancellation fee kept", { exact: true });
    await expect(kept, "a layaway's fee was put on a job").toHaveValue("");
    await kept.fill("100");
    await expect(sheet.getByText("Returned to customer").locator("xpath=following-sibling::*[1]")).toHaveText(/Rs 200/);
    await sheet.getByRole("button", { name: "Cancel job" }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
  }

  const job = await doc(request, id);
  expect(job.status).toBe("cancelled");
  expect(Number(job.refunded_amount), "what was handed back").toBe(200);
  expect(Number(job.forfeited_amount), "what the shop kept").toBe(100);

  // Nothing is left in the shop.
  await board(page);
  await expect(cards(page)).toHaveCount(0);
});
