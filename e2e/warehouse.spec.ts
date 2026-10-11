import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, ownerAuth } from "./api";

/**
 * A WAREHOUSE, LIVED THROUGH — in a browser, as the shop.
 *
 * A godown was a branch like any other: it cost a branch on the plan, it could
 * open a till, a delivery went wherever the header happened to point, and a
 * transfer arrived the instant it was sent. This walks the day a shop with a
 * godown actually has:
 *
 *   the warehouse is on its own line, counted on its own allowance
 *   the till is not drawn while standing in it — and one press finds a shop
 *   a delivery is received INTO it from the shop's screen
 *   stock is sent to the shop, and is on nobody's shelf on the way
 *   two of a line do not arrive: that needs a reason, and then a decision
 *   a size is sent as that size, and the slip says what travelled
 *   and the reorder list says "the godown has it" before it says "buy more"
 *
 * Every figure asserted is worked out here from what the test itself did, and
 * the stock is SET to a known figure first, so a second run starts where the
 * first one did.
 */

const GODOWN = "E2E Godown";
const RICE = "E2E Godown Rice";
const SHIRT = "E2E Godown Shirt";
const SUPPLIER = "E2E Godown Supplier";
const NOTE = "E2E warehouse walk";

type Row = Record<string, unknown>;
interface Place { id: string; name: string; kind: string; is_default: boolean }
interface Item { id: string; name: string; variants?: Array<{ id: string; name: string }> }

const at = (placeId?: string) => ({ ...ownerAuth(), ...(placeId ? { "X-Branch-Id": placeId } : {}) });

async function ask<T>(request: APIRequestContext, path: string, placeId?: string): Promise<T> {
  const res = await request.get(`${API}${path}`, { headers: at(placeId) });
  expect(res.ok(), `GET ${path} → ${res.status()}`).toBeTruthy();

  return ((await res.json()) as { data: T }).data;
}

async function tell<T>(request: APIRequestContext, method: "post" | "put", path: string, data: Row, placeId?: string): Promise<T> {
  const res = await request[method](`${API}${path}`, { headers: at(placeId), data });
  expect(res.ok(), `${method.toUpperCase()} ${path} → ${res.status()} ${await res.text()}`).toBeTruthy();

  return ((await res.json()) as { data: T }).data;
}

/** The warehouse. Made once, and left. */
async function theGodown(request: APIRequestContext): Promise<{ main: Place; godown: Place }> {
  let places = await ask<Place[]>(request, "/branches");
  if (!places.some((p) => p.name === GODOWN)) {
    await tell(request, "post", "/branches", { name: GODOWN, kind: "warehouse", code: "E2EWH" });
    places = await ask<Place[]>(request, "/branches");
  }

  return { main: places.find((p) => p.is_default)!, godown: places.find((p) => p.name === GODOWN)! };
}

/**
 * A fixture product, carded once.
 *
 * NOT on sale. A fixture must not change what other specs exercise, and the
 * till's first tile is whatever sorts first — a new sellable product named
 * "E2E G…" would have become the dish half the till specs ring.
 */
async function item(request: APIRequestContext, name: string, variants?: Row[]): Promise<Item> {
  const found = (await ask<Item[]>(request, `/products?search=${encodeURIComponent(name)}&per_page=20`)).find((p) => p.name === name);
  const made = found ?? (await tell<Item>(request, "post", "/products", {
    item_type: "physical_product", name, price: 1500, cost: 1200, is_active: false, track_inventory: true,
    description: "A fixture for the warehouse walk.", tax_rate: 0, ...(variants ? { variants } : {}),
  }));

  return ask<Item>(request, `/products/${made.id}`);
}

const setStock = (request: APIRequestContext, placeId: string, productId: string, variantId: string | null, quantity: number) =>
  tell(request, "post", "/inventory/adjust", {
    product_id: productId, ...(variantId ? { variant_id: variantId } : {}), type: "set", new_quantity: quantity, reason: NOTE,
  }, placeId);

interface Held { places: Record<string, number>; on_the_road: number; total: number; sizes: Array<{ id: string; places: Record<string, number>; on_the_road: number }> }

/**
 * What the two places THIS walk works at hold between them.
 *
 * Not the row's own `total`. That adds up every place the shop has, and this
 * shop has others — one of them a branch the delete test below fills and
 * removes. A run interrupted between those two steps left five units there,
 * and "a transfer changed how much the business owns" then failed on stock
 * that no transfer had touched.
 */
