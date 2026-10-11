import fs from "node:fs";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { API } from "../api";
import { OWNER_STATE, TRADE, ask, expect, session, settled, test } from "./kit";
import { editor } from "./shop";
import { complete, discount, grandTotal, line, openTill, tender, tenderSheet } from "./till";

/**
 * STAGE T — A CLOTHING SHOP'S DAY.
 *
 * A boutique is a "Retail Store" like the phone shop of stage L, and it lives
 * a different day. Nothing on its rail has a serial number; everything has a
 * SIZE. One design is six things — two colours, three sizes — each with its
 * own tag, its own count, and sometimes its own price. What that asks:
 *
 *   a design is carded ONCE, as a grid, and every size has its own barcode
 *
 *   the till asks WHICH, says how many of each are left, and will not sell
 *   the one that never came
 *
 *   the tag is scanned and THAT size is on the bill — nobody is asked
 *
 *   the bill, the receipt and the shelf all say the size
 *
 *   it did not fit: the Medium comes back and the Large goes out, and the
 *   customer pays the difference — the commonest thing a clothing shop does
 *   after a sale
 *
 * Every figure below is worked out by hand in the comment beside it.
 *
 * Run with `JOURNEY_TRADE=retail`, after stages 01 and 02 for that trade.
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "retail", "a clothing shop's stage — run with JOURNEY_TRADE=retail");
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Row = Record<string, unknown>;
type Size = { id: string; name: string; price: string | number; stock_quantity: number | string };
type Held = Row & { id: string; variants: Size[]; barcodes?: Array<{ barcode: string; variant_id: string | null }> };

/** A barcode a scanner would accept: twelve digits and the check digit they make. */
const ean13 = (twelve: string): string => {
  const sum = [...twelve].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);

  return twelve + String((10 - (sum % 10)) % 10);
};

const TAX = 5;
const KURTA = { name: "QA Lawn Kurta", cost: 1400 } as const;
/** The rail as it was delivered. The white Mediums never came. */
const RAIL = [
  { size: "Blue / S", price: 2500, stock: 4 },
  { size: "Blue / M", price: 2500, stock: 5 },
  { size: "Blue / L", price: 2700, stock: 3 },
  { size: "White / S", price: 2500, stock: 2 },
  { size: "White / M", price: 2500, stock: 0 },
  { size: "White / L", price: 2700, stock: 6 },
].map((r, i) => ({ ...r, code: ean13(`896400010${String(i + 1).padStart(3, "0")}`) }));
const tag = (size: string) => RAIL.find((r) => r.size === size)!;

const token = (): string => {
  const state = JSON.parse(fs.readFileSync(OWNER_STATE, "utf8")) as { origins: Array<{ localStorage: Array<{ name: string; value: string }> }> };
  const auth = state.origins.flatMap((o) => o.localStorage).find((i) => i.name === "shopos-auth")!;

  return (JSON.parse(auth.value) as { state: { accessToken: string } }).state.accessToken;
};

