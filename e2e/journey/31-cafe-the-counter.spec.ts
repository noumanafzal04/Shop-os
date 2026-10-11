import fs from "node:fs";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { API } from "../api";
import { ADMIN_STATE, OWNER_STATE, TRADE, Watch, ask, expect, record, remember, rupees, session, settled, test } from "./kit";
import { editor } from "./shop";
import { complete, grandTotal, openTill, ring, tender, tenderSheet } from "./till";

/**
 * STAGE U — A CAFÉ'S DAY.
 *
 * A café is a "Food & Restaurant" business with nobody sitting down. There
 * is no floor and there are no tabs: a customer stands at the counter, says
 * what they want, pays, and waits with a slip in their hand while the bar
 * makes it. Stage H rang one plain takeaway on the way past. This is the
 * whole day of a shop that does nothing else:
 *
 *   the tables are taken away — and the counter and the pass are left
 *
 *   a coffee comes in sizes, has a question that must be answered (which
 *   milk?) and extras that cost
 *
 *   the order is rung at the counter: size, answer, extra — and the figure
 *   on the button is the figure charged
 *
 *   it is paid FIRST, and the bar and the kitchen are each sent their own
 *   slip, with the size and the extras and no prices
 *
 *   the receipt in the customer's hand says what the cup is
 *
 *   a note too small for the bill is said to be too small
 *
 * Run with `JOURNEY_TRADE=food`, after stages 01 and 02 for that trade.
 *
 * The bill, worked out here:
 *
 *     1 × Caffe Latte, Large        550
 *         oat milk                   80
 *         extra shot                 90      720
 *     1 × Club Sandwich                      650
 *                                          1,370
 *     tax at 5%                            68.50
 *                                       1,438.50      paid 1,500 — 61.50 back
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "food", "a café's stage — run with JOURNEY_TRADE=food");
test.beforeAll(async ({ browser }) => {
  await session(browser, "admin");
  await session(browser, "owner");
});
test.use({ storageState: OWNER_STATE });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4173";

const TAX = 5;
const STATIONS = ["Bar", "Kitchen"] as const;
const LATTE = {
  name: "QA Caffe Latte",
  station: "Bar",
  // Typed small first, the way a menu board reads. By name it is Large, Small.
  sizes: [{ name: "Small", price: 450 }, { name: "Large", price: 550 }],
  groups: [
    { name: "Milk", kind: "Choice", min: 1, max: 1, options: [{ name: "Regular", plus: 0 }, { name: "Oat", plus: 80 }] },
    { name: "Extras", kind: "Add-on", min: 0, max: 2, options: [{ name: "Extra shot", plus: 90 }, { name: "Vanilla", plus: 60 }] },
  ],
} as const;
const SANDWICH = { name: "QA Club Sandwich", price: 650, station: "Kitchen" } as const;
const BILL = { latte: 550 + 80 + 90, subtotal: 1370, tax: 68.5, total: 1438.5 } as const;

type Row = Record<string, unknown>;

const token = (): string => {
  const state = JSON.parse(fs.readFileSync(OWNER_STATE, "utf8")) as { origins: Array<{ localStorage: Array<{ name: string; value: string }> }> };
  const auth = state.origins.flatMap((o) => o.localStorage).find((i) => i.name === "shopos-auth")!;

  return (JSON.parse(auth.value) as { state: { accessToken: string } }).state.accessToken;
};

const product = async (request: APIRequestContext, name: string): Promise<Row | undefined> =>
  (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`)).find((p) => p.name === name);

/** Everything handed to a printer, in order. */
async function watchThePrinter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.print = () => {
      const top = window.top as unknown as { __handed?: unknown[] };
      top.__handed = top.__handed ?? [];
      top.__handed.push({ title: document.title, text: document.body.innerText });
    };
  });
}
const handed = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __handed?: unknown[] }).__handed ?? []) as never) as Promise<Array<{ title: string; text: string }>>;

const search = (page: Page): Locator => page.getByPlaceholder(/scan barcode or search/i).first();
const cart = (page: Page): Locator => page.locator("[data-cart-row]");