const between = (h: Held, ...places: Place[]) => places.reduce((sum, p) => sum + (h.places[p.id] ?? 0), 0);

const held = async (request: APIRequestContext, product: Item): Promise<Held> =>
  (await ask<Array<Held & { id: string }>>(request, `/inventory/by-place?search=${encodeURIComponent(product.name)}`)).find((r) => r.id === product.id)!;

/** Anything an earlier, interrupted run left on the road or unsettled is put back first. */
async function clearTheRoad(request: APIRequestContext): Promise<void> {
  for (const status of ["in_transit", "short"]) {
    const open = await ask<Array<{ id: string; notes: string | null }>>(request, `/inventory/transfers?status=${status}`);
    for (const t of open.filter((x) => x.notes === NOTE)) {
      await tell(request, "post", `/inventory/transfers/${t.id}/${status === "short" ? "settle" : "cancel"}`, status === "short" ? { outcome: "returned" } : {});
    }
  }
}

async function watchThePrinter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.print = () => {
      const top = window.top as unknown as { __handed?: string[] };
      top.__handed = [...(top.__handed ?? []), document.body.innerText];
    };
  });
}
const handed = (page: Page) => page.evaluate(() => (window as unknown as { __handed?: string[] }).__handed ?? []);

const switcher = (page: Page) => page.getByTestId("branch-switcher");
async function standAt(page: Page, place: string): Promise<void> {
  await switcher(page).click();
  await page.getByRole("listbox", { name: "Operating branch" }).getByRole("option", { name: new RegExp(`^${place}`) }).click();
  await expect(switcher(page)).toContainText(place);
}

const firstTransfer = (page: Page) => page.getByTestId("transfer-row").first();

