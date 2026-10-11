import fs from "node:fs";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { ADMIN_STATE, OWNER_STATE, TRADE, ask, begin, choose, expect, record, remember, session, settled, signIn, test } from "./kit";
import { addItem, type Item } from "./shop";

/**
 * STAGE R — A PLAN IS MADE, A SHOP IS PUT ON IT, AND THREE MONTHS GO BY.
 *
 * Asked for in so many words: "create plans, create tenant, uska plan 2–3
 * month chalao, update karo, check karo process sahi chal raha — or pricing."
 *
 * Every other stage begins on a shop given the biggest plan and never looks
 * at it again. This one is about the plan: it is made on the Plans screen,
 * a shop is put on it, and that shop is walked through a quarter of paying —
 * a month paid on time, one given free, one that runs out, one paid late, an
 * add-on, a price rise, and the day it outgrows the plan.
 *
 * A calendar cannot be turned in a browser, and nothing here touches the
 * database. What it uses instead is the thing the product gives an admin for
 * exactly this — the billing window can be STATED: a shop that paid in cash
 * ten weeks ago is entered as having started ten weeks ago. So the shop is
 * created in the past and brought forward one payment at a time, and what
 * the admin's screens, the ledger and the OWNER's own screens say is read at
 * each step. (The calendar itself is turned in `AShopPaysForThreeMonthsTest`
 * on the server, which walks the same quarter with the clock moved.)
 *
 * Run with `JOURNEY_TRADE=billing`. R1 starts a NEW plan and a new shop every
 * time it runs; the cases after it resume those.
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "billing", "the plan's own stage — run with JOURNEY_TRADE=billing");

type Row = Record<string, unknown>;

// ── the calendar ─────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "1 Sep 2026" — a day as the renewal dialog writes it. */
const said = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const days = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** A month on, the way a bank adds one: 31 Jan → 28 Feb, never into March. */
function aMonthAfter(d: Date): Date {
  const last = new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate();

  return new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), last));
}

const NOW = new Date();
const TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
/** The day the shop signed up: about ten weeks ago. */
const JOINED = days(TODAY, -75);
/** Where its first paid month ended, and its second. */
const MONTH_1_ENDS = aMonthAfter(JOINED);
const MONTH_2_ENDS = aMonthAfter(MONTH_1_ENDS);

// ── the plan ─────────────────────────────────────────────────────────

const PLAN = {
  price: 3000,
  dearer: 3500,
  grace: 5,
  products: 3,
  staff: 2,
  lanes: 1,
  bills: 100,
  billsOver: 10,
  offlineDays: 2,
  /** What it includes — by the names on the form. The customer book is NOT one of them. */
  includes: ["Products", "Point of Sale (POS)", "Inventory", "Expense & Income Manager"],
  keys: ["products", "pos", "inventory", "expenses"],
} as const;

const ADD_ON = { label: "Customers & Khata", key: "customers", ownPrice: 400 } as const;
const STANDARD = 4999;

const SHELF: Item[] = [
  { key: "soap", name: "QA Soap", price: 120, cost: 100, stock: 50, effectiveTax: 0 },
  { key: "tea", name: "QA Tea", price: 450, cost: 400, stock: 20, effectiveTax: 0 },
  { key: "sugar", name: "QA Sugar", price: 180, cost: 165, stock: 40, effectiveTax: 0 },
];
const ONE_TOO_MANY: Item = { key: "rice", name: "QA Rice", price: 320, cost: 290, stock: 30, effectiveTax: 0 };

// ── asking the server the same question ──────────────────────────────

type Shop = {
  id: string;
  payment_status: string;
  subscription_state: string;
  subscription_ends_at: string | null;
  features: Record<string, boolean>;
  plan: { id: string; name: string; price: string | number } | null;
  package: { addons: string[]; bill: { total: number; addons_total: number; addons: Array<{ key: string; monthly: number }> } };
};
type Payment = { amount: string; period_start: string; period_end: string; paid_at: string; plan_name: string; method: string };

const theShop = (request: APIRequestContext) => ask<Shop>(request, "admin", `/admin/tenants/${record().tenantId}`);
/** The ledger for this shop, oldest first. */
async function ledger(request: APIRequestContext): Promise<Payment[]> {
  const rows = await ask<Payment[]>(request, "admin", `/admin/billing/payments?tenant_id=${record().tenantId}&per_page=50`);

  return [...rows].sort((a, b) => a.paid_at.localeCompare(b.paid_at));
}
const amounts = async (request: APIRequestContext) => (await ledger(request)).map((p) => Number(p.amount));
const day = (stamp: string | null) => (stamp ?? "").slice(0, 10);

// ── the Plans screen ─────────────────────────────────────────────────

/** A plan's card: the smallest box holding both its name and its Edit. */
const planCard = (page: Page, name: string): Locator =>
  page.locator("div")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Edit", exact: true }) })
    .last();

// ── the renewal dialog ───────────────────────────────────────────────

const renewal = (page: Page): Locator =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Assign / renew plan" }) });