test("U1 · the admin takes the tables away: a café keeps its counter and its pass, and has no floor", async ({ page, browser, request, watch }) => {
  const r = record();

  const context = await browser.newContext({ baseURL: BASE, storageState: ADMIN_STATE });
  const admin = await context.newPage();
  const seen = new Watch(admin);
  try {
    await admin.goto(`/admin/tenants/${r.tenantId}`);
    await expect(admin.getByRole("heading", { name: r.business })).toBeVisible({ timeout: 20_000 });
    await settled(admin);

    const tables = admin.getByRole("switch", { name: "Dine-in / Tables", exact: true });
    await expect(tables).toBeVisible();
    if ((await tables.getAttribute("aria-checked")) === "true") {
      await tables.click();
      await expect(tables).toHaveAttribute("aria-checked", "false");
      // The pass is NOT taken with it: a takeaway counter needs exactly that.
      await expect(admin.getByRole("switch", { name: "Kitchen Tickets (KOT)", exact: true })).toHaveAttribute("aria-checked", "true");
      await admin.getByRole("button", { name: "Save modules" }).click();
      await expect(admin.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });
    }
    await admin.waitForTimeout(400);
    expect(seen.unexpected(), "the server refused something the admin's screen asked for").toEqual([]);
  } finally {
    await context.close();
  }

  const me = await ask<{ tenant: { features: Record<string, boolean> } }>(request, "owner", "/auth/me");
  expect(me.tenant.features.dine_in, "the shop still has a floor").toBe(false);
  expect(me.tenant.features.kitchen, "the pass went with the tables").toBe(true);
  expect(me.tenant.features.pos).toBe(true);

  // ── the owner's side ──────────────────────────────────────────────
  await page.goto("/tenant");
  await settled(page);
  const full = page.getByRole("button", { name: "Full view" });
  if (await full.isVisible().catch(() => false)) await full.click();
  const nav = page.getByRole("navigation").first();
  await expect(nav.getByRole("link", { name: "Dine-in", exact: true }), "a shop with no tables is still offered the floor").toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Kitchen", exact: true }), "the pass is not in the menu").toBeVisible();
  await expect(nav.getByRole("link", { name: "POS", exact: true })).toBeVisible();

  // The counter has no door to a floor that is not there.
  await openTill(page);
  await expect(page.getByRole("link", { name: /Floor/ }), "the till still points at the floor").toHaveCount(0);

  // …and typing the address does not get round it.
  watch.expect(/MODULE_DISABLED/);
  await page.goto("/tenant/dine-in");
  await settled(page);
  await expect(page.getByRole("button", { name: /^QA T\d/ }), "the floor opened for a shop without one").toHaveCount(0);
});

