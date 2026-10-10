import { expect, test, type Browser, type Page } from "@playwright/test";
import { API, foodAuth } from "./api";
import { PLAIN_ITEM, openTill } from "./till";

/**
 * WHICH PAPER IS WHICH, at a restaurant's counter.
 *
 * ── The report ───────────────────────────────────────────────────────
 *
 *     "POS invoice kitchen ki receipt ki tarah nikal rahi — why? Jo setting
 *      main save krty wo ni arhi."
 *
 * with a picture of the print window: KITCHEN in a box, KOT #1, three dishes,
 * no prices — cut across two pages, the last "+ Mild" alone on the second.
 *
 * Nothing in that picture was the invoice. A counter sale in a restaurant
 * fires a kitchen ticket, and a kitchen that works off paper has it printed
 * the moment the sale is paid; the customer's receipt is printed when asked
 * for. So the first window to open after "Complete sale" is the kitchen's
 * slip, and nothing said so. Three faults under one sentence:
 *
 *   it was not said     the sale sheet never told the cashier which paper
 *                       had just been sent, or where the invoice was
 *   it was cut in two   the page was measured wider than it printed, so a
 *                       dish name that fitted one line took two on paper
 *   it printed itself   the ticket carried its own `onload="print()"` and
 *                       so came up twice
 *
 * This rings a real counter sale and reads every document handed to the
 * printer, in the order it was handed over.
 */

const MM_PER_PT = 25.4 / 72;

interface Handed { title: string; roll: string | null; html: string; text: string }

/** Every `print()` in every frame, kept in order. */
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

/** Print that exact document with the engine's own idea of its page. */
async function paperOf(browser: Browser, html: string): Promise<{ widthMm: number; heightMm: number; pages: number }> {
  const context = await browser.newContext();
  const sheet = await context.newPage();
  await sheet.setContent(html, { waitUntil: "load" });
  const pdf = (await sheet.pdf({ preferCSSPageSize: true })).toString("latin1");
  await context.close();
  const box = [...pdf.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)][0];

  return {
    widthMm: Math.round(Number(box[3]) * MM_PER_PT),
    heightMm: Math.round(Number(box[4]) * MM_PER_PT),
    pages: (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length,
  };
}

/**
 * Ring one dish, answering its options sheet if it has one.
 *
 * A dish with a crust to choose or a spice level does not go straight into
 * the cart — it asks first, and the sheet it asks in covers the till. The
 * first version of this spec pressed three tiles in a row and spent five
 * minutes pressing the second one through an open sheet.
 */
async function ringDish(page: Page, nth: number): Promise<void> {
  const rows = page.locator("[data-cart-row]");
  const before = await rows.count();
  await page.locator(PLAIN_ITEM).nth(nth).click();

  const add = page.getByRole("dialog").getByRole("button", { name: /^Add( to (cart|tab))?( ·|$)/ });
  // The line is COUNTED, not seen: on a phone the cart is behind its own tab,
  // and a dish that asks nothing lands there without ever being on screen.
  await expect
    .poll(async () => (await rows.count()) > before || (await add.isVisible().catch(() => false)), { timeout: 10_000, message: "the dish neither reached the cart nor asked its options" })
    .toBe(true);
  // Required choices come pre-picked; the sheet's own button says what it costs.
  if (await add.isVisible().catch(() => false)) await add.click();

  await expect(rows, "the dish did not reach the cart").toHaveCount(before + 1, { timeout: 10_000 });
}

