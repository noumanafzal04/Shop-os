import fs from "node:fs";
import type { Browser, Page } from "@playwright/test";
import { ADMIN_STATE, OWNER_STATE, Watch, ask, expect, record, remember, rupees, session, settled, test } from "./kit";
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

/**
 * Sales this stage has rung, over every time it has been run.
 *
 * The stage counts the shop's sales twice, and rings two each time it runs.
 * Kept in the record so that a second run expects two more rather than
 * calling its own first run a discrepancy.
 */
const rung = (): number => Number(record().adminStageSales ?? 0);
const rangOne = (): void => { remember({ adminStageSales: rung() + 1 }); };

/** Every bill the journey has rung in this shop. */
const everySale = (): number | null => {
  const r = record();
  const before = r.before as { sales_count: number } | undefined;

  // …including the ones stage G rings while it tries each setting at the till.
  return before ? before.sales_count + Number(r.volumeSales ?? 0) + rung() + Number(r.settingsStageSales ?? 0) : null;
};

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
  await expect(toggle).toBeVisible();
  // Already so — a stage started again after stopping halfway.
  if ((await toggle.getAttribute("aria-checked")) === String(on)) return;
  if (!on) {
    // The screen says what ELSE goes with it, before the press: bank card
    // offers stand on promotions, and are taken down with them.
    await expect(page.getByText(/Switching this off also switches off .*Bank Card Offers/i).first()).toBeVisible();
  }
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(on));
  // …and switching it back on does not bring them back, as the screen warned.
  // An admin restoring the shop restores both.
  const dependent = page.getByRole("switch", { name: "Bank Card Offers", exact: true });
  if (on) {
    if ((await dependent.getAttribute("aria-checked")) === "false") await dependent.click();
    await expect(dependent).toHaveAttribute("aria-checked", "true");
  } else {
    await expect(dependent, "the module that depends on it stayed on").toHaveAttribute("aria-checked", "false");
  }
  await page.getByRole("button", { name: "Save modules" }).click();
  await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });
};

test("F1 · the shop's page says how much it has used, and it is what the shop did", async ({ page, request }) => {
  const r = record();
  await tenantPage(page);

  // The CARD, not the strip with its heading in: "the last div that holds the
  // heading" is the heading's own row, which holds nothing else.
  const usage = page.locator('xpath=//h3[normalize-space(.)="Usage & limits"]/ancestor::div[contains(@class,"rounded-2xl")][1]');
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
  const all = everySale();
  if (all !== null) expect(used("orders this month")).toBe(all);

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
      // A person's pace. Each of these is a full reload — the whole shell
      // asked for again — and forty-six of them in forty seconds is past the
      // 240 requests a minute one person is allowed, which is the product
      // working and not a finding.
      await owner.waitForTimeout(700);
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
    rangOne();
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
    rangOne();
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
    const count = rupees(await owner.getByText(/[0-9,]+ sales/).first().innerText());
    // Nothing was lost by being switched off for a minute: every sale of the
    // journey, and the ones rung in this stage.
    const all = everySale();
    if (all !== null) expect(count).toBe(all);
    else expect(count).toBeGreaterThan(10);
  });
});

// Kept last and separate: the admin's own trail of what was just done.
test("F4 · the admin's audit log says what was done, and to which business", async ({ page }) => {
  const r = record();

  await page.goto("/admin/audit-logs");
  // Found by the BUSINESS. It could only be searched by a person's name, and
  // the row for a suspension did not say whose it was.
  await page.getByPlaceholder("Search a person or a business…").fill(r.business);
  const mine = page.getByRole("row").filter({ hasText: r.business });
  await expect(mine.first()).toBeVisible({ timeout: 20_000 });

  await expect(mine.filter({ hasText: "status: active → suspended" }).first(), "the suspension is not on the trail").toBeVisible();
  await expect(mine.filter({ hasText: "status: suspended → active" }).first(), "the activation is not on the trail").toBeVisible();

  // One line for the one module that moved — it was the whole module map,
  // twice, as JSON.
  await expect(mine.filter({ hasText: `${MODULE.label}: on → off` }).first(), "switching the module off is not on the trail").toBeVisible();
  await expect(mine.filter({ hasText: `${MODULE.label}: off → on` }).first()).toBeVisible();
  await expect(page.getByText(/\{"[a-z_]+":(true|false)/)).toHaveCount(0);

  // Every row the search returned is about this business and says so: the
  // Business column, read cell by cell once the list has stopped loading.
  await settled(page);
  const businesses = await page.locator("tbody tr td:nth-child(3)").allInnerTexts();
  expect(businesses.length).toBeGreaterThan(4);
  expect([...new Set(businesses.map((b) => b.trim()))]).toEqual([r.business]);
});
