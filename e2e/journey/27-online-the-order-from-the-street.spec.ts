import fs from "node:fs";
import type { APIRequestContext, Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { OWNER_STATE, TRADE, ask, expect, record, remember, rupees, session, settled, test } from "./kit";
import { addItem, type Item } from "./shop";

/**
 * STAGE P — AN ONLINE SHOP'S OWN DAY.
 *
 * Stages A and B are the same for every trade. An online shop has no till:
 * every rupee it takes comes through an ORDER, from somebody it has never met.
 * So this stage is lived from both sides of the screen:
 *
 *   the shop says what it costs to deliver, the least it will deliver, and
 *   when delivery is free — and a stranger can see all three BEFORE ordering
 *
 *   a stranger finds the shop, makes an account, fills a basket and is told
 *   the whole price — delivery included — before pressing Place order
 *
 *   the shop takes the order through its stages, gives it to a rider, and
 *   the customer watches it move; delivered is a sale
 *
 *   the rider comes back with the cash, and hands it over
 *
 *   a customer changes their mind while the order is still new
 *
 * Run with `JOURNEY_TRADE=online`, after stages 01 and 02 for that trade.
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "online", "an online shop's stage — run with JOURNEY_TRADE=online");
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Row = Record<string, unknown>;

// Exempt on purpose: this stage is about the order, and the totals it checks
// are easier to read without a tax line. Stage C is where tax is judged.
const CAKE: Item = { key: "cake", name: "QA Chocolate Fudge Cake", price: 2400, taxRate: 0, effectiveTax: 0 };
const BROWNIES: Item = { key: "brownies", name: "QA Walnut Brownies Box", price: 900, taxRate: 0, effectiveTax: 0 };
const CUPCAKES: Item = { key: "cupcakes", name: "QA Vanilla Cupcakes Box", price: 600, taxRate: 0, effectiveTax: 0 };

const TERMS = { fee: 200, minimum: 1000, freeAbove: 5000 } as const;
const ADDRESS = "House 12, Street 4, Gulberg III, Lahore";
const RIDER = { name: "QA Rider Asif", phone: "03001250001" } as const;

const product = async (request: APIRequestContext, name: string): Promise<Row | undefined> =>
  (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`)).find((p) => p.name === name);
type Order = Row & { id: string; order_number: string; status: string; total: string; delivery_fee: string; items?: Row[]; sale_id?: string | null };
const orders = async (request: APIRequestContext) => ask<Order[]>(request, "owner", "/orders?per_page=50");
const orderNo = async (request: APIRequestContext, number: string) => (await orders(request)).find((o) => o.order_number === number);

// ── the customer: a stranger with their own browser ──────────────────

const CUSTOMER_STATE = `e2e/.journey/${TRADE}-customer.json`;
/** A browser nobody has signed in to. */
const NOBODY = { cookies: [], origins: [] };
const customer = () => {
  const stamp = String(record().stamp);

  return { name: "QA Online Customer", email: `qa-online-customer-${stamp}@qa.test`, phone: `0301${stamp.replace(/\D/g, "").slice(-7)}`, password: "Customer-pass-1" };
};

/**
 * A browser that is the customer's and nobody else's.
 *
 * Signed in through the storefront's own forms: made on the first run, signed
 * in to on every run after. Its session is kept beside the shop's record.
 */
async function asCustomer(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const young = fs.existsSync(CUSTOMER_STATE) && Date.now() - fs.statSync(CUSTOMER_STATE).mtimeMs < 30 * 60_000;
  // Explicitly NOBODY otherwise: a new context takes the file's `use` options,
  // and that is the shop owner's session.
  const context = await browser.newContext({ storageState: young ? CUSTOMER_STATE : NOBODY });
  const page = await context.newPage();
  if (young) return { context, page };

  const who = customer();
  if (!record().customerMade) {
    await page.goto("/signup");
    await page.getByPlaceholder("Your name").fill(who.name);
    await page.getByPlaceholder("you@example.com").fill(who.email);
    await page.getByPlaceholder("+92…").fill(who.phone);
    await page.getByPlaceholder("Min. 8 characters").fill(who.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).not.toHaveURL(/\/signup/, { timeout: 20_000 });
    remember({ customerMade: true });
  } else {
    await page.goto("/signin");
    await page.getByPlaceholder("you@business.com").fill(who.email);
    await page.getByPlaceholder("Enter your password").fill(who.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL(/\/signin/, { timeout: 20_000 });
  }
  await context.storageState({ path: CUSTOMER_STATE });

  return { context, page };
}

const shopPath = () => `/shop/${String(record().slug)}`;
const card = (page: Page, name: string): Locator => page.locator("article").filter({ hasText: name }).first();

async function basketOf(page: Page, items: Array<{ name: string; qty: number }>): Promise<void> {
  // Whatever an earlier run left in this browser's basket goes first.
  await page.goto("/cart");
  await settled(page);
  const removeAll = page.getByRole("button", { name: "Remove all" });
  if (await removeAll.isVisible().catch(() => false)) {
    await removeAll.click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove them" }).click();
    await expect(page.getByRole("heading", { name: "Your basket is empty" })).toBeVisible({ timeout: 10_000 });
  }

  await page.goto(shopPath());
  await settled(page);
  for (const item of items) {
    const tile = card(page, item.name);
    await expect(tile, `${item.name} is not in the shop`).toBeVisible({ timeout: 20_000 });
    await tile.getByRole("button", { name: "Add", exact: true }).click();
    for (let n = 1; n < item.qty; n++) await tile.getByRole("button", { name: `One more ${item.name}` }).click();
  }
}

// ── the shop's side ──────────────────────────────────────────────────

/**
 * Counted onto the shelf, at Inventory, as a shop does after a bake.
 *
 * The journey's shop was given every module in stage A, inventory with them,
 * so what it lists is counted — and a thing nobody has counted is, correctly,
 * out of stock to a customer. A shop that does not count stock (an Online
 * Store as the platform proposes it) never meets this.
 */
async function stockUp(page: Page, name: string, qty: number): Promise<void> {
  await page.goto("/tenant/inventory");
  await page.getByPlaceholder("Search products…").fill(name);
  const row = page.getByRole("row").filter({ hasText: name }).first();
  await row.getByRole("button", { name: "Adjust", exact: true }).click();
  const sheet = page.getByRole("dialog").filter({ hasText: `Adjust stock — ${name}` });
  await sheet.getByRole("button", { name: "Recount", exact: true }).click();
  await sheet.getByLabel("New counted quantity", { exact: true }).fill(String(qty));
  await sheet.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });
}

