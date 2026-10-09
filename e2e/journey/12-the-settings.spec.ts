import fs from "node:fs";
import type { APIRequestContext, Page } from "@playwright/test";
import { API } from "../api";
import { OWNER_STATE, Watch, ask, expect, record, remember, session, settled, signIn, test } from "./kit";
import { CASHIER, item } from "./shop";
import { complete, discount, openTill, reopenToday, ring, tender, tenderSheet } from "./till";

/**
 * STAGE G — SETTINGS, AND WHETHER ANYTHING LISTENS TO THEM.
 *
 *     "Shop setting main hr tab ko achy sy test kro, specially POS setting
 *      or uski sub tab — jahan jahan inki setting save ho rhi, use ho rhi
 *      wahan ya ni."
 *
 * A setting has three chances to be broken, and a test that checks one of
 * them passes on a switch that does nothing:
 *
 *   it does not SAVE      the screen says saved and the server holds the old value
 *   it does not SURVIVE   saved, and gone again after a reload
 *   nothing READS it      saved, kept, and the till carries on as before
 *
 * So every case here changes a setting ON THE SETTINGS SCREEN, reloads, and
 * then goes to the place the setting is about and looks at what it did.
 * Each one puts the shop back as it found it: the journey's books (stage D)
 * are worked out from the shop's settings and must still add up afterwards.
 */

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Settings = Record<string, unknown>;

const token = (): string => {
  const state = JSON.parse(fs.readFileSync(OWNER_STATE, "utf8")) as { origins: Array<{ localStorage: Array<{ name: string; value: string }> }> };
  const auth = state.origins.flatMap((o) => o.localStorage).find((i) => i.name === "shopos-auth")!;

  return (JSON.parse(auth.value) as { state: { accessToken: string } }).state.accessToken;
};

/** What the server holds — the second opinion on every "Settings saved." */
const held = (request: APIRequestContext) => ask<Settings>(request, "owner", "/shop/settings");

/** Put settings back. The only place this stage writes without a screen. */
const restore = async (request: APIRequestContext, patch: Settings) => {
  const res = await request.put(`${API}/shop/settings`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token()}` },
    data: patch,
  });
  expect(res.ok(), `could not put the shop's settings back (${res.status()})`).toBeTruthy();
};

/** What the shop was set to before this stage touched anything. */
test.beforeAll(async ({ request }) => {
  if (!record().settingsBefore) remember({ settingsBefore: await held(request) });
});

test.afterAll(async ({ request }) => {
  const before = record().settingsBefore as Settings | undefined;
  if (!before) return;
  // Only what a shop may set, and only what this stage moves.
  const keys = [
    "pos_default_payment", "cash_rounding", "pos_ask_who_served", "pos_auto_print", "pos_idle_lock_minutes",
    "tips_enabled", "pos_require_shift", "pos_denomination_count", "pos_blind_close", "pos_declare_tenders",
    "max_discount_percent", "max_discount_amount", "invoice_header", "invoice_footer", "invoice_ntn", "invoice_strn",
    "invoice_fbr_pos_id", "receipt_show_cashier", "invoice_show_logo", "receipt_width", "quotations_enabled",
    "layaway_enabled", "quotation_valid_days", "quotation_terms", "loyalty_enabled", "barcode_show_name",
    "barcode_show_price", "scale_barcode_enabled", "default_tax_rate", "tax_inclusive", "kot_auto_print",
  ];
  await restore(request, Object.fromEntries(keys.filter((k) => k in before).map((k) => [k, before[k]])));
});

// ── the Settings screen, as a person uses it ─────────────────────────

const TABS = ["Business", "Your modules", "Tax & Delivery", "Point of Sale", "Loyalty", "Receipt", "Hardware", "Barcodes"] as const;
const POS_TABS = ["Counter", "Lanes & PINs", "Quotes & advances", "Kitchen"] as const;

async function openSettings(page: Page, tab: (typeof TABS)[number], sub?: (typeof POS_TABS)[number]): Promise<void> {
  await page.goto("/tenant/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible({ timeout: 20_000 });
  await settled(page);
  await page.getByRole("button", { name: tab, exact: true }).click();
  if (sub) await page.getByRole("button", { name: sub, exact: true }).click();
  await page.waitForTimeout(300);
}

/** Press Save and wait for the screen to say it did. */
async function save(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Save preferences" });
  await expect(button, "nothing on the screen counts as changed, so there is nothing to save").toBeEnabled();
  await button.click();
  await expect(page.getByText("Settings saved.").first()).toBeVisible({ timeout: 15_000 });
  await expect(button).toBeDisabled();
}

const toggle = (page: Page, label: string) => page.getByRole("switch", { name: new RegExp(`^${label}`) });

/** Set a switch to a state (no-op if it is already there) and say whether it moved. */
async function setSwitch(page: Page, label: string, on: boolean): Promise<boolean> {
  const control = toggle(page, label);
  await expect(control).toBeVisible();
  if ((await control.getAttribute("aria-checked")) === String(on)) return false;
  await control.click();
  await expect(control).toHaveAttribute("aria-checked", String(on));

  return true;
}

/**
 * Change one setting on the screen, save, reload, and check it is still what
 * was chosen — on the screen AND on the server.
 */
async function choose(
  page: Page, request: APIRequestContext,
  where: { tab: (typeof TABS)[number]; sub?: (typeof POS_TABS)[number] },
  change: (page: Page) => Promise<unknown>,
  expected: Settings,
  shown: (page: Page) => Promise<void>,
): Promise<void> {
  await openSettings(page, where.tab, where.sub);
  await change(page);
  await save(page);

  // SAVED: the server holds it.
  const now = await held(request);
  for (const [key, value] of Object.entries(expected)) expect(now[key], `${key} on the server after Save`).toEqual(value);

  // SURVIVES: a fresh page shows it.
  await openSettings(page, where.tab, where.sub);
  await shown(page);
}

// ── G0: the screen itself ────────────────────────────────────────────

test("G0 · every tab and every POS sub-tab opens, and nothing behind it is refused", async ({ page }) => {
  await page.goto("/tenant/settings");
  await settled(page);

  for (const tab of TABS) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await settled(page);
    // Each tab draws its own first card: a tab that opened onto nothing would
    // still have its button pressed.
    await expect(page.getByRole("heading", { level: 3 }).first(), `${tab} drew no section`).toBeVisible();
    if (tab === "Point of Sale") {
      for (const sub of POS_TABS) {
        await page.getByRole("button", { name: sub, exact: true }).click();
        await settled(page);
        await expect(page.getByRole("heading", { level: 3 }).first(), `${sub} drew no section`).toBeVisible();
      }
    }
  }
});

// ── G1: Point of Sale › Counter ──────────────────────────────────────

test("G1 · Default payment: the tender sheet opens on what the shop chose", async ({ page, request }) => {
  await choose(page, request, { tab: "Point of Sale", sub: "Counter" },
    (p) => p.getByLabel("Default payment").selectOption({ label: "Card" }),
    { pos_default_payment: "card" },
    async (p) => { await expect(p.getByLabel("Default payment")).toHaveValue("card"); },
  );

  await openTill(page);
  await ring(page, item("soap").name);
  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  const methods = tenderSheet(page).getByRole("group", { name: "Payment method" });
  await expect(methods.getByRole("button", { name: /^Card/ }), "the till did not open on the shop's default").toHaveAttribute("aria-pressed", "true");
  await expect(methods.getByRole("button", { name: /^Cash/ })).toHaveAttribute("aria-pressed", "false");

  await restore(request, { pos_default_payment: "cash" });
});

