import type { Locator, Page } from "@playwright/test";

import { nothingIsWrittenUnderAButton, report } from "../rules";
import { OWNER_STATE, TRADE, ask, expect, record, remember, rupees, session, settled, signIn, test } from "./kit";

/**
 * STAGE W — THE BACK OF THE HOUSE.
 *
 * ── The ask ──────────────────────────────────────────────────────────
 *
 *     "aik complete flow bnao jis main hr page, hr module, hr modal — sb kuch
 *      test ho, kisi aik business type ko leke, real time data k sth … hr flow
 *      jo aik QA human flow hai, data entry ki, shop k according."
 *
 * Stages H and J are the front of a restaurant: a floor, a menu, a table, a
 * bill. This is everything behind the pass — what a restaurant's owner types
 * in the afternoon, between lunch and dinner:
 *
 *   who the kitchen buys from, and a delivery of rice and chicken that moves
 *     the shelf, what the shelf cost, and what a plate of biryani costs
 *   what is owed for it, and half of it paid
 *   a kilo of rice that has gone off
 *   the people: a waiter, a cook, a cashier — each let in at their own door
 *   a regular who eats on account
 *   a coupon and a lunch offer
 *   the shop's own rider
 *   the gas and the rent, entered with a date typed the shop's way
 *
 * Every sheet is opened by its own button and filled by hand, and each is
 * looked at once while it is open: nothing may be written under a button.
 *
 * ── The figures ──────────────────────────────────────────────────────
 *
 *     the delivery   20 kg chicken × 680 = 13,600
 *                    25 kg rice    × 290 =  7,250     owed  20,850
 *     paid           10,000 by bank transfer           owed  10,850
 *     a plate        0.25 kg rice + 0.2 kg chicken, at what each NOW costs —
 *                    the average of what was on the shelf and what arrived
 *
 * Run after stages H and J (`JOURNEY_TRADE=food`): it buys their ingredients.
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "food", "a restaurant's stage — run with JOURNEY_TRADE=food");
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });

const RICE = "QA Basmati Rice";
const CHICKEN = "QA Chicken Boneless";
const BIRYANI = "QA Chicken Biryani";
const LEMONADE = "QA Mint Lemonade";
const PER_PLATE = { rice: 0.25, chicken: 0.2 } as const;

const SUPPLIERS = [
  { name: "QA Butt Poultry & Grains", contact: "Imran Butt", phone: "0421110101" },
  { name: "QA Lahore Gas Agency", contact: "Haji Saleem", phone: "0421110102" },
] as const;
const DELIVERY = {
  supplier: SUPPLIERS[0].name,
  lines: [
    { item: CHICKEN, quantity: 20, cost: 680 },
    { item: RICE, quantity: 25, cost: 290 },
  ],
  total: 20 * 680 + 25 * 290, // 20,850
  paid: 10_000,
} as const;

// What each job is given, and the one thing that tells it from the others:
//   a waiter rings a bill — at THEIR OWN tables, so not "Serve any table"
//   a cook sees the board and nothing about the takings
//   the counter settles whoever's table comes up to pay, and hires nobody
const STAFF = [
  { key: "waiter", name: "QA Bilal (waiter)", job: "Waiter", has: "Sales & invoices", hasNot: "Serve any table" },
  { key: "cook", name: "QA Ustad Rafiq (kitchen)", job: "Kitchen", has: "Kitchen board", hasNot: "Sales & invoices" },
  { key: "cashier", name: "QA Sana (counter)", job: "Cashier", has: "Serve any table", hasNot: "Manage staff" },
] as const;
const PASSWORD = "Journey-staff-1";

const GROUP = { name: "QA Regulars", pct: 10 } as const;
const REGULAR = { name: "QA Ahmed Family", phone: "03004440101", creditLimit: 20_000 } as const;
const COUPON = { code: "QAHOUSE10", pct: 10, minSpend: 1000, cap: 300 } as const;
const OFFER = { name: "QA Lunch Lemonade", pct: 20, item: LEMONADE } as const;
const RIDER = { name: "QA Usman (rider)", phone: "03004440202" } as const;
const EXPENSES = [
  { category: "Cooking Gas", description: "QA gas cylinders ×2", amount: 6400, paidBy: "Bank transfer" },
  { category: "Rent", description: "QA October rent", amount: 85_000, paidBy: "Bank transfer" },
] as const;

type Row = Record<string, unknown>;
type Request = Parameters<typeof ask>[0];

const item = async (request: Request, name: string): Promise<Row> => {
  const found = (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`)).find((p) => p.name === name);
  expect(found, `${name} is not on the shelf — stages H and J have not been lived`).toBeTruthy();

  return found!;
};
const onShelf = async (request: Request, name: string) => {
  const p = await item(request, name);

  return { id: String(p.id), stock: Number(p.stock_quantity), cost: Number(p.cost) };
};

const sheetNamed = (page: Page, name: string | RegExp): Locator => page.getByRole("dialog", { name });
/** A sheet is looked at while it is open: nothing in it may be written under a button. */
async function lookedAt(page: Page, what: string): Promise<void> {
  report(await nothingIsWrittenUnderAButton(page), what);
}