const settings = async (request: import("@playwright/test").APIRequestContext, patch?: Record<string, unknown>) => {
  const res = patch
    ? await request.put(`${API}/shop/settings`, { headers: foodAuth(), data: patch })
    : await request.get(`${API}/shop/settings`, { headers: foodAuth() });
  expect(res.ok(), `the restaurant's settings ${patch ? "did not save" : "could not be read"} (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Record<string, unknown> }).data;
};

let before: Record<string, unknown> = {};

test.beforeAll(async ({ request }) => {
  before = await settings(request);
  // A kitchen that works off paper, and a counter that prints the receipt
  // when asked — the defaults, and the shop the report came from.
  await settings(request, { kot_auto_print: true, pos_auto_print: false, receipt_width: "thermal_80" });
});

test.afterAll(async ({ request }) => {
  await settings(request, {
    kot_auto_print: before.kot_auto_print ?? true,
    pos_auto_print: before.pos_auto_print ?? false,
    receipt_width: before.receipt_width ?? "standard",
  });
});

test("the kitchen's slip is one slip, says whose it is, and the invoice is a button away", async ({ page, browser, browserName }) => {
  test.skip(browserName !== "chromium", "page.pdf is Chromium's");
  await watchThePrinter(page);
  await openTill(page);

  // Three dishes, as in the picture.
  const dishes = page.locator(PLAIN_ITEM);
  await expect(dishes.first(), "the restaurant's till shows nothing to ring").toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 3; i++) await ringDish(page, i);

  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  await page.getByRole("group", { name: "Payment method" }).getByRole("button", { name: /^Cash/ }).click();
  await page.getByRole("button", { name: /^Exact ·/ }).click();
  await page.getByRole("button", { name: /^Complete/ }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible({ timeout: 20_000 });
  const invoice = String(await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice"));

  // ── THE SHEET SAYS WHICH PAPER WENT OUT ──────────────────────────────
  const note = page.getByTestId("kitchen-slip-note");
  await expect(note, "a kitchen slip was sent and the cashier was not told what it was").toBeVisible({ timeout: 15_000 });
  await expect(note).toContainText(/Kitchen slip #\d+ sent to the printer/);
  await expect(note).toContainText("for the kitchen");
  await expect(note).toContainText("Print receipt");

  // ── ONE slip, handed over ONCE ───────────────────────────────────────
  await expect.poll(async () => (await handed(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2500); // a second, unwanted print would arrive in this window
  const first = await handed(page);
  const slips = first.filter((d) => /^KOT #/.test(d.title));
  expect(slips.length, `the kitchen ticket was sent to the printer ${slips.length} times for one sale`).toBeGreaterThan(0);
  expect(first.length, "something other than the kitchen's slip was printed without being asked for").toBe(slips.length);
  // One per station is right; the same ticket twice is not.
  expect(new Set(slips.map((d) => d.title)).size, "the same kitchen ticket was printed twice").toBe(slips.length);

  for (const slip of slips) {
    // It says it is the kitchen's, and carries no money.
    expect(slip.text).toContain("KITCHEN COPY — NOT A RECEIPT");
    expect(slip.text).not.toMatch(/Rs\s?\d|Total|Subtotal/);
    expect(slip.roll).toBe("80");

    const paper = await paperOf(browser, slip.html);
    expect(paper.widthMm).toBe(80);
    // THE PICTURE: the last modifier alone on a second page.
    expect(paper.pages, "the kitchen ticket was cut across two slips").toBe(1);
  }

  // ── AND THE CUSTOMER'S INVOICE, when it is asked for ─────────────────
  await page.getByRole("button", { name: /^Print receipt$/ }).click();
  await expect.poll(async () => (await handed(page)).length, { timeout: 15_000 }).toBe(first.length + 1);
  const receipt = (await handed(page)).at(-1)!;

  expect(receipt.title).toContain(invoice);
  // An invoice: the shop's name, what it is, what it comes to.
  expect(receipt.text).toMatch(/SALES (TAX )?INVOICE/i);
  expect(receipt.text).toContain(invoice);
  expect(receipt.text).toMatch(/Total\s+Rs\s?[\d,]+/);
  expect(receipt.text).not.toContain("KITCHEN COPY");

  const paper = await paperOf(browser, receipt.html);
  expect(paper.widthMm).toBe(80);
  expect(paper.pages).toBe(1);

  // Its own edge, whatever the print window's Margins menu says: the page
  // has none to give, and the document keeps five millimetres for itself.
  const check = await browser.newContext();
  const printed = await check.newPage();
  await printed.setContent(receipt.html, { waitUntil: "load" });
  await printed.emulateMedia({ media: "print" });
  await printed.setViewportSize({ width: Math.round((80 * 96) / 25.4), height: 800 });
  const edge = await printed.evaluate(() => {
    const box = document.querySelector(".doc")!.getBoundingClientRect();

    return { left: (box.left * 25.4) / 96, right: ((window.innerWidth - box.right) * 25.4) / 96, top: (box.top * 25.4) / 96 };
  });
  await check.close();
  expect(receipt.html).toMatch(/@page \{ size: 80mm \d+mm; margin: 0mm; \}/);
  for (const [side, mm] of Object.entries(edge)) {
    expect(mm, `the invoice runs to the ${side} edge of the paper`).toBeGreaterThanOrEqual(4.5);
  }
});

test("with auto-print on, the customer's receipt goes first and the kitchen's slip after it", async ({ page, request }) => {
  await settings(request, { pos_auto_print: true });
  await watchThePrinter(page);
  await openTill(page);

  await ringDish(page, 0);
  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  await page.getByRole("group", { name: "Payment method" }).getByRole("button", { name: /^Cash/ }).click();
  await page.getByRole("button", { name: /^Exact ·/ }).click();
  await page.getByRole("button", { name: /^Complete/ }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible({ timeout: 20_000 });

  // BOTH arrive — started side by side, a browser showed one window and
  // dropped the other — and the person waiting at the counter is served first.
  await expect.poll(async () => (await handed(page)).length, { timeout: 20_000, message: "one of the two papers was never sent to the printer" }).toBeGreaterThanOrEqual(2);
  const order = (await handed(page)).map((d) => (/^KOT #/.test(d.title) ? "kitchen" : "receipt"));
  expect(order[0], "the kitchen's slip came out before the customer's receipt").toBe("receipt");
  expect(order).toContain("kitchen");

  await settings(request, { pos_auto_print: false });
});
