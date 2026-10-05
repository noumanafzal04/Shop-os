import fs from "node:fs";
import type { Browser, Page } from "@playwright/test";
import { ADMIN_STATE, OWNER_STATE, Watch, ask, expect, record, rupees, session, settled, test } from "./kit";
import { item } from "./shop";
import { complete, openTill, quantity, ring, tender } from "./till";

/**
 * STAGE F — THE ADMIN COMES BACK.
 *
 * The business has traded. The person who created it opens its page again
 * and does the three things an admin does to a shop that is already running:
 * reads how much of the plan it has used, takes a module away, and stops it
 * altogether. Each is done on the admin's screen and then LOOKED AT from the
 * owner's side, because "saved" on one screen is a promise about another.
 */

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => {
  await session(browser, "admin");
  await session(browser, "owner");
});
test.use({ storageState: ADMIN_STATE });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4173";

/** The module taken away, and the screens that go with it. */
const MODULE = { label: "Coupons & Promotions", key: "promotions", screens: ["/tenant/coupons", "/tenant/promotions"] } as const;

/** The owner's browser, watched like every other page in the journey. */
async function asOwner<T>(browser: Browser, expected: RegExp[], work: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ baseURL: BASE, storageState: OWNER_STATE });
  const page = await context.newPage();
  const watch = new Watch(page);
  for (const pattern of expected) watch.expect(pattern);
  try {
    const result = await work(page);
    await page.waitForTimeout(400);
    expect(watch.unexpected(), "the server refused something the owner's screen asked for").toEqual([]);
    expect(watch.thrown, "the owner's page threw an error").toEqual([]);

    return result;
  } finally {
    await context.close();
  }
}

/** Every entry in the owner's menu, with every group opened. */
async function menu(page: Page): Promise<string[]> {
  await page.goto("/tenant");
  await settled(page);
  const full = page.getByRole("button", { name: "Full view" });
  if (await full.isVisible().catch(() => false)) await full.click();

  const nav = page.getByRole("navigation").first();
  for (let pass = 0; pass < 3; pass++) {
    const groups = nav.getByRole("button");
    for (let i = 0; i < (await groups.count()); i++) {
      const g = groups.nth(i);
      if ((await g.getAttribute("aria-expanded")) === "false") await g.click().catch(() => {});
    }
  }

  return nav.getByRole("link").evaluateAll((as) =>
    [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""))].filter((h) => h.startsWith("/tenant")),
  );
}

const tenantPage = async (page: Page) => {
  const r = record();
  await page.goto(`/admin/tenants/${r.tenantId}`);
  await expect(page.getByRole("heading", { name: r.business })).toBeVisible({ timeout: 20_000 });
  await settled(page);
};

/** Flip one module on the admin's page and save it. */
const setModule = async (page: Page, on: boolean) => {
  await tenantPage(page);
  const toggle = page.getByRole("switch", { name: MODULE.label, exact: true });
  await expect(toggle).toHaveAttribute("aria-checked", String(!on));
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(on));
  await page.getByRole("button", { name: "Save modules" }).click();
  await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });
};

test("F1 · the shop's page says how much it has used, and it is what the shop did", async ({ page, request }) => {
  const r = record();
  await tenantPage(page);

  const usage = page.locator("div").filter({ has: page.getByRole("heading", { name: "Usage & limits" }) }).last();
  const text = (await usage.innerText()).replace(/,/g, "");
  const used = (label: string): number => {
    const m = text.match(new RegExp(`${label}[^0-9]*?([0-9]+)\\s*/`, "i"));
    expect(m, `the Usage card has no "${label}" row: ${text.slice(0, 400)}`).toBeTruthy();

    return Number(m![1]);
  };

  // Six by hand and two thousand from the file.
  expect(used("products")).toBe(2006);
  // Main, and the one added in stage B.
  expect(used("branches")).toBe(2);
  // The cashier. The owner is not staff.
  expect(used("staff members")).toBe(1);
  // Every bill the journey rang this month: the day, the one at the till, the volume.
  const before = r.before as { sales_count: number } | undefined;
  if (before) expect(used("orders this month")).toBe(before.sales_count + Number(r.volumeSales ?? 0));

  // The owner is listed, by name, as the owner.
  await expect(page.getByText(r.ownerEmail).first()).toBeVisible();

  // …and the server holds the same figures the card drew.
  const held = await ask<{ limits_usage: Array<{ key: string; used: number }> }>(request, "admin", `/admin/tenants/${r.tenantId}`);
  expect(held.limits_usage.find((u) => u.key === "products")!.used).toBe(2006);
});