test("G1 · Round cash bills: cash lands on the coin, a card does not, and the server agrees", async ({ page, request }) => {
  await choose(page, request, { tab: "Point of Sale", sub: "Counter" },
    (p) => p.getByLabel("Round cash bills to").selectOption({ label: "Nearest Rs 10" }),
    { cash_rounding: 10 },
    async (p) => { await expect(p.getByLabel("Round cash bills to")).toHaveValue("10"); },
  );

  // Tea: 1,299 at 10% = 1,428.90. No coin pays that.
  await openTill(page);
  await ring(page, item("tea").name);
  expect(await tender(page, "Card"), "a card bill was rounded").toBe(1428.9);
  await tenderSheet(page).getByRole("group", { name: "Payment method" }).getByRole("button", { name: /^Cash/ }).click();
  await expect(page.getByTestId("tender-amount-due")).toContainText("1,430");
  await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
  const sale = await complete(page, request);
  // The bill is still the bill; only what crossed the counter moved.
  expect(Number(sale.total)).toBe(1428.9);
  expect(Number(sale.amount_paid)).toBe(1430);
  expect(Number(sale.change_due ?? 0)).toBe(0);
  remember({ settingsStageSales: Number(record().settingsStageSales ?? 0) + 1 });

  await restore(request, { cash_rounding: 0 });
});

test("G1 · Ask who served: the till asks, and the sale remembers the answer", async ({ page, request }) => {
  const r = record();
  await choose(page, request, { tab: "Point of Sale", sub: "Counter" },
    (p) => setSwitch(p, "Ask who served the customer", true),
    { pos_ask_who_served: true },
    async (p) => { await expect(toggle(p, "Ask who served the customer")).toHaveAttribute("aria-checked", "true"); },
  );

  await openTill(page);
  await ring(page, item("soap").name);
  await tender(page, "Card");
  const served = tenderSheet(page).locator("select").filter({ has: page.locator("option", { hasText: "QA Cashier Hina" }) });
  await expect(served, "the till did not ask who served").toBeVisible();
  await served.selectOption({ label: "QA Cashier Hina" });
  const sale = await complete(page, request);
  expect(sale.served_by, "the sale did not record who served").toBeTruthy();
  expect(sale.served_by).not.toBe(sale.created_by);
  remember({ settingsStageSales: Number(record().settingsStageSales ?? 0) + 1 });

  // Off again: the box is gone. A picker on every sale in a one-person shop
  // is a slower till bought with nothing.
  await restore(request, { pos_ask_who_served: false });
  await openTill(page);
  await ring(page, item("soap").name);
  await tender(page, "Card");
  await expect(tenderSheet(page).getByText("Served by")).toHaveCount(0);
  expect(r.cashierEmail).toBeTruthy();
});

test("G1 · Auto-print: the receipt goes to the printer without being asked", async ({ page, request }) => {
  await choose(page, request, { tab: "Point of Sale", sub: "Counter" },
    (p) => setSwitch(p, "Auto-print receipt", true),
    { pos_auto_print: true },
    async (p) => { await expect(toggle(p, "Auto-print receipt")).toHaveAttribute("aria-checked", "true"); },
  );

  await page.addInitScript(() => {
    window.print = () => {
      const top = window.top as unknown as { __prints?: number };
      top.__prints = (top.__prints ?? 0) + 1;
    };
  });
  await openTill(page);
  await ring(page, item("soap").name);
  await tender(page, "Card");
  await tenderSheet(page).getByRole("button", { name: /^Complete/ }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible({ timeout: 20_000 });
  remember({ settingsStageSales: Number(record().settingsStageSales ?? 0) + 1 });

  // Nobody pressed Print.
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __prints?: number }).__prints ?? 0), {
    message: "the sale was paid and nothing was sent to the printer", timeout: 15_000,
  }).toBe(1);

  await restore(request, { pos_auto_print: false });
});

test("G1 · Lock when idle: a till nobody touches for three minutes locks itself", async ({ page, request }) => {
  await choose(page, request, { tab: "Point of Sale", sub: "Counter" },
    (p) => p.getByLabel("Lock the till when idle").selectOption({ label: "After 3 minutes" }),
    { pos_idle_lock_minutes: 3 },
    async (p) => { await expect(p.getByLabel("Lock the till when idle")).toHaveValue("3"); },
  );

  // IN REAL TIME. A faked clock was tried first and the till never locked
  // under it — the fault was the fake, not the till: left alone for three
  // real minutes, it locks on the tick. A case about a clock on the wall has
  // to be run by the wall's clock.
  test.setTimeout(6 * 60_000);
  await openTill(page);
  const locked = page.getByText(/Locked after a quiet spell/i);

  // A minute in, with nobody touching it: still open.
  await page.waitForTimeout(60_000);
  await expect(locked, "the till locked long before the time the shop chose").toHaveCount(0);

  // Past three: locked, and it says why.
  await expect(locked, "the till did not lock").toBeVisible({ timeout: 150_000 });

  await restore(request, { pos_idle_lock_minutes: 0 });
});

test("G1 · Tips: the counter asks for one, and it is the staff's — not a sale", async ({ page, request }) => {
  await choose(page, request, { tab: "Point of Sale", sub: "Counter" },
    (p) => setSwitch(p, "Ask for a tip at checkout", true),
    { tips_enabled: true },
    async (p) => { await expect(toggle(p, "Ask for a tip at checkout")).toHaveAttribute("aria-checked", "true"); },
  );

  // Oil: 2,850 at 18% = 3,363. (Not soap: soap has a promotion on it.)
  await openTill(page);
  await ring(page, item("oil").name);
  expect(await tender(page, "Card")).toBe(3363);

  const tip = tenderSheet(page).getByLabel("Tip", { exact: true });
  await expect(tip, "the switch is on and the counter never asks for a tip").toBeVisible();
  await tip.fill("37");
  // The customer hands over the bill and the tip together…
  await expect(page.getByTestId("tender-amount-due")).toContainText("3,400");
  // …and the screen says how much of that is the bill.
  await expect(tenderSheet(page).getByText(/Bill Rs 3,363 · tip Rs 37/)).toBeVisible();

  const sale = await complete(page, request);
  expect(Number(sale.tip_amount)).toBe(37);
  // The bill is still the bill: a tip is not revenue and is not taxed.
  expect(Number(sale.total)).toBe(3363);
  expect(Number(sale.tax)).toBe(513);
  expect(Number(sale.amount_paid)).toBe(3400);
  remember({ settingsStageSales: Number(record().settingsStageSales ?? 0) + 1 });

  // Off: no box.
  await restore(request, { tips_enabled: false });
  await openTill(page);
  await ring(page, item("soap").name);
  await tender(page, "Card");
  await expect(tenderSheet(page).getByLabel("Tip", { exact: true })).toHaveCount(0);
});

// ── G2: the drawer ───────────────────────────────────────────────────

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4173";

/** A sale rung by an owner with a figure of their choosing — the door a till could be gone round by. */
const ringByApi = (request: APIRequestContext, data: Settings) =>
  request.post(`${API}/sales`, { headers: { Accept: "application/json", Authorization: `Bearer ${token()}` }, data });

/** Today, as the journey's record keeps dates. */
const today = (): string => new Date().toLocaleDateString("en-CA");

/**
 * Open a shift at the till.
 *
 * The journey is a business lived over days; run from the top in one sitting,
 * stage C closes the day and everything after it happens the same afternoon.
 * A closed day takes no shift — the product is right about that — and for a
 * while that was the end of every case here that needs a drawer, until
 * tomorrow. It is now what a shop does about it: today's day is opened again
 * at Day & banking, with a reason, and the shift is opened. (Stage I is ABOUT
 * that screen; here it is a step on the way.)
 *
 * Returns false only if the day could not be opened again either.
 */
