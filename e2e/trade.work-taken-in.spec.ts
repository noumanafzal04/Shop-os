import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { API, tradeAuth } from "./api";

/**
 * WORK TAKEN IN — a laundry's counter, lived every run.
 *
 * Found by the services journey (stage O), which lives its day once. What it
 * found, and what this holds in place:
 *
 *   a job could not take an advance from its own page — the button was a
 *     layaway's — and an advance taken any other way was drawn nowhere on it
 *   the slip printed as a QUOTATION: "valid until", the shop's quotation
 *     terms, nothing the customer asked for
 *   the board asked a laundry about parts, labour and what is "wrong"
 *   eight shirts could only be taken in as one, then pressed up with "+"
 *   a full board had no way to find one customer's work
 *   cancelling a job spoke of goods going back on a shelf and offered a
 *     layaway's fee
 *
 * A services shop's spec. In every other trade's project it stands aside.
 */

/** Fixed names, never stamped: a fixture named for the moment it ran is one more row for ever. */
const WASH = { name: "E2E Laundry Wash", price: 150 };
const STARCH = { name: "E2E Laundry Starch", price: 50 };
const WHO = { name: "E2E Laundry Customer", phone: "03007780001", spoken: "0300 778 0001" } as const;
const ASKED = "4 shirts, no bleach";

type Row = Record<string, unknown>;
type Job = Row & { id: string; number: string; status: string; customer_phone: string | null; deposit_paid: string; sale?: Row | null };
const headers = () => tradeAuth("services");

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

/** Two services, carded once. Nothing is stocked, so nothing runs down. */
async function shelf(request: APIRequestContext): Promise<void> {
  const held = await get<Row[]>(request, `/products?search=${encodeURIComponent("E2E Laundry")}&per_page=20`);
  for (const item of [WASH, STARCH]) {
    if (held.some((p) => p.name === item.name)) continue;
    await post(request, "/products", {
      item_type: "service", name: item.name, price: item.price, is_active: true, description: "A fixture for work taken in.", tax_rate: 0,
    });
  }
}

const theirJobs = async (request: APIRequestContext): Promise<Job[]> =>
  (await get<Job[]>(request, "/sale-documents?kind=job_card&status=open&per_page=100")).filter((j) => j.customer_phone === WHO.phone);

/** Whatever an earlier run left on the board for this customer, cancelled — every rupee handed back. */
async function counterClear(request: APIRequestContext): Promise<void> {
  for (const job of await theirJobs(request)) await post(request, `/sale-documents/${job.id}/cancel`, { reason: "e2e: left by an earlier run" });
}

const card = (page: Page, number: string): Locator =>
  page.locator("div.rounded-xl").filter({ has: page.getByRole("link", { name: number, exact: true }) });
const figure = async (page: Page, label: string): Promise<number> =>
  Number((await page.getByText(label, { exact: true }).locator("xpath=following-sibling::*[1]").innerText()).replace(/[^0-9.]/g, ""));
