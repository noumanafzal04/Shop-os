import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { API, foodAuth } from "./api";
import { everyRule, nothingIsWrittenUnderAButton, report } from "./rules";

/**
 * AN ORDER TAKEN ON THE PHONE, in a restaurant.
 *
 * ── What was found ───────────────────────────────────────────────────
 *
 * Found by taking one phone order through its life in a restaurant that had
 * just been set up, the way its owner would:
 *
 *   "none left"        every dish without sizes — made to order, counted by
 *                      nobody — read "none left" and could not be pressed
 *   no size            a dish in sizes went on the order with none, at the
 *                      Half's price, and the kitchen was told nothing
 *   no answer          a dish with a question was refused when the order was
 *                      sent, on a page with nowhere to answer it
 *   "Approximately"    the page added the order up itself; delivery, a coupon
 *                      and what an extra costs were not its to know
 *   the kitchen        "Start preparing" told nobody — the pass stayed empty
 *   one press          "Cancel order" cancelled, there and then, unasked
 *   three presses      a restaurant's own order waited to be accepted, then
 *                      confirmed, then started, before a cook heard of it —
 *                      and no slip printed at any of them
 *   the order sank     the order sat UNDER the menu, further down with every
 *                      "Show more" — then in a tall panel that scrolled
 *                      its own customer away
 *
 * Fixed names; the dishes are carded once and left, and an order this takes
 * is cancelled by its own last step — and by the next run's first, if a run
 * was cut short.
 */

const PLAIN = { name: "E2E Phone Biryani", price: 450 };
const SIZED = {
  name: "E2E Phone Karahi",
  sizes: [{ name: "Half", price: 900 }, { name: "Full", price: 1400 }],
  groups: [
    { name: "Spice", type: "modifier", min_select: 1, max_select: 1, options: [{ name: "Mild", price_delta: 0 }, { name: "Hot", price_delta: 0 }] },
    { name: "Extras", type: "addon", min_select: 0, max_select: 2, options: [{ name: "Extra naan", price_delta: 60 }, { name: "Raita", price_delta: 80 }] },
  ],
};
const CALLER = "E2E Mrs. Khan";

type Row = Record<string, unknown>;

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${API}${path}`, { headers: foodAuth() });
  expect(res.ok(), `GET ${path} → ${res.status()}`).toBeTruthy();

  return ((await res.json()) as { data: T }).data;
}

/** The two dishes, on the menu the way their form would have made them. */
async function theDishes(request: APIRequestContext): Promise<void> {
  const held = await get<Array<Row & { name: string }>>(request, `/products?search=${encodeURIComponent("E2E Phone")}&per_page=20`);
  const make = async (data: Row): Promise<string> => {
    const made = await request.post(`${API}/products`, { headers: foodAuth(), data });
    expect(made.ok(), `the fixture could not be carded (${made.status()} ${await made.text()})`).toBeTruthy();

    return String(((await made.json()) as { data: { id: string } }).data.id);
  };

  if (!held.some((p) => p.name === PLAIN.name)) {
    await make({ item_type: "food_item", name: PLAIN.name, price: PLAIN.price, description: "A fixture: a dish made to order.", is_active: true });
  }
  if (!held.some((p) => p.name === SIZED.name)) {
    const id = await make({
      item_type: "food_item", name: SIZED.name, price: SIZED.sizes[0].price, description: "A fixture: a dish in two sizes, with a question.",
      is_active: true, variants: SIZED.sizes,
    });
    const asked = await request.put(`${API}/products/${id}/modifier-groups`, { headers: foodAuth(), data: { groups: SIZED.groups } });
    expect(asked.ok(), `the dish's questions could not be set (${asked.status()} ${await asked.text()})`).toBeTruthy();
  }
}

