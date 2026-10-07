import type { Locator, Page } from "@playwright/test";
import { OWNER_STATE, TRADE, ask, expect, record, remember, rupees, session, settled, test } from "./kit";
import { editor } from "./shop";

/**
 * STAGE J — THE MENU DEEPENS, AND A BILL IS SHARED.
 *
 * Stage H was a restaurant's plainest evening: two dishes, one table, one
 * bill. This is the rest of what a restaurant's menu and floor actually do.
 *
 *   a dish comes in SIZES, each at its own price
 *   it asks a QUESTION that must be answered (how hot) and offers EXTRAS
 *   a dish has a RECIPE, and selling it takes the rice off the shelf
 *   a party MOVES table; two tables turn out to be ONE party
 *   the bill is SPLIT — some of it now, the rest later, part cash part card
 *
 * Run with `JOURNEY_TRADE=food`, after stage H on the same shop.
 *
 * The night's figures, worked out here (tax 5%):
 *
 *     Karahi — Half 900 · Full 1,600 · Extra naan +60 · Raita +80
 *     Biryani 450 · Lemonade 180
 *
 *     the table's tab
 *       2 × Karahi Full, Hot, Extra naan     1,660 each     3,320
 *       1 × Karahi Half, Mild                                 900
 *       2 × Biryani                                           900
 *       1 × Lemonade (merged in from the other table)         180
 *                                                           5,300
 *
 *     first bill   1 Karahi Full + 1 Biryani   2,110 + 105.50 = 2,215.50
 *     the rest     3,190 + 159.50 = 3,349.50   (2,000 cash, 1,349.50 card)
 *                                                    together 5,565.00
 *
 *     the recipe   a biryani is 0.25 kg rice (300/kg) + 0.2 kg chicken
 *                  (700/kg) = 215 a portion; two sold = 0.5 kg and 0.4 kg
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "food", "a restaurant's stage — run with JOURNEY_TRADE=food");
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

const TAX = 5;
const BIRYANI = "QA Chicken Biryani";
const LEMONADE = "QA Mint Lemonade";
const KARAHI = {
  name: "QA Chicken Karahi",
  station: "Kitchen",
  sizes: [{ name: "Half", price: 900 }, { name: "Full", price: 1600 }],
  groups: [
    { name: "Spice", kind: "Choice", min: 1, max: 1, options: [{ name: "Mild", plus: 0 }, { name: "Hot", plus: 0 }] },
    { name: "Extras", kind: "Add-on", min: 0, max: 2, options: [{ name: "Extra naan", plus: 60 }, { name: "Raita", plus: 80 }] },
  ],
} as const;
const INGREDIENTS = [
  { name: "QA Basmati Rice", cost: 300, stock: 10, per: 0.25 },
  { name: "QA Chicken Boneless", cost: 700, stock: 10, per: 0.2 },
] as const;
const PORTION_COST = 0.25 * 300 + 0.2 * 700;      // 215
const TABLES = { first: "QA T1", second: "QA T2" } as const;

type Row = Record<string, unknown>;

const product = async (request: Parameters<typeof ask>[0], name: string): Promise<Row | undefined> =>
  (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`)).find((p) => p.name === name);

/** Open the editor for an item that exists, from the Products list. */
async function edit(page: Page, id: string): Promise<Locator> {
  await page.goto(`/tenant/products/${id}/edit`);
  const form = editor(page);
  await expect(form.getByRole("heading", { name: /^Edit / })).toBeVisible({ timeout: 20_000 });
  await settled(page);

  return form;
}