async function openShift(page: Page, float: number, watch?: { expect: (p: RegExp) => void }): Promise<boolean> {
  watch?.expect(/BUSINESS_DAY_CLOSED/);
  await page.getByRole("button", { name: "Open shift" }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Open shift" }) });
  await sheet.getByRole("spinbutton").first().fill(String(float));
  await sheet.getByRole("button", { name: "Open", exact: true }).click();

  const closed = sheet.getByText(/has already been closed off/);
  await expect(sheet.or(closed).first()).toBeVisible();
  const refused = await Promise.race([
    closed.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false),
    sheet.waitFor({ state: "hidden", timeout: 15_000 }).then(() => false).catch(() => false),
  ]);
  if (refused) {
    remember({ dayClosedOn: today() });
    await sheet.getByRole("button", { name: "Cancel" }).click();

    // What the refusal itself says to do.
    await reopenToday(page, "Journey: the day was closed off in stage C; stage G needs a drawer");
    await openTill(page);
    await page.getByRole("button", { name: "Open shift" }).first().click();
    await sheet.getByRole("spinbutton").first().fill(String(float));
    await sheet.getByRole("button", { name: "Open", exact: true }).click();
  }
  await expect(sheet, "the shift did not open").toBeHidden({ timeout: 15_000 });

  return true;
}

test("G2 · Require open shift: no drawer open, no sale — at the till and behind it", async ({ page, request, watch }) => {
  expect(await ask<unknown>(request, "owner", "/pos/session"), "a shift was left open by an earlier stage").toBeNull();

  await choose(page, request, { tab: "Point of Sale", sub: "Counter" },
    (p) => setSwitch(p, "Require open shift", true),
    { pos_require_shift: true },
    async (p) => { await expect(toggle(p, "Require open shift")).toHaveAttribute("aria-checked", "true"); },
  );

  // The till can be opened and the shelf read, but nothing can be paid for…
  await openTill(page);
  await ring(page, item("soap").name);
  const pay = page.getByRole("button", { name: /Tender \/ Pay/i });
  await expect(pay, "a shop that requires a shift let a sale be paid without one").toBeDisabled();
  // …and it says why, where the cashier is looking.
  await expect(page.getByText("Open a shift to sell — this shop requires one.")).toBeVisible();

  // Going round the screen does not work either.
  watch.expect(/SHIFT_REQUIRED/);
  const soap = (await ask<Array<Record<string, unknown>>>(request, "owner", `/products?search=${encodeURIComponent(item("soap").name)}`))[0];
  const direct = await ringByApi(request, {
    channel: "pos", payment_method: "cash", amount_paid: 1000, items: [{ product_id: soap.id, quantity: 1 }],
  });
  expect(direct.status()).toBe(409);
  expect(((await direct.json()) as { meta: { error_code: string } }).meta.error_code).toBe("SHIFT_REQUIRED");

  // With a drawer open, the same cart is paid. (If the day was closed off in
  // stage C, opening the shift opens the day again first — and the cart rung
  // before that has to be rung again on the till it comes back to.)
  await openShift(page, 1000, watch);
  // The till keeps its cart across the trip; ring again only if it did not.
  if ((await page.locator("[data-cart-row]").count()) === 0) await ring(page, item("soap").name);
  await expect(pay).toBeEnabled({ timeout: 15_000 });
  // Soap at its promotion: 96 + 5% = 100.80.
  expect(await tender(page, "Cash")).toBe(100.8);
  await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
  await complete(page, request);
  remember({ settingsStageSales: Number(record().settingsStageSales ?? 0) + 1 });
});

