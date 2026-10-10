import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { API, foodAuth } from "./api";
import { projectOnly } from "./rules";

/**
 * "BILL PLEASE" — on paper, before the table pays.
 *
 * A waiter could answer that only by settling the tab: the one paper with a
 * total on it was the invoice, and an invoice is printed after the money has
 * changed hands. So the figure was read out off a screen — a screen whose
 * total says "+ tax at the bill", because its tax is an estimate.
 *
 * This opens a real tab with two dishes at two different rates, prints its
 * bill from the tab screen, reads what was handed to the printer — and then
 * pays exactly the figure on the paper. The till must take it with no change
 * and nothing owing.
 */

const MM_PER_PT = 25.4 / 72;
const KARAHI = { name: "E2E Bill Karahi", price: 1890 };
// Its own rate, so the paper cannot be right by multiplying by the shop's.
const CHAI = { name: "E2E Bill Chai", price: 235, tax_rate: 18 };
const GUEST = "E2E Bill Please";

interface Handed { title: string; roll: string | null; html: string; text: string }

async function watchThePrinter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.print = () => {
      const top = window.top as unknown as { __handed?: unknown[] };
      top.__handed = top.__handed ?? [];
      top.__handed.push({
        title: document.title,
        roll: document.documentElement.getAttribute("data-roll-mm"),
        html: `<!doctype html>${document.documentElement.outerHTML}`,
        text: document.body.innerText,
      });
    };
  });
}

const handed = (page: Page) => page.evaluate(() => ((window as unknown as { __handed?: unknown[] }).__handed ?? []) as never) as Promise<Handed[]>;

async function paperOf(browser: Browser, html: string): Promise<{ widthMm: number; pages: number }> {
  const context = await browser.newContext();
  const sheet = await context.newPage();
  await sheet.setContent(html, { waitUntil: "load" });
  const pdf = (await sheet.pdf({ preferCSSPageSize: true })).toString("latin1");
  await context.close();
  const box = [...pdf.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)][0];

  return { widthMm: Math.round(Number(box[3]) * MM_PER_PT), pages: (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length };
}

async function dish(request: APIRequestContext, what: { name: string; price: number; tax_rate?: number }): Promise<string> {
  const auth = foodAuth();
  const found = await request.get(`${API}/products?search=${encodeURIComponent(what.name)}&per_page=10`, { headers: auth });
  const have = ((await found.json()) as { data: Array<{ id: string; name: string }> }).data.find((p) => p.name === what.name);
  if (have) return have.id;

  const made = await request.post(`${API}/products`, {
    headers: auth,
    data: { item_type: "food_item", description: "A fixture for the table's bill.", is_active: true, ...what },
  });
  expect(made.ok(), `could not make the fixture dish: ${made.status()} ${await made.text()}`).toBeTruthy();

  return ((await made.json()) as { data: { id: string } }).data.id;
}