test("a shop's godown: stock is received into it, sent on, counted in short and settled — and nothing is sold from it", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "one walk of the day is enough; the phone has its own test below");
  test.setTimeout(240_000);

  const { main, godown } = await theGodown(request);
  const rice = await item(request, RICE);
  const shirt = await item(request, SHIRT, [{ name: "Medium", price: 2500 }, { name: "Large", price: 2500 }]);
  const medium = shirt.variants!.find((v) => v.name === "Medium")!;
  const large = shirt.variants!.find((v) => v.name === "Large")!;

  await clearTheRoad(request);
  await setStock(request, godown.id, rice.id, null, 40);
  await setStock(request, main.id, rice.id, null, 0);
  for (const [size, qty] of [[medium, 12], [large, 7]] as const) {
    await setStock(request, godown.id, shirt.id, size.id, qty);
    await setStock(request, main.id, shirt.id, size.id, 0);
  }

  await watchThePrinter(page);

  // ── the warehouse is on its own line ──────────────────────────────
  await page.goto("/tenant/branches");
  await expect(page.getByRole("heading", { name: "Branches & warehouses", level: 1 })).toBeVisible();
  const warehouses = page.getByTestId("places-warehouse");
  await expect(warehouses.getByTestId("place-card").filter({ hasText: GODOWN })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("places-shop").getByTestId("place-card").filter({ hasText: GODOWN }), "the godown is listed as a branch").toHaveCount(0);
  // Counted on its own allowance: one of one, while the branches line is a different sum.
  await expect(page.getByTestId("places-warehouse-used")).toHaveText("1 of 1 used");
  await expect(warehouses.getByRole("button", { name: "+ Add warehouse" })).toBeDisabled();
  await expect(page.getByTestId("places-shop").getByRole("button", { name: "+ Add branch" })).toBeEnabled();

  // ── nothing is sold from it ───────────────────────────────────────
  await standAt(page, GODOWN);
  await expect(switcher(page)).toHaveAttribute("data-kind", "warehouse");
  await page.goto("/tenant/pos");
  const noCounter = page.getByTestId("no-counter-here");
  await expect(noCounter, "the till was drawn while standing in a warehouse").toBeVisible({ timeout: 15_000 });
  await expect(noCounter).toContainText(`${GODOWN} is a warehouse`);
  await expect(page.getByPlaceholder(/scan barcode or search/i)).toHaveCount(0);
  // One press finds a shop, and the till is there.
  await noCounter.getByRole("button", { name: "Sell at Main", exact: true }).click();
  await expect(page.getByPlaceholder(/scan barcode or search/i).first()).toBeVisible({ timeout: 30_000 });

  // ── a delivery is received INTO it, from the shop's screen ────────
  const suppliers = await ask<Array<{ id: string; name: string }>>(request, `/suppliers?search=${encodeURIComponent(SUPPLIER)}`);
  const supplier = suppliers.find((s) => s.name === SUPPLIER) ?? (await tell<{ id: string }>(request, "post", "/suppliers", { name: SUPPLIER, phone: "+923001110099" }));
  const today = new Date().toISOString().slice(0, 10);
  const po = await tell<{ id: string; po_number: string }>(request, "post", "/purchase-orders", {
    supplier_id: supplier.id, order_date: today, status: "ordered",
    items: [{ product_id: rice.id, quantity: 12, unit_cost: 1200 }],
  }, main.id);

  await page.goto("/tenant/purchases");
  await page.getByRole("row").filter({ hasText: po.po_number }).click();
  const order = page.getByRole("dialog").filter({ hasText: po.po_number });
  const into = order.getByTestId("receive-into");
  await expect(into, "there is nowhere to say which place the delivery goes into").toBeVisible({ timeout: 15_000 });
  // It starts where the person is standing — the shop — and is changed on purpose.
  await expect(into.getByLabel("Receive into")).toHaveValue(main.id);
  await into.getByLabel("Receive into").selectOption(godown.id);
  await order.getByRole("button", { name: /Receive all/ }).click();
  await expect(page.getByText(`Goods received into ${GODOWN}`)).toBeVisible({ timeout: 15_000 });

  let riceHeld = await held(request, rice);
  expect(riceHeld.places[godown.id], "the delivery did not land in the godown").toBe(52);
  expect(riceHeld.places[main.id] ?? 0, "the delivery landed on the shop's shelf").toBe(0);

  // ── stock is sent to the shop ─────────────────────────────────────
  await page.goto("/tenant/transfers");
  await page.getByRole("button", { name: "+ New transfer" }).click();
  const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "New transfer" }) });
  await form.getByLabel("Send from").selectOption(godown.id);
  await form.getByLabel("Send to").selectOption(main.id);
  await form.getByLabel("Add items").fill("E2E Godown");
  const results = form.getByTestId("transfer-results");
  // What the sender holds, said on each row — and a product sold in sizes is its sizes.
  await expect(results.getByRole("button", { name: `${RICE} 52 here` })).toBeVisible({ timeout: 15_000 });
  await expect(results.getByRole("button", { name: `${SHIRT} — Large 7 here` })).toBeVisible();
  await expect(results.getByRole("button", { name: SHIRT, exact: true }), "the sized product is offered as a thing to send; its stock is on its sizes").toHaveCount(0);
  await results.getByRole("button", { name: `${RICE} 52 here` }).click();
  // Chosen: the list is gone, the line is there, and the box is ready for the next.
  await expect(results, "the list stayed open on top of the line it had just added").toHaveCount(0);
  await expect(form.getByTestId("transfer-line")).toHaveCount(1);
  await expect(form.getByLabel("Add items")).toBeFocused();
  await form.getByLabel("Add items").fill("E2E Godown Shirt");
  await results.getByRole("button", { name: `${SHIRT} — Medium 12 here` }).click();
  await form.getByLabel(`Quantity of ${RICE}`).fill("10");
  await form.getByLabel(`Quantity of ${SHIRT} — Medium`).fill("4");
  await form.getByLabel("Notes").fill(NOTE);
  await form.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/sent — waiting to be received/)).toBeVisible({ timeout: 15_000 });

  const row = firstTransfer(page);
  await expect(row).toHaveAttribute("data-status", "in_transit");
  await expect(row).toContainText("On its way");
  await expect(row).toContainText("2 lines · 14 units");
  const reference = (await row.locator("td").first().locator("span").first().innerText()).trim();

  // On nobody's shelf: it has left the godown and the shop has not got it.
  riceHeld = await held(request, rice);
  expect(riceHeld.places[godown.id]).toBe(42);
  expect(riceHeld.places[main.id] ?? 0, "the shop was given stock nobody has counted in").toBe(0);
  expect(riceHeld.on_the_road).toBe(10);
  expect((await held(request, shirt)).sizes.find((s) => s.id === medium.id)!.on_the_road).toBe(4);

  // ── the slip says what travelled, and has room to write what arrived ─
  await row.getByRole("button", { name: `Print the slip for ${reference}` }).click();
  await expect.poll(async () => (await handed(page)).length, { timeout: 15_000, message: "the slip never reached the printer" }).toBe(1);
  const slip = (await handed(page))[0];
  for (const said of ["STOCK TRANSFER", "ON ITS WAY", reference, GODOWN, "(Warehouse)", RICE, `${SHIRT} — Medium`, "RECEIVED (write in)"]) {
    expect(slip, `the slip does not say "${said}"`).toContain(said);
  }
  expect(slip, "a slip that travels with a van carries prices").not.toMatch(/1,?500|1,?200|2,?500/);

  // ── two do not arrive ─────────────────────────────────────────────
  await row.getByRole("button", { name: "Receive", exact: true }).click();
  const count = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Receive ${reference}` }) });
  // Every box starts at what was sent.
  await expect(count.getByLabel(`How many ${RICE} arrived`)).toHaveValue("10");
  await count.getByLabel(`How many ${RICE} arrived`).fill("8");
  await expect(count.getByTestId("receive-problem")).toHaveText(`${RICE}: say why 2 did not arrive.`);
  await expect(count.getByRole("button", { name: "Receive", exact: true }), "a short line could be received with no reason").toBeDisabled();
  await count.getByLabel(`Why ${RICE} is short`).selectOption("damaged");
  await count.getByRole("button", { name: "Receive", exact: true }).click();
  await expect(page.getByText(/received short/)).toBeVisible({ timeout: 15_000 });
  await expect(firstTransfer(page)).toHaveAttribute("data-status", "short");
  await expect(firstTransfer(page)).toContainText("2 did not arrive");

  riceHeld = await held(request, rice);
  expect(riceHeld.places[main.id], "what arrived is not on the shop's shelf").toBe(8);
  // The two are on nobody's shelf: not made up to ten, not written off.
  expect(between(riceHeld, main, godown)).toBe(50);
  expect((await held(request, shirt)).sizes.find((s) => s.id === medium.id)!.places[main.id], "the Mediums did not arrive as Mediums").toBe(4);
  expect((await held(request, shirt)).sizes.find((s) => s.id === large.id)!.places[godown.id], "sending the Mediums moved the Larges").toBe(7);

  // ── and the sender decides ────────────────────────────────────────
  await firstTransfer(page).getByRole("button", { name: "Settle", exact: true }).click();
  const settle = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Settle ${reference}` }) });
  await expect(settle).toContainText(`${RICE}`);
  await expect(settle).toContainText("2 damaged");
  await settle.getByRole("button", { name: /^Put it back/ }).click();
  await expect(page.getByText(`Transfer ${reference} settled`)).toBeVisible({ timeout: 15_000 });
  await expect(firstTransfer(page)).toHaveAttribute("data-status", "completed");

  riceHeld = await held(request, rice);
  expect(riceHeld.places[godown.id], "what was put back is not back").toBe(44);
  expect(between(riceHeld, main, godown), "a transfer changed how much the business owns").toBe(52);
  expect(riceHeld.on_the_road).toBe(0);

  // ── every place, side by side ─────────────────────────────────────
  await page.goto("/tenant/stock-by-place");
  await page.getByLabel("Search stock").fill("E2E Godown");
  const table = page.getByTestId("stock-by-place");
  const riceRow = table.getByTestId("stock-row").filter({ hasText: RICE });
  await expect(riceRow).toBeVisible({ timeout: 15_000 });
  const columns = await table.locator("thead th").allInnerTexts();
  const cell = (r: typeof riceRow, heading: string) => r.locator("td").nth(columns.findIndex((c) => c.trim().toLowerCase().startsWith(heading.toLowerCase())));
  await expect(cell(riceRow, "Main")).toHaveText("8");
  await expect(cell(riceRow, GODOWN)).toHaveText("44");
  // The Total is the screen's own sum of the columns beside it — every place
  // the shop has, not only the two this walk works at.
  const figures = (await riceRow.locator("td").allInnerTexts()).map((t) => Number(t.trim()));
  const placeColumns = columns.findIndex((c) => c.trim().toLowerCase().startsWith("on the road"));
  const summed = figures.slice(1, placeColumns).reduce((a, b) => a + b, 0);
  expect(summed, "the place columns were not read").toBeGreaterThanOrEqual(52);
  await expect(cell(riceRow, "Total"), "the Total is not the places added up").toHaveText(String(summed));
  // The godown's column says what it is.
  expect(columns.find((c) => c.toLowerCase().startsWith(GODOWN.toLowerCase()))?.toLowerCase()).toContain("warehouse");
  // A product sold in sizes opens onto them.
  const shirtRow = table.getByTestId("stock-row").filter({ hasText: SHIRT });
  await shirtRow.getByRole("button", { name: new RegExp(SHIRT) }).click();
  const mediumRow = table.getByTestId("stock-size-row").filter({ hasText: "Medium" });
  await expect(cell(mediumRow, "Main")).toHaveText("4");
  await expect(cell(mediumRow, GODOWN)).toHaveText("8");

  // ── "the godown has it" comes before "buy more" ───────────────────
  await tell(request, "put", `/products/${rice.id}`, { low_stock_threshold: 20 });
  try {
    await page.goto("/tenant/inventory?filter=low");
    const bring = page.getByRole("row").filter({ hasText: RICE }).getByTestId("held-elsewhere");
    await expect(bring, "a shelf at 8 with 44 in the godown was offered a supplier and nothing else").toBeVisible({ timeout: 15_000 });
    await expect(bring).toHaveText(`${GODOWN} has 44 — bring it`);
    await bring.click();
    // The transfer opens already filled in: from the godown, to here.
    const filled = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "New transfer" }) });
    await expect(filled.getByLabel("Send from")).toHaveValue(godown.id, { timeout: 15_000 });
    await expect(filled.getByLabel("Send to")).toHaveValue(main.id);
    await expect(filled.getByLabel("Add items")).toHaveValue(RICE);
    await filled.getByRole("button", { name: "Cancel" }).click();
  } finally {
    // The level is taken off again: left on, this fixture would sit on the
    // shop's reorder list and in every count of it.
    await tell(request, "put", `/products/${rice.id}`, { low_stock_threshold: null });
  }
});