test("G2 · Closing a shift: blind, typed as one total, with the card machine's figure asked for", async ({ page, request }) => {
  expect(await ask<unknown>(request, "owner", "/pos/session"), "the shift from the case before is not open").not.toBeNull();

  await choose(page, request, { tab: "Point of Sale", sub: "Counter" },
    async (p) => {
      await setSwitch(p, "Count by note & coin", false);
      await setSwitch(p, "Blind close", true);
      await setSwitch(p, "Declare card totals", true);
    },
    { pos_denomination_count: false, pos_blind_close: true, pos_declare_tenders: true },
    async (p) => {
      await expect(toggle(p, "Count by note & coin")).toHaveAttribute("aria-checked", "false");
      await expect(toggle(p, "Blind close")).toHaveAttribute("aria-checked", "true");
      await expect(toggle(p, "Declare card totals")).toHaveAttribute("aria-checked", "true");
    },
  );

  await openTill(page);
  await page.getByRole("button", { name: "Close shift" }).first().click();
  const closing = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Close shift" }) });
  await expect(closing).toBeVisible();

  // BLIND: it says so, and the figure it expects is not on the sheet.
  await expect(closing.getByText(/Expected cash is hidden until you've counted/)).toBeVisible();
  await expect(closing.getByText("Expected", { exact: true })).toHaveCount(0);
  await expect(closing.getByText(/1,100\.80|1,100\.8/)).toHaveCount(0);
  // ONE TOTAL: no grid of notes.
  await expect(closing.getByLabel(/^How many .* notes$/)).toHaveCount(0);
  await expect(closing.locator("#counted-cash")).toBeVisible();
  // THE MACHINES: asked for, by name.
  await expect(closing.getByText("What the machines took")).toBeVisible();
  await expect(closing.getByLabel("Card", { exact: true })).toBeVisible();

  // Float 1,000 and one cash sale of 100.80.
  await closing.locator("#counted-cash").fill("1100.80");
  await closing.getByLabel("Card", { exact: true }).fill("0");
  await closing.getByRole("button", { name: "Close shift" }).click();
  await expect(closing).toBeHidden({ timeout: 20_000 });

  const closed = (await ask<{ sessions: Array<Record<string, string>> }>(request, "owner", "/pos/sessions?per_page=1")).sessions[0];
  expect(Number(closed.expected_cash)).toBe(1100.8);
  expect(Number(closed.counted_cash)).toBe(1100.8);
  expect(Number(closed.variance)).toBe(0);

  await restore(request, { pos_require_shift: false, pos_denomination_count: true, pos_blind_close: false, pos_declare_tenders: false });
});

test("G2 · The other way round: counted note by note, expected shown, no machines asked", async ({ page, request }) => {
  const now = await held(request);
  expect([now.pos_denomination_count, now.pos_blind_close, now.pos_declare_tenders]).toEqual([true, false, false]);

  await openTill(page);
  await openShift(page, 500);
  await page.getByRole("button", { name: "Close shift" }).first().click();
  const closing = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Close shift" }) });
  await expect(closing).toBeVisible();

  await expect(closing.getByLabel("How many 500 notes")).toBeVisible();
  await expect(closing.getByText(/Expected cash is hidden/)).toHaveCount(0);
  await expect(closing.getByText("What the machines took")).toHaveCount(0);

  await closing.getByLabel("How many 500 notes").fill("1");
  // Open: the figure it expects is on the sheet beside the count.
  await expect(closing.getByText("Expected", { exact: true })).toBeVisible();
  await closing.getByRole("button", { name: "Close shift" }).click();
  await expect(closing).toBeHidden({ timeout: 20_000 });
  expect(await ask<unknown>(request, "owner", "/pos/session")).toBeNull();
});

// ── G3: how much a cashier may give away ─────────────────────────────

test("G3 · Discount limit: the cashier is stopped at the shop's ceiling, and told so in words", async ({ page, request, browser }) => {
  test.setTimeout(240_000);
  const r = record();

  await choose(page, request, { tab: "Point of Sale", sub: "Counter" },
    (p) => p.getByLabel("Most they can discount").fill("5"),
    { max_discount_percent: 5 },
    async (p) => { await expect(p.getByLabel("Most they can discount")).toHaveValue("5"); },
  );

  // The cashier, at their own till.
  const context = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  const till = await context.newPage();
  const watch = new Watch(till);
  watch.expect(/DISCOUNT_LIMIT_EXCEEDED/);
  await signIn(till, String(r.cashierEmail), CASHIER.password, /\/tenant/);

  // Oil, 2,850. Rs 300 off is 10.5% — twice what the shop allows.
  await openTill(till);
  await ring(till, item("oil").name);
  await discount(till, { amount: 300 });
  await tender(till, "Card");
  await tenderSheet(till).getByRole("button", { name: /^Complete/ }).click();

  // Refused, in the shop's own terms — not "Sale failed".
  await expect(till.getByText(/above the 5% limit/).first(), "the cashier was not told why").toBeVisible({ timeout: 20_000 });
  await expect(till.getByRole("heading", { name: "Sale complete" })).toHaveCount(0);

  // Inside the limit it goes through: Rs 100 off is 3.5%.
  await till.keyboard.press("Escape");
  await openTill(till);
  await discount(till, { amount: 100 });
  // 2,750 at 18% = 3,245.
  expect(await tender(till, "Card")).toBe(3245);
  await tenderSheet(till).getByRole("button", { name: /^Complete/ }).click();
  await expect(till.getByRole("heading", { name: "Sale complete" })).toBeVisible({ timeout: 20_000 });
  remember({ settingsStageSales: Number(record().settingsStageSales ?? 0) + 1 });

  await till.waitForTimeout(400);
  expect(watch.unexpected()).toEqual([]);
  expect(watch.thrown).toEqual([]);
  await context.close();

  await restore(request, { max_discount_percent: null });
});

// ── G4: Point of Sale › Lanes & PINs ─────────────────────────────────

const PIN = "4821";

test("G4 · Till PIN: set for the cashier, the till locks, and only the right PIN opens it — as her", async ({ page, request, watch, browser }) => {
  test.setTimeout(180_000);
  const owner = await ask<{ id: string }>(request, "owner", "/auth/me");

  await openSettings(page, "Point of Sale", "Lanes & PINs");
  const row = page.getByRole("listitem").filter({ hasText: CASHIER.name });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button", { name: /^(Set|Change) PIN$/ }).click();

  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /till PIN$/ }) });
  await expect(sheet.getByText(`For ${CASHIER.name}.`)).toBeVisible();
  const boxes = sheet.locator('input[type="password"]');
  await boxes.nth(0).fill(PIN);
  await boxes.nth(1).fill(PIN);
  await sheet.getByRole("button", { name: "Save PIN" }).click();
  await expect(page.getByText(`Till PIN set for ${CASHIER.name}`)).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText("PIN set");

  // At the till: lock it by hand, the way a cashier steps away.
  await openTill(page);
  await page.getByTitle(/press to lock and hand over/).click();
  const lock = page.getByRole("heading", { name: "Who's at the counter?" });
  await expect(lock).toBeVisible();

  const key = (digit: string) => page.getByRole("button", { name: digit, exact: true });
  const unlockWith = async (pin: string) => {
    await page.getByRole("button", { name: new RegExp(CASHIER.name) }).click();
    for (const digit of pin) await key(digit).click();
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
  };

  // The wrong PIN does not open it, and the till is still locked afterwards.
  watch.expect(/401 POST \/pos\/unlock/);
  await unlockWith("0000");
  await expect(page.getByText("That PIN is not right."), "a wrong PIN was not answered").toBeVisible({ timeout: 15_000 });
  await expect(lock).toBeVisible();
  // ONE mistake is one mistake. It went to the server twice — the client
  // took the refusal for an expired session and sent the wrong PIN again —
  // so a cashier was frozen out in half the tries the shop allows.
  expect(watch.refused.filter((line) => line.includes("/pos/unlock")), "one wrong PIN was counted more than once").toHaveLength(1);

  // The right one does — and the till is HERS now.
  await unlockWith(PIN);
  await expect(lock).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTitle(new RegExp(`^${CASHIER.name} — press to lock`))).toBeVisible({ timeout: 15_000 });

  // The next sale is stamped with whoever unlocked it, as the setting promises.
  await ring(page, item("tea").name);
  await tender(page, "Card");
  await tenderSheet(page).getByRole("button", { name: /^Complete/ }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible({ timeout: 20_000 });
  const invoice = await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice");
  remember({ settingsStageSales: Number(record().settingsStageSales ?? 0) + 1 });

  // HANDED OVER MEANS HANDED OVER. The owner's session on this till ended
  // the moment the cashier's PIN opened it — the saved sign-in this stage
  // has been using is that session, and it is refused now. That is the
  // feature: the person who walked away cannot still be ringing sales.
  watch.expect(/401 /);
  const stale = await request.get(`${API}/auth/me`, { headers: { Accept: "application/json", Authorization: `Bearer ${token()}` } });
  expect(stale.status(), "the owner's session outlived handing the till over").toBe(401);

  // The owner signs in again, somewhere else, and reads what was rung.
  fs.rmSync(OWNER_STATE, { force: true });
  await session(browser, "owner");
  const sale = (await ask<Array<Record<string, unknown>>>(request, "owner", "/sales?per_page=10")).find((s) => s.invoice_number === invoice)!;
  expect(sale, `the till said ${invoice} and the server has no such sale`).toBeTruthy();
  expect(sale.created_by, "the sale was stamped with the owner, who had handed the till over").not.toBe(owner.id);
});

test("G4 · Till PIN: taken away again, and the list says so", async ({ page }) => {
  await openSettings(page, "Point of Sale", "Lanes & PINs");
  const row = page.getByRole("listitem").filter({ hasText: CASHIER.name });
  await expect(row).toContainText("PIN set", { timeout: 20_000 });

  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Remove PIN", exact: true }).click();
  await expect(page.getByText("Till PIN removed")).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText("No PIN — password only");
});

// ── G6: Point of Sale › Quotes & advances ────────────────────────────

const TERMS = "QA terms: prices firm for one week. Fitting not included.";

/** A date N days from today, the way the quotation prints it: 13 Oct 2026. */
const inDays = (n: number): { iso: string; printed: string } => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (v: number) => String(v).padStart(2, "0");

  return {
    iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    printed: `${pad(d.getDate())} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`,
  };
};

const postDocument = (request: APIRequestContext, data: Settings) =>
  request.post(`${API}/sale-documents`, { headers: { Accept: "application/json", Authorization: `Bearer ${token()}` }, data });