async function settingsTab(page: Page, tab: string): Promise<void> {
  await page.goto("/tenant/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible({ timeout: 20_000 });
  await settled(page);
  await page.getByRole("button", { name: tab, exact: true }).click();
}

const orderRow = (page: Page, number: string): Locator => page.getByRole("row").filter({ hasText: number });
const orderSheet = (page: Page): Locator => page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Close" }) });

async function openOrder(page: Page, number: string): Promise<Locator> {
  await page.goto("/tenant/orders");
  await settled(page);
  await orderRow(page, number).getByRole("button", { name: number, exact: true }).click();
  const sheet = orderSheet(page);
  await expect(sheet).toBeVisible({ timeout: 15_000 });

  return sheet;
}

test("P1 · the shop says what delivery costs, the least it delivers, and when it is free — and stocks its shelf", async ({ page, request }) => {
  const shop = await ask<Row>(request, "owner", "/shop");
  remember({ slug: String(shop.slug) });

  if (Number(shop.delivery_fee) !== TERMS.fee) {
    await settingsTab(page, "Business");
    await page.getByLabel("Delivery fee (Rs)", { exact: true }).fill(String(TERMS.fee));
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 15_000 });
  }

  const prefs = await ask<Row>(request, "owner", "/shop/settings");
  if (Number(prefs.min_order_amount) !== TERMS.minimum || Number(prefs.free_delivery_threshold) !== TERMS.freeAbove || !prefs.delivery_enabled) {
    await settingsTab(page, "Tax & Delivery");
    const delivery = page.getByRole("switch", { name: /^Delivery/ });
    if ((await delivery.getAttribute("aria-checked")) !== "true") await delivery.click();
    await page.getByLabel("Minimum order (Rs)", { exact: true }).fill(String(TERMS.minimum));
    await page.getByLabel("Free delivery above (Rs)", { exact: true }).fill(String(TERMS.freeAbove));
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText("Settings saved.").first()).toBeVisible({ timeout: 15_000 });
  }

  for (const item of [CAKE, BROWNIES, CUPCAKES]) {
    if (!(await product(request, item.name))) await addItem(page, item);
    if (Number((await product(request, item.name))!.stock_quantity) < 10) await stockUp(page, item.name, 20);
  }

  expect(Number((await ask<Row>(request, "owner", "/shop")).delivery_fee)).toBe(TERMS.fee);
  const saved = await ask<Row>(request, "owner", "/shop/settings");
  expect(Number(saved.min_order_amount)).toBe(TERMS.minimum);
  expect(Number(saved.free_delivery_threshold)).toBe(TERMS.freeAbove);
  for (const item of [CAKE, BROWNIES, CUPCAKES]) expect(Number((await product(request, item.name))!.price)).toBe(item.price);
});

