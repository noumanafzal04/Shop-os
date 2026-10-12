import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { API, foodAuth, roomToWork } from "./api";
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
 *   which is which     delivery or pickup was two grey words at the foot of a
 *                      card, and a column only a wide screen drew
 *   nobody's name      "Out for delivery" sent an order out of the door
 *                      without asking who had it
 *   nothing said       a new order waited on a screen nobody was looking at:
 *                      no other screen said one had arrived
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
/** Whoever rings the OTHER counter — an order this screen had no hand in. */
const ELSEWHERE = "E2E Mr. Elsewhere";

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

/** Any order of these callers' still being worked — left by a run that was cut short — is called off. */
async function nobodyIsWaiting(request: APIRequestContext): Promise<void> {
  for (const who of [CALLER, ELSEWHERE]) {
    const open = await get<Array<Row & { id: string }>>(request, `/orders?search=${encodeURIComponent(who)}&open_only=1&per_page=50`);
    for (const order of open) {
      const res = await request.post(`${API}/orders/${order.id}/cancel`, { headers: foodAuth(), data: { reason: "A test's own order, left behind" } });
      expect(res.ok(), `a left-over order could not be called off (${res.status()})`).toBeTruthy();
    }
  }
}

/** What this device has kept of the menu's count — `orders/waitingStore.ts`. */
const keptOnTheDevice = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("shopos-orders-waiting");

    return (raw ? (JSON.parse(raw) as { state: { kept: { heard?: string | null; count?: { new: number; being_worked: number } } | null } }).state.kept : null);
  });

/** The caller's newest order, as the server has it. */
async function theirOrder(request: APIRequestContext): Promise<Row & { id: string; order_number: string; status: string }> {
  const found = await get<Array<Row & { id: string; order_number: string; status: string }>>(request, `/orders?search=${encodeURIComponent(CALLER)}&per_page=5`);
  expect(found.length, "the order that was taken is not on the server").toBeGreaterThan(0);

  return found[0];
}

/** What is on the kitchen's pass for one order. */
const onThePass = async (request: APIRequestContext, number: string) =>
  (await get<{ kots: Array<Row & { ticket_number: string; items: Array<{ name: string }> }> }>(request, "/restaurant/kitchen")).kots.filter((k) => k.ticket_number === number);