test("G6 · Quotes & advances: the validity, the terms and the minimum advance are the shop's own", async ({ page, request }) => {
  await choose(page, request, { tab: "Point of Sale", sub: "Quotes & advances" },
    async (p) => {
      await setSwitch(p, "Write quotations", true);
      await setSwitch(p, "Hold goods on advance", true);
      await p.getByLabel("Quotation valid for").fill("7");
      await p.getByLabel("Printed terms").fill(TERMS);
      await p.getByLabel("Minimum advance").fill("40");
      await p.getByLabel("Collect within").fill("10");
    },
    { quotation_valid_days: 7, quotation_terms: TERMS, layaway_min_deposit_percent: 40, layaway_days: 10 },
    async (p) => {
      await expect(p.getByLabel("Quotation valid for")).toHaveValue("7");
      await expect(p.getByLabel("Printed terms")).toHaveValue(TERMS);
      await expect(p.getByLabel("Minimum advance")).toHaveValue("40");
      await expect(p.getByLabel("Collect within")).toHaveValue("10");
    },
  );

  // Whatever is handed to the printer, kept to read.
  await page.addInitScript(() => {
    window.print = () => {
      (window.top as unknown as { __paper?: string }).__paper = document.documentElement.innerText;
    };
  });

  // Oil: 2,850 at 18% = 3,363.
  await openTill(page);
  await ring(page, item("oil").name);
  await page.getByRole("button", { name: /^Quote/ }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Save this ticket" }) });
  await expect(sheet).toBeVisible();

  // ON ADVANCE: forty percent of 3,363 is 1,345.20 — so 1,346, and not a rupee less.
  await sheet.getByRole("button", { name: /^On advance/ }).click();
  await sheet.getByPlaceholder("03xx-xxxxxxx").fill("03001110009");
  const advance = sheet.getByPlaceholder("1346");
  await expect(advance, "the till does not ask for the shop's minimum advance").toBeVisible();
  await advance.fill("1000");
  await expect(sheet.getByRole("button", { name: "Hold the goods" })).toBeDisabled();
  await advance.fill("1346");
  await expect(sheet.getByRole("button", { name: "Hold the goods" })).toBeEnabled();

  // …and the server holds the same line for anyone who goes round the form.
  const oil = (await ask<Array<Record<string, unknown>>>(request, "owner", `/products?search=${encodeURIComponent(item("oil").name)}`))[0];
  const short = await postDocument(request, {
    kind: "layaway", items: [{ product_id: oil.id, quantity: 1 }], customer_phone: "03001110009",
    deposit: { amount: 1000, method: "cash" },
  });
  expect(short.status()).toBe(422);
  expect(((await short.json()) as { meta: { error_code: string } }).meta.error_code).toBe("DEPOSIT_BELOW_MINIMUM");

  // A QUOTATION: saved, and the paper carries the shop's terms and a date seven days out.
  await sheet.getByRole("button", { name: /^Quotation/ }).click();
  await sheet.getByRole("button", { name: "Save quotation" }).click();
  await expect(page.getByText(/Quotation \S+ saved/)).toBeVisible({ timeout: 20_000 });

  const due = inDays(7);
  const doc = (await ask<Array<Record<string, unknown>>>(request, "owner", "/sale-documents?per_page=5"))[0];
  expect(doc.kind).toBe("quotation");
  expect(String(doc.expires_at).slice(0, 10), "the quotation is not valid for the seven days the shop set").toBe(due.iso);

  const paper = await page.waitForFunction(() => (window as unknown as { __paper?: string }).__paper, null, { timeout: 20_000 });
  const text = String(await paper.jsonValue());
  expect(text).toContain(TERMS);
  // The paper prints it in capitals; the date is the date either way.
  expect(text.toLowerCase()).toContain(`valid until ${due.printed.toLowerCase()}`);

  // WHEN it was written, by the shop's clock. This paper said 07:53 AM for a
  // quotation written at 12:53 in the afternoon — every printed document was
  // in UTC, five hours early.
  const clock = (d: Date) => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Karachi" });
  const now = new Date();
  const lately = [0, 1, 2].map((m) => clock(new Date(now.getTime() - m * 60_000)));
  expect(lately.some((t) => text.includes(t)), `the quotation is not timed by the shop's clock (${lately[0]}): ${text.slice(0, 160)}`).toBe(true);
  // A number with no name is not called "Customer".
  expect(text).not.toMatch(/Customer\s+Customer ·/);
  remember({ settingsStageQuotes: Number(record().settingsStageQuotes ?? 0) + 1 });
});

test("G6 · Quotations switched off: the till does not offer one and the server will not write one", async ({ page, request }) => {
  await choose(page, request, { tab: "Point of Sale", sub: "Quotes & advances" },
    (p) => setSwitch(p, "Write quotations", false),
    { quotations_enabled: false },
    async (p) => { await expect(toggle(p, "Write quotations")).toHaveAttribute("aria-checked", "false"); },
  );

  await openTill(page);
  await ring(page, item("oil").name);
  await page.getByRole("button", { name: /^Quote/ }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Save this ticket" }) });
  await expect(sheet.getByRole("button", { name: /^Quotation/ }), "a shop that writes no quotations was offered one").toBeDisabled();
  // It opens on the thing the shop still does.
  await expect(sheet.getByRole("button", { name: "Hold the goods" })).toBeVisible();

  const oil = (await ask<Array<Record<string, unknown>>>(request, "owner", `/products?search=${encodeURIComponent(item("oil").name)}`))[0];
  const refused = await postDocument(request, { kind: "quotation", items: [{ product_id: oil.id, quantity: 1 }] });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { message: string }).message).toBe("This shop does not issue quotations.");

  await restore(request, { quotations_enabled: true, quotation_valid_days: 15, quotation_terms: null, layaway_min_deposit_percent: 20, layaway_days: 30 });
});

// ── G7: Point of Sale › Kitchen ──────────────────────────────────────

test("G7 · Kitchen: stations are typed one to a line, and stay as typed", async ({ page, request }) => {
  const before = await held(request);

  await openSettings(page, "Point of Sale", "Kitchen");
  const stations = page.getByLabel("Stations");
  await stations.click();
  await stations.press("ControlOrMeta+a");
  await stations.press("Delete");
  // TYPED, key by key, the way a person does — Enter for the next line, and
  // a station whose name is two words.
  await stations.pressSequentially("Kitchen");
  await stations.press("Enter");
  await stations.pressSequentially("Hot Grill");
  await expect(stations, "the box ate the Enter or the space as it was typed").toHaveValue("Kitchen\nHot Grill");

  await setSwitch(page, "Print kitchen tickets", false);
  await save(page);

  const now = await held(request);
  expect(now.kitchen_stations).toEqual(["Kitchen", "Hot Grill"]);
  expect(now.kot_auto_print).toBe(false);

  await openSettings(page, "Point of Sale", "Kitchen");
  await expect(page.getByLabel("Stations")).toHaveValue("Kitchen\nHot Grill");
  await expect(toggle(page, "Print kitchen tickets")).toHaveAttribute("aria-checked", "false");

  await restore(request, { kitchen_stations: before.kitchen_stations ?? [], kot_auto_print: before.kot_auto_print ?? true });
});

// ── G8: Tax & Delivery ───────────────────────────────────────────────

test("G8 · Default tax: an item with no rate of its own is taxed at what the shop says today", async ({ page, request }) => {
  const before = Number((await held(request)).default_tax_rate);
  expect(before, "the journey's shop is taxed at five percent").toBe(5);

  await choose(page, request, { tab: "Tax & Delivery" },
    (p) => p.getByLabel("Default tax %").fill("8"),
    { default_tax_rate: 8 },
    async (p) => { await expect(p.getByLabel("Default tax %")).toHaveValue("8"); },
  );

  // Rice has no group and no rate of its own: 1,950 at 8% = 2,106 (it was 2,047.50).
  await openTill(page);
  await ring(page, item("rice").name);
  expect(await tender(page, "Card")).toBe(2106);
  // Oil is on a group of its own and does not move: 3,363 either way.
  await page.keyboard.press("Escape");
  await ring(page, item("oil").name);
  expect(await tender(page, "Card")).toBe(2106 + 3363);

  await restore(request, { default_tax_rate: before });
});

test("G8 · Prices already include tax: the price on the shelf is the price paid", async ({ page, request }) => {
  await choose(page, request, { tab: "Tax & Delivery" },
    (p) => setSwitch(p, "Prices already include tax", true),
    { tax_inclusive: true },
    async (p) => { await expect(toggle(p, "Prices already include tax")).toHaveAttribute("aria-checked", "true"); },
  );

  // Oil, 2,850 with 18% already inside it: the customer pays 2,850 and
  // 434.75 of that is the tax (2,850 − 2,850 ÷ 1.18).
  await openTill(page);
  await ring(page, item("oil").name);
  expect(await tender(page, "Card")).toBe(2850);
  const sale = await complete(page, request);
  expect(Number(sale.total)).toBe(2850);
  expect(Number(sale.tax)).toBe(434.75);
  remember({ settingsStageSales: Number(record().settingsStageSales ?? 0) + 1 });

  await restore(request, { tax_inclusive: false });
});