test.describe("as the owner", () => {
  test.use({ storageState: OWNER_STATE });

  test("W1 · the kitchen's suppliers are added, and are on the list owed nothing", async ({ page, request }) => {
    const held = await ask<Row[]>(request, "owner", "/suppliers?per_page=100");

    for (const s of SUPPLIERS) {
      if (held.some((h) => h.name === s.name)) continue; // resumed

      await page.goto("/tenant/suppliers");
      await page.getByRole("button", { name: "+ New supplier" }).click();
      const form = sheetNamed(page, "New supplier");
      await form.getByRole("textbox", { name: "Supplier / company name *" }).fill(s.name);
      await form.getByRole("textbox", { name: "Contact person" }).fill(s.contact);
      await form.getByRole("textbox", { name: "Phone" }).fill(s.phone);
      await lookedAt(page, "the New supplier sheet");
      await form.getByRole("button", { name: "Save" }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
    }

    // Nothing has been bought yet — unless this stage is being resumed, when
    // the first of them is owed for its delivery (W3 says exactly how much).
    const bought = (await ask<Row[]>(request, "owner", "/purchase-orders?per_page=50")).length > 0;

    await page.goto("/tenant/suppliers");
    await settled(page);
    for (const s of SUPPLIERS) {
      const row = page.getByRole("row").filter({ hasText: s.name }).first();
      await expect(row, `${s.name} is not listed`).toBeVisible();
      if (!bought) await expect(row, "a supplier nothing was bought from is shown as owed").toContainText("Settled");
    }
  });

  test("W2 · a delivery of chicken and rice is ordered and received: the shelf goes up, its cost blends — and a plate of biryani costs what they now cost", async ({ page, request }) => {
    const before = { chicken: await onShelf(request, CHICKEN), rice: await onShelf(request, RICE) };
    const received = (await ask<Row[]>(request, "owner", "/purchase-orders?per_page=50")).some((po) => po.status === "received");

    if (!received) {
      // ── written ─────────────────────────────────────────────────────
      await page.goto("/tenant/purchases");
      await page.getByRole("button", { name: "+ New purchase order" }).click();
      const form = sheetNamed(page, "New purchase order");

      const supplier = form.getByLabel("Supplier", { exact: true });
      await expect.poll(async () => (await supplier.locator("option").allTextContents()).join("|")).toContain(DELIVERY.supplier);
      await supplier.selectOption({ label: DELIVERY.supplier });
      // The order's date is today's, written the shop's way — not the browser's.
      await expect(form.getByRole("textbox", { name: "Order date" })).toHaveValue(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);

      for (const line of DELIVERY.lines) {
        await form.getByPlaceholder("Search products to add…").fill(line.item);
        await form.getByRole("button", { name: new RegExp(`^${line.item}`) }).click();
        await form.getByLabel(`Quantity of ${line.item}`).fill(String(line.quantity));
        await form.getByLabel(`Cost each for ${line.item}`).fill(String(line.cost));
      }
      // The form adds it up before anything is sent.
      await expect(form.getByText(/^Rs /).last()).toHaveText(/20,850/);
      await lookedAt(page, "the New purchase order sheet");

      await form.getByRole("button", { name: "Place order" }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });

      const row = page.getByRole("row").filter({ hasText: DELIVERY.supplier }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row).toContainText(/ordered/i);
      await expect(row).toContainText("20,850");
      // Ordering is not receiving.
      expect((await onShelf(request, CHICKEN)).stock, "the shelf moved when the order was only PLACED").toBe(before.chicken.stock);

      // ── arrived ─────────────────────────────────────────────────────
      await row.click();
      const detail = page.getByRole("dialog").filter({ hasText: "Receive all" });
      await expect(detail).toBeVisible();
      await lookedAt(page, "the purchase order's own sheet");
      await detail.getByRole("button", { name: /Receive all/ }).click();
      await expect(page.getByRole("row").filter({ hasText: DELIVERY.supplier }).first()).toContainText(/received/i, { timeout: 20_000 });

      // ── the shelf, and what it cost ─────────────────────────────────
      // Read here, the moment it arrived: later in this stage a kilo of the
      // rice is written off, and a resumed run would count the shelf short.
      const arrived = { chicken: await onShelf(request, CHICKEN), rice: await onShelf(request, RICE) };
      expect(arrived.chicken.stock).toBeCloseTo(before.chicken.stock + 20, 3);
      expect(arrived.rice.stock).toBeCloseTo(before.rice.stock + 25, 3);
      const blended = (b: { stock: number; cost: number }, qty: number, at: number) => (b.stock * b.cost + qty * at) / (b.stock + qty);
      expect(arrived.chicken.cost, "the chicken's cost is not the average of what was there and what arrived").toBeCloseTo(blended(before.chicken, 20, 680), 2);
      expect(arrived.rice.cost).toBeCloseTo(blended(before.rice, 25, 290), 2);
      // And it is NOT simply what the last sack cost.
      expect(arrived.chicken.cost).not.toBe(680);
    }

    const now = { chicken: await onShelf(request, CHICKEN), rice: await onShelf(request, RICE) };

    // ── and the plate ─────────────────────────────────────────────────
    // Nobody types what a biryani costs. It is its rice and its chicken, at
    // what they cost TODAY.
    const biryani = await ask<Row>(request, "owner", `/products/${String((await item(request, BIRYANI)).id)}`);
    const plate = PER_PLATE.rice * now.rice.cost + PER_PLATE.chicken * now.chicken.cost;
    expect(Number(biryani.recipe_cost), "a plate still costs what the ingredients used to").toBeCloseTo(plate, 2);
    remember({ plateCost: Math.round(plate * 100) / 100 });
  });

  test("W3 · the supplier is owed the delivery; ten thousand goes by bank transfer and the rest is still owed", async ({ page, request }) => {
    const owedTo = async () => {
      const s = (await ask<Row[]>(request, "owner", "/suppliers?per_page=100")).find((x) => x.name === DELIVERY.supplier)!;

      return Number(s.balance ?? s.outstanding ?? s.payable ?? NaN);
    };
    const said = async (): Promise<number[]> => {
      await page.goto("/tenant/suppliers");
      await settled(page);
      const row = page.getByRole("row").filter({ hasText: DELIVERY.supplier }).first();
      await expect(row).toBeVisible();

      // The MONEY in the row — its phone number is digits too.
      return ((await row.innerText()).match(/Rs\s?[0-9,]+(?:\.[0-9]+)?/g) ?? []).map(rupees);
    };

    if ((await said()).includes(DELIVERY.total)) {
      const row = page.getByRole("row").filter({ hasText: DELIVERY.supplier }).first();
      await row.getByRole("button", { name: "Pay", exact: true }).click();
      const pay = page.locator('.modal [role="dialog"]').filter({ hasText: "You owe" });
      await expect(pay).toContainText("20,850");
      await pay.getByLabel("Amount", { exact: true }).fill(String(DELIVERY.paid));
      await pay.getByLabel("Payment method", { exact: true }).selectOption({ label: "Bank transfer" });
      await pay.getByLabel("Reference", { exact: true }).fill("QA-TRX-0001");
      await lookedAt(page, "the supplier's Pay sheet");
      await pay.getByRole("button", { name: "Record payment" }).click();
      await expect(pay).toBeHidden({ timeout: 15_000 });
    }

    expect(await said(), "what the Suppliers list says is still owed").toContain(DELIVERY.total - DELIVERY.paid);
    // The other supplier was not paid by mistake, and is not owed.
    await expect(page.getByRole("row").filter({ hasText: SUPPLIERS[1].name }).first()).toContainText("Settled");
    expect(await owedTo(), "the server's figure for what is owed").toBe(DELIVERY.total - DELIVERY.paid);
  });

  test("W4 · a kilo of rice has gone off: it is written off at what it cost, and the shelf is a kilo down", async ({ page, request }) => {
    const before = await onShelf(request, RICE);
    const done = (await ask<Row[]>(request, "owner", "/inventory/disposals")).some((d) => String(d.note ?? d.notes ?? "").includes("QA weevils"));

    if (!done) {
      await page.goto("/tenant/disposals");
      await page.getByRole("button", { name: "+ Write off stock" }).click();
      const form = sheetNamed(page, "Write off stock");
      await form.getByRole("textbox", { name: "Which item" }).fill("QA Basmati");
      // It says how much there is before it is chosen.
      await form.getByRole("button", { name: new RegExp(`^${RICE}`) }).click();
      await expect(form.getByText(/on the shelf right now\./)).toBeVisible();
      await form.getByLabel("How many", { exact: true }).fill("1");
      await form.getByLabel("Where it went", { exact: true }).selectOption({ label: "Binned — the money is gone" });
      await form.getByLabel("Why", { exact: true }).selectOption({ label: "Expired" });
      await form.getByLabel("Note", { exact: true }).fill("QA weevils in the open sack");
      await lookedAt(page, "the Write off stock sheet");
      await form.getByRole("button", { name: "Record", exact: true }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });

      expect((await onShelf(request, RICE)).stock, "a kilo written off is still on the shelf").toBeCloseTo(before.stock - 1, 3);
    }

    // On the list: what, why, how much — and what it cost, which is the point.
    await page.goto("/tenant/disposals");
    await settled(page);
    await page.getByRole("button", { name: "Written off", exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: RICE }).first();
    await expect(row, "the write-off is not on the Disposals list").toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(/Expired/i);
    const cost = ((await row.innerText()).match(/Rs\s?[0-9,]+(?:\.[0-9]+)?/g) ?? []).map(rupees);
    expect(cost.some((c) => Math.abs(c - before.cost) < 1), `a kilo was written off at ${cost.join(", ")}, and a kilo costs about ${before.cost.toFixed(2)}`).toBe(true);
  });

  test("W5 · a waiter, a cook and a cashier are taken on, each from their own job", async ({ page, request }) => {
    const r = record();
    const emailOf = (key: string) => `qa-${key}-${r.stamp}@qa.test`;
    const held = await ask<Row[]>(request, "owner", "/staff?per_page=100");

    for (const person of STAFF) {
      if (held.some((s) => s.email === emailOf(person.key))) continue; // resumed

      await page.goto("/tenant/staff");
      await page.getByRole("button", { name: "+ Add Staff" }).click();
      const form = sheetNamed(page, "Add Staff");
      await form.getByLabel("Name *", { exact: true }).fill(person.name);
      await form.getByLabel("Email", { exact: true }).fill(emailOf(person.key));
      await form.getByLabel("Temp password *", { exact: true }).fill(PASSWORD);

      // The job fills in what that job needs — and nothing it does not.
      await form.getByRole("button", { name: person.job, exact: true }).click();
      await expect(form.getByRole("checkbox", { name: new RegExp(`^${person.has}`) }), `a ${person.job} was not given "${person.has}"`).toBeChecked();
      await expect(form.getByRole("checkbox", { name: new RegExp(`^${person.hasNot}`) }), `a ${person.job} was given "${person.hasNot}"`).not.toBeChecked();
      if (person.key === "waiter") await lookedAt(page, "the Add Staff sheet");

      await form.getByRole("button", { name: "Add staff" }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
    }

    await page.goto("/tenant/staff");
    await settled(page);
    for (const person of STAFF) {
      const row = page.getByRole("row").filter({ hasText: person.name }).first();
      await expect(row, `${person.name} is not on the Staff list`).toBeVisible();
      await expect(row, "the list does not say what they do").toContainText(person.job);
    }
    remember({ houseStaff: Object.fromEntries(STAFF.map((p) => [p.key, emailOf(p.key)])) });
  });

  test("W6 · a regular who eats on account: a group that takes ten percent off, and a limit on what they may owe", async ({ page, request }) => {
    const groups = await ask<Row[]>(request, "owner", "/customer-groups?per_page=100");
    await page.goto("/tenant/customers");
    if (!groups.some((g) => g.name === GROUP.name)) {
      await page.getByRole("button", { name: "Groups" }).click();
      const sheet = sheetNamed(page, "Customer groups");
      await sheet.getByPlaceholder("Group name (e.g. Wholesale)").fill(GROUP.name);
      await sheet.getByPlaceholder("Members' discount %").fill(String(GROUP.pct));
      await lookedAt(page, "the Customer groups sheet");
      await sheet.getByRole("button", { name: "Add", exact: true }).click();
      await expect(sheet.getByText(GROUP.name).first()).toBeVisible({ timeout: 15_000 });
      await sheet.getByRole("button", { name: "Done" }).click();
    }

    if (!(await ask<Row[]>(request, "owner", "/customers?per_page=100")).some((c) => c.phone === REGULAR.phone)) {
      await page.getByRole("button", { name: "+ Add customer" }).click();
      const form = sheetNamed(page, "Add customer");
      await form.getByRole("textbox", { name: "Name *" }).fill(REGULAR.name);
      await form.getByRole("textbox", { name: "Phone" }).fill(REGULAR.phone);
      await form.getByRole("spinbutton", { name: /Credit limit/ }).fill(String(REGULAR.creditLimit));
      await form.getByLabel("Customer group", { exact: true }).selectOption({ label: new RegExp(GROUP.name).source });
      await lookedAt(page, "the Add customer sheet");
      await form.getByRole("button", { name: "Save" }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
    }

    await page.reload();
    await settled(page);
    await expect(page.getByRole("row").filter({ hasText: REGULAR.name }).first()).toBeVisible();

    // What the counter and the table will be told about them.
    const looked = await ask<{ name: string; credit_limit: number | null; group: { name: string; discount_percent: number } | null }>(
      request, "owner", `/customers-lookup?phone=${REGULAR.phone}`,
    );
    expect(looked.name).toBe(REGULAR.name);
    expect(looked.credit_limit).toBe(REGULAR.creditLimit);
    expect(looked.group?.name).toBe(GROUP.name);
    expect(looked.group?.discount_percent).toBe(GROUP.pct);
  });

  test("W7 · a coupon for the house and a lunch offer on the lemonade", async ({ page, request }) => {
    if (!(await ask<Row[]>(request, "owner", "/coupons?per_page=100")).some((c) => c.code === COUPON.code)) {
      await page.goto("/tenant/coupons");
      await page.getByRole("button", { name: "+ New coupon" }).click();
      const form = sheetNamed(page, "New coupon");
      await form.getByPlaceholder("CODE (e.g. EID20)").fill(COUPON.code);
      await form.getByLabel("Coupon type", { exact: true }).selectOption({ label: "Percentage %" });
      await form.getByRole("spinbutton", { name: "Value %" }).fill(String(COUPON.pct));
      await form.getByRole("spinbutton", { name: "Min spend (optional)" }).fill(String(COUPON.minSpend));
      await form.getByRole("spinbutton", { name: "Max discount cap (optional)" }).fill(String(COUPON.cap));
      await lookedAt(page, "the New coupon sheet");
      await form.getByRole("button", { name: "Save" }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
    }
    await page.goto("/tenant/coupons");
    await settled(page);
    await expect(page.getByRole("row").filter({ hasText: COUPON.code }).first()).toBeVisible();

    if (!(await ask<Row[]>(request, "owner", "/promotions")).some((p) => p.name === OFFER.name)) {
      await page.goto("/tenant/promotions");
      await page.getByRole("button", { name: "+ New promotion" }).click();
      const form = sheetNamed(page, "New promotion");
      await form.getByLabel("Name", { exact: true }).fill(OFFER.name);
      await form.getByLabel("Discount", { exact: true }).selectOption({ label: "Percent %" });
      await form.getByLabel("Value", { exact: true }).fill(String(OFFER.pct));
      await form.getByLabel("Applies to", { exact: true }).selectOption({ label: "Specific products" });
      await form.getByLabel("Products", { exact: true }).fill(OFFER.item);
      await form.getByRole("button", { name: new RegExp(OFFER.item) }).first().click();
      await expect(form.getByText(OFFER.item).first(), "the dish did not attach to the offer").toBeVisible();
      await lookedAt(page, "the New promotion sheet");
      await form.getByRole("button", { name: "Create" }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
    }
    await page.goto("/tenant/promotions");
    await settled(page);
    await expect(page.getByText(OFFER.name).first()).toBeVisible();
    // One dish, said as one dish — "1 product", never "1 product(s)".
    await expect(page.getByText("1 product", { exact: true }).first(), "the offer does not say how many dishes it is on, in words").toBeVisible();

    const offer = (await ask<Row[]>(request, "owner", "/promotions")).find((p) => p.name === OFFER.name)!;
    expect(Number(offer.value)).toBe(OFFER.pct);
    expect((offer.product_ids as string[]).length, "the offer names no dish").toBe(1);
  });

  test("W8 · the shop's own rider is added, by a name and a number", async ({ page, request }) => {
    if (!(await ask<Row[]>(request, "owner", "/riders")).some((x) => x.name === RIDER.name)) {
      await page.goto("/tenant/riders");
      await settled(page);
      const add = page.getByRole("button", { name: "+ Add", exact: true }).first();
      await expect(add, "a rider can be added with no name").toBeDisabled();
      await page.getByLabel("Rider name", { exact: true }).fill(RIDER.name);
      await page.getByLabel("Phone (optional)", { exact: true }).fill(RIDER.phone);
      await expect(add).toBeEnabled();
      await add.click();
    }

    await page.goto("/tenant/riders");
    await settled(page);
    await expect(page.getByText(RIDER.name).first(), "the rider is not on the list").toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("No riders yet — add your first rider above.")).toHaveCount(0);
  });

  test("W9 · the gas and the rent are entered, the rent dated the first of the month in the shop's own writing", async ({ page, request }) => {
    const held = await ask<Row[]>(request, "owner", "/expenses?per_page=100");
    const now = new Date();
    const first = `1 ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][now.getMonth()]} ${now.getFullYear()}`;
    const firstIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    for (const e of EXPENSES) {
      if (held.some((h) => h.description === e.description)) continue; // resumed

      await page.goto("/tenant/expenses");
      await page.getByRole("button", { name: "Add expense" }).first().click();
      const form = sheetNamed(page, "Add expense");
      await form.getByLabel("Category *", { exact: true }).selectOption({ label: e.category });
      await form.getByLabel("Description *", { exact: true }).fill(e.description);
      await form.getByLabel("Amount *", { exact: true }).fill(String(e.amount));
      if (e.category === "Rent") {
        // TYPED, the way it is said — and the box keeps it that way.
        const date = form.getByRole("textbox", { name: "Date *" });
        await date.fill(first);
        await date.blur();
        await expect(date).toHaveValue(first);
        await lookedAt(page, "the Add expense sheet");
      }
      await form.getByLabel("Paid by", { exact: true }).selectOption({ label: e.paidBy });
      await form.getByRole("button", { name: "Save expense" }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
    }

    await page.goto("/tenant/expenses");
    await settled(page);
    const saved = await ask<Row[]>(request, "owner", "/expenses?per_page=100");
    const rent = saved.find((h) => h.description === EXPENSES[1].description)!;
    expect(String(rent.expense_date).slice(0, 10), "the date typed is not the date kept").toBe(firstIso);
    expect(Number(rent.amount)).toBe(EXPENSES[1].amount);
    expect(Number(saved.find((h) => h.description === EXPENSES[0].description)!.amount)).toBe(EXPENSES[0].amount);
  });
});

// ── each of them, at their own door ──────────────────────────────────

test("W10 · the cook signs in to the kitchen board and nothing about the takings; the waiter has the floor and not the books", async ({ page, watch }) => {
  const staff = record().houseStaff as Record<string, string>;

  // ── the cook ────────────────────────────────────────────────────────
  await signIn(page, staff.cook, PASSWORD, /\/tenant/);
  await settled(page);
  let nav = page.getByRole("navigation").first();
  await expect(nav.getByRole("link", { name: "Kitchen", exact: true }), "a cook is not offered the kitchen").toBeVisible();
  for (const closed of ["POS", "Sales", "Reports", "Settings", "Staff"]) {
    await expect(nav.getByRole("link", { name: closed, exact: true }), `a cook is offered ${closed}`).toHaveCount(0);
  }
  await page.goto("/tenant/kitchen");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/tenant\/kitchen/);
  // A door they have no key for sends them back, and is not half-shown.
  await page.goto("/tenant/sales");
  await settled(page);
  await expect(page).not.toHaveURL(/\/tenant\/sales/);

  // ── the waiter ──────────────────────────────────────────────────────
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await signIn(page, staff.waiter, PASSWORD, /\/tenant/);
  await settled(page);
  nav = page.getByRole("navigation").first();
  await expect(nav.getByRole("link", { name: "Dine-in", exact: true }), "a waiter is not offered the floor").toBeVisible();
  for (const closed of ["Reports", "Settings", "Staff"]) {
    await expect(nav.getByRole("link", { name: closed, exact: true }), `a waiter is offered ${closed}`).toHaveCount(0);
  }
  await page.goto("/tenant/dine-in");
  await expect(page.getByRole("heading", { name: "Dine-in Floor" })).toBeVisible({ timeout: 20_000 });
  await page.goto("/tenant/settings");
  await settled(page);
  await expect(page).not.toHaveURL(/\/tenant\/settings/);

  expect(watch.unexpected(), "their own screens asked for something they are not allowed").toEqual([]);
});