/** Any order of this caller's still being worked — left by a run that was cut short — is called off. */
async function nobodyIsWaiting(request: APIRequestContext): Promise<void> {
  const open = await get<Array<Row & { id: string }>>(request, `/orders?search=${encodeURIComponent(CALLER)}&open_only=1&per_page=50`);
  for (const order of open) {
    const res = await request.post(`${API}/orders/${order.id}/cancel`, { headers: foodAuth(), data: { reason: "A test's own order, left behind" } });
    expect(res.ok(), `a left-over order could not be called off (${res.status()})`).toBeTruthy();
  }
}

/** The caller's newest order, as the server has it. */
async function theirOrder(request: APIRequestContext): Promise<Row & { id: string; order_number: string; status: string }> {
  const found = await get<Array<Row & { id: string; order_number: string; status: string }>>(request, `/orders?search=${encodeURIComponent(CALLER)}&per_page=5`);
  expect(found.length, "the order that was taken is not on the server").toBeGreaterThan(0);

  return found[0];
}

/** What is on the kitchen's pass for one order. */
const onThePass = async (request: APIRequestContext, number: string) =>
  (await get<{ kots: Array<Row & { ticket_number: string; items: Array<{ name: string }> }> }>(request, "/restaurant/kitchen")).kots.filter((k) => k.ticket_number === number);

/** An order's card on the board, and the column it is in. */
const card = (page: Page, number: string): Locator => page.locator(`[data-order="${number}"]`);
const column = (page: Page, title: string): Locator => page.getByRole("region", { name: title, exact: true });
const how = (page: Page, which: "Pickup" | "Delivery"): Locator => page.getByRole("radio", { name: which, exact: true });

const tile = (page: Page, name: string): Locator => page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
const chooser = (page: Page): Locator => page.locator('.modal [role="dialog"]').filter({ has: page.getByRole("heading", { name: SIZED.name }) });
const worthBox = (page: Page): Locator => page.getByTestId("order-worth");
const total = (page: Page): Locator => page.getByTestId("order-total");