async function openRenewal(page: Page): Promise<Locator> {
  await page.goto(`/admin/tenants/${record().tenantId}`);
  await settled(page);
  await page.getByRole("button", { name: "Assign / renew plan" }).click();
  const dialog = renewal(page);
  await expect(dialog).toBeVisible();
  // The dates it would buy are asked of the server: wait for the answer.
  await expect(dialog.getByTestId("renew-window")).toBeVisible({ timeout: 15_000 });

  return dialog;
}

async function assign(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole("button", { name: "Assign plan" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await settled(page);
}

// ─────────────────────────────────────────────────────────────────────

test.describe("the admin", () => {
  test.beforeAll(async ({ browser }) => {
    if (!fs.existsSync(`e2e/.journey/${TRADE}.json`)) begin();
    await session(browser, "admin");
  });
  test.use({ storageState: ADMIN_STATE });

  test("R1 · a plan is made on the Plans screen, and keeps every figure typed into it", async ({ page, request }) => {
    const r = begin();
    const name = `QA Corner ${r.stamp}`;

    await page.goto("/admin/plans");
    await settled(page);
    await page.getByRole("button", { name: "+ New plan" }).click();
    const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "New plan" }) });
    await expect(form).toBeVisible();

    // ── what it costs ──
    await form.getByLabel("Name *", { exact: true }).fill(name);
    await form.getByLabel("Price (Rs)", { exact: true }).fill(String(PLAN.price));
    await form.getByLabel("Billing (mo)", { exact: true }).fill("1");
    await form.getByLabel("Grace (days)", { exact: true }).fill(String(PLAN.grace));

    // ── how much it holds ──
    await form.getByRole("tab", { name: "Limits" }).click();
    await form.getByLabel("Branches", { exact: true }).fill("1");
    await form.getByLabel("Staff logins", { exact: true }).fill(String(PLAN.staff));
    await form.getByLabel("Checkout lanes", { exact: true }).fill(String(PLAN.lanes));
    await form.getByLabel("Bills a month", { exact: true }).fill(String(PLAN.bills));
    await form.getByLabel("Allowed over", { exact: true }).fill(String(PLAN.billsOver));
    await form.getByLabel("Products", { exact: true }).fill(String(PLAN.products));
    await form.getByRole("checkbox", { name: /Selling offline is included/ }).check();
    await form.getByLabel("Days a till may sell offline", { exact: true }).fill(String(PLAN.offlineDays));

    // ── what it includes: a till, a shelf and the books ──
    await form.getByRole("tab", { name: /^Modules/ }).click();
    const modules = form.getByTestId("plan-modules-editor");
    await modules.getByRole("button", { name: "Clear" }).click();
    for (const label of PLAN.includes) {
      await modules.getByRole("checkbox", { name: new RegExp(`^${label.replace(/[()&]/g, "\\$&")}`) }).check();
    }

    await form.getByRole("button", { name: "Create plan" }).click();
    await expect(form).toBeHidden({ timeout: 20_000 });
    await settled(page);

    // ── read back off the server, figure by figure ──
    const plans = await ask<Array<Row & { id: string; name: string; limits: Record<string, number | null>; modules: string[] }>>(request, "admin", "/admin/plans");
    const made = plans.find((p) => p.name === name);
    expect(made, "the plan is not on the server").toBeTruthy();
    expect(Number(made!.price)).toBe(PLAN.price);
    expect(made!.billing_period_months).toBe(1);
    expect(made!.grace_period_days).toBe(PLAN.grace);
    expect(made!.limits.products).toBe(PLAN.products);
    expect(made!.limits.staff).toBe(PLAN.staff);
    expect(made!.limits.registers).toBe(PLAN.lanes);
    expect(made!.limits.branches).toBe(1);
    expect(made!.limits.orders_month).toBe(PLAN.bills);
    // The three boxes that used to save nothing.
    expect(made!.grace_orders_month, "the bills a shop may run over were typed and not kept").toBe(PLAN.billsOver);
    expect(made!.limits.offline_selling, "selling offline was ticked and not kept").toBe(1);
    expect(made!.limits.offline_days, "the days a till may sell offline were typed and not kept").toBe(PLAN.offlineDays);
    expect([...made!.modules].sort(), "the plan includes something that was not ticked, or not what was").toEqual([...PLAN.keys].sort());

    // ── and off the card the screen draws for it ──
    const card = planCard(page, name);
    await expect(card).toContainText(`Rs ${PLAN.price.toLocaleString()}`);
    await expect(card).toContainText(`+${PLAN.billsOver} over`);
    await expect(card).toContainText(`Up to ${PLAN.offlineDays} days`);

    remember({ planId: made!.id, planName: name });
  });

  test("R2 · opened again, the form still holds what was typed", async ({ page }) => {
    const r = record();

    await page.goto("/admin/plans");
    await settled(page);
    await planCard(page, String(r.planName)).getByRole("button", { name: "Edit", exact: true }).click();
    const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Edit ${r.planName}` }) });
    await expect(form).toBeVisible();

    await expect(form.getByLabel("Price (Rs)", { exact: true })).toHaveValue(String(PLAN.price));
    await form.getByRole("tab", { name: "Limits" }).click();
    await expect(form.getByLabel("Allowed over", { exact: true })).toHaveValue(String(PLAN.billsOver));
    await expect(form.getByRole("checkbox", { name: /Selling offline is included/ })).toBeChecked();
    await expect(form.getByLabel("Days a till may sell offline", { exact: true })).toHaveValue(String(PLAN.offlineDays));
    await expect(form.getByLabel("Products", { exact: true })).toHaveValue(String(PLAN.products));
    await form.getByRole("button", { name: "Cancel" }).click();
  });

  test("R3 · a shop is put on it — entered as having joined ten weeks ago, and paid for its first month", async ({ page, request }) => {
    const r = record();

    await page.goto("/admin/tenants/new");
    await expect(page.getByRole("heading", { name: "Create a business" })).toBeVisible();

    await page.getByLabel("Business name *", { exact: true }).fill(r.business);
    await page.getByLabel("Business type *", { exact: true }).selectOption({ label: "Mart & Grocery" });
    await page.getByLabel("Email", { exact: true }).fill(`shop-${r.stamp}@qa.test`);
    await page.getByLabel("Phone", { exact: true }).fill(r.phone);
    await page.getByLabel("City", { exact: true }).selectOption({ label: "Lahore" });

    await choose(page.getByLabel("Plan *", { exact: true }), new RegExp(`^${r.planName}`));

    // The window, stated: it started the day they signed up. The end is left
    // for the plan to work out — one month on.
    await page.getByLabel("From", { exact: true }).fill(iso(JOINED));
    await page.getByLabel("Amount", { exact: true }).fill(String(PLAN.price));
    await page.getByLabel("Reference", { exact: true }).fill(`R-${r.stamp}-1`);
    await page.getByLabel("Paid on", { exact: true }).fill(iso(JOINED));

    await page.getByLabel("Owner name *", { exact: true }).fill(r.ownerName);
    await page.getByLabel("Owner email *", { exact: true }).fill(r.ownerEmail);
    await page.getByLabel("Temp password *", { exact: true }).fill(r.ownerPassword);

    // Exactly what the plan includes, and nothing past it: every switch on
    // the form is put where this shop should have it.
    const switches = page.getByRole("switch");
    await expect.poll(async () => switches.count()).toBeGreaterThan(3);
    for (let i = 0; i < (await switches.count()); i++) {
      const one = switches.nth(i);
      const wanted = (PLAN.includes as readonly string[]).includes((await one.getAttribute("aria-label")) ?? "");
      if (((await one.getAttribute("aria-checked")) === "true") !== wanted) await one.click();
    }
    // One switch can bring another with it; the second pass settles it.
    for (let i = 0; i < (await switches.count()); i++) {
      const one = switches.nth(i);
      const label = (await one.getAttribute("aria-label")) ?? "";
      const wanted = (PLAN.includes as readonly string[]).includes(label);
      expect((await one.getAttribute("aria-checked")) === "true", `${label} would not stay ${wanted ? "on" : "off"}`).toBe(wanted);
    }

    const create = page.getByRole("button", { name: "Create business" });
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page).not.toHaveURL(/\/tenants\/new/, { timeout: 30_000 });

    const found = await ask<Array<{ id: string; business_name: string }>>(request, "admin", `/admin/tenants?search=${encodeURIComponent(r.business)}&per_page=50`);
    const mine = found.find((t) => t.business_name === r.business);
    expect(mine, "the server has no such business").toBeTruthy();
    remember({ tenantId: mine!.id });

    const shop = await theShop(request);
    expect(Object.entries(shop.features).filter(([, on]) => on).map(([key]) => key).sort(), "the shop was given modules nobody switched on").toEqual([...PLAN.keys].sort());
    expect(shop.package.addons, "a shop with exactly what its plan includes has an add-on").toEqual([]);
    expect(shop.package.bill.total).toBe(PLAN.price);
    // One month from the day it joined — which was six weeks ago, grace and all.
    expect(day(shop.subscription_ends_at)).toBe(iso(MONTH_1_ENDS));
    expect(shop.subscription_state).toBe("read_only");
    expect(shop.payment_status).toBe("unpaid");

    // The one payment that was typed, for the month it bought, on the day it was paid.
    const paid = await ledger(request);
    expect(paid).toHaveLength(1);
    expect(Number(paid[0].amount)).toBe(PLAN.price);
    expect([paid[0].period_start, paid[0].period_end, day(paid[0].paid_at)]).toEqual([iso(JOINED), iso(MONTH_1_ENDS), iso(JOINED)]);
  });

  test("R4 · its second month is recorded for the dates it covered — and the dialog says what it will buy before it is saved", async ({ page, request }) => {
    const r = record();
    const dialog = await openRenewal(page);
    const buys = dialog.getByTestId("renew-window");

    // Left alone, a shop whose grace ran out starts again today.
    await expect(buys).toContainText(`This buys ${said(TODAY)} → ${said(aMonthAfter(TODAY))}.`);
    await expect(buys).toContainText(`Its grace ran out on ${said(days(MONTH_1_ENDS, PLAN.grace))}`);
    await expect(buys).toContainText("the new period starts today");

    // But this payment is for the month that followed the first.
    await dialog.getByLabel("From", { exact: true }).fill(iso(MONTH_1_ENDS));
    await dialog.getByLabel("To", { exact: true }).fill(iso(MONTH_2_ENDS));
    await expect(buys).toContainText(`This buys ${said(MONTH_1_ENDS)} → ${said(MONTH_2_ENDS)}.`);
    await expect(buys).toContainText("These are the dates you typed.");

    // What it owes is said under the box, and one press types it.
    const due = dialog.getByTestId("renew-due");
    await expect(due).toContainText(`${r.planName} is Rs ${PLAN.price.toLocaleString()}, and this shop has no paid add-ons.`);
    await due.getByRole("button", { name: `Use Rs ${PLAN.price.toLocaleString()}` }).click();
    await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue(String(PLAN.price));
    await dialog.getByLabel("Reference (optional)", { exact: true }).fill(`R-${r.stamp}-2`);
    await dialog.getByLabel("Paid on", { exact: true }).fill(iso(days(MONTH_1_ENDS, 2)));
    await assign(page, dialog);

    const paid = await ledger(request);
    expect(paid.map((p) => Number(p.amount))).toEqual([PLAN.price, PLAN.price]);
    expect([paid[1].period_start, paid[1].period_end, day(paid[1].paid_at)]).toEqual([iso(MONTH_1_ENDS), iso(MONTH_2_ENDS), iso(days(MONTH_1_ENDS, 2))]);
    expect(day((await theShop(request)).subscription_ends_at)).toBe(iso(MONTH_2_ENDS));
  });

  test("R5 · a stretch given free — the amount left blank — is not a rupee in the ledger", async ({ page, request }) => {
    const dialog = await openRenewal(page);

    // From where its second month ended to three days from now: time to
    // find its feet, on the house.
    await dialog.getByLabel("From", { exact: true }).fill(iso(MONTH_2_ENDS));
    await dialog.getByLabel("To", { exact: true }).fill(iso(days(TODAY, 3)));
    await expect(dialog.getByTestId("renew-window")).toContainText(`This buys ${said(MONTH_2_ENDS)} → ${said(days(TODAY, 3))}.`);
    await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("");
    await assign(page, dialog);

    // The form says "leave amount blank for a free/complimentary assignment".
    // It used to be written into the ledger at the plan's full price.
    expect(await amounts(request), "a month given free was booked as money collected").toEqual([PLAN.price, PLAN.price]);

    const shop = await theShop(request);
    expect(day(shop.subscription_ends_at)).toBe(iso(days(TODAY, 3)));
    expect(shop.subscription_state).toBe("active");
    expect(shop.payment_status).toBe("paid");
  });
});

// ── the owner's side of the same thing ───────────────────────────────

/** One small write, the same one each time: a category added from its own screen. */
async function addACategory(page: Page, name: string): Promise<void> {
  await page.goto("/tenant/categories");
  await settled(page);
  await page.getByPlaceholder("Category name").fill(name);
  await page.getByRole("button", { name: "Add category" }).click();
}

/** The admin states where the shop's period stands, and takes no money for it. */
async function theWindowIs(page: Page, from: Date, to: Date): Promise<void> {
  const dialog = await openRenewal(page);
  await dialog.getByLabel("From", { exact: true }).fill(iso(from));
  await dialog.getByLabel("To", { exact: true }).fill(iso(to));
  await expect(dialog.getByTestId("renew-window")).toContainText(`This buys ${said(from)} → ${said(to)}.`);
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("");
  await assign(page, dialog);
}

test.describe("the owner's first morning", () => {
  // Nobody has been inside it: this is the first time this password is typed.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("R6 · the owner signs in: the plan, the price, the renewal date and both payments are on its own screen", async ({ page, request }) => {
    const r = record();

    await signIn(page, r.ownerEmail, r.ownerPassword, /\/tenant/);
    await settled(page);
    // Asked where the shop is, the first time anybody walks in. (A case
    // lived twice finds that already answered.)
    if (/\/tenant\/setup/.test(page.url())) {
      const city = page.getByLabel("City *", { exact: true });
      await expect.poll(async () => city.locator("option:not([disabled])").count()).toBeGreaterThan(0);
      await city.selectOption({ label: "Lahore" });
      await page.getByRole("button", { name: "Finish setup" }).click();
      await expect(page).not.toHaveURL(/\/tenant\/setup/, { timeout: 30_000 });
      await settled(page);
    }
    await page.context().storageState({ path: OWNER_STATE });
    expect(fs.existsSync(OWNER_STATE)).toBe(true);

    await page.goto("/tenant/subscription");
    await settled(page);
    await expect(page.getByRole("heading", { name: "Subscription", level: 1 })).toBeVisible();
    const main = page.locator("body");
    await expect(main).toContainText(String(r.planName));
    await expect(main).toContainText(`Rs ${PLAN.price.toLocaleString()} every month`);
    // Three days left: said, because it is close enough to matter.
    await expect(main).toContainText("Renews in 3 days");
    await expect(main).toContainText(`${PLAN.grace} days of grace`);
    // What was paid — two payments, and nothing for the stretch given free.
    await expect(main).toContainText("Your last 2 payments");

    const told = await ask<{ state: string; payments: Array<{ amount: string }>; plan: { price: string } }>(request, "owner", "/shop/subscription");
    expect(told.state).toBe("active");
    expect(told.payments.map((p) => Number(p.amount))).toEqual([PLAN.price, PLAN.price]);
  });
});

test.describe("the shop, while its plan is running", () => {
  test.beforeAll(async ({ browser }) => {
    await session(browser, "owner");
  });
  test.use({ storageState: OWNER_STATE });

  test("R7 · the shelf takes the three products the plan holds — and the fourth is refused at three, by name", async ({ page, request, watch }) => {
    test.setTimeout(240_000);

    for (const item of SHELF) await addItem(page, item);
    expect((await ask<Row[]>(request, "owner", "/products?per_page=50")).length).toBe(SHELF.length);

    // The fourth. Refused by the plan's own number, said in words.
    watch.expect(/LIMIT_REACHED/);
    await page.goto("/tenant/products/new");
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add item" }) });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.getByLabel("Name *", { exact: true }).fill(ONE_TOO_MANY.name);
    await dialog.getByLabel("Price *", { exact: true }).fill(String(ONE_TOO_MANY.price));
    const description = dialog.getByLabel("Description *", { exact: true });
    if (await description.isVisible().catch(() => false)) await description.fill("One more than the plan holds.");
    await dialog.getByRole("button", { name: "Create item" }).click();
    await expect(page.getByText(`You've reached your limit of ${PLAN.products} products`).first()).toBeVisible({ timeout: 15_000 });
    expect((await ask<Row[]>(request, "owner", "/products?per_page=50")).length, "a product past the plan's ceiling was saved").toBe(SHELF.length);
  });
});