/** What the menu is told: how many nobody has accepted, and how many are not finished. */
const waiting = (request: APIRequestContext) => get<{ new: number; being_worked: number }>(request, "/orders/waiting");
/** What the count beside "Orders" should be saying, for those two numbers. */
const railSays = (w: { new: number; being_worked: number }): string =>
  `${w.being_worked} ${w.being_worked === 1 ? "order" : "orders"} being worked${w.new > 0 ? `, ${w.new} new` : ""}`;

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
  // One owner, three screen sizes, fifteen tests one after another: the last
  // of them was refused its own shelf (429) by the limit every person is under.
  await roomToWork(request, foodAuth(), 130, "/auth/me");
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
  // Which it is, as a badge beside the number — and a pickup has no rider to be without.
  await expect(card(page, number).locator('[data-how="pickup"]')).toHaveText("Pickup");
  await expect(card(page, number).getByText("no rider")).toHaveCount(0);

  // ── THE MENU SAYS SO, on every screen: counted, and blinking for a new one ──
  const railCount = page.getByTestId("orders-waiting");
  const unanswered = await waiting(request);
  expect(unanswered.new, "an order nobody has accepted is not counted as new").toBeGreaterThan(0);
  await expect(railCount, "nothing beside Orders says an order is waiting").toHaveText(String(unanswered.being_worked), { timeout: 15_000 });
  await expect(railCount).toHaveAttribute("aria-label", railSays(unanswered));
  await expect(railCount, "a new order does not blink").toHaveAttribute("data-alert", "");
  expect(await page.locator(".rail-blink").first().evaluate((el) => getComputedStyle(el).animationName), "the blink is not an animation").toBe("ping");
  // ── THE COUNT IS KEPT, NOT ASKED FOR ───────────────────────────────
  // It was asked on every load and every half minute. Now the device keeps
  // what it was last told, and asks again only on news of an order.
  const asks: string[] = [];
  let asking = 0;
  // The server's address, whole: the dev server also serves two source files
  // named `orders/waiting…`, and the first count of "asks" was of those.
  const theAsk = (url: string) => url.startsWith(`${API}/orders/waiting`);
  page.on("request", (r) => { if (theAsk(r.url())) { asks.push(r.url()); asking += 1; } });
  page.on("requestfinished", (r) => { if (theAsk(r.url())) asking -= 1; });
  page.on("requestfailed", (r) => { if (theAsk(r.url())) asking -= 1; });
  // Taking the order rang this shop's own bell, and the bell's news is one
  // more asking. Waited for by what the device has HEARD, not by the clock:
  // the first run of this waited for "the next answer from the bell" and
  // counted the asking that answer caused.
  const rung = (await get<Array<{ id: string; type: string }>>(request, "/notifications?page=1")).find((n) => n.type.startsWith("order."));
  expect(rung, "taking an order rang nobody's bell").toBeTruthy();
  await expect.poll(async () => (await keptOnTheDevice(page))?.heard, { timeout: 45_000, message: "the bell's news of the order just taken was never acted on" }).toBe(rung!.id);
  await expect.poll(() => asking, { message: "the count was still being asked for" }).toBe(0);
  expect((await keptOnTheDevice(page))?.count, "the device has not kept what the menu shows").toMatchObject(unanswered);
  asks.length = 0;

  // …from a screen that is not Orders, too — the app opened afresh, and the
  // count is there without the server being asked for it.
  await page.goto("/tenant");
  await expect(railCount).toHaveAttribute("aria-label", railSays(unanswered), { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  expect(asks, "opening the app again asked for a count the device already had").toHaveLength(0);

  // An order taken at ANOTHER counter. This screen did nothing and is on
  // another page: it is the bell that says so, and only then is the count
  // asked for — once.
  const menu = await get<Array<Row & { name: string; id: string }>>(request, `/products?search=${encodeURIComponent("E2E Phone")}&per_page=20`);
  const taken = await request.post(`${API}/orders`, {
    headers: foodAuth(),
    data: {
      channel: "phone", fulfillment_type: "pickup", customer_name: ELSEWHERE, customer_phone: "03001230001",
      items: [{ product_id: menu.find((p) => p.name === PLAIN.name)!.id, quantity: 1 }], idempotency_key: randomUUID(),
    },
  });
  expect(taken.ok(), `the other counter's order could not be taken (${taken.status()} ${await taken.text()})`).toBeTruthy();
  const elsewhere = ((await taken.json()) as { data: { id: string } }).data.id;
  const both = await waiting(request);
  expect(both).toEqual({ new: unanswered.new + 1, being_worked: unanswered.being_worked + 1 });
  await expect(railCount, "an order taken at another counter never reached this menu").toHaveAttribute("aria-label", railSays(both), { timeout: 50_000 });
  expect(asks.length, "one piece of news on the bell was asked about more than once").toBe(1);

  // Called off there, too — and back on the Orders screen the menu is told
  // by the screen's own list, which is where the two must agree.
  const off = await request.post(`${API}/orders/${elsewhere}/cancel`, { headers: foodAuth(), data: { reason: "The other counter's test order" } });
  expect(off.ok(), `the other counter's order could not be called off (${off.status()})`).toBeTruthy();
  await page.goto("/tenant/orders");
  await expect(railCount, "the menu and the Orders screen disagree about how many orders there are").toHaveAttribute("aria-label", railSays(unanswered), { timeout: 15_000 });

  // ── confirmed is not cooking ───────────────────────────────────────
  await card(page, number).getByRole("button", { name: "Confirm" }).click();
  await expect(column(page, "Accepted").locator(card(page, number))).toBeVisible({ timeout: 15_000 });
  expect(await onThePass(request, number), "the kitchen was told to cook an order nobody had started").toHaveLength(0);
  // Accepted, it is still being worked — and no longer new: the count moves
  // with the press, not half a minute after it, and stops blinking when the
  // last new one is answered.
  const answered = await waiting(request);
  expect(answered).toEqual({ new: unanswered.new - 1, being_worked: unanswered.being_worked });
  await expect(railCount).toHaveAttribute("aria-label", railSays(answered), { timeout: 10_000 });
  if (answered.new === 0) await expect(railCount, "it still blinks with nothing new").not.toHaveAttribute("data-alert", "");

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

test("a delivery says it is one — and going out asks who is carrying it, without insisting", async ({ page, request }, info) => {
  test.skip(info.project.name !== "restaurant", "one pair of orders out of the door is enough; the sheet is a sheet on every size");

  const dishes = await get<Array<Row & { name: string; id: string }>>(request, `/products?search=${encodeURIComponent("E2E Phone")}&per_page=20`);
  const biryani = dishes.find((p) => p.name === PLAIN.name)!;
  /** A delivery, taken and already being prepared — the step before the door. */
  const aDelivery = async (): Promise<Row & { id: string; order_number: string }> => {
    const res = await request.post(`${API}/orders`, {
      headers: foodAuth(),
      data: {
        channel: "phone", fulfillment_type: "delivery", customer_name: CALLER, customer_phone: "03001230000",
        delivery_address: "12-B, Johar Town", items: [{ product_id: biryani.id, quantity: 1 }], send_to_kitchen: true,
        idempotency_key: randomUUID(),
      },
    });
    expect(res.ok(), `a delivery could not be taken (${res.status()} ${await res.text()})`).toBeTruthy();

    return ((await res.json()) as { data: Row & { id: string; order_number: string } }).data;
  };
  const now = async (id: string) => get<Row & { status: string; rider_id: string | null }>(request, `/orders/${id}`);
  const riders = await get<Array<Row & { id: string; name: string; is_active: boolean }>>(request, "/riders");
  expect(riders.some((r) => r.is_active), "this restaurant has no rider to give an order to").toBeTruthy();

  const first = await aDelivery();
  const second = await aDelivery();
  await page.goto("/tenant/orders");

  // ── a delivery says it is one, and that nobody has it ──────────────
  const one = card(page, first.order_number);
  await expect(column(page, "Being prepared").locator(one)).toBeVisible({ timeout: 20_000 });
  await expect(one.locator('[data-how="delivery"]')).toHaveText("Delivery");
  await expect(one.getByText("no rider")).toBeVisible();

  // ── the step asks ──────────────────────────────────────────────────
  await one.getByRole("button", { name: "Out for delivery" }).click();
  const asked = page.getByRole("dialog", { name: `Who is carrying ${first.order_number}?` });
  await expect(asked, "an order left the shop without anybody being asked who had it").toBeVisible();
  await expect(asked).toContainText("12-B, Johar Town");
  report([...(await nothingIsWrittenUnderAButton(page)), ...(await everyRule(page))], "the rider question");

  // Closing it is not an answer: the order has not left.
  await page.keyboard.press("Escape");
  await expect(asked).toBeHidden();
  expect((await now(first.id)).status, "closing the question sent the order out").toBe("preparing");

  // ── …and does not insist ───────────────────────────────────────────
  await one.getByRole("button", { name: "Out for delivery" }).click();
  await asked.getByRole("button", { name: "Send without a rider" }).click();
  await expect(asked).toBeHidden({ timeout: 15_000 });
  await expect.poll(async () => (await now(first.id)).status, { message: "it would not go without a rider" }).toBe("out_for_delivery");
  expect((await now(first.id)).rider_id).toBeNull();
  await expect(column(page, "Ready · on the way").locator(one)).toBeVisible({ timeout: 15_000 });

  // ── with a name on it: the rider is on the order BEFORE it leaves ──
  const two = card(page, second.order_number);
  await two.getByRole("button", { name: "Out for delivery" }).click();
  const again = page.getByRole("dialog", { name: `Who is carrying ${second.order_number}?` });
  // ("Send with …", not "Send without a rider" — one is the other's first nine letters.)
  const send = again.getByRole("button", { name: /^(Send with\s|Choose a rider)/ });
  const offered = again.getByRole("radio");
  if ((await offered.count()) > 1) await expect(send, "a rider is chosen for a shop that has several").toBeDisabled();
  await offered.first().click();
  await expect(send).toHaveText(/^Send with\s/);
  await send.click();
  await expect(again).toBeHidden({ timeout: 15_000 });
  await expect.poll(async () => (await now(second.id)).status).toBe("out_for_delivery");
  const carried = await now(second.id);
  expect(carried.rider_id, "it left with a rider chosen and nobody's name on it").not.toBeNull();
  expect(riders.map((r) => r.id)).toContain(carried.rider_id);
  await expect(two.getByText("no rider")).toHaveCount(0);
  await expect(two).toContainText("Rider");

  // Asked once: somebody is on it now, so the next step is not a question.
  await two.getByRole("button", { name: "Complete" }).click();
  await expect.poll(async () => (await now(second.id)).status).toBe("completed");
  await expect(page.getByRole("dialog", { name: /Who is carrying/ })).toHaveCount(0);

  await nobodyIsWaiting(request);
});