test("G8 · Delivery: the limits a shop sets are the limits a customer is shown", async ({ page, request }) => {
  const before = await held(request);
  const shop = await ask<{ slug: string }>(request, "owner", "/shop");

  await choose(page, request, { tab: "Tax & Delivery" },
    async (p) => {
      await p.getByLabel("Delivery radius (km)").fill("7");
      await p.getByLabel("Prep time (min)").fill("25");
      await p.getByLabel("Minimum order (Rs)").fill("500");
      await p.getByLabel("Free delivery above (Rs)").fill("2000");
    },
    { delivery_radius_km: 7, prep_time_minutes: 25, min_order_amount: 500, free_delivery_threshold: 2000 },
    async (p) => {
      await expect(p.getByLabel("Delivery radius (km)")).toHaveValue("7");
      await expect(p.getByLabel("Prep time (min)")).toHaveValue("25");
      await expect(p.getByLabel("Minimum order (Rs)")).toHaveValue("500");
      await expect(p.getByLabel("Free delivery above (Rs)")).toHaveValue("2000");
    },
  );

  // What a customer's app is told about this shop — no sign-in, as they have none.
  const seen = await request.get(`${API}/shops/${shop.slug}`, { headers: { Accept: "application/json" } });
  if (seen.ok()) {
    const data = ((await seen.json()) as { data: Record<string, unknown> }).data;
    expect(data.prep_time_minutes).toBe(25);
    expect(data.free_delivery_threshold).toBe(2000);
    expect(data.delivery_radius_km).toBe(7);
    expect(data.min_order_amount).toBe(500);
  } else {
    // Not listed (its online shop is closed): the shop cannot be seen at all,
    // which is its own answer — but then this case has not checked the limits.
    expect(seen.status(), "the shop's public page failed for a reason other than not being listed").toBe(404);
    test.info().annotations.push({ type: "not-checked", description: "the shop is not listed online, so the customer-facing limits were not read back" });
  }

  await restore(request, {
    delivery_radius_km: before.delivery_radius_km ?? null, prep_time_minutes: before.prep_time_minutes ?? null,
    min_order_amount: before.min_order_amount ?? null, free_delivery_threshold: before.free_delivery_threshold ?? null,
  });
});

