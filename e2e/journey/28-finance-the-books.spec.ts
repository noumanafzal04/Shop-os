import fs from "node:fs";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { ADMIN_STATE, OWNER_STATE, TRADE, TRADE_LABEL, ask, begin, choose, expect, record, remember, rupees, session, settled, signIn, test } from "./kit";

/**
 * STAGE Q — AN OFFICE THAT ONLY KEEPS ITS BOOKS.
 *
 * Every other trade's stage begins on a shop the admin gave EVERYTHING to.
 * This one cannot: what a Finance Manager bought is the expense and income
 * books and nothing else — no shelf, no till, no customers at a counter. The
 * subject of the stage is as much what is NOT there as what is. So it makes
 * its own business, the way the admin would for such a customer, and lives
 * two days of a small software house's money in it:
 *
 *   yesterday   a client pays an invoice; the salaries go out; the rent,
 *               which comes round every month, falls due
 *   today       two more payments in (one of them in notes), the electricity
 *               and the internet out, and a billboard that takes Marketing
 *               past the ceiling set for it
 *
 * Every figure below is worked out here from that list, never read back.
 *
 * Run with `JOURNEY_TRADE=finance`. Q1 starts a NEW business every time it
 * runs; the cases after it resume that one.
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "finance", "the books-only stage — run with JOURNEY_TRADE=finance");

type Row = Record<string, unknown>;

// ── the two days ─────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const NOW = new Date();
const TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
const YESTERDAY = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - 1);
const D0 = iso(TODAY);
const D1 = iso(YESTERDAY);
/** Run on the 1st, yesterday is last month's — and this month's figures leave it out. */
const YESTERDAY_IS_THIS_MONTH = YESTERDAY.getMonth() === TODAY.getMonth();
/** "10 Oct" — a day as the panel writes it. */
const dayLabel = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
/** A month on from a date, never spilling into the month after (31 Jan → 28 Feb). */
function aMonthAfter(d: Date): Date {
  const last = new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate();

  return new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), last));
}

// ── the money ────────────────────────────────────────────────────────

const INCOME = [
  { on: D1, category: "Client Payments", description: "Invoice 114 — Al-Noor Textiles", amount: 450_000, by: "Bank transfer", reference: "INV-114" },
  { on: D0, category: "Service Fees", description: "Support retainer — Karachi Cables", amount: 120_000, by: "Bank transfer", reference: "INV-115" },
  { on: D0, category: "Client Payments", description: "Invoice 116 — Sialkot Sports", amount: 80_000, by: "Cash", reference: "INV-116" },
] as const;

const BILLS = [
  { on: D1, category: "Salary", description: "Salaries — last month", amount: 240_000, by: "Bank transfer", reference: "PAY-09" },
  { on: D0, category: "Electricity", description: "LESCO bill", amount: 18_400, by: "Cash", reference: "LESCO-0925" },
  { on: D0, category: "Internet", description: "Fibre line", amount: 6_500, by: "Bank transfer", reference: "NET-10" },
] as const;

/** Comes round every month. The usual figure is not what the landlord asked for this time. */
const RENT = { category: "Rent", description: "Office rent", usual: 80_000, actual: 85_000, dueOn: D1 } as const;
/** Takes Marketing past its ceiling. */
const BILLBOARD = { on: D0, category: "Marketing", description: "Billboard, Ferozepur Road", amount: 26_500, by: "Bank transfer", ceiling: 20_000 } as const;

const sum = (rows: ReadonlyArray<{ amount: number }>) => rows.reduce((s, r) => s + r.amount, 0);
const on = <T extends { on: string }>(rows: readonly T[], day: string) => rows.filter((r) => r.on === day);

// Yesterday: 450,000 in; salaries 240,000 and the rent 85,000 out.
const Y_IN = sum(on(INCOME, D1)); // 450,000
const Y_OUT = sum(on(BILLS, D1)) + RENT.actual; // 325,000
const Y_NET = Y_IN - Y_OUT; // 125,000
// Today: 200,000 in; 18,400 + 6,500 + the billboard 26,500 out.
const T_IN = sum(on(INCOME, D0)); // 200,000
const T_OUT = sum(on(BILLS, D0)) + BILLBOARD.amount; // 51,400
const T_NET = T_IN - T_OUT; // 148,600
const ALL_NET = Y_NET + T_NET; // 273,600
// This month, as every screen that says "this month" must have it.
const M_IN = T_IN + (YESTERDAY_IS_THIS_MONTH ? Y_IN : 0);
const M_OUT = T_OUT + (YESTERDAY_IS_THIS_MONTH ? Y_OUT : 0);
const OVER_BY = BILLBOARD.amount - BILLBOARD.ceiling; // 6,500

/** What this trade is sold with, and the one thing it may add. */
const OFFERED = ["Expense & Income Manager", "Basic HR"] as const;
/** Things a books-only business must never be handed. */
const NOT_BOUGHT = ["products", "services", "pos", "inventory", "purchasing", "customers", "marketplace", "delivery", "dine_in", "kitchen", "fuel"] as const;
/** Its whole menu, in Full view, in order. */
const ITS_SCREENS = [
  "/tenant", "/tenant/cashbook", "/tenant/ledger", "/tenant/income", "/tenant/expenses",
  "/tenant/reports", "/tenant/staff", "/tenant/activity", "/tenant/subscription", "/tenant/settings", "/tenant/help",
];
/** Screens it did not buy — typed, as from an old bookmark. */
const NOT_ITS_SCREENS = ["/tenant/pos", "/tenant/products", "/tenant/inventory", "/tenant/customers", "/tenant/sales", "/tenant/sales/new", "/tenant/day", "/tenant/purchases"];
/** Words that are true of a shop with a till and of nobody else. */
const SHOP_WORDS = /\btill\b|drawer|\bshift\b|\bPOS\b|ring a sale|your shop\b|the shop\b/i;

// ── reading the screen ───────────────────────────────────────────────

/**
 * The amount printed with a label — "Money in", "Opening balance" — wherever
 * the label sits relative to its figure. NaN when nothing is so labelled.
 */