test("an order is addressed to the place the business's deliveries come to, and is received there", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "one walk is enough");

  const { main, godown } = await theGodown(request);
  const rice = await item(request, RICE);
  await setStock(request, godown.id, rice.id, null, 40);

  try {
    // ── "our deliveries come to the godown" ─────────────────────────
    await page.goto("/tenant/branches");
    const card = page.getByTestId("places-warehouse").getByTestId("place-card").filter({ hasText: GODOWN });
    await card.getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Edit warehouse" }) });
    await edit.getByLabel("Deliveries come here").check();
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(card.getByText("Deliveries come here"), "the place deliveries come to is not marked on its card").toBeVisible({ timeout: 15_000 });

    // Raised at the shop, with nobody naming a place: it is addressed to the godown.
    const suppliers = await ask<Array<{ id: string; name: string }>>(request, `/suppliers?search=${encodeURIComponent(SUPPLIER)}`);
    const supplier = suppliers.find((x) => x.name === SUPPLIER) ?? (await tell<{ id: string }>(request, "post", "/suppliers", { name: SUPPLIER, phone: "+923001110099" }));
    const po = await tell<{ id: string; po_number: string; deliver_to_branch_id: string }>(request, "post", "/purchase-orders", {
      supplier_id: supplier.id, order_date: new Date().toISOString().slice(0, 10), status: "ordered",
      items: [{ product_id: rice.id, quantity: 6, unit_cost: 1200 }],
    }, main.id);
    expect(po.deliver_to_branch_id, "the business receives at its godown and the order was addressed to the shop").toBe(godown.id);

    // The order says where it is going, and the receipt starts there.
    await page.goto("/tenant/purchases");
    await page.getByRole("row").filter({ hasText: po.po_number }).click();
    const order = page.getByRole("dialog").filter({ hasText: po.po_number });
    await expect(order.getByTestId("addressed-to")).toHaveText(new RegExp(`deliver to ${GODOWN} \\(warehouse\\)`), { timeout: 15_000 });
    await expect(order.getByTestId("receive-into").getByLabel("Receive into")).toHaveValue(godown.id);
    await order.getByRole("button", { name: /Receive all/ }).click();
    await expect(page.getByText(`Goods received into ${GODOWN}`)).toBeVisible({ timeout: 15_000 });

    expect((await held(request, rice)).places[godown.id]).toBe(46);

    // A new order from the form starts addressed there too.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "+ New purchase order" }).click();
    const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "New purchase order" }) });
    await expect(form.getByTestId("deliver-to").getByLabel("Deliver to")).toHaveValue(godown.id, { timeout: 15_000 });
  } finally {
    // Unmarked again: left on, every other spec's orders would be addressed to this godown.
    await tell(request, "put", `/branches/${godown.id}`, { takes_deliveries: false });
  }
});