test("U2 · the bar and the kitchen are two stations, and the tax a cup is charged", async ({ page, request }) => {
  await page.goto("/tenant/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible({ timeout: 20_000 });
  await settled(page);

  await page.getByRole("button", { name: "Tax & Delivery", exact: true }).click();
  await page.getByLabel("Default tax %", { exact: true }).fill(String(TAX));

  await page.getByRole("button", { name: "Point of Sale", exact: true }).click();
  await page.getByRole("button", { name: "Kitchen", exact: true }).click();
  const stations = page.getByLabel("Stations");
  await stations.click();
  await stations.press("ControlOrMeta+a");
  await stations.press("Delete");
  await stations.pressSequentially(STATIONS[0]);
  await stations.press("Enter");
  await stations.pressSequentially(STATIONS[1]);

  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Settings saved.").first()).toBeVisible({ timeout: 15_000 });

  const held = await ask<Row>(request, "owner", "/shop/settings");
  expect(Number(held.default_tax_rate)).toBe(TAX);
  expect(held.kitchen_stations).toEqual([...STATIONS]);
});

test("U3 · the menu: a latte in two sizes with a question and extras, and a sandwich", async ({ page, request }) => {
  if (!(await product(request, LATTE.name))) {
    await page.goto("/tenant/products/new");
    const form = editor(page);
    await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });
    await form.getByLabel("Name *", { exact: true }).fill(LATTE.name);
    await form.getByLabel("Price *", { exact: true }).fill(String(LATTE.sizes[0].price));
    const description = form.getByLabel("Description *", { exact: true });
    if (await description.isVisible().catch(() => false)) await description.fill("Double shot, steamed milk.");
    await form.locator("select").filter({ has: page.locator("option", { hasText: "Default kitchen" }) }).selectOption({ label: LATTE.station });

    await form.getByRole("button", { name: "Sizes & options" }).click();
    await form.getByRole("button", { name: "+ Add sizes or colours" }).click();
    await form.getByLabel("What varies").fill("Size");
    for (const size of LATTE.sizes) {
      const box = form.getByLabel("Add a Size");
      await box.fill(size.name);
      await box.press("Enter");
    }
    await expect(form.getByText("2 sizes")).toBeVisible();
    for (const size of LATTE.sizes) await form.getByLabel(`Price for ${size.name}`).fill(String(size.price));

    const create = form.getByRole("button", { name: "Create item" });
    await expect(create).toBeEnabled();
    await create.click();
    await expect(form).toBeHidden({ timeout: 20_000 });
  }

  const latte = (await product(request, LATTE.name))!;
  expect(latte, `${LATTE.name} is not on the menu`).toBeTruthy();
  remember({ latte: String(latte.id) });

  if (((await ask<Row & { modifier_groups?: Row[] }>(request, "owner", `/products/${String(latte.id)}`)).modifier_groups ?? []).length === 0) {
    await page.goto(`/tenant/products/${String(latte.id)}/edit`);
    const form = editor(page);
    await expect(form.getByRole("heading", { name: /^Edit / })).toBeVisible({ timeout: 20_000 });
    await settled(page);
    await form.getByRole("button", { name: "Sizes & options" }).click();

    for (const [n, group] of LATTE.groups.entries()) {
      await form.getByRole("button", { name: "+ Group" }).click();
      const card = form.getByPlaceholder("Group name e.g. Crust").nth(n).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
      await card.getByPlaceholder("Group name e.g. Crust").fill(group.name);
      await card.locator("select").selectOption({ label: group.kind });
      const counts = card.getByRole("spinbutton");
      await counts.nth(0).fill(String(group.min));
      await counts.nth(1).fill(String(group.max));
      for (const [o, option] of group.options.entries()) {
        if (o > 0) await card.getByRole("button", { name: "+ Option" }).click();
        await card.getByPlaceholder("Option e.g. Stuffed").nth(o).fill(option.name);
        await card.getByPlaceholder("+ price").nth(o).fill(String(option.plus));
      }
    }
    await form.getByRole("button", { name: "Save modifiers" }).click();
    await expect(form.getByRole("button", { name: "Saved ✓" })).toBeVisible({ timeout: 15_000 });
  }

  if (!(await product(request, SANDWICH.name))) {
    await page.goto("/tenant/products/new");
    const form = editor(page);
    await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });
    await form.getByLabel("Name *", { exact: true }).fill(SANDWICH.name);
    await form.getByLabel("Price *", { exact: true }).fill(String(SANDWICH.price));
    const description = form.getByLabel("Description *", { exact: true });
    if (await description.isVisible().catch(() => false)) await description.fill("Chicken, egg, toasted.");
    await form.locator("select").filter({ has: page.locator("option", { hasText: "Default kitchen" }) }).selectOption({ label: SANDWICH.station });
    await form.getByRole("button", { name: "Create item" }).click();
    await expect(form).toBeHidden({ timeout: 20_000 });
  }

  const held = await ask<Row & { variants: Row[]; modifier_groups: Array<Row & { options: Row[] }> }>(request, "owner", `/products/${String(latte.id)}`);
  // Small, then Large — as the board reads, not as a dictionary sorts.
  expect(held.variants.map((v) => [v.name, Number(v.price)])).toEqual(LATTE.sizes.map((s) => [s.name, s.price]));
  expect(held.kitchen_station).toBe(LATTE.station);
  const milk = held.modifier_groups.find((g) => g.name === "Milk")!;
  const extras = held.modifier_groups.find((g) => g.name === "Extras")!;
  expect([Number(milk.min_select), Number(milk.max_select)]).toEqual([1, 1]);
  expect(milk.options.map((o) => [o.name, Number(o.price_delta)])).toEqual([["Regular", 0], ["Oat", 80]]);
  expect(extras.options.map((o) => [o.name, Number(o.price_delta)])).toEqual([["Extra shot", 90], ["Vanilla", 60]]);
  expect(Number((await product(request, SANDWICH.name))!.price)).toBe(SANDWICH.price);
});