async function near(scope: Page | Locator, label: string): Promise<number> {
  const root = "locator" in scope && "goto" in scope ? (scope as Page).locator("body") : (scope as Locator);
  const text = await root.evaluate((el, wanted) => {
    const leaf = [...el.querySelectorAll("*")].find(
      (n) => n.children.length === 0 && (n.textContent ?? "").trim().toLowerCase() === wanted.toLowerCase(),
    );
    if (!leaf) return null;

    let box: Element | null = leaf;
    while (box && !/Rs\s?-?\s?[\d,]/.test(box.textContent ?? "")) box = box.parentElement;

    return box ? (box as HTMLElement).innerText : null;
  }, label);
  // NaN, not a failure, when the label is not on the page yet: a figure that
  // is polled for has to be allowed to arrive.
  return text === null ? Number.NaN : rupees(text.replace(/Rs\s?-\s?/g, "-"));
}

const status = (page: Page) => page.getByTestId("shop-status");
const tab = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}(\\s*\\d+)?$`) });
const dialogOf = (page: Page, title: string) => page.getByRole("dialog", { name: title });
const held = async (request: APIRequestContext, path: string) => ask<Row[]>(request, "owner", `${path}?per_page=100`);

/** File one entry through its form. Leaves the form open for the caller to judge what it said. */
async function fill(form: Locator, e: { category: string; description: string; amount: number; on: string; by: string; reference?: string }, byLabel: string, refLabel: string) {
  await form.getByLabel("Category *", { exact: true }).selectOption({ label: e.category });
  await form.getByLabel("Description *", { exact: true }).fill(e.description);
  await form.getByLabel("Amount *", { exact: true }).fill(String(e.amount));
  await form.getByLabel("Date *", { exact: true }).fill(e.on);
  await form.getByLabel(byLabel, { exact: true }).selectOption({ label: e.by });
  if (e.reference) await form.getByLabel(refLabel, { exact: true }).fill(e.reference);
}

// ═════════════════════════════════════════════════════════════════════

test.describe("the platform", () => {
  test.beforeAll(async ({ browser }) => { await session(browser, "admin"); });
  test.use({ storageState: ADMIN_STATE });

  test("Q1 · the admin makes a business that only keeps books — and is offered only what such a business can use", async ({ page, request }) => {
    const r = begin();

    await page.goto("/admin/tenants/new");
    await expect(page.getByRole("heading", { name: "Create a business", level: 1 })).toBeVisible();

    await page.getByLabel("Business name *", { exact: true }).fill(r.business);
    await page.getByLabel("Business type *", { exact: true }).selectOption({ label: TRADE_LABEL[TRADE] });
    await page.getByLabel("Category", { exact: true }).selectOption({ label: "Software House" });
    await page.getByLabel("Email", { exact: true }).fill(`office-${r.stamp}@qa.test`);
    await page.getByLabel("Phone", { exact: true }).fill(r.phone);
    await page.getByLabel("City", { exact: true }).selectOption({ label: "Lahore" });

    // Said as what it is. The form used to build "a finance manager shop".
    await expect(page.getByText("Only what a books-only business can use. Choose a plan to see what it includes.")).toBeVisible();

    // The smallest plan: an office with one set of books needs no more.
    await choose(page.getByLabel("Plan *", { exact: true }), /^Basic/);
    await page.getByLabel("Amount", { exact: true }).fill("2499");
    await page.getByLabel("Reference", { exact: true }).fill(`QA-${r.stamp}`);

    await page.getByLabel("Owner name *", { exact: true }).fill(r.ownerName);
    await page.getByLabel("Owner email *", { exact: true }).fill(r.ownerEmail);
    await page.getByLabel("Temp password *", { exact: true }).fill(r.ownerPassword);

    // Two switches, and only two: the books (needed, and on) and the one
    // thing an office may add. The other nineteen are folded away, and this
    // case leaves them there — that is what "books only" is.
    const included = page.getByTestId("modules-included");
    await expect(included.getByRole("switch")).toHaveCount(1);
    await expect(included.getByRole("switch", { name: OFFERED[0] })).toBeChecked();
    await expect(included.getByText("needed", { exact: true })).toHaveAttribute("title", "A books-only business cannot open without it");
    const addons = page.getByTestId("modules-addons");
    await expect(addons.getByRole("switch")).toHaveCount(1);
    await expect(addons.getByRole("switch", { name: OFFERED[1] })).not.toBeChecked();
    const folded = page.getByTestId("modules-other").getByRole("button", { name: /^Not usual for a books-only business/ });
    await expect(folded).toHaveAttribute("aria-expanded", "false");
    await expect(folded).toContainText("19 more");
    await expect(page.getByRole("switch")).toHaveCount(2);
    await expect(page.getByText(/finance manager shop/i), "the form calls an office a shop").toHaveCount(0);

    const create = page.getByRole("button", { name: "Create business" });
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page).not.toHaveURL(/\/tenants\/new/, { timeout: 30_000 });

    // As the server holds it: the books on, and nothing that sells.
    const found = await ask<Array<{ id: string; business_name: string; status: string }>>(
      request, "admin", `/admin/tenants?search=${encodeURIComponent(r.business)}&per_page=50`,
    );
    const mine = found.find((t) => t.business_name === r.business);
    expect(mine, "the server has no such business").toBeTruthy();
    remember({ tenantId: mine!.id });

    const detail = await ask<{ features: Record<string, boolean>; plan?: { name?: string } | null }>(request, "admin", `/admin/tenants/${mine!.id}`);
    expect(detail.features.expenses, "the one module it was sold is off").toBe(true);
    const handed = NOT_BOUGHT.filter((key) => detail.features[key]);
    expect(handed, "a books-only business was handed modules nobody switched on").toEqual([]);
    expect(detail.plan?.name).toBe("Basic");
  });
});

test.describe("the first morning", () => {
  // Nobody has been inside it: this is the first time this password is typed.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Q2 · the owner walks in — to a business, not a shop, and a front page that says where to begin", async ({ page, request }) => {
    const r = record();

    await signIn(page, r.ownerEmail, r.ownerPassword, /\/tenant/);
    await expect(page).toHaveURL(/\/tenant\/setup/);
    await expect(page.getByRole("heading", { name: new RegExp(`Set up ${r.business}`) })).toBeVisible();

    // Asked where its BUSINESS is, all the way down the form — the map
    // picker went on asking for "your shop address".
    await expect(page.getByText("tell us where your business is")).toBeVisible();
    await expect(page.getByPlaceholder("Search your business address…")).toBeVisible();
    await expect(page.getByText("to set your exact business location.")).toBeVisible();
    await expect(page.getByText(/your shop|shop location|shop address/i)).toHaveCount(0);

    const city = page.getByLabel("City *", { exact: true });
    await expect.poll(async () => city.locator("option:not([disabled])").count()).toBeGreaterThan(0);
    await city.selectOption({ label: "Lahore" });
    await page.getByLabel("Address (optional)", { exact: true }).fill("4th Floor, Arfa Tower, Ferozepur Road");
    await page.getByRole("button", { name: "Finish setup" }).click();

    await expect(page).not.toHaveURL(/\/tenant\/setup/, { timeout: 30_000 });
    await settled(page);
    await expect(page).toHaveURL(/\/tenant\/?$/);
    await page.context().storageState({ path: OWNER_STATE });
    expect(fs.existsSync(OWNER_STATE)).toBe(true);

    // The head of the page and the panel under it say the SAME thing. It
    // used to be "Nothing needs you right now" over "1 to look at".
    await expect(status(page)).toHaveText("Your books are empty — record your first income or expense to begin.");
    await expect(page.getByText("No expenses recorded yet")).toBeVisible();
    await expect(page.getByText("1 to look at")).toBeVisible();

    // Both halves of its books are one press away, money in first.
    const tiles = page.getByRole("navigation", { name: "Quick actions" }).getByRole("link");
    await expect(tiles).toHaveCount(4);
    expect(await tiles.evaluateAll((as) => as.map((a) => a.getAttribute("href")))).toEqual(["/tenant/income", "/tenant/expenses", "/tenant/reports", "/tenant/cashbook"]);

    // Books are read by the month, so that is what it opens on.
    await expect(page.getByTestId("period-name")).toHaveText("This month");
    for (const label of ["Money In", "Money Out", "Net"]) {
      expect(await near(page.getByTestId("dashboard-figures"), label), `${label} on a business with no entries`).toBe(0);
    }

    const me = await ask<{ tenant: { setup_completed: boolean; features: Record<string, boolean> } }>(request, "owner", "/auth/me");
    expect(me.tenant.setup_completed).toBe(true);
    expect(Object.entries(me.tenant.features).filter(([, on]) => on).map(([key]) => key)).toEqual(["expenses"]);
  });
});

test.describe("inside the books", () => {
  test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
  test.use({ storageState: OWNER_STATE });

  test("Q3 · its menu is the books and nothing else — and a screen it did not buy is shut, not broken", async ({ page }) => {
    test.setTimeout(300_000);

    await page.goto("/tenant");
    await settled(page);
    const full = page.getByRole("button", { name: "Full view" });
    await full.click();
    await expect(page.getByText("Every module this business has.")).toBeVisible();

    const nav = page.getByRole("navigation").first();
    for (let pass = 0; pass < 3; pass++) {
      const groups = nav.getByRole("button");
      const n = await groups.count();
      for (let i = 0; i < n; i++) {
        const g = groups.nth(i);
        if ((await g.getAttribute("aria-expanded")) === "false") await g.click().catch(() => {});
      }
    }

    // The third part of the rail is the business itself — and it is not a shop.
    await expect(nav.getByText("Your business", { exact: true })).toBeVisible();
    await expect(nav.getByText("Your shop", { exact: true })).toHaveCount(0);

    const links = await nav.getByRole("link").evaluateAll((as) =>
      [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""))].filter((h) => h.startsWith("/tenant")),
    );
    expect(links, "the menu of a business that bought only the books").toEqual(ITS_SCREENS);

    // Every one opens its own screen and draws something. Any request the
    // server refuses along the way fails the case — the watch is listening.
    for (const href of ITS_SCREENS) {
      await page.goto(href);
      await settled(page);
      await page.waitForTimeout(600);
      expect(new URL(page.url()).pathname.replace(/\/$/, ""), `${href} did not open its own screen`).toBe(href);
      expect((await page.locator("body").innerText()).trim().length, `${href} drew nothing`).toBeGreaterThan(40);
    }

    // A screen it did not buy, typed. Sent home, and nothing asked of the
    // server on the way: /tenant/sales used to draw the whole Sales screen
    // around two requests the server refused.
    for (const href of NOT_ITS_SCREENS) {
      await page.goto(href);
      await settled(page);
      await page.waitForTimeout(400);
      expect(new URL(page.url()).pathname.replace(/\/$/, ""), `${href} opened for a business that never bought it`).toBe("/tenant");
    }

    // What happened here, in its own words. The card used to print the audit
    // trail's model names: "updated a tenant", "created a user".
    await page.goto("/tenant");
    await settled(page);
    await expect(page.getByText("Business settings · changed").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Staff member · added").first()).toBeVisible();
    await expect(page.getByText(/updated a tenant|created a user|\ba tenant\b/i)).toHaveCount(0);
    remember({ screens: links });
  });

  test("Q4 · it has somewhere to file what it earns, and each screen says what it is for in its own terms", async ({ page, request }) => {
    // INCOME. For a shop this screen is the money that is NOT a sale. For
    // this business it is every rupee it takes, and it used to be told
    // "money in that isn't a sale… your sales revenue is counted automatically".
    await page.goto("/tenant/income");
    await settled(page);
    await expect(page.getByTestId("income-says")).toHaveText(/^Everything the business takes in — a client's payment, a fee, a grant/);
    await expect(page.getByTestId("income-says")).not.toContainText(/sale/i);
    // On its first morning the empty list says what belongs on it. (A
    // resumed run has already put money there.)
    if ((await held(request, "/incomes")).length === 0) {
      await expect(page.getByText("No income recorded yet")).toBeVisible();
      await expect(page.getByText("A client's payment, a fee, a grant, money the owner put in — record it here.")).toBeVisible();
    }

    await tab(page, "Categories").click();
    await expect(page.getByTestId("income-says")).toHaveText(/^What your money in is filed under/);
    // What an office earns. It was given Interest, Owner Investment, Rent
    // Received, Supplier Refund and Other Income — and nothing for its fees.
    for (const earned of ["Client Payments", "Service Fees", "Sales", "Commission", "Donations & Grants", "Owner Investment", "Other Income"]) {
      await expect(page.getByText(earned, { exact: true }).first(), `no income category called ${earned}`).toBeVisible();
    }

    // …and its own, added the way it would be said out loud.
    const mine = "Maintenance Contracts";
    if (!(await held(request, "/income-categories")).some((c) => c.name === mine)) {
      await page.getByRole("button", { name: "+ Add category" }).click();
      const dialog = page.getByRole("dialog").filter({ has: page.getByLabel("Name", { exact: true }) });
      await dialog.getByLabel("Name", { exact: true }).fill(mine);
      await dialog.getByRole("button", { name: "Add category", exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
    }
    await expect(page.getByText(mine, { exact: true }).first()).toBeVisible();
    expect((await held(request, "/income-categories")).map((c) => c.name)).toContain(mine);

    // EXPENSES. "…if it was cash — your drawer", to a business with none.
    await page.goto("/tenant/expenses");
    await settled(page);
    await expect(page.getByTestId("expenses-says")).toHaveText("Every bill the business has paid. File one and it lands in your cashbook, your ledger and your reports.");
    await tab(page, "Categories").click();
    for (const spent of ["Rent", "Salary", "Electricity", "Internet", "Marketing"]) {
      await expect(page.getByText(spent, { exact: true }).first(), `no expense category called ${spent}`).toBeVisible();
    }
  });

  test("Q5 · money in is recorded — and cash is cash, with no till for it to have gone into", async ({ page, request }) => {
    const before = await held(request, "/incomes");

    // WHAT THE FORM OFFERS AND SAYS — looked at every time, before anything
    // is typed into it.
    await page.goto("/tenant/income");
    await page.getByRole("button", { name: "Add income" }).first().click();
    const asked = dialogOf(page, "Add income");
    // What a books-only business would type there…
    await expect(asked.getByPlaceholder("e.g. Invoice 114 — client payment")).toBeVisible();
    // …and how it can have been paid. "Cash (to till)" was the first of these.
    const received = asked.getByLabel("Received by", { exact: true });
    expect((await received.locator("option").allTextContents()).filter((o) => o !== "Select an option"), "how money can arrive at a business with no till")
      .toEqual(["Cash", "Bank transfer", "Card", "Mobile wallet", "Other"]);
    // Cash chosen, and nothing said about a drawer it does not have.
    await received.selectOption({ label: "Cash" });
    await expect(asked.getByText(SHOP_WORDS)).toHaveCount(0);
    await asked.getByRole("button", { name: "Cancel" }).click();
    await expect(asked).toBeHidden();

    for (const entry of INCOME) {
      if (before.some((h) => h.description === entry.description)) continue; // resumed

      await page.goto("/tenant/income");
      await page.getByRole("button", { name: "Add income" }).first().click();
      const form = dialogOf(page, "Add income");
      await fill(form, entry, "Received by", "Reference");
      await form.getByRole("button", { name: "Save income" }).click();

      // The form CLOSES. A cash entry used to be answered "Saved — recorded
      // as cash, but you have no shift open — the drawer was not adjusted",
      // and held open until that was dismissed. Every cash entry, for ever.
      await expect(form, `${entry.description} did not save`).toBeHidden({ timeout: 15_000 });
      // …and what it is told is that it was recorded. On this side of the
      // books the drawer sentence arrived as the message itself, IN PLACE of
      // "Income recorded" — so a check that only watched the form close
      // passed with the fault put back.
      await expect(page.getByText("Income recorded").first(), `${entry.description} was not confirmed as recorded`).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/no shift open|drawer was not adjusted/i), "a business with no till was told about its drawer").toHaveCount(0);
    }

    await page.goto("/tenant/income");
    await settled(page);
    for (const entry of INCOME) {
      const row = page.getByRole("row").filter({ hasText: entry.description }).first();
      await expect(row, `${entry.description} is not on the Income list`).toBeVisible();
      expect(((await row.innerText()).match(/Rs\s?[0-9,]+(?:\.[0-9]+)?/g) ?? []).map(rupees)).toContain(entry.amount);
    }
    // 450,000 + 120,000 + 80,000.
    expect(await near(page, "Total in")).toBe(sum(INCOME));

    // Found by the number on the invoice, and the figure is that entry's.
    await page.getByPlaceholder("Search description, bill number or note…").fill("INV-115");
    await expect(page.getByRole("row").filter({ hasText: "Support retainer — Karachi Cables" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("row").filter({ hasText: "Invoice 114" })).toHaveCount(0);
    await expect.poll(async () => near(page, "Total in"), { message: "the total did not follow the search" }).toBe(120_000);

    const now = await held(request, "/incomes");
    expect(now.filter((h) => INCOME.some((e) => e.description === h.description)).reduce((s, h) => s + Number(h.amount), 0)).toBe(sum(INCOME));
    const notes = now.find((h) => h.description === "Invoice 116 — Sialkot Sports")!;
    expect(notes.payment_method).toBe("cash");
    expect(notes.cash_movement_id ?? null, "cash at a business with no till moved a drawer").toBeNull();
  });

  test("Q6 · bills are filed — a cash one too, and the form has nothing to add", async ({ page, request }) => {
    const before = await held(request, "/expenses");

    // What the form offers and says, every time.
    await page.goto("/tenant/expenses");
    await page.getByRole("button", { name: "Add expense" }).first().click();
    const asked = dialogOf(page, "Add expense");
    await expect(asked.getByPlaceholder("e.g. July office rent")).toBeVisible();
    const paid = asked.getByLabel("Paid by", { exact: true });
    // "Cash (from till)" was the first of these.
    expect((await paid.locator("option").allTextContents()).filter((o) => o !== "Select an option"))
      .toEqual(["Cash", "Bank transfer", "Card", "Mobile wallet", "On credit", "Other"]);
    // "Cash comes out of your open drawer, so the shift's expected cash drops."
    await paid.selectOption({ label: "Cash" });
    await expect(asked.getByText(SHOP_WORDS), "the form talks about a till to a business with none").toHaveCount(0);
    await asked.getByRole("button", { name: "Cancel" }).click();
    await expect(asked).toBeHidden();

    for (const bill of BILLS) {
      if (before.some((h) => h.description === bill.description)) continue; // resumed

      await page.goto("/tenant/expenses");
      await page.getByRole("button", { name: "Add expense" }).first().click();
      const form = dialogOf(page, "Add expense");
      await fill(form, bill, "Paid by", "Bill / voucher no.");
      await form.getByRole("button", { name: "Save expense" }).click();
      await expect(form, `${bill.description} was saved with something to say about it`).toBeHidden({ timeout: 15_000 });
      await expect(page.getByText("Expense recorded").first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/no shift open|drawer was not adjusted/i), "a business with no till was told about its drawer").toHaveCount(0);
    }

    await page.goto("/tenant/expenses");
    await settled(page);
    for (const bill of BILLS) {
      await expect(page.getByRole("row").filter({ hasText: bill.description }).first(), `${bill.description} is not on the list`).toBeVisible();
    }

    const now = await held(request, "/expenses");
    const electricity = now.find((h) => h.description === "LESCO bill")!;
    expect(electricity.payment_method).toBe("cash");
    expect(electricity.cash_movement_id ?? null).toBeNull();
    expect(String(electricity.expense_date).slice(0, 10)).toBe(D0);
    expect(String(now.find((h) => h.description === "Salaries — last month")!.expense_date).slice(0, 10)).toBe(D1);
  });

  test("Q7 · the rent comes round — the front page says it has fallen due, and posting it takes the real figure", async ({ page, request }) => {
    const templates = await held(request, "/expenses/recurring");
    const posted = (await held(request, "/expenses")).some((h) => h.description === RENT.description);

    if (!templates.some((t) => t.description === RENT.description)) {
      await page.goto("/tenant/expenses?tab=recurring");
      await page.getByRole("button", { name: "Add recurring" }).first().click();
      const form = dialogOf(page, "Add recurring expense");
      await form.getByLabel("Category", { exact: true }).selectOption({ label: RENT.category });
      await form.getByLabel("Description", { exact: true }).fill(RENT.description);
      await form.getByLabel("Usual amount", { exact: true }).fill(String(RENT.usual));
      await form.getByLabel("Every", { exact: true }).selectOption({ label: "Month" });
      await form.getByLabel("First due on", { exact: true }).fill(RENT.dueOn);
      await form.getByLabel("Paid by", { exact: true }).selectOption({ label: "Bank transfer" });
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
    }

    if (!posted) {
      // THE FRONT PAGE. A recurring bill never posts itself — a person
      // confirms the figure — so somebody has to be told it is waiting. It
      // was a badge on a tab of another screen, and this page said "Nothing
      // needs you right now" over it.
      await page.goto("/tenant");
      await settled(page);
      await expect(status(page)).toHaveText("1 bill has fallen due and is waiting to be posted.");
      const row = page.getByRole("link").filter({ hasText: "1 bill has fallen due" });
      await expect(row).toContainText(`Rs 80,000, due yesterday. Confirm the real figure and post it.`);

      // …and the row lands on the bill, not on the first tab of its page.
      await row.click();
      await expect(page).toHaveURL(/\/tenant\/expenses\?tab=recurring/);
      const bill = page.getByRole("row").filter({ hasText: RENT.description });
      await expect(bill.getByRole("button", { name: "Post", exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(tab(page, "Recurring")).toContainText("1");

      // Posted at what the landlord actually asked for.
      await bill.getByRole("button", { name: "Post", exact: true }).click();
      const post = page.getByRole("dialog").filter({ hasText: `Post ${RENT.description}` });
      await expect(post.getByLabel("Amount", { exact: true })).toHaveValue(String(RENT.usual));
      await post.getByLabel("Amount", { exact: true }).fill(String(RENT.actual));
      await post.getByRole("button", { name: "Post expense" }).click();
      await expect(post).toBeHidden({ timeout: 15_000 });
      await expect(bill.getByRole("button", { name: "Post", exact: true })).toHaveCount(0);
    }

    // The expense is real, at the real figure, on the day it was DUE…
    const rent = (await held(request, "/expenses")).find((h) => h.description === RENT.description);
    expect(rent, "posting the rent filed no expense").toBeTruthy();
    expect(Number(rent!.amount)).toBe(RENT.actual);
    expect(String(rent!.expense_date).slice(0, 10)).toBe(RENT.dueOn);
    // …and the next one is a month on from the due date, not from today.
    const template = (await held(request, "/expenses/recurring")).find((t) => t.description === RENT.description)!;
    expect(String(template.next_due_on).slice(0, 10)).toBe(iso(aMonthAfter(YESTERDAY)));
    expect(Number(template.amount), "posting at another figure rewrote the usual one").toBe(RENT.usual);

    // Nothing is waiting any more, and the front page stops saying so.
    await page.goto("/tenant");
    await settled(page);
    await expect(page.getByRole("link").filter({ hasText: /bills? ha(s|ve) fallen due/ })).toHaveCount(0);
    await expect(status(page)).not.toContainText("fallen due");
    // Until the billboard (the next case), nothing at all is — and that is
    // said in terms of what CAN go wrong for it, not "stock, orders and the
    // day are all where they should be".
    if (!(await held(request, "/expenses")).some((h) => h.description === BILLBOARD.description)) {
      await expect(status(page)).toHaveText("Nothing needs you right now.");
      await expect(page.getByText("No bill has fallen due and no budget has been passed.")).toBeVisible();
    }
  });

  test("Q8 · a ceiling is set on Marketing, a billboard goes past it — said at the moment of entry, and on the front page after", async ({ page, request }) => {
    const filed = (await held(request, "/expenses")).some((h) => h.description === BILLBOARD.description);

    await page.goto("/tenant/expenses?tab=budgets");
    await settled(page);
    const ceiling = page.getByLabel(`Ceiling for ${BILLBOARD.category}`, { exact: true });
    await expect(ceiling).toBeVisible({ timeout: 15_000 });
    if ((await ceiling.inputValue()) !== String(BILLBOARD.ceiling)) {
      await ceiling.fill(String(BILLBOARD.ceiling));
      await ceiling.blur();
      await expect(page.getByText("Monthly budget saved")).toBeVisible({ timeout: 15_000 });
    }

    if (!filed) {
      await tab(page, "Expenses").click();
      await page.getByRole("button", { name: "Add expense" }).first().click();
      const form = dialogOf(page, "Add expense");
      await fill(form, BILLBOARD, "Paid by", "Bill / voucher no.");
      await form.getByRole("button", { name: "Save expense" }).click();

      // A budget never blocks: the bill arrived either way. It is SAVED, and
      // the form stays to say the one thing worth hearing — by how much.
      const said = `${BILLBOARD.category} is now 6,500.00 over its 20,000.00 budget for ${MONTH_NAMES[TODAY.getMonth()]} ${TODAY.getFullYear()}.`;
      await expect(form.getByText(said)).toBeVisible({ timeout: 15_000 });
      await expect(form.getByText("Saved", { exact: true })).toBeVisible();
      await form.getByRole("button", { name: "Done" }).click();
      await expect(form).toBeHidden();
    }
    expect(Number((await held(request, "/expenses")).find((h) => h.description === BILLBOARD.description)?.amount)).toBe(BILLBOARD.amount);

    // The Budgets tab agrees…
    await page.goto("/tenant/expenses?tab=budgets");
    await settled(page);
    const marketing = page.getByRole("row").filter({ hasText: BILLBOARD.category });
    await expect(marketing).toContainText("Rs 26,500");
    await expect(marketing).toContainText(/over/i);

    // …and so does the front page, by name, with how far past.
    await page.goto("/tenant");
    await settled(page);
    await expect(status(page)).toHaveText(`${BILLBOARD.category} has gone past its budget this month.`);
    const row = page.getByRole("link").filter({ hasText: `${BILLBOARD.category} is over its budget` });
    await expect(row).toContainText(`Rs ${OVER_BY.toLocaleString("en-US")} past the ceiling set for this month.`);
    await row.click();
    await expect(page).toHaveURL(/\/tenant\/expenses\?tab=budgets/);
    await expect(page.getByLabel(`Ceiling for ${BILLBOARD.category}`, { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test("Q9 · the cashbook is its books by the day — no column it can never fill, and any window an accountant works in", async ({ page }) => {
    await page.goto("/tenant/cashbook");
    await settled(page);

    // Said as what it is. It was "sales and other income against expenses and
    // refunds… for physical cash at the counter, use the POS shift close".
    await expect(page.getByTestId("cashbook-says")).toHaveText("Everything in and out, day by day — the income you recorded against the expenses you recorded.");
    await expect(page.getByTestId("cashbook-footnote")).toHaveCount(0);
    await expect(page.getByText(SHOP_WORDS)).toHaveCount(0);

    // Five columns. Sales and Refunds were two more, empty for ever.
    expect(await page.getByRole("columnheader").allTextContents()).toEqual(["Date", "Income", "Expenses", "Net", "Running net"]);

    // This month, worked out above.
    expect(await near(page, "Money in"), "money in this month").toBe(M_IN);
    expect(await near(page, "Money out"), "money out this month").toBe(M_OUT);
    expect(await near(page, "Net this period")).toBe(M_IN - M_OUT);
    expect(await near(page, "Cumulative net"), "everything since the books were opened").toBe(ALL_NET);
    // One thing in, one thing out: there is no split worth printing under either.
    await expect(page.getByText(/Sales Rs|Refunds Rs/)).toHaveCount(0);

    const today = page.getByRole("row").filter({ hasText: "Today" }).first();
    for (const figure of [T_IN, T_OUT, T_NET, ALL_NET]) await expect(today).toContainText(`Rs ${figure.toLocaleString("en-US")}`);
    if (YESTERDAY_IS_THIS_MONTH) {
      const yesterday = page.getByRole("row").filter({ hasText: "Yesterday" }).first();
      for (const figure of [Y_IN, Y_OUT, Y_NET]) await expect(yesterday).toContainText(`Rs ${figure.toLocaleString("en-US")}`);
    }

    // THE WINDOW. Four buttons — today, week, month, year — were all it
    // could be asked about. The control the Reports page has, now.
    const window = page.locator('button[aria-haspopup="listbox"]');
    await window.click();
    const list = page.getByRole("listbox", { name: "This month" });
    for (const named of ["Today", "This Week", "This Month", "This Year", "Tax Year", "Last month", "Last 30 days"]) {
      await expect(list.getByRole("option", { name: new RegExp(`^${named}`) }), `the cashbook cannot be asked about "${named}"`).toHaveCount(1);
    }
    await expect(page.getByRole("button", { name: /Custom range/ })).toBeVisible();

    // Today alone: what came before it is the balance it opens on.
    await list.getByRole("option", { name: /^Today/ }).click();
    await expect(page.getByTestId("cashbook-window")).toHaveText(dayLabel(TODAY));
    await expect.poll(async () => near(page, "Money in"), { message: "the cashbook did not follow its window" }).toBe(T_IN);
    expect(await near(page, "Money out")).toBe(T_OUT);
    expect(await near(page, "Cumulative net")).toBe(ALL_NET);
    await expect(page.getByText(`was Rs ${Y_NET.toLocaleString("en-US")} before this period`)).toBeVisible();

    // And the ledger opens on the window the cashbook was showing.
    await page.getByRole("link", { name: "Open ledger" }).click();
    await expect(page).toHaveURL(new RegExp(`/tenant/ledger\\?from=${D0}&to=${D0}`));
    await expect.poll(async () => near(page, "Opening balance"), { message: "the ledger did not open on the cashbook's window" }).toBe(Y_NET);
  });

  test("Q10 · the ledger is every line with the balance carried down — and its filters do what they say", async ({ page }) => {
    await page.goto(`/tenant/ledger?from=${D0}&to=${D0}`);
    await settled(page);

    await expect(page.getByTestId("ledger-says")).toHaveText("Every movement of money, in the order it happened, with the balance carried down.");
    // Income and Expenses. Sales, Refunds and Supplier paid were three more
    // buttons that could only ever answer "Nothing matches these filters".
    expect(await page.getByTestId("ledger-types").getByRole("button").allTextContents()).toEqual(["Income", "Expenses"]);

    // Opening → in → out → closing, for today.
    await expect.poll(async () => near(page, "Opening balance")).toBe(Y_NET);
    expect(await near(page, "Money in")).toBe(T_IN);
    expect(await near(page, "Money out")).toBe(T_OUT);
    expect(await near(page, "Closing balance")).toBe(ALL_NET);

    // Today's five lines, under the balance they start from.
    const todays = [...on(INCOME, D0), ...on(BILLS, D0), BILLBOARD].map((e) => e.description);
    for (const line of todays) await expect(page.getByRole("row").filter({ hasText: line })).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: "Salaries — last month" }), "yesterday's line is in today's ledger").toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: "Opening balance" })).toContainText(`Rs ${Y_NET.toLocaleString("en-US")}`);
    // The balance is CARRIED: one of the lines ends on the closing figure.
    await expect(page.getByRole("row").filter({ hasText: `Rs ${ALL_NET.toLocaleString("en-US")}` }).first()).toBeVisible();

    // The period is the page's subject, not a filter on it: there is no ✕ on
    // it. Pressing that ✕ used to send the server a custom period with no
    // dates, which it refuses.
    await expect(page.getByRole("button", { name: /^Remove filter/ })).toHaveCount(0);
    await expect(page.getByText("Showing", { exact: true })).toHaveCount(0);

    // One kind of line. A filter is a VIEW: the opening balance does not move.
    await page.getByTestId("ledger-types").getByRole("button", { name: "Income" }).click();
    await expect(page.getByRole("row").filter({ hasText: "LESCO bill" })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("row").filter({ hasText: "Invoice 116 — Sialkot Sports" })).toHaveCount(1);
    expect(await near(page, "Opening balance"), "narrowing the ledger rewrote what the account stood at").toBe(Y_NET);
    await page.getByTestId("ledger-types").getByRole("button", { name: "Income" }).click();

    // Searched for something that is not there…
    const search = page.getByPlaceholder("Search description, invoice or bill number…");
    await search.fill("no-such-invoice-9000");
    await expect(page.getByText("Nothing matches these filters.")).toBeVisible({ timeout: 15_000 });
    // …and "Clear all" brings the book back. It used to clear nothing: the
    // page merged what the bar handed back over what it already had.
    await page.getByRole("button", { name: "Clear all" }).first().click();
    await expect(search).toHaveValue("");
    for (const line of todays) await expect(page.getByRole("row").filter({ hasText: line })).toHaveCount(1, { timeout: 15_000 });
    // Still today: clearing the filters did not clear the period.
    expect(await near(page, "Opening balance")).toBe(Y_NET);
    expect(await near(page, "Closing balance")).toBe(ALL_NET);

    // What the accountant is sent is what was on the screen.
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const csv = fs.readFileSync(await (await downloading).path(), "utf8");
    expect(csv.split("\n")[0].replace(/^﻿/, "").trim()).toBe("Date,Type,Reference,Description,Category,Method,In,Out,Balance");
    for (const line of todays) expect(csv, `${line} is missing from the export`).toContain(line);
    expect(csv, "yesterday's line is in today's export").not.toContain("Salaries — last month");
  });

  test("Q11 · the report and the front page are the same month, to the rupee", async ({ page }) => {
    // REPORTS. One report, so no row of tabs with a single lit button on it.
    await page.goto("/tenant/reports");
    await settled(page);
    await expect(page.getByRole("button", { name: "Overview", exact: true })).toHaveCount(0);
    await expect.poll(async () => near(page, "Money In"), { message: "the report has not caught up" }).toBe(M_IN);
    expect(await near(page, "Money Out")).toBe(M_OUT);
    expect(await near(page, "Net")).toBe(M_IN - M_OUT);
    // Days on the chart as a person reads them — not thirty-one wire dates.
    const axis = page.locator(".apexcharts-xaxis");
    await expect(axis).toContainText(`1 ${MONTHS[TODAY.getMonth()]}`);
    await expect(axis).not.toContainText(/\d{4}-\d{2}-\d{2}/);
    // …and amounts up the side with their thousands apart.
    await expect(page.locator(".apexcharts-yaxis").first()).toContainText(/\d{1,3},\d{3}/);

    // THE FRONT PAGE, this month.
    await page.goto("/tenant");
    await settled(page);
    await expect(page.getByTestId("period-name")).toHaveText("This month");
    const figures = page.getByTestId("dashboard-figures");
    await expect(figures).toHaveAttribute("aria-busy", "false");
    expect(await near(figures, "Money In")).toBe(M_IN);
    expect(await near(figures, "Money Out")).toBe(M_OUT);
    expect(await near(figures, "Net")).toBe(M_IN - M_OUT);
    await expect(page.getByText(SHOP_WORDS), "the front page talks to an office as a shop").toHaveCount(0);
  });

  test("Q12 · what it pays for and what it is counted against is its own — and Settings does not offer it a shop", async ({ page }) => {
    await page.goto("/tenant/subscription");
    await settled(page);
    await expect(page.getByText("Where your business stands, what it can use, and what has been paid.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What your business runs" })).toBeVisible();
    await expect(page.getByText(/Your business is active/)).toBeVisible();

    // COUNTED AGAINST people, places and paper. It was also shown "Products
    // 0 / 1,000", "Registers 0 / 1" and "Offline selling 0 / 0".
    const usage = page.locator("div").filter({ has: page.getByRole("heading", { name: "Usage", exact: true }) }).last();
    for (const its of ["MB of storage", "Branches", "Staff members"]) await expect(usage.getByText(its, { exact: true })).toBeVisible();
    await expect(usage.getByText(/products|orders|registers|offline/i)).toHaveCount(0);
    // One branch on a one-branch plan is the plan working, not a fault.
    await expect(page.getByTestId("usage-branches-full")).toHaveText("All 1 in use — ask support to extend this before adding more.");
    // It cannot take an online order, so it is not told it pays 4.5% on them.
    await expect(page.getByRole("heading", { name: "Marketplace commission" })).toHaveCount(0);
    // "10 Oct – 10 Nov", not two wire dates.
    const paid = page.getByRole("row").filter({ hasText: "Basic" }).first();
    await expect(paid).not.toContainText(/\d{4}-\d{2}-\d{2}/);
    await expect(paid).toContainText("Rs 2,499");

    // SETTINGS.
    await page.goto("/tenant/settings");
    await settled(page);
    await expect(page.getByText("Manage your business profile, location and how the app works for you.")).toBeVisible();
    await expect(page.getByText("Your business's name and contact.")).toBeVisible();
    // No storefront to offer a business with nothing to list on one.
    await expect(page.getByRole("heading", { name: "Online shop" })).toHaveCount(0);
    await expect(page.getByText(/invoice|storefront|delivery/i)).toHaveCount(0);
    await expect(page.getByPlaceholder("Search your business address…")).toBeVisible();

    // THE MAP STAYS UNDER THE SAVE BAR. It was painted over it: wherever the
    // map sat beneath the bar, the Save button was behind a map.
    //
    // Measured in PIXELS. Asking the page what is "on top" at the button's
    // centre answers "the button" either way — map tiles take no pointer
    // events, so a click falls straight through a picture that covers the
    // thing completely. The first version of this check asked exactly that
    // and passed with the fault put back.
    await page.setViewportSize({ width: 1366, height: 700 });
    const save = page.getByRole("button", { name: "Save profile" });
    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });

    // An unsaved change lights the button: a solid colour is something to compare.
    const address = page.getByLabel("Address", { exact: true });
    const was = await address.inputValue();
    await address.fill(`${was}, rear entrance`);
    await expect(save).toBeEnabled();

    /** Scroll the page until the button's left end is, or is not, over the map. */
    const bring = (over: boolean) =>
      page.evaluate(async (wanted) => {
        const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save profile")!;
        const map = document.querySelector(".leaflet-container")!;
        // Whatever scrolls the BUTTON — not the first scrolling thing on the
        // page, which is the menu.
        let scroller = button.parentElement as HTMLElement | null;
        while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
          scroller = scroller.parentElement;
        }
        scroller ??= document.scrollingElement as HTMLElement;
        const isOver = () => {
          const b = button.getBoundingClientRect();
          const m = map.getBoundingClientRect();

          return m.left < b.left && m.right > b.left + 24 && m.top < b.top && m.bottom > b.bottom;
        };

        scroller.scrollTo(0, wanted ? 0 : scroller.scrollHeight);
        for (let step = 0; step < 80 && isOver() !== wanted; step++) {
          scroller.scrollBy(0, wanted ? 20 : -20);
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }

        return isOver() === wanted;
      }, over);

    /** Three points inside the button's left end, as they are actually painted. */
    const painted = async (): Promise<number[][]> => {
      const png = (await save.screenshot({ animations: "disabled" })).toString("base64");

      return page.evaluate(async (data) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const pen = canvas.getContext("2d")!;
        pen.drawImage(img, 0, 0);
        const at = (x: number, y: number) => Array.from(pen.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3);

        return [at(6, img.height / 2), at(14, 4), at(14, img.height - 5)];
      }, png);
    };

    expect(await bring(false), "the Save bar could not be got clear of the map").toBe(true);
    const clear = await painted();
    expect(await bring(true), "the map was never brought under the Save button — this would measure nothing").toBe(true);
    const over = await painted();
    // The same button, the same colour, whatever is beneath it.
    const moved = clear.map((point, i) => Math.max(...point.map((channel, c) => Math.abs(channel - over[i][c]))));
    expect(Math.max(...moved), `the Save button is painted differently with the map beneath it (${JSON.stringify({ clear, over })})`).toBeLessThan(24);

    // Nothing was saved: the change is taken back.
    await address.fill(was);
  });

  test("Q13 · a mistake is put right — a figure corrected, a bill filed twice taken off — and every screen follows", async ({ page, request }) => {
    const wrong = 19_400; // the LESCO bill, mistyped
    const right = 18_400;

    // Corrected up, and the list's total follows…
    await page.goto("/tenant/expenses");
    await settled(page);
    const total = async () => near(page, "Total out");
    const everything = sum(BILLS) + RENT.actual + BILLBOARD.amount; // 376,400
    await expect.poll(total).toBe(everything);

    await page.getByRole("button", { name: "Edit LESCO bill" }).click();
    let form = dialogOf(page, "Edit expense");
    await form.getByLabel("Amount *", { exact: true }).fill(String(wrong));
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
    await expect.poll(total, { message: "the total did not follow the correction" }).toBe(everything + (wrong - right));

    // …and so does the cashbook's today.
    await page.goto("/tenant/cashbook");
    await settled(page);
    await expect(page.getByRole("row").filter({ hasText: "Today" }).first()).toContainText(`Rs ${(T_OUT + (wrong - right)).toLocaleString("en-US")}`);

    // Put back.
    await page.goto("/tenant/expenses");
    await page.getByRole("button", { name: "Edit LESCO bill" }).click();
    form = dialogOf(page, "Edit expense");
    await form.getByLabel("Amount *", { exact: true }).fill(String(right));
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
    await expect.poll(total).toBe(everything);

    // THE SAME BILL TWICE. Not refused — rent can repeat — but said.
    const twice = { ...BILLS[2], description: "Fibre line (again)" };
    await page.getByRole("button", { name: "Add expense" }).first().click();
    form = dialogOf(page, "Add expense");
    await fill(form, twice, "Paid by", "Bill / voucher no.");
    await form.getByRole("button", { name: "Save expense" }).click();
    await expect(form.getByText("A very similar expense (same category, amount and date) already exists.")).toBeVisible({ timeout: 15_000 });
    await form.getByRole("button", { name: "Done" }).click();
    await expect.poll(total).toBe(everything + twice.amount);

    // Taken off again, and asked first.
    await page.getByRole("button", { name: `Delete ${twice.description}` }).click();
    const sure = page.getByRole("dialog").filter({ hasText: `Delete "${twice.description}"?` });
    await sure.getByRole("button", { name: /^(Delete|Confirm|Yes)/ }).click();
    await expect(page.getByRole("row").filter({ hasText: twice.description })).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(total, { message: "the total did not follow the deletion" }).toBe(everything);

    // The books are exactly what was lived, to the rupee.
    const bills = await held(request, "/expenses");
    expect(bills.reduce((s, h) => s + Number(h.amount), 0)).toBe(everything);
    expect((await held(request, "/incomes")).reduce((s, h) => s + Number(h.amount), 0)).toBe(sum(INCOME));

    await page.goto(`/tenant/ledger?from=${D0}&to=${D0}`);
    await expect.poll(async () => near(page, "Closing balance"), { message: "the ledger does not close on what was lived" }).toBe(ALL_NET);
  });
});