test("a keeper at the shop asks the godown for stock, and the godown sends what it can spare", async ({ page, request, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one walk is enough");
  test.setTimeout(180_000);

  const { main, godown } = await theGodown(request);
  const rice = await item(request, RICE);
  await clearTheRoad(request);
  await setStock(request, godown.id, rice.id, null, 40);
  await setStock(request, main.id, rice.id, null, 0);

  // A stock keeper who works at the shop and nowhere else. Made once, and left.
  const KEEPER = { name: "E2E Shop Keeper", email: "e2e.shop.keeper@qa.test", password: "password" };
  const staff = await ask<Array<{ email: string | null }>>(request, `/staff?search=${encodeURIComponent(KEEPER.email)}`);
  if (!staff.some((u) => u.email === KEEPER.email)) {
    await tell(request, "post", "/staff", { ...KEEPER, branch_id: main.id, permissions: ["inventory.manage"] });
  }

  const theirs = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const keeper = await theirs.newPage();
  await keeper.goto("/signin");
  await keeper.getByPlaceholder("you@business.com").fill(KEEPER.email);
  await keeper.getByPlaceholder("Enter your password").fill(KEEPER.password);
  await keeper.getByRole("button", { name: /sign in/i }).click();
  await expect(keeper).toHaveURL(/\/tenant/, { timeout: 30_000 });

  // ── the keeper may not take it, so they ask ─────────────────────
  await keeper.goto("/tenant/transfers");
  await keeper.getByRole("button", { name: "+ New transfer" }).click();
  const form = keeper.getByRole("dialog").filter({ has: keeper.getByRole("heading", { name: "New transfer" }) });
  await form.getByLabel("Send from").selectOption(godown.id);
  await form.getByLabel("Send to").selectOption(main.id);
  await expect(form.getByTestId("transfer-verbs")).toContainText("Ask for it");
  await expect(form.getByRole("button", { name: "Send", exact: true }), "a keeper at the shop is offered Send for the godown's stock").toHaveCount(0);
  await expect(form.getByRole("button", { name: "Move now" })).toHaveCount(0);
  await form.getByLabel("Add items").fill(RICE);
  await form.getByTestId("transfer-results").getByRole("button", { name: `${RICE} 40 here` }).click();
  await form.getByLabel(`Quantity of ${RICE}`).fill("6");
  await form.getByLabel("Notes").fill(NOTE);
  await form.getByRole("button", { name: "Ask for it" }).click();
  await expect(keeper.getByText(/has been asked/)).toBeVisible({ timeout: 15_000 });

  const asked = keeper.getByTestId("transfer-row").first();
  await expect(asked).toHaveAttribute("data-status", "requested");
  await expect(asked).toContainText("Asked for");
  await expect(asked.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await expect(asked.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
  // Nothing has moved.
  expect((await held(request, rice)).places[godown.id], "asking for stock took it off the shelf").toBe(40);
  expect((await held(request, rice)).on_the_road).toBe(0);

  // ── the godown answers, with less ───────────────────────────────
  // From head office every place's requests are in view; the owner answers for the godown.
  await page.goto("/tenant/transfers");
  await expect(page.getByTestId("waiting-to-send"), "the place that was asked is not told").toBeVisible({ timeout: 15_000 });
  await page.getByTestId("waiting-to-send").click();
  const row = firstTransfer(page);
  await expect(row).toHaveAttribute("data-status", "requested");
  await row.getByRole("button", { name: "Send", exact: true }).click();
  const answer = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /^Send TRF-/ }) });
  await expect(answer.getByLabel(`How many ${RICE} to send`)).toHaveValue("6");
  await answer.getByLabel(`How many ${RICE} to send`).fill("4");
  await answer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/sent — waiting to be received/)).toBeVisible({ timeout: 15_000 });

  expect((await held(request, rice)).places[godown.id]).toBe(36);
  expect((await held(request, rice)).on_the_road).toBe(4);

  // ── and the keeper counts it in, told how it compares with what they asked ─
  await keeper.reload();
  const arriving = keeper.getByTestId("transfer-row").first();
  await expect(arriving).toHaveAttribute("data-status", "in_transit", { timeout: 15_000 });
  await arriving.getByRole("button", { name: "Receive", exact: true }).click();
  const count = keeper.getByRole("dialog").filter({ has: keeper.getByRole("heading", { name: /^Receive TRF-/ }) });
  await expect(count.getByTestId("receive-line")).toContainText("4 of the 6 asked for");
  await count.getByRole("button", { name: "Receive", exact: true }).click();
  await expect(keeper.getByText(/received$/)).toBeVisible({ timeout: 15_000 });

  expect((await held(request, rice)).places[main.id]).toBe(4);
  expect(between(await held(request, rice), main, godown)).toBe(40);

  await theirs.close();
});

