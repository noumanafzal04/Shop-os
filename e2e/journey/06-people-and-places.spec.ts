import { OWNER_STATE, ask, expect, record, remember, session, settled, signIn, test } from "./kit";
import { BRANCH, CASHIER } from "./shop";

/**
 * STAGE B (people and places) — a second location, and somebody to work in
 * the first one.
 *
 * The cashier is the first person in the journey who is NOT the owner, which
 * is the whole point of making one: an owner holds every permission, so
 * nothing the owner can do says anything about what a member of staff can.
 */

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });

type Row = Record<string, unknown>;

test.describe("as the owner", () => {
  test.use({ storageState: OWNER_STATE });

  test("B11 · a second branch is added and listed beside the first", async ({ page, request }) => {
    const held = await ask<Row[]>(request, "owner", "/branches");
    if (!held.some((b) => b.name === BRANCH.name)) {
      await page.goto("/tenant/branches");
      await page.getByRole("button", { name: "+ Add branch" }).click();
      const form = page.getByRole("dialog", { name: "Add branch" });
      await form.getByLabel("Name *", { exact: true }).fill(BRANCH.name);
      await form.getByLabel("Short code", { exact: true }).fill(BRANCH.code);
      await form.getByLabel("Phone", { exact: true }).fill(BRANCH.phone);
      await form.getByLabel("Address", { exact: true }).fill(BRANCH.address);
      await form.getByRole("button", { name: "Save" }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
    }

    await page.goto("/tenant/branches");
    await settled(page);
    await expect(page.getByText(BRANCH.name).first()).toBeVisible();

    const now = await ask<Row[]>(request, "owner", "/branches");
    expect(now.length, "a shop with a second branch has two").toBe(2);
    expect(now.find((b) => b.name === BRANCH.name)?.code).toBe(BRANCH.code);
  });

  test("B11 · a cashier is hired from the Cashier job, with only a cashier's permissions", async ({ page, request }) => {
    const r = record();
    const email = `qa-cashier-${r.stamp}@qa.test`;

    const held = await ask<Row[]>(request, "owner", "/staff?per_page=100");
    if (!held.some((s) => s.email === email)) {
      await page.goto("/tenant/staff");
      await page.getByRole("button", { name: "+ Add Staff" }).click();
      const form = page.getByRole("dialog", { name: "Add Staff" });
      await form.getByLabel("Name *", { exact: true }).fill(CASHIER.name);
      await form.getByLabel("Email", { exact: true }).fill(email);
      await form.getByLabel("Temp password *", { exact: true }).fill(CASHIER.password);

      // The JOB, not nineteen boxes: one press ticks what a cashier needs.
      await form.getByRole("button", { name: CASHIER.job, exact: true }).click();
      await expect(form.getByRole("checkbox", { name: "Sales & invoices" })).toBeChecked();
      // …and does not hand over the shop.
      await expect(form.getByRole("checkbox", { name: "Manage staff" })).not.toBeChecked();

      await form.getByRole("button", { name: "Add staff" }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
    }

    await page.goto("/tenant/staff");
    await settled(page);
    await expect(page.getByRole("row").filter({ hasText: CASHIER.name }).first()).toBeVisible();

    const mine = (await ask<Row[]>(request, "owner", "/staff?per_page=100")).find((s) => s.email === email)!;
    const permissions = mine.permissions as string[];
    expect(permissions).toContain("sales.manage");
    expect(permissions, "a cashier was given the keys").not.toContain("staff.manage");
    expect(permissions).not.toContain("settings.manage");
    remember({ cashierEmail: email });
  });
});

test("B11 · the cashier can sign in, sees the till, and is kept out of Staff and Settings", async ({ page, watch }) => {
  const r = record();

  await signIn(page, String(r.cashierEmail), CASHIER.password, /\/tenant/);
  await settled(page);

  // The menu is the cashier's menu.
  const nav = page.getByRole("navigation").first();
  await expect(nav.getByRole("link", { name: "POS", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Staff", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);

  // Typing the address is not a way round the menu.
  await page.goto("/tenant/staff");
  await settled(page);
  await expect(page).not.toHaveURL(/\/tenant\/staff/);

  // The till itself opens for them.
  await page.goto("/tenant/pos");
  await expect(page.getByPlaceholder(/scan barcode or search/i).first()).toBeVisible({ timeout: 30_000 });

  // A cashier's screens ask the server only for what a cashier may read.
  expect(watch.unexpected(), "the cashier's own screens asked for something they are not allowed").toEqual([]);
});