const settings = async (request: APIRequestContext, patch?: Record<string, unknown>) => {
  const res = patch
    ? await request.put(`${API}/shop/settings`, { headers: foodAuth(), data: patch })
    : await request.get(`${API}/shop/settings`, { headers: foodAuth() });
  expect(res.ok(), `the restaurant's settings ${patch ? "did not save" : "could not be read"} (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Record<string, unknown> }).data;
};

let before: Record<string, unknown> = {};
let toClear: string | null = null;

test.beforeAll(async ({ request }) => {
  before = await settings(request);
  await settings(request, { receipt_width: "thermal_80" });
});

test.afterAll(async ({ request }) => {
  await settings(request, { receipt_width: before.receipt_width ?? "standard" });
});

test.afterEach(async ({ request }) => {
  if (toClear === null) return;
  await request.post(`${API}/restaurant/tickets/${toClear}/cancel`, { headers: foodAuth(), data: { reason: "e2e fixture" } }).catch(() => {});
  toClear = null;
});

/** A takeaway tab holding two karahi and three chai. No table is taken, so no table has to be free. */
async function aTab(request: APIRequestContext): Promise<string> {
  const karahi = await dish(request, KARAHI);
  const chai = await dish(request, CHAI);
  const opened = await request.post(`${API}/restaurant/tickets`, { headers: foodAuth(), data: { order_type: "takeaway", customer_name: GUEST } });
  expect(opened.ok(), `the tab could not be opened (${opened.status()} ${await opened.text()})`).toBeTruthy();
  const id = ((await opened.json()) as { data: { id: string } }).data.id;
  toClear = id;
  const added = await request.post(`${API}/restaurant/tickets/${id}/items`, {
    headers: foodAuth(),
    data: { items: [{ product_id: karahi, quantity: 2 }, { product_id: chai, quantity: 3 }] },
  });
  expect(added.ok(), `the dishes could not be put on the tab (${added.status()} ${await added.text()})`).toBeTruthy();

  return id;
}

test("the bill is printed once, on the roll, says it is not a receipt — and paying exactly what it says settles the table", async ({ page, request, browser, browserName }, info) => {
  test.skip(info.project.name !== "restaurant", projectOnly("one walk of the paper is enough; the row of buttons is measured on every device below"));
  test.skip(browserName !== "chromium", "page.pdf is Chromium's");

  const id = await aTab(request);
  await watchThePrinter(page);
  await page.goto(`/tenant/dine-in/tickets/${id}`);

  const bill = page.getByTestId("print-bill");
  await expect(bill).toBeEnabled({ timeout: 20_000 });
  await expect(bill).toHaveAccessibleName("Print bill");
  await bill.click();

  // ── one paper, and it is the bill ─────────────────────────────────
  await expect.poll(async () => (await handed(page)).length, { message: "nothing was handed to the printer", timeout: 15_000 }).toBe(1);
  // Give a second print the chance to arrive, if there is one. The print
  // door holds each job for a second and a half when the browser gives it no
  // sign the last one ended — so a second paper, if there is one, is at
  // least that far behind the first. Waiting 1.2s here missed it.
  await page.waitForTimeout(4000);
  const papers = await handed(page);
  expect(papers.length, "the bill was printed more than once").toBe(1);
  const paper = papers[0];
  expect(paper.title).toMatch(/^Bill — /);
  expect(paper.roll, "the bill is not laid out for the roll the shop prints on").toBe("80");

  // What it says.
  expect(paper.text).toContain("BILL");
  expect(paper.text.match(/NOT A RECEIPT/g)?.length, "it does not say, top and bottom, that it is not a receipt").toBe(2);
  expect(paper.text).toContain(`2 × ${KARAHI.name}`);
  expect(paper.text).toContain(`3 × ${CHAI.name}`);
  expect(paper.text).toContain("Subtotal");
  expect(paper.text).toContain("Tax");
  // Nothing that says money has changed hands.
  for (const not of ["Invoice", "Cash", "Change", "Cashier"]) expect(paper.text, `the bill reads like a receipt: ${not}`).not.toContain(not);

  // One slip, the width of the roll — not a sheet with a column down it.
  const sheet = await paperOf(browser, paper.html);
  expect(sheet.pages, "the bill is cut across more than one slip").toBe(1);
  expect(sheet.widthMm).toBe(80);

  // ── and the figure on it is what the till takes ───────────────────
  const toPay = Number(/TO PAY\s+\D*([\d,]+\.\d{2})/.exec(paper.text)?.[1].replace(/,/g, ""));
  expect(toPay, "the bill has no TO PAY figure").toBeGreaterThan(0);
  // Chai is taxed at its own 18%: the paper cannot have got here by
  // multiplying the subtotal by one rate.
  const subtotal = 2 * KARAHI.price + 3 * CHAI.price;
  const chaiTax = Math.round(3 * CHAI.price * 18) / 100;
  expect(toPay, "the chai's own tax is not on the bill").toBeGreaterThanOrEqual(Math.round((subtotal + chaiTax) * 100) / 100);

  const settled = await request.post(`${API}/restaurant/tickets/${id}/settle`, {
    headers: foodAuth(),
    data: { payment_method: "cash", amount_paid: toPay },
  });
  expect(settled.ok(), `the till would not take the figure on the bill (${settled.status()} ${await settled.text()})`).toBeTruthy();
  const sale = ((await settled.json()) as { data: { sale: { total: string; change_due: string; payment_status?: string }; ticket: { status: string } } }).data;
  expect(Number(sale.sale.total), "the till asked for a different figure from the one on the bill").toBe(toPay);
  expect(Number(sale.sale.change_due), "paying the bill exactly left change").toBe(0);
  expect(sale.ticket.status).toBe("closed");
  toClear = null;

  // ── a settled table has no bill to print ──────────────────────────
  await page.reload();
  await expect(page.getByTestId("print-bill")).toHaveCount(0, { timeout: 15_000 }).catch(async () => {
    await expect(page.getByTestId("print-bill")).toBeDisabled();
  });
});

test("the bill sits between sending and settling, and all three fit", async ({ page, request }) => {
  const id = await aTab(request);
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto(`/tenant/dine-in/tickets/${id}`);

  // The tab has to be on the screen before it can be asked what it shows:
  // asked straight after the address changed, a phone's Order tab was "not
  // visible" and the test went looking for a footer that was one tap away.
  await expect(page.getByRole("heading", { name: GUEST, level: 1 })).toBeVisible({ timeout: 20_000 });
  // On a phone the order is behind a tab.
  const order = page.getByRole("tab", { name: /^Order/ });
  if (await order.isVisible().catch(() => false)) await order.click();

  const send = page.getByRole("button", { name: /^Send to kitchen/ });
  const bill = page.getByTestId("print-bill");
  const settle = page.getByRole("button", { name: "Settle", exact: true });
  await expect(bill).toBeVisible({ timeout: 20_000 });
  for (const button of [send, bill, settle]) await expect(button).toBeInViewport();

  const [a, b, c] = [(await send.boundingBox())!, (await bill.boundingBox())!, (await settle.boundingBox())!];
  // One row, in that order, none on top of another.
  expect(Math.abs(a.y - b.y) + Math.abs(b.y - c.y), "the three are not one row").toBeLessThan(3);
  expect(a.x + a.width, "Send overlaps the bill").toBeLessThanOrEqual(b.x + 0.5);
  expect(b.x + b.width, "the bill overlaps Settle").toBeLessThanOrEqual(c.x + 0.5);
  // A thumb can hit it.
  expect(b.width).toBeGreaterThanOrEqual(44);
  expect(b.height).toBeGreaterThanOrEqual(44);
  // And the row did not push the page sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