async function open(page: Page): Promise<void> {
  await page.goto("/tenant/orders/new");
  await expect(page.getByRole("heading", { name: "Take an order" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("searchbox", { name: "Search products" }).fill("E2E Phone");
  await expect(tile(page, PLAIN.name)).toBeVisible({ timeout: 20_000 });
}

/** A Full karahi, hot, with an extra naan: 1,400 + 60. */
async function aFullKarahi(page: Page): Promise<void> {
  await tile(page, SIZED.name).click();
  const sheet = chooser(page);
  await sheet.getByRole("radio", { name: /^Full/ }).click();
  await sheet.getByRole("button", { name: "Hot", exact: true }).click();
  await sheet.getByRole("button", { name: /^Extra naan/ }).click();
  await sheet.getByRole("button", { name: /^Add to order/ }).click();
  await expect(sheet).toBeHidden();
}

test.beforeEach(async ({ request }) => {
  await theDishes(request);
  await nobodyIsWaiting(request);
});

test("a dish made to order can be taken — and one in sizes is asked which, and what with it", async ({ page }, info) => {
  await open(page);

  // MADE TO ORDER IS NOT OUT. Nobody counts a biryani, so its nought is not a shelf.
  await expect(tile(page, PLAIN.name), "a made-to-order dish cannot be pressed").toBeEnabled();
  await expect(tile(page, PLAIN.name)).not.toContainText("none left");
  // A dish in sizes has no one price.
  await expect(tile(page, SIZED.name)).toContainText("from Rs 900");

  // ── asked, before it goes on ───────────────────────────────────────
  await tile(page, SIZED.name).click();
  const sheet = chooser(page);
  const add = sheet.getByRole("button", { name: /^Add to order/ });
  await expect(add, "a dish in sizes can go on the order with no size").toBeDisabled();
  await expect(sheet.getByRole("status")).toHaveText("Choose a size.");
  for (const size of SIZED.sizes) {
    await expect(sheet.getByRole("radio", { name: new RegExp(`^${size.name}`) })).toContainText(`Rs ${size.price.toLocaleString("en-US")}`);
  }

  await sheet.getByRole("radio", { name: /^Full/ }).click();
  await expect(add, "a question that must be answered was skipped").toBeDisabled();
  await expect(sheet.getByRole("status")).toHaveText("Choose one for Spice.");

  await sheet.getByRole("button", { name: "Mild", exact: true }).click();
  await sheet.getByRole("button", { name: "Hot", exact: true }).click(); // one answer replaces the other
  await expect(sheet.getByRole("button", { name: "Mild", exact: true })).toHaveAttribute("aria-pressed", "false");
  await sheet.getByRole("button", { name: /^Extra naan/ }).click();
  await expect(add).toHaveText("Add to order · Rs 1,460");

  // The sheet, while it is open: whole, and nothing written under a button.
  report([...(await nothingIsWrittenUnderAButton(page)), ...(await everyRule(page))], `the size sheet on ${info.project.name}`);

  await add.click();
  await expect(sheet).toBeHidden();

  // ── on the order, written as a waiter writes it ────────────────────
  const line = page.locator(`[data-order-line="${SIZED.name} (Full)"]`);
  await expect(line).toContainText("Hot · Extra naan");
  // The same again is the same line; the other size is another.
  await aFullKarahi(page);
  await expect(page.getByRole("button", { name: `One more ${SIZED.name} (Full)` })).toHaveCount(1);
  await expect(line).toContainText("2");

  await tile(page, SIZED.name).click();
  await chooser(page).getByRole("radio", { name: /^Half/ }).click();
  await chooser(page).getByRole("button", { name: "Mild", exact: true }).click();
  await chooser(page).getByRole("button", { name: /^Add to order/ }).click();
  await expect(page.locator("[data-order-line]")).toHaveCount(2);

  // ── THE ORDER STAYS IN SIGHT, however much is on it ────────────────
  // Arranged like the till: beside the menu, the page does not scroll — the
  // menu scrolls in its pane and the lines in theirs — and what it comes to,
  // with the one button, is along the bottom. (Below that width the order is
  // under the menu, and a bar at the menu's foot leads to it.)
  // The WHOLE menu, and more of it loaded — which is what used to push the order down.
  // Counted by its dishes, and waited for: the first version of this waited on
  // "a ninth button in the menu", which the section chips and the bar already
  // were — so it measured the page while the menu was still arriving, and on a
  // tablet that put a dish under the install card "with nowhere left to scroll".
  const dishes = page.getByRole("region", { name: "Menu" }).locator("[data-rows] > button");
  await page.getByRole("searchbox", { name: "Search products" }).fill("");
  await expect.poll(() => dishes.count(), { message: "this restaurant's menu is too short to push anything anywhere", timeout: 20_000 }).toBeGreaterThan(8);
  const more = page.getByRole("button", { name: /^Show more/ });
  if ((await more.count()) > 0) {
    const first = await dishes.count();
    await more.click();
    await expect.poll(() => dishes.count(), { message: "Show more showed no more", timeout: 20_000 }).toBeGreaterThan(first);
  }
  const take = page.getByRole("button", { name: "Take order" });
  const besideTheMenu = await page.evaluate(() => window.matchMedia("(min-width: 1024px)").matches);
  if (besideTheMenu) {
    const fits = await page.evaluate(() => {
      const el = document.scrollingElement!;

      return { page: el.scrollHeight, screen: window.innerHeight };
    });
    expect(fits.page, "the page scrolls: the order can be pushed out of sight").toBeLessThanOrEqual(fits.screen + 1);
    for (const [what, it] of [["the Take order button", take], ["the customer's name", page.getByLabel("Customer name *", { exact: true })], ["the total", worthBox(page)]] as const) {
      await expect(it, `${what} is not on the screen`).toBeInViewport({ ratio: 1 });
    }
  } else {
    const bar = page.getByTestId("see-the-order");
    await expect(bar, "under the menu, nothing says the order is there").toBeVisible();
    await expect(bar).toContainText("on the order");
    await bar.click();
    await expect(page.locator("[data-order-line]").first()).toBeInViewport();
    // The bar scrolls there smoothly; the rules below measure a page that has stopped.
    let was = -1;
    await expect.poll(async () => {
      const now = await page.evaluate(() => Math.round(window.scrollY));
      const still = now === was;
      was = now;

      return still;
    }, { message: "the page never came to rest", intervals: [200] }).toBe(true);
  }
  report([...(await nothingIsWrittenUnderAButton(page)), ...(await everyRule(page))], `the order, with lines on it, on ${info.project.name}`);
});

test("the figure is the server's: the order, collecting it, and a coupon that is not one", async ({ page, request }) => {
  await open(page);
  await expect(worthBox(page)).toHaveText("Add something to see what it comes to.");
  await expect(page.getByText("Approximately"), "the page is still guessing").toHaveCount(0);

  await aFullKarahi(page);
  await tile(page, PLAIN.name).click();
  await tile(page, PLAIN.name).click();

  // 1,460 + 2 × 450. Asked of the server by this test too — its second opinion.
  const dishes = await get<Array<Row & { name: string; id: string; variants?: Array<{ id: string; name: string }>; modifier_groups?: Array<{ name: string; options: Array<{ id: string; name: string }> }> }>>(
    request, `/products?search=${encodeURIComponent("E2E Phone")}&per_page=20`,
  );
  const karahi = dishes.find((p) => p.name === SIZED.name)!;
  const option = (group: string, name: string) => karahi.modifier_groups!.find((g) => g.name === group)!.options.find((o) => o.name === name)!.id;
  const ask = (more: Row = {}) => request.post(`${API}/orders/worth`, {
    headers: foodAuth(),
    data: {
      channel: "phone", fulfillment_type: "pickup",
      items: [
        { product_id: karahi.id, variant_id: karahi.variants!.find((v) => v.name === "Full")!.id, quantity: 1, modifier_option_ids: [option("Spice", "Hot"), option("Extras", "Extra naan")] },
        { product_id: dishes.find((p) => p.name === PLAIN.name)!.id, quantity: 2 },
      ],
      ...more,
    },
  });

  await how(page, "Pickup").click();
  const said = ((await (await ask()).json()) as { data: { total: number; subtotal: number } }).data;
  expect(said.subtotal).toBe(2360);
  await expect(total(page), "the figure on the page is not the one the order will carry").toHaveText(`Rs ${said.total.toLocaleString("en-US")}`, { timeout: 15_000 });
  await expect(page.getByText("To pay when collecting", { exact: true })).toBeVisible();

  // Delivery is the shop's own to price — the page says whatever it says.
  const delivers = how(page, "Delivery");
  if ((await delivers.count()) > 0) {
    await delivers.click();
    const atTheDoor = ((await (await ask({ fulfillment_type: "delivery" })).json()) as { data: { total: number; delivery_fee: number } }).data;
    await expect(total(page)).toHaveText(`Rs ${atTheDoor.total.toLocaleString("en-US")}`, { timeout: 15_000 });
    // The row's two ends are two elements: there is no space between them in the page's text.
    await expect(worthBox(page)).toContainText(
      atTheDoor.delivery_fee > 0 ? new RegExp(`Delivery\\s*Rs ${atTheDoor.delivery_fee.toLocaleString("en-US")}`) : /Delivery\s*Free/,
    );
  }

  // A coupon that is not one: refused in the server's words, and the order cannot be taken on it.
  const coupon = page.getByLabel("Coupon", { exact: true });
  if ((await coupon.count()) > 0) {
    await coupon.fill("E2E-NO-SUCH-CODE");
    await expect(worthBox(page).getByText("It cannot be taken like this")).toBeVisible({ timeout: 15_000 });
    await expect(total(page)).toHaveCount(0);
    await page.getByLabel("Customer name *", { exact: true }).fill(CALLER);
    await expect(page.getByRole("button", { name: "Take order" }), "an order can be taken at a figure nobody gave").toBeDisabled();
    await coupon.fill("");
    await expect(total(page)).toBeVisible({ timeout: 15_000 });
  }
});

test("taken with the kitchen told now: one press, and it is being prepared, on the pass, and its slip is with the printer", async ({ page, request }, info) => {
  test.skip(info.project.name !== "restaurant", "one order through its life is enough; the page itself is measured on every size above");

  // The shop's own answer to "screen or paper" — paper, for this.
  const set = await request.put(`${API}/shop/settings`, { headers: foodAuth(), data: { kot_auto_print: true } });
  expect(set.ok(), `the shop could not be set to print kitchen slips (${set.status()})`).toBeTruthy();
  // Every document handed to the printer, by any frame, kept in order.
  await page.addInitScript(() => {
    window.print = () => {
      const top = window.top as unknown as { __handed?: string[] };
      top.__handed = [...(top.__handed ?? []), document.body.innerText];
    };
  });

  await open(page);
  await aFullKarahi(page);
  await how(page, "Pickup").click();
  await page.getByLabel("Customer name *", { exact: true }).fill(CALLER);
  await page.getByLabel("Notes", { exact: true }).fill("less oil");
  await expect(total(page)).toHaveText("Rs 1,460", { timeout: 15_000 });
  // On, unasked: a restaurant taking its own order means the kitchen to start.
  await expect(page.getByRole("checkbox", { name: "Send to the kitchen now" }), "a restaurant's own order waits to be accepted before anybody cooks it").toBeChecked();
  await page.getByRole("button", { name: "Take order" }).click();
  await expect(page).toHaveURL(/\/tenant\/orders(\?|$)/, { timeout: 20_000 });

  const order = await theirOrder(request);
  const number = order.order_number;
  expect(order.status, "it was taken, and nobody was told to cook it").toBe("preparing");

  // ── said, on the board, on the pass, and on paper ──────────────────
  await expect(page.getByText(`${number} is with the kitchen — its slip has been sent to the printer.`)).toBeVisible({ timeout: 15_000 });
  await expect(column(page, "Being prepared").locator(card(page, number)), "it is not on the board where the kitchen's work is").toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("being-worked")).toHaveText(/^[1-9]\d*$/);

  const docket = (await onThePass(request, number))[0];
  expect(docket, "the order never reached the kitchen's pass").toBeTruthy();
  expect(docket.table_name, "the pass has nothing to call out").toBe(CALLER);
  expect(docket.notes).toBe("Pickup — less oil");
  expect(docket.items.map((i) => i.name).join(" "), "the kitchen was not told which size").toContain("Full");

  await expect.poll(async () => page.evaluate(() => ((window as unknown as { __handed?: string[] }).__handed ?? []).join("\n")), { message: "no slip was handed to the printer" }).toContain(number);

  // ── called off: it comes off the pass, and is among what was finished today ──
  const off = await request.post(`${API}/orders/${order.id}/cancel`, { headers: foodAuth(), data: { reason: "The caller rang back" } });
  expect(off.ok()).toBeTruthy();
  await page.reload();
  await expect(card(page, number), "a cancelled order is still on the board").toHaveCount(0, { timeout: 15_000 });
  const finished = page.getByRole("region", { name: "Finished today" }).getByRole("row").filter({ hasText: number });
  await expect(finished).toContainText("Cancelled", { timeout: 15_000 });
  await expect.poll(async () => (await onThePass(request, number)).length, { message: "a cook is making a meal nobody will collect" }).toBe(0);

  // ── and it is not among the past: that is every day BEFORE this one ─
  await page.getByRole("tab", { name: "Past orders" }).click();
  await expect(page).toHaveURL(/show=past/);
  await page.getByRole("searchbox", { name: "Search orders" }).fill(number);
  await expect(page.getByText("No past order matches these filters.")).toBeVisible({ timeout: 15_000 });
  // The count of what is being worked is still in sight from here.
  await expect(page.getByTestId("being-worked")).toBeVisible();
});

test("taken for later, it waits as New — the kitchen hears at Start preparing, and cancelling asks first, and why", async ({ page, request }, info) => {
  test.skip(info.project.name !== "restaurant", "one order through its life is enough; the page itself is measured on every size above");

  await open(page);
  await aFullKarahi(page);
  await how(page, "Pickup").click();
  await page.getByLabel("Customer name *", { exact: true }).fill(CALLER);
  await page.getByLabel("Notes", { exact: true }).fill("less oil");
  await expect(total(page)).toHaveText("Rs 1,460", { timeout: 15_000 });
  await page.getByRole("checkbox", { name: "Send to the kitchen now" }).uncheck();
  await page.getByRole("button", { name: "Take order" }).click();
  await expect(page).toHaveURL(/\/tenant\/orders(\?|$)/, { timeout: 20_000 });

  const number = (await theirOrder(request)).order_number;
  expect(number).toMatch(/^ORD-\d+$/);
  await expect(column(page, "New").locator(card(page, number))).toContainText("Rs 1,460", { timeout: 20_000 });
  await expect(card(page, number)).toContainText(CALLER);

  // ── confirmed is not cooking ───────────────────────────────────────
  await card(page, number).getByRole("button", { name: "Confirm" }).click();
  await expect(column(page, "Accepted").locator(card(page, number))).toBeVisible({ timeout: 15_000 });
  expect(await onThePass(request, number), "the kitchen was told to cook an order nobody had started").toHaveLength(0);

  // ── "Start preparing" tells the kitchen ────────────────────────────
  await card(page, number).getByRole("button", { name: number, exact: true }).click();
  const sheet = page.getByRole("dialog", { name: number });
  await expect(sheet).toContainText("Pays when collecting");
  await expect(sheet.getByText(/just now ago|cod unpaid/i), "the sheet still writes its columns out").toHaveCount(0);
  await sheet.getByRole("button", { name: "Start preparing" }).click();
  await expect(sheet).toContainText("Being prepared", { timeout: 15_000 });

  await expect.poll(async () => (await onThePass(request, number)).length, { message: "the order never reached the kitchen's pass" }).toBeGreaterThan(0);
  const docket = (await onThePass(request, number))[0];
  expect(docket.table_name, "the pass has nothing to call out").toBe(CALLER);
  expect(docket.notes).toBe("Pickup — less oil");
  expect(docket.items.map((i) => i.name).join(" "), "the kitchen was not told which size").toContain("Full");

  // ── cancelling asks, and can be turned down ────────────────────────
  await sheet.getByRole("button", { name: "Cancel order" }).click();
  const sure = page.getByRole("dialog", { name: `Cancel ${number}?` });
  await expect(sure, "one press cancelled an order the kitchen is cooking").toBeVisible();
  await expect(sure.getByRole("button", { name: "Cancel order" }), "it can be cancelled without saying why").toBeDisabled();
  await sure.getByRole("button", { name: "Keep it" }).click();
  await expect(sure).toBeHidden();
  expect((await theirOrder(request)).status).toBe("preparing");

  // ── and with a reason, it goes — and comes off the pass ────────────
  await sheet.getByRole("button", { name: "Cancel order" }).click();
  await sure.getByRole("textbox").fill("The caller rang back");
  await sure.getByRole("button", { name: "Cancel order" }).click();
  await expect(sure).toBeHidden({ timeout: 15_000 });

  const mine = await theirOrder(request);
  expect(mine.status).toBe("cancelled");
  expect(mine.cancel_reason, "the customer is told a reason nobody typed").toBe("The caller rang back");
  await expect.poll(async () => (await onThePass(request, number)).length, { message: "a cook is making a meal nobody will collect" }).toBe(0);
  await expect(card(page, number), "a cancelled order is still on the board").toHaveCount(0, { timeout: 15_000 });
});