test("U4 · the counter is opened", async ({ page, request }) => {
  await openTill(page);
  if (!(await ask<unknown>(request, "owner", "/pos/session"))) {
    await page.getByRole("button", { name: "Open shift" }).first().click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Open shift" }) });
    await sheet.getByRole("spinbutton").first().fill("5000");
    await sheet.getByRole("button", { name: "Open", exact: true }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
  }
  await expect(page.getByText(/Shift open/).first()).toBeVisible({ timeout: 15_000 });
});

test("U5 · a large oat latte with an extra shot and a club sandwich: rung, paid first, and both stations are sent their slip", async ({ page, request }) => {
  await watchThePrinter(page);

  // Rung ONCE: a second run of this case finds the order it already rang.
  let invoice = String(record().cafeInvoice ?? "");
  if (!invoice) {
    await openTill(page);

    // ── the latte: size, then the question ──────────────────────────
    await search(page).fill(LATTE.name);
    const tile = page.locator("[data-pos-item]").filter({ hasText: LATTE.name }).first();
    await expect(tile).toBeVisible({ timeout: 15_000 });
    await tile.click();
    const which = page.getByRole("dialog", { name: LATTE.name });
    await expect(which, "a cup in two sizes was not asked about").toBeVisible({ timeout: 10_000 });
    // Small first, as the menu was written.
    expect(await which.locator("[data-pos-size]").evaluateAll((chips) => chips.map((c) => c.getAttribute("data-pos-size")))).toEqual(LATTE.sizes.map((s) => s.name));
    await which.locator('[data-pos-size="Large"]').click();

    const options = page.getByRole("dialog", { name: `Options for ${LATTE.name}` });
    await expect(options, "the milk was not asked about").toBeVisible({ timeout: 10_000 });
    const add = options.getByRole("button", { name: /^Add · / });
    // The question that must be answered opens ON its usual answer — regular
    // milk, at nothing extra — so a plain latte is one more tap, not three.
    await expect(options.getByText("Choose 1 · required")).toBeVisible();
    await expect(add).toContainText("550");
    await options.getByRole("button", { name: /^Oat/ }).click();
    await expect(add, "oat milk is 80 more and the button did not say so").toContainText("630");
    await options.getByRole("button", { name: /^Extra shot/ }).click();
    // 550 + 80 + 90: the button says what the cup will cost before it is added.
    await expect(add).toContainText("720");
    await add.click();
    await expect(options).toBeHidden();
    await search(page).fill("");

    const cup = cart(page).filter({ hasText: LATTE.name }).first();
    await expect(cup).toContainText("Large");
    await expect(cup, "the bill does not say what is in the cup").toContainText(/Oat/);
    await expect(cup).toContainText(/Extra shot/);
    await expect(cup).toContainText("720");

    await ring(page, SANDWICH.name);

    // 720 + 650 = 1,370.  5% = 68.50.  Bill 1,438.50.
    expect(await grandTotal(page)).toBe(BILL.total);
    expect(await tender(page, "Cash")).toBe(BILL.total);
    await page.getByPlaceholder("Cash tendered").fill("1500");
    await expect(tenderSheet(page).getByText(/Change due/i).locator("..")).toContainText("61.5");
    const sale = await complete(page, request);

    expect(Number(sale.subtotal)).toBe(BILL.subtotal);
    expect(Number(sale.tax)).toBe(BILL.tax);
    expect(Number(sale.total)).toBe(BILL.total);
    expect(sale.items).toHaveLength(2);
    const latte = sale.items.find((i) => i.product_name === LATTE.name)!;
    expect(latte.variant_name).toBe("Large");
    expect(Number(latte.line_total)).toBe(BILL.latte);
    invoice = String(sale.invoice_number);
    remember({ cafeInvoice: invoice, cafeSale: String(sale.id) });

    // Paid, and THEN made: the bar and the kitchen are each sent their own.
    await expect.poll(async () => (await handed(page)).filter((d) => /^KOT #/.test(d.title)).length, {
      timeout: 20_000, message: "an order paid at the counter did not send each station its slip",
    }).toBe(2);
    const slips = (await handed(page)).filter((d) => /^KOT #/.test(d.title));
    const bar = slips.find((d) => d.text.includes(LATTE.name))!;
    const kitchen = slips.find((d) => d.text.includes(SANDWICH.name))!;
    expect(bar, "the bar was not sent the latte").toBeTruthy();
    expect(kitchen, "the kitchen was not sent the sandwich").toBeTruthy();
    expect(bar.text, "the bar was sent the kitchen's sandwich").not.toContain(SANDWICH.name);
    for (const word of ["Large", "Oat", "Extra shot"]) expect(bar.text, `the bar's slip does not say "${word}"`).toMatch(new RegExp(word, "i"));
    expect(bar.text, "the bar was given prices").not.toMatch(/Rs\s?\d/);
  }

  // ── the paper in the customer's hand ──────────────────────────────
  const res = await request.get(`${API}/sales/${String(record().cafeSale)}/invoice`, { headers: { Accept: "text/html", Authorization: `Bearer ${token()}` } });
  expect(res.ok(), `the receipt could not be read (${res.status()})`).toBeTruthy();
  const slip = (await res.text()).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  for (const word of [LATTE.name, "Large", "Oat", "Extra shot", SANDWICH.name]) expect(slip, `the receipt does not say "${word}"`).toContain(word);
  expect(slip).toContain("1,370");
  expect(slip).toContain("68.5");
  expect(slip).toContain("1,438.5");
});

test("U6 · the pass shows the order under its receipt number, and each station works its own ticket off", async ({ page }) => {
  const invoice = String(record().cafeInvoice);

  await page.goto("/tenant/kitchen");
  await expect(page.getByRole("heading", { name: "Kitchen", exact: true })).toBeVisible({ timeout: 20_000 });
  await settled(page);

  // Nobody gave a name, so each card is HEADED by the receipt number — the
  // one thing in the customer's hand that says which cup is theirs.
  const cards = page.getByRole("article").filter({ has: page.getByRole("heading", { name: invoice, exact: true }) });
  await expect(cards, "the order is not on the pass as a ticket for each station").toHaveCount(2, { timeout: 20_000 });
  const ticket = (dish: string) => cards.filter({ hasText: dish });
  await expect(ticket(LATTE.name)).toContainText("Takeaway");
  await expect(ticket(LATTE.name)).toContainText(STATIONS[0]);
  await expect(ticket(SANDWICH.name)).toContainText(STATIONS[1]);
  // What the barista reads is the cup, not just the drink's name.
  for (const word of ["Large", "Oat", "Extra shot"]) await expect(ticket(LATTE.name), `the bar's ticket does not say "${word}"`).toContainText(new RegExp(word, "i"));

  for (const dish of [LATTE.name, SANDWICH.name]) {
    const card = ticket(dish);
    await card.getByRole("button", { name: "Start cooking", exact: true }).click();
    await card.getByRole("button", { name: "Ready", exact: true }).click();
    await card.getByRole("button", { name: "Served", exact: true }).click();
    await expect(card, `${dish} is still on the pass after it was handed over`).toHaveCount(0, { timeout: 15_000 });
  }
});

test("U7 · the next cup is for here, at table 2: it is paid at the counter, and the bar is told where to take it", async ({ page, request }) => {
  await watchThePrinter(page);

  let invoice = String(record().cafeHereInvoice ?? "");
  if (!invoice) {
    await openTill(page);

    // A café has no floor — so the counter itself asks: to take away, or for here?
    const here = page.getByRole("button", { name: "Dine-in", exact: true });
    await expect(here, "a counter with no floor cannot say an order is for here").toBeVisible();
    await here.click();
    await page.getByPlaceholder("Table #").fill("2");

    await search(page).fill(LATTE.name);
    await page.locator("[data-pos-item]").filter({ hasText: LATTE.name }).first().click();
    await page.getByRole("dialog", { name: LATTE.name }).locator('[data-pos-size="Small"]').click();
    const options = page.getByRole("dialog", { name: `Options for ${LATTE.name}` });
    await options.getByRole("button", { name: /^Add · / }).click();
    await expect(options).toBeHidden();
    await search(page).fill("");

    // 450 and its 22.50 of tax.
    expect(await tender(page, "Card")).toBe(472.5);
    const sale = await complete(page, request);
    expect(Number(sale.total)).toBe(472.5);
    expect(sale.order_type).toBe("dine_in");
    expect(sale.table_no).toBe("2");
    invoice = String(sale.invoice_number);
    remember({ cafeHereInvoice: invoice });

    // THE BAR IS TOLD. It was not: an order rung "for here" at a counter was
    // paid for and never reached the pass, on paper or on the screen.
    await expect.poll(async () => (await handed(page)).filter((d) => /^KOT #/.test(d.title)).length, {
      timeout: 20_000, message: "a cup paid for at the counter, to have here, was never sent to the bar",
    }).toBe(1);
    const slip = (await handed(page)).find((d) => /^KOT #/.test(d.title))!;
    expect(slip.text, "the bar's slip does not say which table").toContain("Table 2");
    expect(slip.text).toMatch(/Small/i);
    expect(slip.text).not.toMatch(/TAKEAWAY/);
  }

  await page.goto("/tenant/kitchen");
  await expect(page.getByRole("heading", { name: "Kitchen", exact: true })).toBeVisible({ timeout: 20_000 });
  await settled(page);

  // Headed by where it goes — and it is not going in a bag.
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Table 2", exact: true }) });
  await expect(card, "the cup for table 2 is not on the pass").toHaveCount(1, { timeout: 20_000 });
  await expect(card).toContainText(LATTE.name);
  await expect(card).toContainText("Small");
  await expect(card).toContainText("Dine-in");
  await expect(card).not.toContainText("Takeaway");

  await card.getByRole("button", { name: "Start cooking", exact: true }).click();
  await card.getByRole("button", { name: "Ready", exact: true }).click();
  await card.getByRole("button", { name: "Served", exact: true }).click();
  await expect(card).toHaveCount(0, { timeout: 15_000 });
});

test("U8 · a note too small for the bill is said to be too small — and nothing is sold", async ({ page, request }) => {
  const before = (await ask<Row[]>(request, "owner", "/sales?per_page=30")).length;

  await openTill(page);
  await ring(page, SANDWICH.name);

  // 650 and its 32.50 of tax.
  expect(await tender(page, "Cash")).toBe(682.5);
  await page.getByPlaceholder("Cash tendered").fill("500");

  const outcome = tenderSheet(page).getByTestId("cash-outcome");
  await expect(outcome, "five hundred against 682.50 still reads as change due").toContainText("Still to pay");
  await expect(outcome).toContainText("182.5");
  await expect(tenderSheet(page).getByRole("button", { name: /^Complete/ })).toBeDisabled();

  // The exact money, and it goes.
  await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();
  await expect(outcome).toContainText("Change due");
  await expect(tenderSheet(page).getByRole("button", { name: /^Complete/ })).toBeEnabled();

  // …but this customer walked off for more cash: the sheet is closed, the bill cleared.
  await tenderSheet(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: /^Reset/ }).click();
  const sure = page.getByRole("button", { name: /^(Clear|Yes|Reset) /i }).last();
  if (await sure.isVisible().catch(() => false)) await sure.click();
  await expect(cart(page)).toHaveCount(0, { timeout: 10_000 });

  expect((await ask<Row[]>(request, "owner", "/sales?per_page=30")).length, "a bill that was never paid became a sale").toBe(before);
});

test("U9 · the books have the two bills: what was taken, and the tax that is not the shop's", async ({ page }) => {
  await page.goto("/tenant/reports");
  await settled(page);

  const card = async (label: string): Promise<number> => {
    const value = page.locator(`xpath=//h4[preceding-sibling::*[1][normalize-space(.)="${label}"]]`).first();
    await expect(value, `the "${label}" card is not on the screen`).toBeVisible({ timeout: 20_000 });

    return rupees((await value.innerText()).replace("Rs -", "-"));
  };

  expect(await card("Sales")).toBe(2);
  // 1,438.50 to take away and 472.50 at table 2.
  expect(await card("Revenue")).toBe(1911);
  // 68.50 + 22.50 held for the government.
  expect(await card("Sales Tax (not yours)")).toBe(91);
});