test("J1 · a dish in two sizes, each at its own price", async ({ page, request }) => {
  if (!(await product(request, KARAHI.name))) {
    await page.goto("/tenant/products/new");
    const form = editor(page);
    await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });
    await form.getByLabel("Name *", { exact: true }).fill(KARAHI.name);
    await form.getByLabel("Price *", { exact: true }).fill(String(KARAHI.sizes[0].price));
    const description = form.getByLabel("Description *", { exact: true });
    if (await description.isVisible().catch(() => false)) await description.fill(`${KARAHI.name} — added by the QA journey.`);
    const madeAt = form.locator("select").filter({ has: page.locator("option", { hasText: "Default kitchen" }) });
    await madeAt.selectOption({ label: KARAHI.station });

    // THE SIZES. What varies is the size; a restaurant is offered its own
    // words for one ("Half", "Full"), not a shirt shop's.
    await form.getByRole("button", { name: "Sizes & options" }).click();
    await form.getByRole("button", { name: "+ Add sizes or colours" }).click();
    await form.getByLabel("What varies").fill("Size");
    for (const size of KARAHI.sizes) {
      const box = form.getByLabel("Add a Size");
      await box.fill(size.name);
      await box.press("Enter");
    }
    // Enter added a size. It did not create the dish.
    await expect(form, "pressing Enter in the size box submitted the form").toBeVisible();
    await expect(form.getByText("2 sizes")).toBeVisible();
    for (const size of KARAHI.sizes) await form.getByLabel(`Price for ${size.name}`).fill(String(size.price));

    const create = form.getByRole("button", { name: "Create item" });
    await expect(create).toBeEnabled();
    await create.click();
    await expect(form).toBeHidden({ timeout: 20_000 });
  }

  const held = (await product(request, KARAHI.name))!;
  expect(held, `${KARAHI.name} is not on the menu`).toBeTruthy();
  remember({ karahi: String(held.id) });
  const full = await ask<Row & { variants: Row[] }>(request, "owner", `/products/${String(held.id)}`);
  expect(full.variants.map((v) => [v.name, Number(v.price)]).sort()).toEqual(KARAHI.sizes.map((s) => [s.name, s.price]).sort());
  expect(full.kitchen_station).toBe(KARAHI.station);

  // On the list it says where its price STARTS — not one price for a dish
  // that has two.
  await page.goto("/tenant/products");
  await settled(page);
  await page.getByPlaceholder(/search/i).first().fill(KARAHI.name);
  const row = page.getByRole("row").filter({ hasText: KARAHI.name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText("900");
});

test("J2 · a question that must be answered, and extras that cost", async ({ page, request }) => {
  const id = String(record().karahi);
  const before = await ask<Row & { modifier_groups?: Row[] }>(request, "owner", `/products/${id}`);

  if ((before.modifier_groups ?? []).length === 0) {
    const form = await edit(page, id);
    await form.getByRole("button", { name: "Sizes & options" }).click();

    for (const [n, group] of KARAHI.groups.entries()) {
      await form.getByRole("button", { name: "+ Group" }).click();
      const card = form.getByPlaceholder("Group name e.g. Crust").nth(n).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
      await card.getByPlaceholder("Group name e.g. Crust").fill(group.name);
      await card.locator("select").selectOption({ label: group.kind });
      const counts = card.getByRole("spinbutton");
      await counts.nth(0).fill(String(group.min));
      await counts.nth(1).fill(String(group.max));
      // It says, in words, which kind of group this has become.
      await expect(card).toContainText(group.min > 0 ? "required" : "optional");

      for (const [o, option] of group.options.entries()) {
        if (o > 0) await card.getByRole("button", { name: "+ Option" }).click();
        await card.getByPlaceholder("Option e.g. Stuffed").nth(o).fill(option.name);
        await card.getByPlaceholder("+ price").nth(o).fill(String(option.plus));
      }
    }

    await form.getByRole("button", { name: "Save modifiers" }).click();
    await expect(form.getByRole("button", { name: "Saved ✓" })).toBeVisible({ timeout: 15_000 });
  }

  const held = await ask<Row & { modifier_groups: Array<Row & { options: Row[] }> }>(request, "owner", `/products/${id}`);
  expect(held.modifier_groups.map((g) => g.name).sort()).toEqual(["Extras", "Spice"]);
  const spice = held.modifier_groups.find((g) => g.name === "Spice")!;
  const extras = held.modifier_groups.find((g) => g.name === "Extras")!;
  expect([Number(spice.min_select), Number(spice.max_select)]).toEqual([1, 1]);
  expect([Number(extras.min_select), Number(extras.max_select)]).toEqual([0, 2]);
  expect(extras.options.map((o) => [o.name, Number(o.price_delta)]).sort()).toEqual([["Extra naan", 60], ["Raita", 80]]);

  // And they are still there when the dish is opened again — a group that
  // saves and is gone on the next visit is the bug this screen once had.
  const again = await edit(page, id);
  await again.getByRole("button", { name: "Sizes & options" }).click();
  await expect(again.getByPlaceholder("Group name e.g. Crust")).toHaveCount(2);
  await expect(again.getByText("2 sizes")).toBeVisible();
});