test.describe("the month runs out", () => {
  test.beforeAll(async ({ browser }) => {
    await session(browser, "admin");
  });
  test.use({ storageState: ADMIN_STATE });

  test("R8 · two days past the end: the admin's list says grace, and when it stops", async ({ page, request }) => {
    const r = record();

    // The period is put where it would stand had nobody paid: ended two days ago.
    await theWindowIs(page, days(TODAY, -32), days(TODAY, -2));

    const shop = await theShop(request);
    expect(shop.subscription_state).toBe("grace");
    expect(shop.payment_status).toBe("grace");
    // Restating the window took no money: the ledger is as it was.
    expect(await amounts(request)).toEqual([PLAN.price, PLAN.price]);

    await page.goto("/admin/tenants");
    await settled(page);
    await page.getByPlaceholder(/search/i).first().fill(r.business);
    const row = page.getByRole("row").filter({ hasText: r.business });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(/grace/i);
  });
});

test.describe("the shop, in its grace days", () => {
  test.beforeAll(async ({ browser }) => {
    await session(browser, "owner");
  });
  test.use({ storageState: OWNER_STATE });

  test("R9 · the owner is told payment is overdue and by when — and the shop still works", async ({ page, request }) => {
    await page.goto("/tenant/subscription");
    await settled(page);
    const main = page.locator("body");
    await expect(main).toContainText("Payment is overdue");
    // Five days of grace from two days ago: three left.
    await expect(main).toContainText("in 3 days");
    await expect(main).toContainText("Your data is safe either way.");
    await expect(main).toContainText("Ran out");

    await addACategory(page, "QA In Grace");
    await expect(page.getByText("QA In Grace").first()).toBeVisible({ timeout: 15_000 });
    const made = await ask<Array<{ name: string }>>(request, "owner", "/categories");
    expect(made.map((c) => c.name)).toContain("QA In Grace");
  });
});

