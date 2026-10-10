import { expect, test, type APIRequestContext } from "@playwright/test";

import { API, roomToWork, tradeAuth } from "./api";

/**
 * A CUSTOMER THE PLATFORM MADE CAN BE FOUND AGAIN — through the screen.
 *
 * Reported as "customers are being created on the admin side and they do not
 * show". The screen was one form: it made an account and there was no list
 * for the account to be on.
 *
 * One walk, the way staff do it: make somebody, find them on the list, correct
 * their name, give them a new password, switch the account off and see that
 * the list and its figures say so, switch it back on — and take the account
 * away again, which is how this run leaves the ground as it found it.
 */

const WHO = { name: "E2E Admin Customer", fixed: "E2E Admin Customer Fixed", phone: "03990001111" };

type Row = { id: string; name: string; status: string; phone: string | null };

const admin = () => tradeAuth("admin");

async function found(request: APIRequestContext, search: string): Promise<Row[]> {
  const res = await request.get(`${API}/admin/customers?search=${encodeURIComponent(search)}`, { headers: admin() });
  expect(res.ok(), `the customer list could not be read (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Row[] }).data;
}

/** Whoever an earlier run left behind. They never order, so they can always be removed. */
async function clearTheGround(request: APIRequestContext): Promise<void> {
  for (const left of await found(request, WHO.phone)) {
    const gone = await request.delete(`${API}/admin/customers/${left.id}`, { headers: admin() });
    expect(gone.ok(), `an earlier run's customer could not be removed (${gone.status()} ${await gone.text()})`).toBeTruthy();
  }
}

// One signed-in admin, 240 requests a minute: wait for the minute to turn
// rather than be refused half-way through a test. See roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, tradeAuth("admin"));
});

test("a customer made by staff is on the list, and can be corrected, switched off and taken away", async ({ page, request }) => {
  await clearTheGround(request);

  await page.goto("/admin/customers");
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible({ timeout: 20_000 });
  // The screen is a list now, with what it amounts to above it.
  await expect(page.getByTestId("customers-table").or(page.getByText("No customers yet"))).toBeVisible({ timeout: 20_000 });

  // ── made ──────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "New customer" }).first().click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "New customer" }) });
  await expect(dialog).toBeVisible();
  const create = dialog.getByRole("button", { name: "Create account" });
  await dialog.getByLabel("Name", { exact: true }).fill(WHO.name);
  await dialog.getByLabel("Password", { exact: true }).fill("password123");
  // A name and a password, and nothing to sign in WITH: an account that looks
  // fine and can never be opened.
  await expect(create, "an account with neither a phone nor an email can be created").toBeDisabled();
  await dialog.getByLabel("Phone", { exact: true }).fill(WHO.phone);
  await expect(create).toBeEnabled();
  await create.click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });

  // ── and then found: on the list, without anybody searching ────────
  const row = page.getByRole("row").filter({ hasText: WHO.phone });
  await expect(row, "the account just made is not on the list").toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(WHO.name);
  await expect(row).toContainText("Can sign in");
  await expect(row).toContainText("None yet");

  // …and by search, which is how they are found next week.
  await page.getByLabel("Search customers").fill("0399000");
  await expect(page.getByRole("row").filter({ hasText: WHO.phone })).toBeVisible();
  await expect(page.getByTestId("customers-table").locator("tbody tr")).toHaveCount(1, { timeout: 15_000 });

  // ── corrected ─────────────────────────────────────────────────────
  await row.getByRole("button", { name: `Open ${WHO.name}` }).click();
  const card = page.getByRole("dialog").filter({ has: page.getByTestId("customer-card") });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await card.getByLabel("Name", { exact: true }).fill(WHO.fixed);
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card.getByRole("heading", { name: WHO.fixed })).toBeVisible({ timeout: 15_000 });
  expect((await found(request, WHO.phone))[0]?.name).toBe(WHO.fixed);

  // ── a new password ────────────────────────────────────────────────
  await card.getByRole("button", { name: "Set a password" }).click();
  const set = card.getByRole("button", { name: "Set password", exact: true });
  await card.getByLabel("New password", { exact: true }).fill("short");
  await expect(set, "a five-letter password can be set").toBeDisabled();
  await card.getByLabel("New password", { exact: true }).fill("a-new-password");
  await set.click();
  await expect(card.getByLabel("New password", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  const signIn = await request.post(`${API}/auth/login`, { data: { identifier: WHO.phone, password: "a-new-password" } });
  expect(signIn.ok(), "the password staff set does not sign the customer in").toBeTruthy();

  // ── switched off ──────────────────────────────────────────────────
  await card.getByRole("button", { name: "Switch off", exact: true }).click();
  await page.getByRole("button", { name: "Switch off", exact: true }).last().click(); // the confirmation
  await expect(card.getByText("Switched off", { exact: true })).toBeVisible({ timeout: 15_000 });
  const refused = await request.post(`${API}/auth/login`, { data: { identifier: WHO.phone, password: "a-new-password" } });
  expect(refused.status(), "a switched-off customer can still sign in").toBe(403);
  await card.getByRole("button", { name: "Close", exact: true }).first().click();

  // The list says so, and its own figure is the way to them.
  await page.getByLabel("Search customers").fill("");
  await page.getByRole("button", { name: /^Switched off/ }).click();
  await expect(page.getByRole("row").filter({ hasText: WHO.phone })).toContainText("Switched off", { timeout: 15_000 });
  await page.getByRole("button", { name: /^Switched off/ }).click(); // and back to everybody

  // ── switched back on, and taken away ──────────────────────────────
  await page.getByLabel("Search customers").fill(WHO.phone);
  await page.getByRole("row").filter({ hasText: WHO.phone }).getByRole("button", { name: `Open ${WHO.fixed}` }).click();
  await card.getByRole("button", { name: "Switch back on" }).click();
  await expect(card.getByText("Can sign in", { exact: true })).toBeVisible({ timeout: 15_000 });

  await card.getByRole("button", { name: "Remove account" }).click();
  await page.getByRole("button", { name: "Remove account" }).last().click(); // the confirmation
  await expect(card).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("row").filter({ hasText: WHO.phone }), "a removed account is still on the list").toHaveCount(0, { timeout: 15_000 });
  expect(await found(request, WHO.phone)).toHaveLength(0);
});