test("deleting a place that holds stock asks what becomes of it, and carries it where it is told", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "one walk is enough");

  const { main } = await theGodown(request);
  const rice = await item(request, RICE);
  const CLOSING = "E2E Closing Branch";
  const places = await ask<Place[]>(request, "/branches");
  const closing = places.find((p) => p.name === CLOSING) ?? (await tell<Place>(request, "post", "/branches", { name: CLOSING }));
  await setStock(request, main.id, rice.id, null, 3);
  await setStock(request, closing.id, rice.id, null, 5);

  await page.goto("/tenant/branches");
  const card = page.getByTestId("place-card").filter({ hasText: CLOSING });
  await card.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Delete \u201c${CLOSING}\u201d?` }) });

  // It says what stays before it asks anything…
  await expect(dialog).toContainText("stays in your books");
  // …then what is there, and Delete waits for an answer.
  await expect(dialog.getByTestId("delete-place-stock")).toContainText("It still holds 1 product (5 units)", { timeout: 15_000 });
  const del = dialog.getByRole("button", { name: "Delete branch" });
  await expect(del, "Delete was live before anybody said what becomes of the stock").toBeDisabled();
  await expect(dialog.getByTestId("delete-place-waiting")).toHaveText("Say what becomes of its stock.");

  await dialog.getByRole("radio", { name: /^Move it to another place/ }).click();
  await expect(dialog.getByTestId("delete-place-waiting")).toHaveText("Choose the place its stock moves to.");
  await expect(del).toBeDisabled();
  await dialog.getByLabel("Move its stock to").selectOption(main.id);
  await expect(del).toBeEnabled();
  await del.click();

  await expect(page.getByText(`Deleted "${CLOSING}"`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("place-card").filter({ hasText: CLOSING })).toHaveCount(0);
  // The five went where they were told, and the business owns what it did.
  const now = await held(request, rice);
  expect(now.places[main.id], "the deleted place's stock did not arrive at Main").toBe(8);
  expect(now.places[closing.id] ?? 0).toBe(0);
});

test("on a phone the transfers and the places fit the screen, and each transfer says its state", async ({ page, request }, info) => {
  test.skip(info.project.name !== "phone", "the phone's own check");

  await theGodown(request);

  for (const path of ["/tenant/branches", "/tenant/transfers", "/tenant/stock-by-place"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    // The table may scroll inside its own frame; the PAGE must not.
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways, `${path} scrolls sideways on a phone by ${sideways}px`).toBeLessThanOrEqual(1);
  }

  await page.goto("/tenant/transfers");
  await page.getByRole("button", { name: "+ New transfer" }).click();
  const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "New transfer" }) });
  // The two ends are one above the other, not squeezed side by side.
  const from = (await form.getByLabel("Send from").boundingBox())!;
  const to = (await form.getByLabel("Send to").boundingBox())!;
  expect(to.y, "From and To are squeezed onto one line on a phone").toBeGreaterThan(from.y + from.height - 1);
  const send = (await form.getByRole("button", { name: "Send", exact: true }).boundingBox())!;
  expect(send.x + send.width, "the Send button runs off the screen").toBeLessThanOrEqual(page.viewportSize()!.width);
});