test("J3 · what a biryani is made of — and what one costs to put on a plate", async ({ page, request }) => {
  // The rice and the chicken are on the shelf, counted, at what was paid.
  for (const raw of INGREDIENTS) {
    if (await product(request, raw.name)) continue;

    await page.goto("/tenant/products/new");
    const form = editor(page);
    await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });
    // Not a dish: something the kitchen buys.
    await form.getByRole("button", { name: "Physical Product", exact: true }).click();
    await form.getByLabel("Name *", { exact: true }).fill(raw.name);
    await form.getByLabel("Price *", { exact: true }).fill(String(raw.cost));
    await form.getByLabel("Cost (optional)", { exact: true }).fill(String(raw.cost));
    await form.getByLabel("Opening stock", { exact: true }).fill(String(raw.stock));
    const description = form.getByLabel("Description *", { exact: true });
    if (await description.isVisible().catch(() => false)) await description.fill(`${raw.name} — a kitchen ingredient.`);
    await form.getByRole("button", { name: "Create item" }).click();
    await expect(form).toBeHidden({ timeout: 20_000 });
  }

  const biryani = (await product(request, BIRYANI))!;
  expect(biryani, "stage H's biryani is not on the menu").toBeTruthy();
  remember({ biryani: String(biryani.id) });

  const held = await ask<Row & { recipe_items?: Row[] }>(request, "owner", `/products/${String(biryani.id)}`);
  if ((held.recipe_items ?? []).length === 0) {
    const form = await edit(page, String(biryani.id));
    await expect(form.getByText("No ingredients — the dish sells without depleting stock.")).toBeVisible();

    for (const [n, raw] of INGREDIENTS.entries()) {
      await form.getByRole("button", { name: "+ Add ingredient" }).click();
      const pick = form.getByLabel(`Ingredient ${n + 1}`, { exact: true });
      const label = (await pick.locator("option").allTextContents()).find((t) => t.includes(raw.name));
      expect(label, `${raw.name} is on the shelf and is not offered as an ingredient`).toBeTruthy();
      await pick.selectOption({ label: label! });
      await form.getByLabel(`Quantity of ingredient ${n + 1}`).fill(String(raw.per));
    }

    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(form).toBeHidden({ timeout: 20_000 });
  }

  // The server works the cost out from the ingredients' own — nobody types it.
  const costed = await ask<Row & { recipe_items: Row[] }>(request, "owner", `/products/${String(biryani.id)}`);
  expect(costed.recipe_items).toHaveLength(2);
  expect(Number(costed.recipe_cost)).toBe(PORTION_COST);

  // And the form says it, beside the price it is sold at: 215 on a 450 dish.
  const form = await edit(page, String(biryani.id));
  await expect(form.getByText(/Rs\s?215/).first(), "the dish does not say what a portion costs").toBeVisible({ timeout: 15_000 });

  for (const raw of INGREDIENTS) {
    const on = (await product(request, raw.name))!;
    remember({ [`stock:${raw.name}`]: Number(on.stock_quantity) });
  }
});

// ── the table ────────────────────────────────────────────────────────

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

const tile = (page: Page, table: string): Locator => page.getByRole("button", { name: new RegExp(`^${table}\\b`) });
const menu = (page: Page, name: string): Locator => page.getByRole("button").filter({ hasText: name }).first();

