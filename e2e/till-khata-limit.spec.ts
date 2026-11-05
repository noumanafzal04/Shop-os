import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, ownerAuth, removeProductsNamed, roomToWork } from "./api";
import { openTill } from "./till";

/**
 * WHERE THIS BILL LEAVES THE DEALER'S KHATA.
 *
 * A wholesaler sells to a dealer on credit. The tender sheet said only "Adds
 * Rs X to <dealer>'s khata" — not what the dealer already owes, nor how much of
 * their limit is left, so a bill over the limit was found out at Complete. Now
 * it says both before the press, and warns when the bill would cross the limit.
 *
 * Fixture: a dealer who owes nothing with a limit of 5,000, and an item at 1,000.
 */
const ITEM = { name: "E2E Khata Rice Bag", price: 1000 };
const DEALER = { name: "E2E Khata Dealer", phone: "03001110042", limit: 5000 };

async function card(request: APIRequestContext): Promise<void> {
  await removeProductsNamed(request, ITEM.name);
  const made = await request.post(`${API}/products`, {
    headers: ownerAuth(),
    data: { item_type: "physical_product", name: ITEM.name, price: ITEM.price, is_active: true, track_inventory: false, tax_rate: 0 },
  });
  expect(made.ok(), `the item could not be carded (${made.status()} ${await made.text()})`).toBeTruthy();

  // The dealer, owing nothing: found by phone, made if missing, limit set either way.
  const found = await request.get(`${API}/customers-lookup?phone=${DEALER.phone}`, { headers: ownerAuth() });
  const known = ((await found.json()) as { data: { id: string; credit_balance: number } | null }).data;
  if (known && Number(known.credit_balance) !== 0) {
    test.skip(true, `the fixture dealer already owes ${known.credit_balance} — this measures a dealer owing nothing`);
  }
  const res = known
    ? await request.put(`${API}/customers/${known.id}`, { headers: ownerAuth(), data: { name: DEALER.name, phone: DEALER.phone, credit_limit: DEALER.limit } })
    : await request.post(`${API}/customers`, { headers: ownerAuth(), data: { name: DEALER.name, phone: DEALER.phone, credit_limit: DEALER.limit } });
  expect(res.ok(), `the dealer could not be set up (${res.status()} ${await res.text()})`).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  await roomToWork(request, ownerAuth(), 130, "/auth/me");
});

const outlook = (page: Page) => page.locator("[data-khata-outlook]");

async function billOnKhata(page: Page, qty: number): Promise<void> {
  await openTill(page);
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  if (await reset.isEnabled().catch(() => false)) await reset.click();
  await page.getByPlaceholder(/scan barcode or search/i).first().fill(ITEM.name);
  await page.getByText(ITEM.name).first().click();
  const line = page.locator("[data-cart-row]").filter({ hasText: ITEM.name }).first();
  await expect(line).toBeVisible();
  await line.locator("input").first().fill(String(qty));
  await line.locator("input").first().press("Tab");
  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  await page.getByRole("combobox", { name: "Payment method" }).selectOption("credit");
  await page.getByLabel("Customer phone").fill(DEALER.phone);
}

test("the tender sheet says what the dealer owes now, after this bill, and the room left", async ({ page, request }) => {
  await card(request);
  await billOnKhata(page, 3);

  await expect(outlook(page), "the sheet says nothing of the dealer's khata").toContainText(/Owes now Rs\s?0/, { timeout: 10_000 });
  await expect(outlook(page)).toContainText(/after this Rs\s?3,000/);
  await expect(outlook(page)).toContainText(/limit Rs\s?5,000 \(Rs\s?2,000 left\)/);
  await expect(outlook(page)).not.toContainText("Over the limit");
});

test("a bill over the dealer's limit is warned before Complete, by how much", async ({ page, request }) => {
  await card(request);
  await billOnKhata(page, 7);

  await expect(outlook(page), "a bill 2,000 past the limit was not warned").toContainText(/Over the limit by Rs\s?2,000/, { timeout: 10_000 });
});
