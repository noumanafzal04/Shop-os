import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, ownerAuth, removeProductsNamed, roomToWork } from "./api";

/**
 * POS 2 — THE SAME TILL, LAID OUT FOR FEWER STEPS (/tenant/pos2).
 *
 * The first till is untouched; this one is reached by its address. Its rules,
 * refusals and sheets are the first till's own code — what is new is where
 * things are: categories as chips, the customer's phone in the cart header,
 * and the money at the foot of the cart with ONE Complete. These are the new
 * pieces, each driven the way a cashier drives it and measured where it lands:
 * the sale, the shelf, the khata.
 */
const ITEM = { name: "E2E Pos2 Soap", sku: "E2E-POS2-SOAP", price: 150, stock: 50 };
const AISLE = "E2E Pos2 Aisle";
const KHATA = { name: "E2E Pos2 Khata", phone: "03001110077", limit: 100000 };

type Row = Record<string, unknown>;

async function fixture(request: APIRequestContext): Promise<string> {
  await removeProductsNamed(request, ITEM.name);
  const cats = await request.get(`${API}/categories`, { headers: ownerAuth() });
  let aisle = (((await cats.json()) as { data: Row[] }).data ?? []).find((c) => c.name === AISLE)?.id as string | undefined;
  if (!aisle) {
    const made = await request.post(`${API}/categories`, { headers: ownerAuth(), data: { name: AISLE } });
    expect(made.ok(), `the aisle could not be made (${made.status()} ${await made.text()})`).toBeTruthy();
    aisle = String(((await made.json()) as { data: Row }).data.id);
  }
  const made = await request.post(`${API}/products`, {
    headers: ownerAuth(),
    data: {
      item_type: "physical_product", name: ITEM.name, sku: ITEM.sku, price: ITEM.price, is_active: true, category_id: aisle,
      tax_rate: 0, track_inventory: true, stock_quantity: ITEM.stock,
    },
  });
  expect(made.ok(), `the item could not be carded (${made.status()} ${await made.text()})`).toBeTruthy();

  return String(((await made.json()) as { data: Row }).data.id);
}

async function onTheShelf(request: APIRequestContext, id: string): Promise<number> {
  const res = await request.get(`${API}/products/${id}`, { headers: ownerAuth() });

  return Number(((await res.json()) as { data: { stock_quantity: number | string } }).data.stock_quantity);
}

async function khataOwes(request: APIRequestContext): Promise<number | null> {
  const res = await request.get(`${API}/customers-lookup?phone=${KHATA.phone}`, { headers: ownerAuth() });
  const c = ((await res.json()) as { data: { credit_balance: number } | null }).data;

  return c === null ? null : Number(c.credit_balance);
}

async function khataCustomer(request: APIRequestContext): Promise<void> {
  const found = await request.get(`${API}/customers-lookup?phone=${KHATA.phone}`, { headers: ownerAuth() });
  const known = ((await found.json()) as { data: { id: string } | null }).data;
  const res = known
    ? await request.put(`${API}/customers/${known.id}`, { headers: ownerAuth(), data: { name: KHATA.name, phone: KHATA.phone, credit_limit: KHATA.limit } })
    : await request.post(`${API}/customers`, { headers: ownerAuth(), data: { name: KHATA.name, phone: KHATA.phone, credit_limit: KHATA.limit } });
  expect(res.ok(), `the khata customer could not be set up (${res.status()} ${await res.text()})`).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  await roomToWork(request, ownerAuth(), 130, "/auth/me");
});

const box = (page: Page) => page.getByPlaceholder(/scan barcode or search/i).first();
const lines = (page: Page) => page.locator("[data-cart-row]");
const complete = (page: Page) => page.locator("[data-pos2-complete]");

async function till2(page: Page): Promise<void> {
  await page.goto("/tenant/pos2");
  await expect(box(page)).toBeVisible({ timeout: 30_000 });
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  if (await reset.isEnabled().catch(() => false)) await reset.click();
  await expect(lines(page)).toHaveCount(0);
}