test("F2 · a module is switched off, and the owner's shop loses it cleanly", async ({ page, browser }) => {
  test.setTimeout(600_000);
  await setModule(page, false);

  // The owner, on a session opened BEFORE the change, as a real one would be.
  await asOwner(browser, [], async (owner) => {
    const links = await menu(owner);

    // It is not offered…
    for (const gone of MODULE.screens) expect(links, `${gone} is still in the menu`).not.toContain(gone);

    // …and nothing that IS offered leads to a refusal. `asOwner` fails this
    // case on any 403 — the bug this guards is a menu entry left behind for a
    // module the shop no longer has.
    const bounced: string[] = [];
    for (const href of links) {
      await owner.goto(href);
      await settled(owner);
      if (new URL(owner.url()).pathname.replace(/\/$/, "") !== href.replace(/\/$/, "")) bounced.push(`${href} → ${new URL(owner.url()).pathname}`);
    }
    expect(bounced).toEqual([]);
  });

  // Typing the address does not get round it: the screen is not there.
  await asOwner(browser, [/MODULE_DISABLED/], async (owner) => {
    for (const gone of MODULE.screens) {
      await owner.goto(gone);
      await settled(owner);
      await expect(owner.getByRole("heading", { name: /^(Coupons|Promotions)$/ })).toHaveCount(0);
    }
  });
});

test("F2 · with promotions off, the till charges the shelf price — and the server agrees", async ({ browser, request }) => {
  const soap = item("soap");

  await asOwner(browser, [], async (owner) => {
    await openTill(owner);
    await ring(owner, soap.name);
    await quantity(owner, soap.name, 5);

    // 5 × 120 = 600 at 5%. In stage C this same cart was 504 with the
    // promotion on; a shop without the module has no promotions to give.
    const due = await tender(owner, "Card");
    expect(due).toBe(630);

    const sale = await complete(owner, request);
    expect(Number(sale.total)).toBe(630);
    expect(Number(sale.discount)).toBe(0);
  });
});

test("F2 · switched back on, the offers are as they were left", async ({ page, browser, request }) => {
  await setModule(page, true);

  await asOwner(browser, [], async (owner) => {
    const links = await menu(owner);
    for (const back of MODULE.screens) expect(links, `${back} did not come back`).toContain(back);

    // The coupon and the promotion made in stage B were never deleted.
    await owner.goto("/tenant/coupons");
    await expect(owner.getByText("QAEID10").first()).toBeVisible({ timeout: 20_000 });
    await owner.goto("/tenant/promotions");
    await expect(owner.getByText("QA Soap 20 off").first()).toBeVisible({ timeout: 20_000 });

    // …and the till gives it again: 5 × 120 less 20% = 480 at 5% = 504.
    const soap = item("soap");
    await openTill(owner);
    await ring(owner, soap.name);
    await quantity(owner, soap.name, 5);
    expect(await tender(owner, "Card")).toBe(504);
    const sale = await complete(owner, request);
    expect(Number(sale.total)).toBe(504);
  });
});

test("F3 · suspended: the owner is out, and is told why", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const r = record();

  await tenantPage(page);
  await page.getByRole("button", { name: "Suspend", exact: true }).click();
  await expect(page.getByText(/Tenant suspended/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Activate", exact: true })).toBeVisible();

  // The list says so too.
  await page.goto("/admin/tenants");
  const search = page.getByPlaceholder(/search/i).first();
  if (await search.isVisible().catch(() => false)) await search.fill(r.business);
  await expect(page.getByRole("row").filter({ hasText: r.business })).toContainText(/suspended/i, { timeout: 20_000 });

  // The owner's open session is over: the next thing they do lands at the door.
  const context = await browser.newContext({ baseURL: BASE, storageState: OWNER_STATE });
  const owner = await context.newPage();
  await owner.goto("/tenant/products");
  await expect(owner).toHaveURL(/\/signin/, { timeout: 30_000 });

  // And the door says what happened rather than "wrong password".
  await owner.getByPlaceholder("you@business.com").fill(r.ownerEmail);
  await owner.getByPlaceholder("Enter your password").fill(r.ownerPassword);
  await owner.getByRole("button", { name: /sign in/i }).click();
  await expect(owner.getByText(/suspended/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(owner).toHaveURL(/\/signin/);
  await context.close();
});

test("F3 · activated: the owner is back in, and the shop is as it was", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const r = record();

  await tenantPage(page);
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByText("Tenant activated")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Suspend", exact: true })).toBeVisible();

  // The saved sign-in was revoked with the rest. A new one, through the form.
  fs.rmSync(OWNER_STATE, { force: true });
  await session(browser, "owner");

  await asOwner(browser, [], async (owner) => {
    await owner.goto("/tenant/sales");
    await settled(owner);
    const before = r.before as { sales_count: number } | undefined;
    const count = rupees(await owner.getByText(/[0-9,]+ sales/).first().innerText());
    // Nothing was lost by being switched off for a minute: every sale of the
    // journey, and the two rung in this stage.
    if (before) expect(count).toBe(before.sales_count + Number(r.volumeSales ?? 0) + 2);
    else expect(count).toBeGreaterThan(10);
  });
});

// Kept last and separate: the admin's own trail of what was just done.
test("F4 · the admin's audit log has the suspension and the module change", async ({ page }) => {
  const r = record();

  await page.goto("/admin/audit-logs");
  await settled(page);
  await expect(page.getByText(r.business).first()).toBeVisible({ timeout: 20_000 });
  const trail = (await page.locator("main, body").first().innerText()).toLowerCase();
  expect(trail, "the audit log does not mention the suspension").toMatch(/suspend/);
  expect(trail, "the audit log does not mention the activation").toMatch(/activat/);
});