/** Sit a party at a free table and land on its tab. */
async function seat(page: Page, table: string, guests: number): Promise<string> {
  await page.goto("/tenant/dine-in");
  await settled(page);
  await tile(page, table).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Open tab — ${table}` }) });
  await sheet.getByRole("group", { name: "Party size" }).getByRole("button", { name: String(guests), exact: true }).click();
  await sheet.getByRole("button", { name: "Open tab" }).click();
  await expect(page).toHaveURL(/\/tenant\/dine-in\/tickets\//, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: table, exact: true })).toBeVisible({ timeout: 20_000 });
  await settled(page);

  return page.url().split("/").pop()!;
}

/** Order a karahi: the size, how hot, and whatever extras. */
async function orderKarahi(page: Page, size: string, spice: string, extras: string[] = []): Promise<void> {
  await menu(page, KARAHI.name).click();

  // SIZE FIRST. Both are offered, each at its own price.
  const which = page.getByRole("dialog").filter({ has: page.getByText("Which size?") });
  await expect(which).toBeVisible();
  for (const s of KARAHI.sizes) {
    await expect(which.locator(`[data-tab-size="${s.name}"]`)).toContainText(`Rs ${s.price.toLocaleString()}`);
  }
  await which.locator(`[data-tab-size="${size}"]`).click();

  // THEN THE QUESTION. It cannot go on the tab unanswered.
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Add to tab" }) });
  await expect(sheet.getByRole("heading", { name: KARAHI.name })).toBeVisible();
  const add = sheet.getByRole("button", { name: "Add to tab" });
  await expect(add, "a dish that must be told how hot went on the tab without being told").toBeDisabled();
  await sheet.getByRole("button", { name: spice, exact: true }).click();
  await expect(add).toBeEnabled();
  for (const extra of extras) await sheet.getByRole("button", { name: new RegExp(`^${extra}`) }).click();
  await add.click();
  await expect(sheet).toBeHidden();
}

test("J4 · at the table: a size, an answer, an extra — and the same again joins the line", async ({ page }) => {
  await watchThePrinter(page);
  const tab = String(record().shareTab ?? "") || (await seat(page, TABLES.second, 2));
  remember({ shareTab: tab });
  await page.goto(`/tenant/dine-in/tickets/${tab}`);
  await settled(page);

  const unsent = page.getByRole("region", { name: "Not sent yet" });
  const sent = page.getByRole("region", { name: "In the kitchen" });
  const line = (pile: Locator, text: string | RegExp) => pile.getByRole("listitem").filter({ hasText: text });

  if ((await unsent.count()) === 0 && (await sent.count()) === 0) {
    // The dish says its price STARTS somewhere — it has two.
    await expect(menu(page, KARAHI.name)).toContainText("from Rs 900");

    await orderKarahi(page, "Full", "Hot", ["Extra naan"]);
    await expect(line(unsent, "(Full)")).toHaveCount(1, { timeout: 15_000 });
    // 1,600 for a Full and 60 for the naan.
    await expect(line(unsent, "(Full)")).toContainText("Rs 1,660");
    await expect(line(unsent, "(Full)")).toContainText("Hot · Extra naan");

    // A HALF IS ANOTHER LINE. Same dish; not the same thing on a plate.
    await orderKarahi(page, "Half", "Mild");
    await expect(unsent.getByRole("listitem")).toHaveCount(2, { timeout: 15_000 });
    await expect(line(unsent, "(Half)")).toContainText("Rs 900");
    await expect(line(unsent, "(Half)")).toContainText("Mild");

    // THE SAME AGAIN JOINS. Full, hot, extra naan — one line that says two.
    await orderKarahi(page, "Full", "Hot", ["Extra naan"]);
    await expect(unsent.getByRole("listitem")).toHaveCount(2);
    await expect(unsent.getByLabel(`2 of ${KARAHI.name} (Full), Hot · Extra naan`), "the same karahi ordered twice did not become one line of two").toBeVisible({ timeout: 15_000 });
    await expect(line(unsent, "(Full)")).toContainText("Rs 3,320");
    // The two lines of one dish are two different things to press.
    await expect(unsent.getByRole("button", { name: `One more ${KARAHI.name} (Half), Mild` })).toBeVisible();
    await expect(unsent.getByRole("button", { name: `One more ${KARAHI.name} (Full), Hot · Extra naan` })).toBeVisible();
    // Three karahis are waiting, and the tile says three.
    await expect(menu(page, KARAHI.name).getByTestId("tile-count")).toHaveText("3");

    await menu(page, BIRYANI).click();
    await menu(page, BIRYANI).click();
    await expect(unsent.getByLabel(`2 of ${BIRYANI}`)).toBeVisible({ timeout: 15_000 });

    // 3,320 + 900 + 900.
    await expect(page.getByText("Rs 5,120").last()).toBeVisible();

    // One station, one ticket — and the cook is told the size and the extras.
    await page.getByRole("button", { name: "Send to kitchen (5)" }).click();
    await expect(page.getByText(/Kitchen ticket #\d+ Kitchen sent/)).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await handed(page)).length, { timeout: 20_000, message: "sending printed no kitchen ticket" }).toBe(1);
    const slip = (await handed(page))[0].text;
    expect(slip).toContain(TABLES.second);
    for (const word of ["Full", "Half", "Hot", "Mild", "Extra naan"]) {
      expect(slip, `the kitchen's paper does not say "${word}"`).toMatch(new RegExp(word, "i"));
    }
    expect(slip, "the kitchen was given prices").not.toMatch(/Rs\s?\d/);
  }

  await expect(page.getByRole("region", { name: "Not sent yet" })).toHaveCount(0);
  await expect(sent.getByRole("listitem")).toHaveCount(3);
});