test.describe("grace is spent", () => {
  test.beforeAll(async ({ browser }) => {
    await session(browser, "admin");
  });
  test.use({ storageState: ADMIN_STATE });

  test("R10 · ten days past the end: unpaid on the admin's list", async ({ page, request }) => {
    const r = record();

    await theWindowIs(page, days(TODAY, -40), days(TODAY, -10));

    const shop = await theShop(request);
    expect(shop.subscription_state).toBe("read_only");
    expect(shop.payment_status).toBe("unpaid");

    await page.goto("/admin/tenants");
    await settled(page);
    await page.getByPlaceholder(/search/i).first().fill(r.business);
    const row = page.getByRole("row").filter({ hasText: r.business });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(/unpaid/i);
  });
});

test.describe("the shop, read-only", () => {
  test.beforeAll(async ({ browser }) => {
    await session(browser, "owner");
  });
  test.use({ storageState: OWNER_STATE });

  test("R11 · everything can be read, nothing can be written — and the refusal says why", async ({ page, request, watch }) => {
    await page.goto("/tenant/subscription");
    await settled(page);
    const main = page.locator("body");
    await expect(main).toContainText("Your subscription has run out");
    await expect(main).toContainText("Contact support to renew and it comes straight back on.");

    // Its books are still its own: the shelf is all there.
    await page.goto("/tenant/products");
    for (const item of SHELF) await expect(page.getByRole("row").filter({ hasText: item.name }).first()).toBeVisible({ timeout: 20_000 });

    // A write is refused, in words a shopkeeper can act on.
    watch.expect(/SUBSCRIPTION_EXPIRED/);
    await addACategory(page, "QA Read Only");
    await expect(page.getByText(/Your subscription has expired\. Your data is safe — renew to continue making changes\./).first()).toBeVisible({ timeout: 15_000 });
    const held = await ask<Array<{ name: string }>>(request, "owner", "/categories");
    expect(held.map((c) => c.name), "a read-only shop wrote something").not.toContain("QA Read Only");
  });
});

