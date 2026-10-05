import { ADMIN_STATE, TRADE, TRADE_LABEL, ask, begin, choose, expect, record, remember, session, settled, test } from "./kit";

/**
 * STAGE A — THE PLATFORM ADMIN.
 *
 * Where every business starts: somebody at the platform fills in one form.
 * Everything the owner can ever do follows from what is switched on here, so
 * this run switches on EVERYTHING — the journey is meant to walk every module.
 */

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  begin();
  await session(browser, "admin");
});

test.use({ storageState: ADMIN_STATE });

test("A1 · the admin is signed in and lands on the console", async ({ page }) => {
  await page.goto("/admin");
  await settled(page);
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("link", { name: "Tenants", exact: true })).toBeVisible();
});

test("A2 · a business is created with every module switched on", async ({ page }) => {
  const r = record();

  await page.goto("/admin/tenants/new");
  await expect(page.getByRole("heading", { name: "Create a business" })).toBeVisible();

  await page.getByLabel("Business name *", { exact: true }).fill(r.business);
  await page.getByLabel("Business type *", { exact: true }).selectOption({ label: TRADE_LABEL[TRADE] });

  // A category, where the type has any. The first real one.
  const category = page.getByLabel("Category", { exact: true });
  await expect.poll(async () => category.locator("option:not([disabled])").count()).toBeGreaterThan(0);
  const firstCategory = await category.locator("option:not([disabled])").first().getAttribute("value");
  if (firstCategory) await category.selectOption(firstCategory);

  await page.getByLabel("Email", { exact: true }).fill(`shop-${r.stamp}@qa.test`);
  await page.getByLabel("Phone", { exact: true }).fill(r.phone);
  await page.getByLabel("City", { exact: true }).selectOption({ label: "Lahore" });

  // The biggest plan: the journey needs room for branches, lanes and staff.
  await choose(page.getByLabel("Plan *", { exact: true }), /^Enterprise/);
  await page.getByLabel("Amount", { exact: true }).fill("15000");
  await page.getByLabel("Reference", { exact: true }).fill(`QA-${r.stamp}`);

  await page.getByLabel("Owner name *", { exact: true }).fill(r.ownerName);
  await page.getByLabel("Owner email *", { exact: true }).fill(r.ownerEmail);
  await page.getByLabel("Temp password *", { exact: true }).fill(r.ownerPassword);

  // EVERY module. One switch can bring others with it, so this goes round
  // until none is left off rather than clicking each exactly once.
  const off = page.getByRole("switch", { checked: false });
  for (let guard = 0; guard < 40 && (await off.count()) > 0; guard++) {
    await off.first().click();
  }
  await expect(off, "a module switch would not stay on").toHaveCount(0);
  const modules = await page.getByRole("switch").count();
  expect(modules, "the form offered fewer modules than the platform has").toBeGreaterThanOrEqual(20);

  const create = page.getByRole("button", { name: "Create business" });
  await expect(create).toBeEnabled();
  await create.click();

  // It lands somewhere that is not the form.
  await expect(page).not.toHaveURL(/\/tenants\/new/, { timeout: 30_000 });
  remember({ modules });
});

test("A3 · it is on the Tenants list — active, on the plan chosen", async ({ page, request }) => {
  const r = record();

  await page.goto("/admin/tenants");
  await settled(page);
  const search = page.getByPlaceholder(/search/i).first();
  if (await search.isVisible().catch(() => false)) await search.fill(r.business);

  const row = page.getByRole("row").filter({ hasText: r.business });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(/Enterprise/);
  // Paid, because an opening payment was taken on the form…
  await expect(row).toContainText("Rs 15,000");
  await expect(row).toContainText(/paid/i);
  // …and honest about the one thing still missing: the owner has not been in.
  await expect(row).toContainText(/setup unfinished/i);

  // The same business, as the server holds it.
  const found = await ask<Array<{ id: string; business_name: string; status: string }>>(
    request, "admin", `/admin/tenants?search=${encodeURIComponent(r.business)}&per_page=50`,
  );
  const mine = found.find((t) => t.business_name === r.business);
  expect(mine, "the server has no such business").toBeTruthy();
  expect(mine!.status).toBe("active");
  remember({ tenantId: mine!.id });
});

test("A4 · its own page shows every module on", async ({ page, request }) => {
  const r = record();

  await page.goto(`/admin/tenants/${r.tenantId}`);
  await settled(page);
  await expect(page.getByText(r.business).first()).toBeVisible();

  const detail = await ask<{ features: Record<string, boolean> }>(request, "admin", `/admin/tenants/${r.tenantId}`);
  const off = Object.entries(detail.features).filter(([, on]) => !on).map(([key]) => key);
  expect(off, "modules the form said were on and the server says are off").toEqual([]);
  expect(Object.keys(detail.features).length).toBeGreaterThanOrEqual(20);
});

test("A5 · the opening payment is in Billing & Payments", async ({ page }) => {
  const r = record();

  await page.goto("/admin/payments");
  await settled(page);
  const row = page.getByRole("row").filter({ hasText: r.business }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText("15,000");
});

test("A6 · the Audit Log says who created it", async ({ page }) => {
  const r = record();

  await page.goto("/admin/audit-logs");
  await settled(page);
  await expect(page.getByText(r.business).first()).toBeVisible({ timeout: 20_000 });
});