const tomorrowAt = (time: string): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);

  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}T${time}`;
};

/** Take the work in through the sheet; answer the job as the server holds it. */
async function takeIn(page: Page, request: APIRequestContext, howMany: number): Promise<Job> {
  await page.goto("/tenant/workshop");
  await page.getByRole("button", { name: "Take work in" }).first().click();
  const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Take work in" }) });

  await expect(form.getByText("Registration", { exact: true }), "a laundry was asked for a registration").toHaveCount(0);
  await expect(form, "a laundry was spoken to about parts and labour").not.toContainText(/labour|diagnostic|\bparts?\b/i);

  await form.getByLabel("What they want done", { exact: true }).fill(ASKED);
  await form.getByLabel("Customer", { exact: true }).fill(WHO.name);
  await form.getByLabel("Phone", { exact: true }).fill(WHO.phone);
  await form.getByLabel("Promised back", { exact: true }).fill(tomorrowAt("18:00"));
  await form.getByPlaceholder("Search the work or an item").fill(WASH.name);
  await form.getByRole("button", { name: WASH.name, exact: true }).click();
  await form.getByLabel("How many", { exact: true }).fill(String(howMany));
  await form.getByRole("button", { name: "Take it in" }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });

  // The counter was cleared first, so this customer has exactly one job open: this one.
  const open = await theirJobs(request);
  expect(open, "the work was taken in and is not in the shop").toHaveLength(1);
  const [job] = open;

  return job;
}

/** Find it on the board the way the customer says it, and open it. */
async function findAndOpen(page: Page, number: string): Promise<void> {
  await page.goto("/tenant/workshop");
  const find = page.getByLabel("Find a job — slip number, name or phone", { exact: true });
  await expect(find, "a full board has no way to find one customer's work").toBeVisible({ timeout: 15_000 });
  await find.fill(WHO.spoken);
  await expect(card(page, number), "the customer's phone, said with spaces, did not find their work").toBeVisible({ timeout: 15_000 });
  // Found means the rest of the board stood aside — not that this card was somewhere on it.
  await expect(page.locator("div.rounded-xl").filter({ has: page.getByRole("link", { name: /^JOB-/ }) })).toHaveCount(1);
  await card(page, number).getByRole("link", { name: number, exact: true }).click();
  await expect(page.getByTestId("job-details")).toBeVisible({ timeout: 15_000 });
}

async function takeAnAdvance(page: Page, amount: number): Promise<void> {
  await expect(page.getByRole("button", { name: "Take an advance" }), "a job has no way to take an advance").toBeVisible();
  await page.getByRole("button", { name: "Take an advance" }).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Take an advance" }) });
  await sheet.getByLabel("Amount", { exact: true }).fill(String(amount));
  await sheet.getByRole("button", { name: "Card", exact: true }).click();
  await sheet.getByRole("button", { name: "Record" }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });
}

test("work is taken in by the piece, money is left with it, it grows, prints as a job and is billed with the advance off", async ({ page, request }, info) => {
  test.skip(info.project.name !== "trade-services", "a services counter — the other trades take no work in like this");
  await shelf(request);
  await counterClear(request);

  // ── taken in: four shirts, typed ───────────────────────────────────
  const job = await takeIn(page, request, 4);
  const opened = await get<Job & { items: Row[] }>(request, `/sale-documents/${job.id}`);
  expect(opened.items.map((i) => [i.product_name, Number(i.quantity)]), "the pieces taken in were not the number typed").toEqual([[WASH.name, 4]]);
  expect(Number(opened.total)).toBe(600);

  // ── found, opened, money left ──────────────────────────────────────
  await findAndOpen(page, job.number);
  await expect(page.getByRole("link", { name: "← Jobs" })).toBeVisible();
  await expect(page.getByTestId("job-details")).toContainText("Instructions");
  await expect(page.getByTestId("job-details")).toContainText(ASKED);
  await takeAnAdvance(page, 200);
  await expect(page.getByText("Advance paid", { exact: true }), "an advance taken on a job is nowhere on it").toBeVisible({ timeout: 15_000 });
  expect(await figure(page, "Advance paid")).toBe(200);
  expect(await figure(page, "Balance due")).toBe(400);

  // ── it grows ───────────────────────────────────────────────────────
  const add = page.getByLabel("Add work or an item to this job", { exact: true });
  await expect(add, "a laundry's job has no box for more work — or calls it parts and labour").toBeVisible();
  await add.fill(STARCH.name);
  await page.getByRole("button", { name: `+ ${STARCH.name}`, exact: true }).click();
  await expect.poll(() => figure(page, "Total")).toBe(650);
  const shirts = page.getByLabel(`How many ${WASH.name}`, { exact: true });
  await shirts.fill("6");
  await shirts.press("Enter");
  await expect.poll(() => figure(page, "Total"), { message: "a typed quantity did not reach the job" }).toBe(950);
  expect(await figure(page, "Balance due")).toBe(750);

  // ── the slip ───────────────────────────────────────────────────────
  const answered = page.waitForResponse((r) => r.url().includes(`/sale-documents/${job.id}/print`), { timeout: 20_000 });
  await page.getByRole("button", { name: "Print", exact: true }).click();
  const slip = await (await answered).text();
  expect(slip, "the slip is not called a job card").toContain("Job Card");
  expect(slip).not.toContain("Valid until");
  expect(slip).toContain("Instructions");
  expect(slip).toContain(ASKED);
  expect(slip).toContain("Advance paid");
  expect(slip).toContain("Total so far");

  // ── billed, the advance off what is asked for ─────────────────────
  await page.getByRole("button", { name: "Bill & hand over" }).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Bill & hand over" }) });
  await expect(sheet, "the advance was not taken off what the customer is asked for").toContainText("Take Rs 750");
  await expect(sheet.getByLabel("Odometer on handover", { exact: true })).toHaveCount(0);
  await sheet.getByLabel("Amount taken", { exact: true }).fill("750");
  await sheet.getByRole("button", { name: "Bill it" }).click();
  await expect(sheet).toBeHidden({ timeout: 20_000 });

  const billed = await get<Job>(request, `/sale-documents/${job.id}`);
  expect(billed.status).toBe("converted");
  const sale = await get<Row & { payments?: Row[] }>(request, `/sales/${String((billed.sale as Row).id)}`);
  expect(Number(sale.total)).toBe(950);
  expect((sale.payments ?? []).map((p) => [String(p.method), Number(p.amount)]).sort()).toEqual([["cash", 750], ["deposit", 200]].sort());
});

test("a job nobody comes back for is cancelled as a job — nothing goes back on a shelf, and no layaway fee is assumed", async ({ page, request }, info) => {
  test.skip(info.project.name !== "trade-services", "a services counter — the other trades take no work in like this");
  await shelf(request);
  await counterClear(request);
  // The shop keeps 10% when goods HELD on advance are given up. A laundry's job
  // held nothing, so that figure must not be put in front of the counter here.
  const fee = await request.put(`${API}/shop/settings`, { headers: headers(), data: { layaway_cancellation_fee_percent: 10 } });
  expect(fee.ok(), `the layaway fee was not set (${fee.status()})`).toBeTruthy();

  const job = await takeIn(page, request, 2);
  await findAndOpen(page, job.number);
  await takeAnAdvance(page, 100);
  await expect.poll(async () => Number((await get<Job>(request, `/sale-documents/${job.id}`)).deposit_paid)).toBe(100);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Cancel this job" }) });
  await expect(sheet, "cancelling a job is called cancelling a document").toBeVisible();
  await expect(sheet, "a job's cancel sheet speaks of goods going back on a shelf").not.toContainText("shelf");
  await expect(sheet.getByLabel("Cancellation fee kept", { exact: true }), "a layaway's fee was put on a job").toHaveValue("");
  await sheet.getByRole("button", { name: "Cancel job" }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });

  const cancelled = await get<Job>(request, `/sale-documents/${job.id}`);
  expect(cancelled.status).toBe("cancelled");
  // Nothing was chosen to be kept, so every rupee went back.
  expect(Number(cancelled.refunded_amount)).toBe(100);
  expect(Number(cancelled.forfeited_amount)).toBe(0);
});