// ── it pays, takes an add-on, and outgrows the plan ──────────────────

test.describe("the admin takes the money", () => {
  test.beforeAll(async ({ browser }) => {
    await session(browser, "admin");
  });
  test.use({ storageState: ADMIN_STATE });

  test("R12 · it pays, late: the dialog says the month starts today, and why", async ({ page, request }) => {
    const r = record();
    const dialog = await openRenewal(page);
    const buys = dialog.getByTestId("renew-window");

    await expect(buys).toContainText(`This buys ${said(TODAY)} → ${said(aMonthAfter(TODAY))}.`);
    // Grace ran out five days after the period ended ten days ago.
    await expect(buys).toContainText(`Its grace ran out on ${said(days(TODAY, -10 + PLAN.grace))} and it has been read-only since, so the new period starts today.`);

    await dialog.getByTestId("renew-due").getByRole("button", { name: `Use Rs ${PLAN.price.toLocaleString()}` }).click();
    await dialog.getByLabel("Reference (optional)", { exact: true }).fill(`R-${r.stamp}-3`);
    await assign(page, dialog);

    const shop = await theShop(request);
    expect(shop.subscription_state).toBe("active");
    expect(shop.payment_status).toBe("paid");
    expect(day(shop.subscription_ends_at)).toBe(iso(aMonthAfter(TODAY)));

    const paid = await ledger(request);
    expect(paid.map((p) => Number(p.amount))).toEqual([PLAN.price, PLAN.price, PLAN.price]);
    expect([paid[2].period_start, paid[2].period_end, day(paid[2].paid_at)]).toEqual([iso(TODAY), iso(aMonthAfter(TODAY)), iso(TODAY)]);
  });

  test("R13 · it asks for the customer book: switched on at its own price, it is on the bill at once", async ({ page, request }) => {
    await page.goto(`/admin/tenants/${record().tenantId}`);
    await settled(page);

    const book = page.getByRole("switch", { name: ADD_ON.label, exact: true });
    await expect(book).toHaveAttribute("aria-checked", "false");
    await book.click();
    await expect(book).toHaveAttribute("aria-checked", "true");
    await page.getByLabel(`${ADD_ON.label}: this shop's own price a month`).fill(String(ADD_ON.ownPrice));
    await page.getByRole("button", { name: "Save modules" }).click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 15_000 });
    await settled(page);

    // The bill, on the shop's page: the plan, the add-on, and their sum.
    const bill = page.getByTestId("shop-bill");
    await expect(bill).toContainText(`Rs ${PLAN.price.toLocaleString()}`);
    await expect(bill).toContainText(ADD_ON.label);
    await expect(bill).toContainText(`Rs ${ADD_ON.ownPrice}`);
    await expect(bill).toContainText(`Rs ${(PLAN.price + ADD_ON.ownPrice).toLocaleString()}`);
    await expect(bill).toContainText("Due a month");

    const shop = await theShop(request);
    expect(shop.package.addons).toEqual([ADD_ON.key]);
    expect(shop.package.bill.total).toBe(PLAN.price + ADD_ON.ownPrice);
    expect(shop.plan?.name, "an add-on moved the shop off its plan").toBe(record().planName);
    // Nothing is charged for it until the next period: the ledger has not moved.
    expect(await amounts(request)).toEqual([PLAN.price, PLAN.price, PLAN.price]);
  });

  test("R14 · the next month is paid early, add-on and all — and carries on from where the paid month ends", async ({ page, request }) => {
    const r = record();
    const dialog = await openRenewal(page);
    const owes = PLAN.price + ADD_ON.ownPrice;
    const next = aMonthAfter(TODAY);

    // Still running: the month it buys starts where this one ends.
    const buys = dialog.getByTestId("renew-window");
    await expect(buys).toContainText(`This buys ${said(next)} → ${said(aMonthAfter(next))}.`);
    await expect(buys).toContainText(`It carries on from ${said(next)}, so no paid day is lost.`);

    // The figure offered is the whole bill, said as a sum.
    const due = dialog.getByTestId("renew-due");
    await expect(due).toContainText(`Rs ${PLAN.price.toLocaleString()} plan + Rs ${ADD_ON.ownPrice} for 1 add-on = Rs ${owes.toLocaleString()}.`);
    await due.getByRole("button", { name: `Use Rs ${owes.toLocaleString()}` }).click();
    await dialog.getByLabel("Method", { exact: true }).selectOption({ label: "Bank transfer" });
    await dialog.getByLabel("Reference (optional)", { exact: true }).fill(`R-${r.stamp}-4`);
    await assign(page, dialog);

    const paid = await ledger(request);
    expect(paid.map((p) => Number(p.amount))).toEqual([PLAN.price, PLAN.price, PLAN.price, owes]);
    const last = paid.find((p) => Number(p.amount) === owes)!;
    expect([last.period_start, last.period_end, last.method]).toEqual([iso(next), iso(aMonthAfter(next)), "bank_transfer"]);
    expect(day((await theShop(request)).subscription_ends_at)).toBe(iso(aMonthAfter(next)));
  });

  test("R15 · the plan's price goes up: the next bill moves, and what was paid does not", async ({ page, request }) => {
    const r = record();

    await page.goto("/admin/plans");
    await settled(page);
    await planCard(page, String(r.planName)).getByRole("button", { name: "Edit", exact: true }).click();
    const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Edit ${r.planName}` }) });
    await form.getByLabel("Price (Rs)", { exact: true }).fill(String(PLAN.dearer));
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(form).toBeHidden({ timeout: 20_000 });
    await expect(planCard(page, String(r.planName))).toContainText(`Rs ${PLAN.dearer.toLocaleString()}`);
    // One business is on it — said on the card, so nobody reprices blind.
    await expect(planCard(page, String(r.planName))).toContainText("1 businesses");

    await page.goto(`/admin/tenants/${r.tenantId}`);
    await settled(page);
    await expect(page.getByTestId("shop-bill")).toContainText(`Rs ${(PLAN.dearer + ADD_ON.ownPrice).toLocaleString()}`);

    expect((await theShop(request)).package.bill.total).toBe(PLAN.dearer + ADD_ON.ownPrice);
    expect(await amounts(request), "a price change rewrote what was already paid").toEqual([PLAN.price, PLAN.price, PLAN.price, PLAN.price + ADD_ON.ownPrice]);
  });
});

test.describe("the shop, paid up", () => {
  test.beforeAll(async ({ browser }) => {
    await session(browser, "owner");
  });
  test.use({ storageState: OWNER_STATE });

  test("R16 · the owner's screen says what it actually pays — the plan AND the add-on — and the shop works again", async ({ page, request }) => {
    const r = record();

    await page.goto("/tenant/subscription");
    await settled(page);
    const body = page.locator("body");
    await expect(body).not.toContainText("Your subscription has run out");
    await expect(body).toContainText(String(r.planName));
    await expect(body).toContainText(`Rs ${PLAN.dearer.toLocaleString()} every month`);

    // It used to stop there, at the plan's price, for a shop that pays more.
    const pays = page.getByTestId("what-you-pay");
    await expect(pays).toContainText(`Your plan`);
    await expect(pays).toContainText(`${ADD_ON.label} — added for your shop`);
    await expect(pays).toContainText(`Rs ${ADD_ON.ownPrice}`);
    await expect(pays).toContainText(`You pay every month`);
    await expect(pays).toContainText(`Rs ${(PLAN.dearer + ADD_ON.ownPrice).toLocaleString()}`);

    await expect(body).toContainText("Your last 4 payments");
    const told = await ask<{ payments: Array<{ amount: string }>; bill: { total: number } }>(request, "owner", "/shop/subscription");
    expect(told.bill.total).toBe(PLAN.dearer + ADD_ON.ownPrice);
    expect(told.payments.map((p) => Number(p.amount)).sort((a, b) => a - b)).toEqual([PLAN.price, PLAN.price, PLAN.price, PLAN.price + ADD_ON.ownPrice]);

    // ONE SHOP, AND NO GODOWN. Its plan would allow a warehouse and two more
    // branches; it has neither, so nothing about "which place" is drawn — no
    // stock by place, no transfers, no branch to switch to. The screen where
    // a second place would be ADDED is there, in Full view.
    await page.getByRole("button", { name: /^(Full view|Switch to full view)$/ }).click();
    const rail = page.locator("aside").first().locator("nav");
    await expect(rail.locator('a[href="/tenant/inventory"]')).toHaveCount(1);
    await expect(rail.locator('a[href="/tenant/branches"]'), "a shop that may add a place has nowhere to add it").toHaveCount(1);
    await expect(rail.locator('a[href="/tenant/stock-by-place"]'), "a one-shop business is shown Stock by place").toHaveCount(0);
    await expect(rail.locator('a[href="/tenant/transfers"]'), "a one-shop business is shown Stock transfers").toHaveCount(0);
    await expect(page.getByTestId("branch-switcher")).toHaveCount(0);
    const settings = await ask<{ places: { shops: number; warehouses: number } }>(request, "owner", "/shop/settings");
    expect(settings.places).toEqual({ shops: 1, warehouses: 0 });
    await page.getByRole("button", { name: /^(Simple|Switch to simple menu)$/ }).click();

    // The customer book it asked for is on its menu, and opens.
    await page.goto("/tenant/customers");
    await expect(page.getByRole("heading", { name: "Customers", level: 1 })).toBeVisible({ timeout: 20_000 });

    // And it can write again — the category refused while it was read-only goes in.
    await addACategory(page, "QA Read Only");
    await expect(page.getByText("QA Read Only").first()).toBeVisible({ timeout: 15_000 });
    expect((await ask<Array<{ name: string }>>(request, "owner", "/categories")).map((c) => c.name)).toContain("QA Read Only");
  });
});

test.describe("it outgrows the plan", () => {
  test.beforeAll(async ({ browser }) => {
    await session(browser, "admin");
  });
  test.use({ storageState: ADMIN_STATE });

  test("R17 · moved to Standard: the dialog says what changes, and what is given up", async ({ page, request }) => {
    const r = record();
    const dialog = await openRenewal(page);
    const paidTo = aMonthAfter(aMonthAfter(TODAY));

    await choose(dialog.getByLabel("Plan", { exact: true }), /^Standard/);

    // A different plan is a new period from today — and it says what is left behind.
    const buys = dialog.getByTestId("renew-window");
    await expect(buys).toContainText(`This buys ${said(TODAY)} → ${said(aMonthAfter(TODAY))}.`);
    await expect(buys).toContainText("A different plan starts a new period today.");
    await expect(buys).toContainText(`What is left of the current one (to ${said(paidTo)}) is not carried over`);

    // What moving does to this shop: the ceiling it kept meeting goes.
    await expect(dialog).toContainText(/products/i);
    await expect(dialog).toContainText("10,000");

    const due = dialog.getByTestId("renew-due");
    await expect(due).toContainText(`Standard is Rs ${STANDARD.toLocaleString()}.`);
    await due.getByRole("button", { name: `Use Rs ${STANDARD.toLocaleString()}` }).click();
    await dialog.getByLabel("Reference (optional)", { exact: true }).fill(`R-${r.stamp}-5`);
    await assign(page, dialog);

    const shop = await theShop(request);
    expect(shop.plan?.name).toBe("Standard");
    expect(day(shop.subscription_ends_at)).toBe(iso(aMonthAfter(TODAY)));
    // Modules are the shop's, not the plan's: moving took nothing away.
    for (const key of [...PLAN.keys, ADD_ON.key]) expect(shop.features[key], `${key} was switched off by a plan change`).toBe(true);

    // The bill on the page is the bill on the server, whatever Standard includes.
    await page.goto(`/admin/tenants/${r.tenantId}`);
    await settled(page);
    await expect(page.getByTestId("shop-bill")).toContainText(`Rs ${Math.round(shop.package.bill.total).toLocaleString()}`);
    expect(shop.package.bill.total).toBe(STANDARD + shop.package.bill.addons_total);

    expect(await amounts(request)).toEqual([PLAN.price, PLAN.price, PLAN.price, PLAN.price + ADD_ON.ownPrice, STANDARD]);
  });

  test("R18 · Billing & Payments: its five payments, and a total that is their sum", async ({ page, request }) => {
    const r = record();
    const all = [PLAN.price, PLAN.price, PLAN.price, PLAN.price + ADD_ON.ownPrice, STANDARD];
    const sum = all.reduce((a, b) => a + b, 0);

    expect(await amounts(request)).toEqual(all);

    // On the screen: found by the shop's name. The ledger follows the page's
    // period — this month — so it holds the three payments made today…
    await page.goto("/admin/payments");
    await settled(page);
    await page.getByPlaceholder(/search/i).first().fill(r.business);
    const rows = page.getByRole("row").filter({ hasText: r.business });
    await expect(rows).toHaveCount(3, { timeout: 20_000 });

    // …and says so, with the way to the rest: every date.
    await expect(page.locator("body")).toContainText("Following the period above");
    // The LEDGER's own date control — the one at the head of the page moves
    // the whole page, and is never "all time".
    await page.getByRole("button", { name: /^\d+ – \d+ [A-Z][a-z]{2}/ }).last().click();
    await page.getByRole("option", { name: "All time", exact: true }).click();
    await expect(rows).toHaveCount(all.length, { timeout: 20_000 });
    await expect(page.locator("body")).toContainText(`Rs ${sum.toLocaleString()}`);
  });

  test("R19 · the plan nobody is on any more is removed — and the ledger still names it", async ({ page, request }) => {
    const r = record();

    await page.goto("/admin/plans");
    await settled(page);
    const card = planCard(page, String(r.planName));
    await expect(card).toContainText("0 businesses");
    await card.getByRole("button", { name: "Delete", exact: true }).click();
    const sure = page.getByRole("dialog").last();
    await sure.getByRole("button", { name: /delete/i }).click();
    await expect(page.getByRole("heading", { name: String(r.planName), exact: true })).toHaveCount(0, { timeout: 20_000 });

    const plans = await ask<Array<{ name: string }>>(request, "admin", "/admin/plans");
    expect(plans.map((p) => p.name)).not.toContain(r.planName);
    // What was paid on it was paid on it.
    expect((await ledger(request)).filter((p) => p.plan_name === r.planName)).toHaveLength(4);
  });
});