test("J5 · the cook reads the size and the extras off the board", async ({ page }) => {
  await page.goto("/tenant/kitchen");
  await expect(page.getByRole("heading", { name: "Kitchen", exact: true })).toBeVisible({ timeout: 20_000 });
  await settled(page);

  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: TABLES.second, exact: true }) });
  if ((await card.count()) > 0) {
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("listitem")).toHaveCount(3);
    const row = (text: string) => card.getByRole("listitem").filter({ hasText: text });
    // Two Fulls on ONE row, hot, with the naan; the Half on its own, mild.
    await expect(row("Full")).toContainText("2");
    await expect(row("Full")).toContainText(/hot/i);
    await expect(row("Full")).toContainText(/extra naan/i);
    await expect(row("Half")).toContainText(/mild/i);
    await expect(row("Half")).not.toContainText(/extra naan/i);
    await expect(row(BIRYANI)).toContainText("2");

    await card.getByRole("button", { name: "Start cooking", exact: true }).click();
    await card.getByRole("button", { name: "Ready", exact: true }).click();
    await card.getByRole("button", { name: "Served", exact: true }).click();
    await expect(card, "the ticket is still on the pass after it was served").toHaveCount(0, { timeout: 15_000 });
  }
});

test("J6 · the party moves to another table, and takes its order with it", async ({ page }) => {
  const tab = String(record().shareTab);
  await page.goto(`/tenant/dine-in/tickets/${tab}`);
  await settled(page);

  if (await page.getByRole("heading", { name: TABLES.second, exact: true }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Move table", exact: true }).click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Move this tab" }) });
    // Only somewhere it can go: the table it is at, and tables nobody is at.
    const offered = await sheet.locator("select option").allTextContents();
    expect(offered).toContain(TABLES.first);
    await sheet.locator("select").selectOption({ label: TABLES.first });
    await sheet.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText("Tab moved").last()).toBeVisible({ timeout: 15_000 });
  }

  // The tab is now the other table's — same order, same amount.
  await expect(page.getByRole("heading", { name: TABLES.first, exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Rs 5,120").last()).toBeVisible();

  await page.goto("/tenant/dine-in");
  await settled(page);
  await expect(tile(page, TABLES.first)).toContainText("Rs 5,120", { timeout: 20_000 });
  await expect(tile(page, TABLES.first)).toContainText("2 guests");
  if (!record().joinedTab) await expect(tile(page, TABLES.second), "the table the party left is still taken").toContainText("Free");
});

test("J7 · two tables turn out to be one party: the tabs are merged", async ({ page, request }) => {
  const tab = String(record().shareTab);

  if (!record().merged) {
    // A friend sits down at the next table and orders a lemonade…
    const other = String(record().joinedTab ?? "") || (await seat(page, TABLES.second, 1));
    remember({ joinedTab: other });
    await page.goto(`/tenant/dine-in/tickets/${other}`);
    await settled(page);
    if ((await page.getByRole("region", { name: "In the kitchen" }).count()) === 0) {
      if ((await page.getByRole("region", { name: "Not sent yet" }).count()) === 0) await menu(page, LEMONADE).click();
      await page.getByRole("button", { name: "Send to kitchen (1)" }).click();
      await expect(page.getByText(/Kitchen ticket #\d+ Bar sent/)).toBeVisible({ timeout: 20_000 });
    }

    // …and then joins the others. Their tab takes his in.
    await page.goto(`/tenant/dine-in/tickets/${tab}`);
    await settled(page);
    await page.getByRole("button", { name: "Merge tab", exact: true }).click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Merge another tab into this one" }) });
    // The open tabs are fetched as the sheet opens.
    const offered = sheet.locator("select option").filter({ hasText: new RegExp(`^${TABLES.second} · `) });
    await expect(offered, "the other table's tab is not offered to be merged in").toHaveCount(1, { timeout: 15_000 });
    await sheet.locator("select").selectOption({ label: (await offered.textContent())! });
    await sheet.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(page.getByText("Tabs merged").last()).toBeVisible({ timeout: 15_000 });
    remember({ merged: true });
  }

  await page.goto(`/tenant/dine-in/tickets/${tab}`);
  await settled(page);
  // His lemonade is on their tab, still with the bar — not rung again.
  await expect(page.getByRole("region", { name: "In the kitchen" }).getByRole("listitem").filter({ hasText: LEMONADE })).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByText("Rs 5,300").last()).toBeVisible();

  // The table he left is free, and the bar still has his drink to make —
  // under the table he is sitting at now.
  await page.goto("/tenant/dine-in");
  await settled(page);
  await expect(tile(page, TABLES.second)).toContainText("Free", { timeout: 20_000 });
  await expect(tile(page, TABLES.first)).toContainText("Rs 5,300");

  await page.goto("/tenant/kitchen");
  await settled(page);
  const drink = page.getByRole("article").filter({ hasText: LEMONADE });
  await expect(drink, "merging the tabs lost the bar's ticket").toHaveCount(1, { timeout: 20_000 });
  await expect(drink.getByRole("heading", { name: TABLES.first, exact: true }), "the bar's ticket still names the table he left").toBeVisible();

  // One open tab in the shop, not two.
  const open = await ask<Row[]>(request, "owner", "/restaurant/tickets?status=open");
  expect(open.map((t) => t.id)).toEqual([tab]);
});

// ── the bill ─────────────────────────────────────────────────────────

const settleSheet = (page: Page): Locator =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Settle tab" }) });

const figure = async (sheet: Locator, label: string | RegExp): Promise<number> =>
  rupees(await sheet.getByText(label).locator("xpath=following-sibling::span[1]").innerText());

const KARAHI_FULL = `${KARAHI.name} (Full), Hot · Extra naan`;
const KARAHI_HALF = `${KARAHI.name} (Half), Mild`;

test("J8 · the bill is shared: two of them pay for theirs now", async ({ page, request }) => {
  const tab = String(record().shareTab);
  if (record().firstShare) return;

  await page.goto(`/tenant/dine-in/tickets/${tab}`);
  await settled(page);
  await page.getByRole("button", { name: "Settle", exact: true }).click();
  const sheet = settleSheet(page);
  await expect(sheet).toBeVisible();

  // WHICH KARAHI. The sheet a bill is split on names the size and what was
  // chosen with it — it said "Karahi" twice, told apart only by the price.
  await expect(sheet.getByText(`${KARAHI.name} (Full)`, { exact: true })).toBeVisible();
  await expect(sheet.getByText(`${KARAHI.name} (Half)`, { exact: true })).toBeVisible();
  await expect(sheet.getByText("Hot · Extra naan", { exact: true })).toBeVisible();

  // It opens on the whole bill.
  expect(await figure(sheet, "Whole bill")).toBe(5300);
  expect(await figure(sheet, /^Bill$/)).toBe(5565);

  // One Full karahi and one biryani are being paid for; the rest is not.
  await sheet.getByRole("button", { name: `Settle less ${KARAHI_FULL}` }).click();
  await sheet.getByRole("button", { name: `Settle less ${KARAHI_HALF}` }).click();
  await sheet.getByRole("button", { name: `Settle less ${BIRYANI}` }).click();
  await sheet.getByRole("button", { name: `Settle less ${LEMONADE}` }).click();
  // Nothing can go below nought, or above what was ordered.
  await expect(sheet.getByRole("button", { name: `Settle less ${KARAHI_HALF}` })).toBeDisabled();
  await expect(sheet.getByRole("button", { name: `Settle more ${KARAHI_HALF}` })).toBeEnabled();

  // 1,660 + 450, and the tax on exactly that.
  expect(await figure(sheet, "2 item(s)")).toBe(2110);
  expect(await figure(sheet, `Tax (${TAX}%)`)).toBe(105.5);
  expect(await figure(sheet, /^Bill$/)).toBe(2215.5);

  await sheet.locator("select").first().selectOption({ label: "Card" });
  await sheet.getByRole("button", { name: /^Take Rs 2,215\.50/ }).click();
  await expect(page.getByText("Part of the tab settled").last()).toBeVisible({ timeout: 20_000 });

  // The tab is still open, on the same table, owing the rest.
  await expect(page).toHaveURL(new RegExp(`/tickets/${tab}$`));
  const paid = page.getByRole("region", { name: "Paid" });
  await expect(paid.getByRole("listitem")).toHaveCount(2, { timeout: 15_000 });
  await expect(paid).toContainText(`${KARAHI.name} (Full)`);
  await expect(paid).toContainText(BIRYANI);

  const sale = (await ask<Row[]>(request, "owner", "/sales?per_page=5"))[0];
  expect(Number(sale.total)).toBe(2215.5);
  expect(Number(sale.tax)).toBe(105.5);
  expect(sale.payment_method).toBe("card");
  remember({ firstShare: String(sale.invoice_number), firstShareId: String(sale.id) });

  // The floor does not call the table free, or its bill unpaid in full.
  await page.goto("/tenant/dine-in");
  await settled(page);
  await expect(tile(page, TABLES.first)).not.toContainText("Free");
  await expect(tile(page, TABLES.first)).toContainText("Rs 3,190", { timeout: 20_000 });
});

test("J9 · the rest is paid part in cash and part by card, and the table is free", async ({ page, request }) => {
  const tab = String(record().shareTab);

  if (!record().secondShare) {
    await page.goto(`/tenant/dine-in/tickets/${tab}`);
    await settled(page);
    await page.getByRole("button", { name: "Settle", exact: true }).click();
    const sheet = settleSheet(page);

    // Only what is still owed is on the sheet: one Full, the Half, one
    // biryani and the lemonade.
    expect(await figure(sheet, "Whole bill")).toBe(3190);
    expect(await figure(sheet, `Tax (${TAX}%)`)).toBe(159.5);
    expect(await figure(sheet, /^Bill$/)).toBe(3349.5);

    // ONE bill, two ways of paying it.
    await sheet.getByRole("button", { name: "+ Pay with two methods" }).click();
    await sheet.getByPlaceholder("Amount on this method").fill("1349.5");
    await expect(sheet.getByText("Rs 2,000 on cash, Rs 1,349.50 on card.")).toBeVisible();

    await sheet.getByRole("button", { name: /^Take Rs 3,349\.50/ }).click();
    await expect(page.getByText(/Settled — invoice \S+/)).toBeVisible({ timeout: 20_000 });

    const sale = (await ask<Row[]>(request, "owner", "/sales?per_page=5"))[0];
    remember({ secondShare: String(sale.invoice_number), secondShareId: String(sale.id) });
  }

  const second = await ask<Row & { payments?: Row[] }>(request, "owner", `/sales/${String(record().secondShareId)}`);
  expect(Number(second.total)).toBe(3349.5);
  expect(Number(second.tax)).toBe(159.5);
  expect(second.order_type).toBe("dine_in");
  // Both tenders are on the sale, each at its own amount.
  const tenders = (second.payments ?? []).map((p) => [String(p.method ?? p.payment_method), Number(p.amount)]).sort();
  expect(tenders, "a bill paid two ways is not recorded as two tenders").toEqual([["card", 1349.5], ["cash", 2000]]);

  // The two bills are the whole table, to the paisa.
  const first = await ask<Row>(request, "owner", `/sales/${String(record().firstShareId)}`);
  expect(Number(first.total) + Number(second.total)).toBe(5565);

  await page.goto("/tenant/dine-in");
  await settled(page);
  await expect(tile(page, TABLES.first)).toContainText("Free", { timeout: 20_000 });
  await expect(tile(page, TABLES.second)).toContainText("Free");
});

test("J10 · two biryanis left the kitchen, and so did their rice and chicken", async ({ page, request }) => {
  for (const raw of INGREDIENTS) {
    const before = Number(record()[`stock:${raw.name}`]);
    const now = Number((await product(request, raw.name))!.stock_quantity);
    // Two portions, across two bills.
    expect(Math.round((before - now) * 1000) / 1000, `${raw.name}: selling two biryanis did not take ${2 * raw.per} off the shelf`)
      .toBe(Math.round(2 * raw.per * 1000) / 1000);
  }

  // And each biryani on a bill carries what it cost to make: 215, not nought.
  const sale = await ask<Row & { items: Row[] }>(request, "owner", `/sales/${String(record().firstShareId)}`);
  const line = sale.items.find((i) => i.product_name === BIRYANI)!;
  expect(line, "the biryani is not on the first bill").toBeTruthy();
  expect(Number(line.unit_cost)).toBe(PORTION_COST);

  // Inventory says where it went.
  await page.goto("/tenant/inventory");
  await settled(page);
  await page.getByPlaceholder(/search/i).first().fill(INGREDIENTS[0].name);
  const row = page.getByRole("row").filter({ hasText: INGREDIENTS[0].name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText("9.5");
});