async function ring(page: Page, qty = 1): Promise<void> {
  for (let i = 0; i < qty; i++) {
    await box(page).fill(ITEM.name);
    await page.locator("[data-pos-item]").filter({ hasText: ITEM.name }).first().click();
  }
  await expect(lines(page).filter({ hasText: ITEM.name })).toHaveCount(1);
}

async function done(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Sale complete" }), "the sale did not complete from the cart's own button").toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "New sale" }).click();
}

test("a category chip narrows the shelf to that aisle", async ({ page, request }) => {
  await fixture(request);
  await till2(page);
  await page.locator("[data-pos2-categories]").getByRole("button", { name: AISLE, exact: true }).click();
  await expect(page.locator("[data-pos-item]").first()).toContainText(ITEM.name, { timeout: 15_000 });
  await expect(page.locator("[data-pos2-categories]").getByRole("button", { name: AISLE, exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("exact cash is one tap: an empty cash box completes at the bill, and the shelf moves", async ({ page, request }) => {
  const id = await fixture(request);
  await till2(page);
  await ring(page, 2);
  await expect(page.locator("[data-pos2-total]")).toHaveText(/Rs\s?300\b/);
  await expect(complete(page)).toHaveText(/Complete · Rs\s?300\b/);
  await complete(page).click();
  await done(page);
  expect(await onTheShelf(request, id), "two sold did not leave the shelf").toBe(ITEM.stock - 2);
});

test("cash given is worked out: a quick amount fills the box and the change is said", async ({ page, request }) => {
  await fixture(request);
  await till2(page);
  await ring(page, 1);
  await page.locator("#pos2-cash").fill("500");
  await expect(page.locator("[data-pos2-change]")).toContainText(/Rs\s?350\b/);
  await page.locator("#pos2-cash").press("Enter");
  await done(page);
});

test("card completes from the cart; Khata puts it on the customer typed in the header", async ({ page, request }) => {
  await fixture(request);
  await khataCustomer(request);
  await till2(page);

  await ring(page, 1);
  await page.locator("[data-pos2-pay]").getByRole("button", { name: "Card", exact: true }).click();
  await complete(page).click();
  await done(page);

  const before = (await khataOwes(request)) ?? 0;
  await ring(page, 1);
  await page.getByLabel("Customer's phone number").fill(KHATA.phone);
  await expect(page.locator("[data-pos2-customer]")).toContainText(KHATA.name, { timeout: 10_000 });
  await page.locator("[data-pos2-pay]").getByRole("button", { name: "Khata", exact: true }).click();
  await expect(page.locator("[data-pos2-pay]")).toContainText(/after this Rs\s?[\d,]+/);
  await expect(complete(page)).toHaveText(/on khata Rs\s?150\b/);
  await complete(page).click();
  await done(page);
  expect(await khataOwes(request), "the khata did not grow by the bill").toBe(before + ITEM.price);
});

test("the full Tender sheet is still there — More ways to pay, and F9", async ({ page, request }) => {
  await fixture(request);
  await till2(page);
  await ring(page, 1);
  await page.getByRole("button", { name: /More ways to pay/ }).click();
  await expect(page.getByRole("heading", { name: "Tender / Pay" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.keyboard.press("F9");
  await expect(page.getByRole("heading", { name: "Tender / Pay" })).toBeVisible();
});

test("after a line's ✕ a slow scanner still rings — the first till's rule, kept", async ({ page, request }) => {
  await fixture(request);
  await till2(page);
  await ring(page, 1);
  await lines(page).first().getByRole("button", { name: "Remove", exact: true }).click();
  await expect(lines(page)).toHaveCount(0);
  // What a scanner sends: the item's code, a key every 80 ms.
  await page.keyboard.type(ITEM.sku, { delay: 80 });
  await page.keyboard.press("Enter");
  await expect(lines(page).filter({ hasText: ITEM.name })).toHaveCount(1, { timeout: 15_000 });
});