test("P2 · a stranger finds the shop, and can read its terms before ordering anything", async ({ browser }) => {
  const context = await browser.newContext({ storageState: NOBODY });
  const page = await context.newPage();

  // Found by what it sells, from the marketplace's own search.
  await page.goto("/shops");
  const search = page.getByLabel("Search products and shops", { exact: true });
  await search.fill(BROWNIES.name);
  await search.press("Enter");
  const found = card(page, BROWNIES.name);
  await expect(found, "the shop's brownies cannot be found on the marketplace").toBeVisible({ timeout: 20_000 });
  await found.locator(`a[href="${shopPath()}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`${shopPath()}$`), { timeout: 20_000 });

  for (const item of [CAKE, BROWNIES, CUPCAKES]) await expect(card(page, item.name)).toContainText(`Rs ${item.price.toLocaleString("en-US")}`, { timeout: 20_000 });

  // What it costs to have it brought, the least it will bring, and when it is free.
  const header = page.locator("main");
  await expect(header).toContainText(`Delivery Rs ${TERMS.fee}`);
  // What kind of shop it is, by name — the key was printed here.
  await expect(header, "the shop's kind is printed as a key").not.toContainText(/[a-z]+_[a-z]+/);
  await expect(header, "a stranger cannot see the least the shop will deliver").toContainText(`Minimum order Rs ${TERMS.minimum.toLocaleString("en-US")}`);
  await expect(header, "a stranger cannot see when delivery is free").toContainText(`Free delivery above Rs ${TERMS.freeAbove.toLocaleString("en-US")}`);

  await context.close();
});

test("P3 · a customer makes an account and is told the whole price — delivery and the minimum — before ordering", async ({ browser }) => {
  // Lived every run: a basket is filled and priced, and nothing is placed.
  const { context, page } = await asCustomer(browser);

  // One box of brownies: below the minimum for delivery.
  await basketOf(page, [{ name: BROWNIES.name, qty: 1 }]);
  await page.goto("/checkout");
  const shopCard = page.locator("section").filter({ hasText: BROWNIES.name }).first();
  await expect(shopCard, "the checkout did not say the basket is short of the minimum").toContainText(
    `Minimum order for delivery is Rs ${TERMS.minimum.toLocaleString("en-US")} — add Rs ${TERMS.minimum - BROWNIES.price} more, or collect it.`,
    { timeout: 20_000 },
  );
  await shopCard.getByPlaceholder("Delivery address").fill(ADDRESS);
  await expect(page.getByRole("button", { name: /^Place order/ }), "an order below the minimum could be sent, to be refused").toBeDisabled();

  // Collected, it has no minimum and nothing to deliver.
  await shopCard.getByRole("button", { name: "I'll collect it" }).click();
  await expect(page.getByTestId("checkout-total"), "collecting it still charged delivery").toHaveText(`Rs ${BROWNIES.price}`);
  await expect(page.getByRole("button", { name: "Place order", exact: true })).toBeEnabled();

  // A box of cupcakes too: 1,500, above the minimum, below free delivery.
  await basketOf(page, [{ name: BROWNIES.name, qty: 1 }, { name: CUPCAKES.name, qty: 1 }]);
  await page.goto("/checkout");
  await shopCard.getByPlaceholder("Delivery address").fill(ADDRESS);
  await expect(shopCard, "the checkout does not say what delivery costs").toContainText(`Delivery Rs ${TERMS.fee}`, { timeout: 20_000 });
  await expect(shopCard, "the checkout does not say when delivery would be free").toContainText(
    `Add Rs ${(TERMS.freeAbove - BROWNIES.price - CUPCAKES.price).toLocaleString("en-US")} more and delivery is free.`,
  );
  const total = BROWNIES.price + CUPCAKES.price + TERMS.fee;
  await expect(page.getByTestId("checkout-total"), "the customer was not told the whole price before ordering").toHaveText(`Rs ${total.toLocaleString("en-US")}`);
  await expect(page.getByRole("button", { name: "Place order", exact: true })).toBeEnabled();
  await context.close();
});

test("P3b · the order is placed — and the customer's own record of it adds up, in words", async ({ browser, request }) => {
  const total = BROWNIES.price + CUPCAKES.price + TERMS.fee;
  const { context, page } = await asCustomer(browser);

  if (!record().firstOrder) {
    await basketOf(page, [{ name: BROWNIES.name, qty: 1 }, { name: CUPCAKES.name, qty: 1 }]);
    await page.goto("/checkout");
    await page.locator("section").filter({ hasText: BROWNIES.name }).first().getByPlaceholder("Delivery address").fill(ADDRESS);
    await expect(page.getByTestId("checkout-total")).toHaveText(`Rs ${total.toLocaleString("en-US")}`, { timeout: 20_000 });
    await page.getByRole("button", { name: "Place order", exact: true }).click();
    await expect(page).toHaveURL(/\/my-orders/, { timeout: 20_000 });
    const placed = page.locator("div.rounded-2xl").filter({ hasText: BROWNIES.name }).first();
    const number = (await placed.innerText()).match(/ORD-\d+/)?.[0];
    expect(number, "the customer's order has no number on it").toBeTruthy();
    remember({ firstOrder: number });
  }

  const number = String(record().firstOrder);
  const order = (await orderNo(request, number))!;
  expect(order, "the shop has no such order").toBeTruthy();
  expect(Number(order.total)).toBe(total);
  expect(Number(order.delivery_fee)).toBe(TERMS.fee);

  // Their own record: the lines, the delivery, a total that adds up — and
  // where it is, in words rather than a status code.
  await page.goto("/my-orders");
  const mine = page.locator("div.rounded-2xl").filter({ hasText: number }).first();
  await expect(mine).toContainText(`Rs ${total.toLocaleString("en-US")}`, { timeout: 20_000 });
  await expect(mine, "the order's total is more than its lines, and nothing says why").toContainText(`DeliveryRs ${TERMS.fee}`);
  const words: Record<string, string> = { pending: "Waiting for the shop", out_for_delivery: "On the way", completed: "Delivered" };
  if (words[order.status]) await expect(mine, "the customer is shown a status code").toContainText(words[order.status]);
  await expect(mine).not.toContainText(/pending|out for delivery|completed/);
  await context.close();
});

test("P4 · the shop takes the order through its stages, gives it to a rider — and the customer watches it move", async ({ page, request, browser }) => {
  const number = String(record().firstOrder);

  // A rider of the shop's own.
  const riders = await ask<Array<Row & { name: string }>>(request, "owner", "/riders");
  if (!riders.some((r) => r.name === RIDER.name)) {
    await page.goto("/tenant/riders");
    await page.getByPlaceholder("e.g. Ahmed").fill(RIDER.name);
    await page.getByPlaceholder("+92…").first().fill(RIDER.phone);
    // The first "+ Add" is the one beside the name; the second adds by rider id.
    await page.getByRole("button", { name: "+ Add" }).first().click();
    await expect(page.getByRole("row").filter({ hasText: RIDER.name })).toBeVisible({ timeout: 15_000 });
  }

  if ((await orderNo(request, number))!.status === "pending") {
    const sheet = await openOrder(page, number);
    await expect(sheet).toContainText(ADDRESS);
    await expect(sheet).toContainText(BROWNIES.name);
    await sheet.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(async () => (await orderNo(request, number))!.status).toBe("confirmed");
  }
  if ((await orderNo(request, number))!.status === "confirmed") {
    const sheet = await openOrder(page, number);
    await sheet.getByRole("button", { name: "Start preparing" }).click();
    await expect.poll(async () => (await orderNo(request, number))!.status).toBe("preparing");
  }
  if ((await orderNo(request, number))!.status === "preparing") {
    const sheet = await openOrder(page, number);
    await sheet.getByLabel(`Rider for ${number}`).selectOption({ label: RIDER.name });
    await expect.poll(async () => String(((await orderNo(request, number)) as Row).rider_id ?? "")).not.toBe("");
    await sheet.getByRole("button", { name: "Out for delivery" }).click();
    await expect.poll(async () => (await orderNo(request, number))!.status).toBe("out_for_delivery");
  }

  // The customer sees it on its way — in words, not a status code.
  const { context, page: theirs } = await asCustomer(browser);
  await theirs.goto("/my-orders");
  const mine = theirs.locator("div.rounded-2xl").filter({ hasText: number }).first();
  if ((await orderNo(request, number))!.status === "out_for_delivery") {
    await expect(mine, "the customer cannot see that the order is on its way").toContainText("On the way", { timeout: 20_000 });
  }
  await context.close();

  if ((await orderNo(request, number))!.status === "out_for_delivery") {
    const sheet = await openOrder(page, number);
    await sheet.getByRole("button", { name: "Complete" }).click();
    await expect.poll(async () => (await orderNo(request, number))!.status).toBe("completed");
  }

  // Delivered is a sale — of the GOODS. The delivery charge stays on the order
  // and is the rider's (OrderService::complete; P5 sees it on the settlement).
  const done = (await orderNo(request, number))!;
  expect(done.status).toBe("completed");
  expect(done.sale_id, "a delivered order wrote no sale").toBeTruthy();
  const sale = await ask<Row>(request, "owner", `/sales/${String(done.sale_id)}`);
  expect(Number(sale.total), "the sale is not the goods the customer bought").toBe(BROWNIES.price + CUPCAKES.price);
  expect(Number(done.total) - Number(sale.total), "what is not in the sale is not the delivery charge").toBe(TERMS.fee);
});

test("P5 · the rider comes back with the cash, and hands it over", async ({ page, request }) => {
  const rider = () => ask<Array<Row & { name: string; cash_in_hand?: number }>>(request, "owner", "/riders").then((rs) => rs.find((r) => r.name === RIDER.name)!);
  const total = Number((await orderNo(request, String(record().firstOrder)))!.total);

  if (Number((await rider()).cash_in_hand ?? 0) > 0) {
    await page.goto("/tenant/riders");
    const row = page.getByRole("row").filter({ hasText: RIDER.name });
    await expect(row, "the rider's cash is not what the customer paid").toContainText(`Rs ${total.toLocaleString("en-US")}`, { timeout: 15_000 });
    await row.getByRole("button", { name: "Settle cash" }).click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Settle with ${RIDER.name}` }) });
    await expect(sheet).toContainText(String(record().firstOrder));
    // Of the cash, the delivery charge is what the rider earned.
    await expect(sheet, "the settlement does not say what the rider earned").toContainText(`Rs ${TERMS.fee} is what the rider earned`);
    await sheet.getByRole("button", { name: "Cash received" }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
  }

  expect(Number((await rider()).cash_in_hand ?? 0), "the rider still holds the shop's cash").toBe(0);
});