const kurta = async (request: APIRequestContext): Promise<Held | undefined> => {
  const found = (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(KURTA.name)}`)).find((p) => p.name === KURTA.name);

  return found ? ask<Held>(request, "owner", `/products/${String(found.id)}`) : undefined;
};

/** What is on the rail, size by size. */
const rail = async (request: APIRequestContext): Promise<Record<string, number>> =>
  Object.fromEntries((await kurta(request))!.variants.map((v) => [v.name, Number(v.stock_quantity)]));

/** What a printer would be handed for a sale. */
const paper = async (request: APIRequestContext, saleId: unknown, kind: "invoice" = "invoice"): Promise<string> => {
  const res = await request.get(`${API}/sales/${String(saleId)}/${kind}`, { headers: { Accept: "text/html", Authorization: `Bearer ${token()}` } });
  expect(res.ok(), `the ${kind} could not be read (${res.status()})`).toBeTruthy();

  return (await res.text()).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
};

const search = (page: Page): Locator => page.getByPlaceholder(/scan barcode or search/i).first();
const cart = (page: Page): Locator => page.locator("[data-cart-row]");

/** Tap the design on the till: it asks which size. */
async function whichSize(page: Page): Promise<Locator> {
  await search(page).fill(KURTA.name);
  const tile = page.locator("[data-pos-item]").filter({ hasText: KURTA.name }).first();
  await expect(tile, "the design is not on the till").toBeVisible({ timeout: 15_000 });
  await tile.click();
  const sheet = page.getByRole("dialog", { name: KURTA.name });
  await expect(sheet, "tapping a design with sizes did not ask which one").toBeVisible({ timeout: 10_000 });

  return sheet;
}

async function pick(page: Page, size: string): Promise<void> {
  const before = await cart(page).count();
  const sheet = await whichSize(page);
  await sheet.locator(`[data-pos-size="${size}"]`).click();
  await expect(cart(page).filter({ hasText: size }).first(), `${size} was chosen and is not on the bill`).toBeVisible({ timeout: 10_000 });
  expect(await cart(page).count()).toBeGreaterThanOrEqual(before);
  await search(page).fill("");
}

/** The tag is put under the scanner. */
async function scan(page: Page, code: string): Promise<void> {
  await search(page).fill(code);
  await search(page).press("Enter");
}

const saleSheet = async (page: Page, invoice: string): Promise<Locator> => {
  await page.goto("/tenant/sales");
  await page.getByRole("row").filter({ hasText: invoice }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: invoice }) });
  await expect(sheet).toBeVisible({ timeout: 15_000 });

  return sheet;
};

test("T1 · one design is carded as a grid: two colours, three sizes, a tag and a count for each", async ({ page, request }) => {
  if (!(await kurta(request))) {
    await page.goto("/tenant/products/new");
    const form = editor(page);
    await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });

    const field = (label: string) => form.getByLabel(label, { exact: true });
    await field("Name *").fill(KURTA.name);
    await field("Price *").fill("2500");
    await field("Cost (optional)").fill(String(KURTA.cost));
    await field("Tax rate % (optional)").fill(String(TAX));
    const description = field("Description *");
    if (await description.isVisible().catch(() => false)) await description.fill("Printed lawn kurta, stitched.");

    await form.getByRole("button", { name: /Sizes & options/i }).click();
    await form.getByRole("button", { name: /Add sizes or colours/i }).click();
    await form.getByLabel("What varies").first().fill("Colour");
    await form.getByLabel(/Add a Colour/i).fill("Blue, White");
    await page.keyboard.press("Enter");
    await form.getByRole("button", { name: /Add another option/i }).click();
    await form.getByLabel("What varies").nth(1).fill("Size");
    await form.getByLabel(/Add a Size/i).fill("S, M, L");
    await page.keyboard.press("Enter");

    // Six rows, a colour's sizes together — the way a rail hangs.
    const grid = form.locator("[data-variant-grid]");
    await expect(grid).toBeVisible();
    await expect(grid.locator("tbody tr")).toHaveCount(6);
    expect((await grid.locator("tbody tr td:first-child").allInnerTexts()).map((t) => t.trim())).toEqual(RAIL.map((r) => r.size));

    await form.getByLabel("Same price for all").fill("2500");
    await form.getByRole("button", { name: /Apply to all/i }).click();
    for (const r of RAIL) {
      // The Larges take more cloth.
      if (r.price !== 2500) await form.getByLabel(`Price for ${r.size}`).fill(String(r.price));
      await form.getByLabel(`Barcode for ${r.size}`).fill(r.code);
      await form.getByLabel(`Opening stock for ${r.size}`).fill(String(r.stock));
    }

    const create = form.getByRole("button", { name: "Create item" });
    await expect(create).toBeEnabled();
    await create.click();
    await expect(form).toBeHidden({ timeout: 20_000 });
    await settled(page);
  }

  const held = (await kurta(request))!;
  expect(held, "the design was not carded").toBeTruthy();
  // IN THE ORDER IT WAS CARDED: S, M, L — a rail, not a dictionary. It came
  // back L, M, S, on this screen and on every other that lists sizes.
  expect(held.variants.map((v) => [v.name, Number(v.price), Number(v.stock_quantity)])).toEqual(RAIL.map((r) => [r.size, r.price, r.stock]));
  // Each size answers to its own tag.
  const codes = Object.fromEntries((held.barcodes ?? []).map((b) => [held.variants.find((v) => v.id === b.variant_id)?.name ?? "the design itself", b.barcode]));
  for (const r of RAIL) expect(codes[r.size], `${r.size} has no barcode of its own`).toBe(r.code);

  // The list shows one design, and what is on the rail in all: 4 + 5 + 3 + 2 + 0 + 6 = 20.
  await page.goto("/tenant/products");
  await page.getByPlaceholder("Search name or SKU…").fill(KURTA.name);
  const row = page.getByRole("row").filter({ hasText: KURTA.name }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("row").filter({ hasText: KURTA.name })).toHaveCount(1);
  await expect(row, "the list does not add up the rail").toContainText("20");
});

test("T2 · the counter is opened", async ({ page, request }) => {
  await openTill(page);
  if (!(await ask<unknown>(request, "owner", "/pos/session"))) {
    await page.getByRole("button", { name: "Open shift" }).first().click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Open shift" }) });
    await sheet.getByRole("spinbutton").first().fill("5000");
    await sheet.getByRole("button", { name: "Open", exact: true }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
  }
  await expect(page.getByText(/Shift open/).first()).toBeVisible({ timeout: 15_000 });
});

test("T3 · the till asks which: every size at its own price, how many are left — and the one that never came cannot be pressed", async ({ page, request }) => {
  const before = await rail(request);

  await openTill(page);
  const sheet = await whichSize(page);
  // Asked in the order the rail hangs: Blue S, M, L, then White.
  expect(await sheet.locator("[data-pos-size]").evaluateAll((chips) => chips.map((c) => c.getAttribute("data-pos-size")))).toEqual(RAIL.map((r) => r.size));
  for (const r of RAIL) {
    const chip = sheet.locator(`[data-pos-size="${r.size}"]`);
    await expect(chip, `${r.size} is not offered`).toBeVisible();
    await expect(chip).toContainText(r.price.toLocaleString("en-US"));
    await expect(chip, `${r.size} does not say how many are left`).toContainText(before[r.size] > 0 ? `${before[r.size]} left` : "none left");
    if (before[r.size] > 0) await expect(chip).toBeEnabled();
    else await expect(chip, `${r.size} can be sold with none on the rail`).toBeDisabled();
  }

  await sheet.locator('[data-pos-size="Blue / M"]').click();
  await expect(line(page, KURTA.name), "the bill does not say which size").toContainText("Blue / M");
  await search(page).fill("");

  // 2,500 and 5% of it: 125.  Bill 2,625.  Paid with three thousand: 375 back.
  expect(await grandTotal(page)).toBe(2625);
  expect(await tender(page, "Cash")).toBe(2625);
  await page.getByPlaceholder("Cash tendered").fill("3000");
  await expect(tenderSheet(page).getByText(/Change due/i).locator("..")).toContainText("375");
  const sale = await complete(page, request);

  expect(Number(sale.tax)).toBe(125);
  expect(Number(sale.total)).toBe(2625);
  expect(sale.items).toHaveLength(1);
  expect(sale.items[0].variant_name, "the sale does not record which size left the shop").toBe("Blue / M");

  // One Medium off the blue rail, and nothing else touched.
  expect(await rail(request)).toEqual({ ...before, "Blue / M": before["Blue / M"] - 1 });

  // The paper in the customer's hand says the size.
  const slip = await paper(request, sale.id);
  expect(slip, "the receipt does not say which size was bought").toContain("Blue / M");
  expect(slip).toContain("2,625");
});

test("T4 · a tag is scanned and that size is on the bill — twice is two of them on one line, and a discount comes off before the tax", async ({ page, request }) => {
  const before = await rail(request);
  const large = tag("White / L");

  await openTill(page);
  await scan(page, large.code);
  await expect(cart(page), "a scanned tag put nothing on the bill").toHaveCount(1, { timeout: 10_000 });
  await expect(cart(page).first(), "the tag is the white Large's and the bill is not").toContainText("White / L");
  await expect(page.getByRole("dialog", { name: KURTA.name }), "a tag was scanned and the till still asked which size").toHaveCount(0);

  await scan(page, large.code);
  await expect(cart(page), "the second of the same size started a line of its own").toHaveCount(1);
  await expect(cart(page).first().locator("input").first()).toHaveValue("2");

  await discount(page, { amount: 400 });

  // 2 × 2,700 = 5,400.  Less 400 = 5,000.  5% = 250.  Bill 5,250.
  expect(await tender(page, "Card")).toBe(5250);
  const sale = await complete(page, request);

  expect(Number(sale.discount)).toBe(400);
  expect(Number(sale.tax)).toBe(250);
  expect(Number(sale.total)).toBe(5250);
  expect(sale.items.map((i) => [i.variant_name, Number(i.quantity)])).toEqual([["White / L", 2]]);
  expect(await rail(request)).toEqual({ ...before, "White / L": before["White / L"] - 2 });
});

test("T5 · the tag of a size that never came is refused in words, and nothing is on the bill", async ({ page }) => {
  await openTill(page);
  await scan(page, tag("White / M").code);

  await expect(page.getByText(/White \/ M is out of stock/i).first(), "the till did not say why the tag rang nothing").toBeVisible({ timeout: 10_000 });
  await expect(cart(page)).toHaveCount(0);
});

test("T6 · two sizes of one design on a bill, and the Large comes back — the refund names the size, to the paisa", async ({ page, request }) => {
  const before = await rail(request);

  await openTill(page);
  await pick(page, "Blue / S");
  await pick(page, "Blue / L");
  await expect(cart(page), "two sizes of one design were put on one line").toHaveCount(2);

  // 2,500 + 2,700 = 5,200.  5% = 260.  Bill 5,460.
  expect(await tender(page, "Cash")).toBe(5460);
  await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
  const sale = await complete(page, request);
  expect(Number(sale.total)).toBe(5460);
  expect(await rail(request)).toEqual({ ...before, "Blue / S": before["Blue / S"] - 1, "Blue / L": before["Blue / L"] - 1 });

  // ── she is back within the hour: the Large is too long ───────────
  const sheet = await saleSheet(page, String(sale.invoice_number));
  await sheet.getByRole("button", { name: "Return / Refund" }).click();
  // Two boxes for one design. Each has to say WHICH it is for.
  await expect(sheet.getByLabel(`How many ${KURTA.name} (Blue / S) to return`), "the Small's box does not say it is the Small's").toBeVisible();
  await sheet.getByLabel(`How many ${KURTA.name} (Blue / L) to return`).fill("1");
  // The money is said BEFORE the press: 2,700 and the 135 of tax charged on it.
  const worth = sheet.getByTestId("refund-worth");
  await expect(worth, "the sheet does not say what will be handed back").toContainText("2,835", { timeout: 10_000 });
  await expect(worth).toContainText("135");
  await sheet.getByRole("button", { name: "Refund & restock" }).click();
  await expect(sheet.getByText("Partially refunded", { exact: true })).toBeVisible({ timeout: 20_000 });

  const now = await ask<{ status: string; returns: Array<{ refund_total: string | number }> }>(request, "owner", `/sales/${String(sale.id)}`);
  // 2,700 and the 135 of tax that was charged on it.
  expect(now.returns.map((r) => Number(r.refund_total))).toEqual([2835]);
  // The Large is back on the rail. The Small is still sold.
  expect(await rail(request)).toEqual({ ...before, "Blue / S": before["Blue / S"] - 1 });
});

test("T7 · it does not fit: the Medium is handed back for a Large, and the difference is paid", async ({ page, request }) => {
  const before = await rail(request);
  // The first sale of the day: one Blue / M at 2,625.
  const first = (await ask<Array<Row & { id: string; invoice_number: string; total: string | number }>>(request, "owner", "/sales?per_page=30"))
    .filter((s) => Number(s.total) === 2625).pop()!;
  expect(first, "the Medium sold in T3 is not in the ledger").toBeTruthy();

  const sheet = await saleSheet(page, first.invoice_number);
  await sheet.getByRole("button", { name: "Exchange" }).click();
  await sheet.getByLabel(`How many ${KURTA.name} (Blue / M) to hand back`).fill("1");

  // What goes out instead is asked for by SIZE — the same question the till asks.
  await sheet.getByPlaceholder("Search products…").fill(KURTA.name);
  const large = sheet.getByRole("button", { name: /Blue \/ L/ });
  await expect(large, "the exchange offers the design and not its sizes").toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByRole("button", { name: /White \/ M/ }), "a size with none on the rail can be handed over").toBeDisabled();
  await large.click();

  // Back: 2,500 + 125 = 2,625.  Out: 2,700 + 135 = 2,835.  She pays 210.
  const sums = sheet.getByTestId("exchange-sums");
  await expect(sums).toContainText("2,625");
  await expect(sums).toContainText("2,835");
  await expect(sums.getByText("Difference to collect").locator("..")).toContainText("210");

  await sheet.getByRole("button", { name: "Complete exchange" }).click();
  await expect(sheet.getByText(/Exchange failed/), "the exchange was refused").toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Complete exchange" })).toBeHidden({ timeout: 20_000 });

  // The Medium is back, a Large is gone.
  expect(await rail(request)).toEqual({ ...before, "Blue / M": before["Blue / M"] + 1, "Blue / L": before["Blue / L"] - 1 });

  // …and the sale that took its place says the size, at the Large's price, with 210 taken.
  const newest = (await ask<Array<Row & { id: string }>>(request, "owner", "/sales?per_page=5"))[0];
  const swap = await ask<Row & { items: Row[]; payments?: Array<{ method: string; amount: string | number }> }>(request, "owner", `/sales/${newest.id}`);
  expect(Number(swap.total)).toBe(2835);
  expect(swap.items.map((i) => i.variant_name)).toEqual(["Blue / L"]);
  const taken = (swap.payments ?? []).filter((p) => p.method !== "other").reduce((s, p) => s + Number(p.amount), 0);
  expect(taken, "what the customer paid on top is not the difference").toBe(210);
});

test("T8 · every size has its own sticker: its own code, its own price", async ({ page }) => {
  await page.goto(`/tenant/labels?search=${encodeURIComponent(KURTA.name)}`);
  await expect(page.getByRole("heading", { name: "Barcode labels" })).toBeVisible({ timeout: 20_000 });

  for (const r of RAIL) {
    await expect(page.getByRole("textbox", { name: `Labels for ${KURTA.name} ${r.size}`, exact: true }).first(), `${r.size} has no label of its own`).toBeVisible({ timeout: 15_000 });
  }

  const box = page.getByRole("textbox", { name: `Labels for ${KURTA.name} Blue / L`, exact: true }).first();
  await box.fill("2");
  await box.blur();
  const sticker = page.getByTestId("label-paper").locator(".lbl").filter({ hasText: tag("Blue / L").code }).first();
  await expect(sticker, "the Large's sticker does not carry the Large's code").toBeVisible({ timeout: 10_000 });
  await expect(sticker, "the Large's sticker is priced as a Small").toContainText("2,700");
  await expect(sticker).toContainText("Blue / L");
});

test("T9 · at the end of the day the rail, counted by hand, is what the screen says", async ({ page, request }) => {
  // Blue / S   4 − 1 (T6)                          = 3
  // Blue / M   5 − 1 (T3) + 1 (handed back, T7)    = 5
  // Blue / L   3 − 1 (T6) + 1 (returned) − 1 (T7)  = 2
  // White / S  2                                   = 2
  // White / M  0                                   = 0
  // White / L  6 − 2 (T4)                          = 4
  const counted = { "Blue / S": 3, "Blue / M": 5, "Blue / L": 2, "White / S": 2, "White / M": 0, "White / L": 4 };
  expect(await rail(request)).toEqual(counted);

  await page.goto("/tenant/inventory");
  await settled(page);
  // The design, and under it a row for every size — in the order of the rail.
  const design = page.getByRole("row").filter({ hasText: KURTA.name }).first();
  await expect(design).toBeVisible({ timeout: 20_000 });
  // 3 + 5 + 2 + 2 + 0 + 4 = 16.
  await expect(design.getByRole("cell").nth(1)).toHaveText("16");

  const sizes = page.getByRole("row").filter({ hasText: /^\s*↳?\s*(Blue|White) \/ [SML]/ });
  expect((await sizes.locator("td:first-child").allInnerTexts()).map((t) => t.replace(/[^A-Za-z/ ]/g, "").trim())).toEqual(Object.keys(counted));
  for (const [size, left] of Object.entries(counted)) {
    const row = page.getByRole("row").filter({ hasText: size }).first();
    await expect(row.getByRole("cell").nth(1), `Stock levels and the rail disagree about ${size}`).toHaveText(String(left));
  }
});
