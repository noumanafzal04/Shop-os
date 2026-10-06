import fs from "node:fs";
import type { APIRequestContext, Page } from "@playwright/test";
import { API } from "../api";
import { OWNER_STATE, ask, expect, record, remember, session, settled, test } from "./kit";
import { item } from "./shop";
import { complete, grandTotal, openTill, ring, tender, tenderSheet } from "./till";

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

// ── G9: one screen must not undo another ─────────────────────────────

test("G9 · saving one tab does not put back a setting somebody changed elsewhere", async ({ page, request }) => {
  const before = await held(request);

  // The Settings screen is open, holding what the shop was set to a moment ago.
  await openSettings(page, "Barcodes");

  // Meanwhile something else changes a setting this screen is not showing —
  // the Appearance panel, a second tab, the owner's phone.
  await restore(request, { invoice_footer: "QA — changed somewhere else" });

  // The person on this screen flips one switch and saves.
  const moved = await setSwitch(page, "Show price", !(before.barcode_show_price as boolean));
  expect(moved).toBe(true);
  await save(page);

  const after = await held(request);
  expect(after.barcode_show_price).toBe(!(before.barcode_show_price as boolean));
  expect(after.invoice_footer, "Save on one tab put back a setting that was changed elsewhere").toBe("QA — changed somewhere else");

  await restore(request, { invoice_footer: before.invoice_footer ?? null, barcode_show_price: before.barcode_show_price });
});