test("P6 · a customer changes their mind while the order is still new — and the shop sees it cancelled", async ({ browser, page, request }) => {
  if (!record().secondOrder) {
    const { context, page: theirs } = await asCustomer(browser);
    await basketOf(theirs, [{ name: CAKE.name, qty: 1 }]);
    await theirs.goto("/checkout");
    const shopCard = theirs.locator("section").filter({ hasText: CAKE.name }).first();
    await shopCard.getByRole("button", { name: "I'll collect it" }).click();
    await expect(theirs.getByTestId("checkout-total"), "collecting it still charged delivery").toHaveText(`Rs ${CAKE.price.toLocaleString("en-US")}`);
    await theirs.getByRole("button", { name: "Place order", exact: true }).click();
    await expect(theirs).toHaveURL(/\/my-orders/, { timeout: 20_000 });
    const mine = theirs.locator("div.rounded-2xl").filter({ hasText: CAKE.name }).first();
    const number = (await mine.innerText()).match(/ORD-\d+/)?.[0];
    remember({ secondOrder: number });

    await mine.getByRole("button", { name: "Cancel", exact: true }).click();
    await theirs.getByRole("button", { name: "Cancel order" }).click();
    await expect(theirs.getByText("Order cancelled").first()).toBeVisible({ timeout: 15_000 });
    await context.close();
  }

  const order = (await orderNo(request, String(record().secondOrder)))!;
  expect(order.status).toBe("cancelled");

  await page.goto("/tenant/orders");
  await settled(page);
  const row = orderRow(page, String(record().secondOrder));
  await expect(row).toContainText(/Cancelled/i, { timeout: 15_000 });
  // Nothing to move it on to.
  await expect(row.getByRole("button", { name: /Confirm|Start preparing|Complete/ })).toHaveCount(0);
  expect(rupees(`Rs ${order.total}`)).toBe(CAKE.price);
});