test("G8 · A shop must be reachable somehow: pickup and delivery cannot both be off", async ({ page, request, watch }) => {
  watch.expect(/FULFILLMENT_REQUIRED/);

  await openSettings(page, "Tax & Delivery");
  await setSwitch(page, "Pickup", false);
  await setSwitch(page, "Delivery", false);
  await page.getByRole("button", { name: "Save preferences" }).click();

  // Refused, and in words — not "Settings saved." over a shop nobody can order from.
  await expect(page.getByText(/Enable at least one fulfillment option/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Settings saved.")).toHaveCount(0);
  const now = await held(request);
  expect([now.pickup_enabled, now.delivery_enabled]).not.toEqual([false, false]);
});

// ── G10: Loyalty ─────────────────────────────────────────────────────

test("G10 · Loyalty: points are earned on what was bought and are worth what the shop says", async ({ page, request }) => {
  const walkin = "03001110001"; // QA Ali Raza — in no group, so the bill is the items'.
  const points = async () => (await ask<{ loyalty_points: number }>(request, "owner", `/customers-lookup?phone=${walkin}`)).loyalty_points;

  await openSettings(page, "Loyalty");
  await setSwitch(page, "Enable loyalty points", true);
  await page.getByLabel("Earn: Rs per point").fill("100");
  await page.getByLabel("Redeem: Rs per point").fill("2");
  await page.getByLabel("Minimum to redeem").fill("10");
  await save(page);
  expect(await held(request)).toMatchObject({ loyalty_enabled: true, loyalty_earn_per_amount: 100, loyalty_redeem_value: 2, loyalty_min_redeem: 10 });
  await openSettings(page, "Loyalty");
  await expect(page.getByLabel("Redeem: Rs per point")).toHaveValue("2");

  const had = await points();

  // Oil: 2,850 of goods → 28 points (one per Rs 100; the tax earns nothing).
  await openTill(page);
  await ring(page, item("oil").name);
  await page.getByTitle(/No customer attached|Customer:/).first().click();
  const who = page.getByRole("dialog").filter({ hasText: "Leave blank for a walk-in sale" });
  await who.getByPlaceholder("03xx-xxxxxxx").fill(walkin);
  await who.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(`${had} available`), "the till does not show the customer's points").toBeVisible({ timeout: 15_000 });
  expect(await tender(page, "Card")).toBe(3363);
  await complete(page, request);
  remember({ settingsStageSales: Number(record().settingsStageSales ?? 0) + 1 });
  expect(await points()).toBe(had + 28);

  // Twenty of them, at Rs 2 each, take Rs 40 off the goods: 2,810 at 18% = 3,315.80.
  await ring(page, item("oil").name);
  await page.getByTitle(/No customer attached|Customer:/).first().click();
  await who.getByPlaceholder("03xx-xxxxxxx").fill(walkin);
  await who.getByRole("button", { name: "Done" }).click();
  await page.getByPlaceholder("Redeem points").fill("20");
  // Said twice on purpose: beside the box, and in the Discount figure on the money bar.
  await expect(page.getByText("−Rs 40").first()).toBeVisible();
  expect(await tender(page, "Card")).toBe(3315.8);
  const sale = await complete(page, request);
  expect(Number(sale.total)).toBe(3315.8);
  remember({ settingsStageSales: Number(record().settingsStageSales ?? 0) + 1 });
  // Spent twenty; earned on what was left (2,810 → 28).
  expect(await points()).toBe(had + 28 - 20 + 28);

  await restore(request, { loyalty_enabled: false });
});

// ── G11: Receipt ─────────────────────────────────────────────────────

const PAPER = {
  header: "QA HEADER — open 9 to 9",
  footer: "QA FOOTER — no returns without this slip",
  ntn: "1234567-8",
  strn: "32-77-8761-234-56",
  fbr: "POS-998877",
} as const;

test("G11 · Receipt: what is typed is on the preview at once, and on the paper after", async ({ page, request }) => {
  const before = await held(request);

  await openSettings(page, "Receipt");
  await page.getByLabel("Invoice header line").fill(PAPER.header);
  await page.getByLabel("Invoice footer").fill(PAPER.footer);
  await page.getByLabel("NTN").fill(PAPER.ntn);
  await page.getByLabel("STRN").fill(PAPER.strn);
  await page.getByLabel("FBR POS ID").fill(PAPER.fbr);
  await page.getByLabel("Receipt size").selectOption({ label: /80/ } as never).catch(async () => {
    const options = await page.getByLabel("Receipt size").locator("option").allTextContents();
    await page.getByLabel("Receipt size").selectOption({ label: options.find((o) => o.includes("80"))! });
  });

  // BEFORE saving: the preview is the question "what will this look like if I keep it".
  const preview = page.frameLocator('iframe[title="Receipt preview"]');
  await expect(preview.locator("body"), "the preview did not follow what was typed").toContainText(PAPER.header, { timeout: 20_000 });
  await expect(preview.locator("body")).toContainText(PAPER.footer);
  await expect(preview.locator("body")).toContainText(PAPER.ntn);
  await expect(preview.locator("html")).toHaveAttribute("data-roll-mm", "80");

  await save(page);
  expect(await held(request)).toMatchObject({
    invoice_header: PAPER.header, invoice_footer: PAPER.footer, invoice_ntn: PAPER.ntn,
    invoice_strn: PAPER.strn, invoice_fbr_pos_id: PAPER.fbr, receipt_width: "thermal_80",
  });

  // A real sale's real receipt.
  await openTill(page);
  await ring(page, item("soap").name);
  await tender(page, "Card");
  const sale = await complete(page, request);
  remember({ settingsStageSales: Number(record().settingsStageSales ?? 0) + 1 });
  const paper = await request.get(`${API}/sales/${String(sale.id)}/invoice`, { headers: { Accept: "text/html", Authorization: `Bearer ${token()}` } });
  const html = await paper.text();
  for (const line of Object.values(PAPER)) expect(html, `the receipt does not carry "${line}"`).toContain(line);
  expect(html).toContain('data-roll-mm="80"');
  // …and it names who served, which the shop has left switched on.
  expect(html).toContain(record().ownerName);

  // Switched off, the name comes off the paper.
  await openSettings(page, "Receipt");
  await setSwitch(page, "Show who served", false);
  await save(page);
  const again = await (await request.get(`${API}/sales/${String(sale.id)}/invoice`, { headers: { Accept: "text/html", Authorization: `Bearer ${token()}` } })).text();
  expect(again).not.toContain(record().ownerName);

  await restore(request, {
    invoice_header: before.invoice_header ?? null, invoice_footer: before.invoice_footer ?? null,
    invoice_ntn: before.invoice_ntn ?? null, invoice_strn: before.invoice_strn ?? null,
    invoice_fbr_pos_id: before.invoice_fbr_pos_id ?? null, receipt_width: before.receipt_width ?? "standard",
    receipt_show_cashier: before.receipt_show_cashier ?? true,
  });
});

// ── G12: Barcodes ────────────────────────────────────────────────────

test("G12 · Barcode labels: what a label carries is chosen beside the label, said to be saved, and kept", async ({ page, request }) => {
  // These were two switches under Settings → Barcodes, two screens from the
  // sticker they changed. They are on the screen that draws the label now.
  await restore(request, { barcode_show_name: true, barcode_show_price: true });

  await page.goto("/tenant/labels");
  await settled(page);
  const fields = page.getByTestId("label-fields");
  await expect(fields, "the Labels screen did not start from the shop's own choice").toContainText("Price", { timeout: 15_000 });

  await fields.click();
  await page.getByRole("checkbox", { name: "Price", exact: true }).uncheck();
  await page.getByRole("heading", { name: "Barcode labels" }).click();
  await expect(fields).not.toContainText("Price");
  // WHICH settings are in force, said — not left to be guessed.
  await expect(page.getByTestId("label-settings-state")).toContainText("Saved for your shop", { timeout: 15_000 });
  await expect.poll(async () => (await held(request)).barcode_show_price, { message: "the choice made on the Labels screen was not saved" }).toBe(false);

  // …and it is still the shop's choice on the next visit.
  await page.reload();
  await settled(page);
  await expect(page.getByTestId("label-fields")).toContainText("Product name", { timeout: 15_000 });
  await expect(page.getByTestId("label-fields")).not.toContainText("Price");

  // Settings no longer holds a second copy of it — it points here.
  await openSettings(page, "Barcodes");
  await expect(toggle(page, "Show price")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Barcode Labels →" })).toBeVisible();

  await restore(request, { barcode_show_price: true });
});

test("G12 · Scale barcodes: a label from the scale rings the item at the weight on it", async ({ page, request, watch, context }) => {
  const sugar = (await ask<Array<Record<string, unknown>>>(request, "owner", `/products?search=${encodeURIComponent(item("sugar").name)}`))[0];

  // The scale's own number for sugar, on the item. Set on the item's own
  // screen once; this stage only reads it back.
  if (!sugar.plu_code) {
    await page.goto(`/tenant/products/${String(sugar.id)}/edit`);
    const editor = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /^Edit / }) });
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.getByRole("button", { name: "Codes & packs" }).click();
    await editor.getByLabel("Scale PLU code").fill("21");
    await editor.getByRole("button", { name: /^Save/ }).click();
    await expect(editor).toBeHidden({ timeout: 20_000 });
  }

  await openSettings(page, "Barcodes");
  await setSwitch(page, "Read weighing-scale labels", true);
  await page.getByLabel("Prefix").fill("2");
  // By value: the box's greyed-out hint is also the word "Weight".
  await page.getByLabel("Label encodes").selectOption("weight");
  await save(page);
  expect(await held(request)).toMatchObject({ scale_barcode_enabled: true, scale_barcode_prefix: "2", scale_barcode_mode: "weight" });

  // 2 · 000021 · 01500 · 0  — sugar, 1.500 kg.
  await openTill(page);
  const search = page.getByPlaceholder(/scan barcode or search/i).first();
  await search.fill("2000021015000");
  await search.press("Enter");
  const line = page.locator("[data-cart-row]").filter({ hasText: item("sugar").name });
  await expect(line, "the scale's label did not ring the item").toBeVisible({ timeout: 15_000 });
  await expect(line.locator("input").first()).toHaveValue("1.5");
  // 1.5 kg at 160, tax-exempt.
  expect(await tender(page, "Card")).toBe(240);

  // ── AND WITH THE LINE DOWN ──────────────────────────────────────────
  //
  // Online the server reads the label. Offline the till looked the thirteen
  // digits up as an ordinary barcode and said "Nothing here matches" — a mart
  // whose line dropped could not sell anything it weighs.
  await page.keyboard.press("Escape");
  await line.getByRole("button", { name: "Remove" }).click();
  await expect(page.locator("[data-cart-row]")).toHaveCount(0);

  // The device has to HOLD the shop's answer first: wait for its own copy of
  // the settings to say scale labels are on, rather than for a number of seconds.
  await expect.poll(async () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((done, fail) => {
      const open = indexedDB.open("shopos-till");
      open.onsuccess = () => done(open.result);
      open.onerror = () => fail(open.error);
    });
    const rows = await new Promise<Array<Record<string, unknown>>>((done) => {
      if (!db.objectStoreNames.contains("settings")) { done([]); return; }
      const all = db.transaction("settings").objectStore("settings").getAll();
      all.onsuccess = () => done(all.result as Array<Record<string, unknown>>);
      all.onerror = () => done([]);
    });
    db.close();

    return rows.some((r) => r.scale_barcode_enabled === true);
  }), { timeout: 30_000, message: "the till never took its own copy of the scale settings" }).toBe(true);

  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine), "the browser did not go offline, so this would be an online scan").toBe(false);
  try {
    // 0.347 kg this time: a different label for the same sugar, which is why no index could hold them.
    await search.fill("2000021003470");
    await search.press("Enter");
    await expect(line, "with the line down the scale's label rang nothing").toBeVisible({ timeout: 15_000 });
    await expect(line.locator("input").first()).toHaveValue("0.347");
    // …and the cashier is told what the label said, as they are online.
    await expect(page.getByText(/0\.347 .* weighed/).first()).toBeAttached();
  } finally {
    await context.setOffline(false);
  }
  await expect.poll(async () => page.evaluate(() => navigator.onLine)).toBe(true);
  await page.waitForTimeout(1500);
  await line.locator("input").first().fill("1.5");
  await line.locator("input").first().press("Enter");

  // Switched off, the same label is just a number nothing answers to. The
  // cart still holds the sugar from a moment ago (a reload keeps the cart);
  // the question is whether a SECOND scan adds to it.
  await restore(request, { scale_barcode_enabled: false });
  watch.expect(/POS_ITEM_NOT_FOUND/);
  await openTill(page);
  await expect(page.locator("[data-cart-row]")).toHaveCount(1, { timeout: 15_000 });
  await page.getByPlaceholder(/scan barcode or search/i).first().fill("2000021015000");
  await page.getByPlaceholder(/scan barcode or search/i).first().press("Enter");
  // The till says it found nothing, in words…
  await expect(page.getByText(/No item found for that code|Nothing here matches/).first()).toBeVisible({ timeout: 15_000 });
  // …and the cart is as it was: one line, still a kilo and a half.
  await expect(page.locator("[data-cart-row]")).toHaveCount(1);
  await expect(line.locator("input").first()).toHaveValue("1.5");

  // Leave the till empty for whoever comes next.
  await line.getByRole("button", { name: "Remove" }).click();
  await expect(page.locator("[data-cart-row]")).toHaveCount(0);
});

// ── G13: Hardware ────────────────────────────────────────────────────

const PRINTER = "QA Counter printer";

test("G13 · Hardware: a 58mm printer is added, its test page is a 58mm roll, and receipts follow it", async ({ page, request }) => {
  await page.addInitScript(() => {
    window.print = () => {
      const rules: string[] = [];
      const walk = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          if (rule.cssText.startsWith("@page")) rules.push(rule.cssText);
          const inner = (rule as CSSGroupingRule).cssRules;
          if (inner) walk(inner);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
      (window.top as unknown as { __page?: unknown }).__page = { roll: document.documentElement.getAttribute("data-roll-mm"), rules, text: document.body.innerText };
    };
  });

  await openSettings(page, "Hardware");
  const row = page.getByRole("listitem").filter({ hasText: PRINTER });
  if ((await row.count()) === 0) {
    await page.getByRole("button", { name: "+ Add device" }).click();
    const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add device" }) });
    await form.getByLabel("Type", { exact: true }).selectOption("receipt_printer");
    await form.getByLabel("Name", { exact: true }).fill(PRINTER);
    await form.getByLabel("Paper size", { exact: true }).selectOption("58mm");
    await form.getByRole("button", { name: "Add device" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText("Receipt printer · Browser (print dialog)");

  // TEST PRINT goes out as the roll the device holds — through the same door a receipt does.
  await row.getByRole("button", { name: "Test print" }).click();
  const handed = await page.waitForFunction(() => (window as unknown as { __page?: unknown }).__page, null, { timeout: 20_000 });
  const test_ = (await handed.jsonValue()) as { roll: string | null; rules: string[]; text: string };
  expect(test_.roll).toBe("58");
  expect(test_.rules.filter((r) => /size:/.test(r)).at(-1)).toMatch(/size: 58mm \d+mm/);
  expect(test_.text).toContain("Test print OK");

  // The shop's own setting says A4; this printer says 58mm; the printer wins.
  await restore(request, { receipt_width: "standard" });
  await openTill(page);
  await ring(page, item("soap").name);
  await tender(page, "Card");
  const sale = await complete(page, request);
  remember({ settingsStageSales: Number(record().settingsStageSales ?? 0) + 1 });
  const paper = await request.get(`${API}/sales/${String(sale.id)}/invoice`, { headers: { Accept: "text/html", Authorization: `Bearer ${token()}` } });
  expect(paper.headers()["x-receipt-paper"]).toBe("thermal_58");
  expect(await paper.text()).toContain('data-roll-mm="58"');
});

test("G13 · Hardware: the form says what each connection will really do", async ({ page }) => {
  await openSettings(page, "Hardware");
  await page.getByRole("button", { name: "+ Add device" }).click();
  const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add device" }) });
  const means = form.getByTestId("connection-means");

  // A printer prints through the print window whatever is chosen…
  await form.getByLabel("Type", { exact: true }).selectOption("receipt_printer");
  await expect(means).toContainText("print window");
  // …and choosing the network does not mean the till talks to it.
  await form.getByLabel("Connection", { exact: true }).selectOption("lan");
  await expect(means).toContainText("does not connect to the printer itself");
  await expect(form.getByText("The till does not connect to this address.")).toBeVisible();

  // A drawer opens from the till over a serial line, on a computer — and nowhere else.
  await form.getByLabel("Type", { exact: true }).selectOption("cash_drawer");
  await form.getByLabel("Connection", { exact: true }).selectOption("bluetooth");
  await expect(means).toContainText("cannot open a drawer over this connection");
  await form.getByLabel("Connection", { exact: true }).selectOption("serial");
  await expect(means).toContainText("Chrome or Edge on a computer only");
  await expect(means).toContainText("not on an iPad");

  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toBeHidden();
});

test("G13 · Hardware: the printer is removed, and receipts go back to the shop's own paper", async ({ page, request }) => {
  await openSettings(page, "Hardware");
  const row = page.getByRole("listitem").filter({ hasText: PRINTER });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  const confirm = page.getByRole("dialog").last();
  await confirm.getByRole("button", { name: /^(Remove|Delete)/ }).click();
  await expect(page.getByRole("listitem").filter({ hasText: PRINTER })).toHaveCount(0, { timeout: 15_000 });

  const last = (await ask<Array<Record<string, unknown>>>(request, "owner", "/sales?per_page=1"))[0];
  const paper = await request.get(`${API}/sales/${String(last.id)}/invoice`, { headers: { Accept: "text/html", Authorization: `Bearer ${token()}` } });
  expect(paper.headers()["x-receipt-paper"]).toBe("standard");
});

// ── G9: one screen must not undo another ─────────────────────────────

test("G9 · saving one tab does not put back a setting somebody changed elsewhere", async ({ page, request }) => {
  const before = await held(request);

  // The Settings screen is open, holding what the shop was set to a moment ago.
  await openSettings(page, "Barcodes");

  // Meanwhile something else changes a setting this screen is not showing —
  // the Appearance panel, a second tab, the owner's phone.
  await restore(request, { invoice_footer: "QA — changed somewhere else" });

  // The person on this screen flips one switch and saves.
  const moved = await setSwitch(page, "Read weighing-scale labels", !(before.scale_barcode_enabled as boolean));
  expect(moved).toBe(true);
  await save(page);

  const after = await held(request);
  expect(after.scale_barcode_enabled).toBe(!(before.scale_barcode_enabled as boolean));
  expect(after.invoice_footer, "Save on one tab put back a setting that was changed elsewhere").toBe("QA — changed somewhere else");

  await restore(request, { invoice_footer: before.invoice_footer ?? null, scale_barcode_enabled: before.scale_barcode_enabled });
});

// ── G5: a second lane. LAST, because a shop with lanes asks which one you are on. ──

const LANE = { name: "QA Lane 2", code: "L2" } as const;

test("G5 · A register is added, the till asks which lane it is, and remembers", async ({ page }) => {
  await openSettings(page, "Point of Sale", "Lanes & PINs");
  await expect(page.getByRole("heading", { name: "Registers" })).toBeVisible({ timeout: 20_000 });
  const lanes = page.locator("body");
  if ((await lanes.getByText(LANE.name, { exact: true }).count()) === 0) {
    await lanes.getByRole("button", { name: "+ Add register" }).click();
    const form = page.getByRole("dialog").filter({ hasText: "Short code" });
    await form.getByPlaceholder("e.g. Lane 1").fill(LANE.name);
    await form.getByPlaceholder("e.g. L1").fill(LANE.code);
    await form.getByRole("button", { name: /^(Add register|Add|Save)$/ }).click();
    await expect(page.getByText("Register added")).toBeVisible({ timeout: 15_000 });
  }
  await expect(lanes.getByRole("listitem").filter({ hasText: LANE.name })).toContainText("Free");

  // The till did not ask before, because there was nothing to ask about.
  await openTill(page);
  const chip = page.getByTitle("Which register is this device?");
  await expect(chip, "a shop with a lane does not ask which lane this till is").toBeVisible({ timeout: 15_000 });
  await expect(chip).toContainText("Pick register");

  await chip.click();
  const picker = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "This register" }) });
  await picker.getByRole("button", { name: new RegExp(LANE.name) }).click();
  await expect(chip).toContainText(LANE.name);

  // Remembered on this device across a reload.
  await page.reload();
  await expect(page.getByTitle("Which register is this device?")).toContainText(LANE.name, { timeout: 30_000 });
});

test("G5 · The register is removed, and the till stops asking", async ({ page }) => {
  await openSettings(page, "Point of Sale", "Lanes & PINs");
  await expect(page.getByRole("heading", { name: "Registers" })).toBeVisible({ timeout: 20_000 });
  const lanes = page.locator("body");
  const row = lanes.getByRole("listitem").filter({ hasText: LANE.name });
  await expect(row).toBeVisible({ timeout: 20_000 });

  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("dialog").filter({ hasText: `Remove ${LANE.name}?` }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Register removed")).toBeVisible({ timeout: 15_000 });
  await expect(lanes.getByText(LANE.name, { exact: true })).toHaveCount(0);

  await openTill(page);
  await expect(page.getByTitle("Which register is this device?")).toHaveCount(0);
});
