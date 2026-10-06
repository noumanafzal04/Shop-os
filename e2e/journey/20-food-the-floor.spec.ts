import type { Page } from "@playwright/test";
import { OWNER_STATE, TRADE, ask, expect, record, remember, rupees, session, settled, test } from "./kit";
import { editor } from "./shop";
import { complete, openTill, ring, tender } from "./till";

/**
 * A RESTAURANT'S OWN STAGE — the floor, the tab, the pass, the bill.
 *
 * Stages A and B (the admin creates the business; the owner walks every
 * screen) are the same for every trade. What a restaurant does that no other
 * shop does is this: a dish is made at a STATION; guests sit at a TABLE; what
 * they order goes on a TAB; firing the tab sends each station its own ticket;
 * the kitchen works them off a board; and the bill is settled when they
 * leave. Then there is the counter, where a takeaway is paid for first and
 * cooked after.
 *
 * Run with `JOURNEY_TRADE=food`, after stages 01 and 02 for that trade.
 *
 * The bill, worked out here:
 *
 *     2 × Chicken Biryani   450      900
 *     1 × Mint Lemonade     180      180
 *                                  1,080
 *     tax at 5%                       54
 *                                  1,134
 */

test.describe.configure({ mode: "serial" });
test.skip(TRADE !== "food", "a restaurant's stage — run with JOURNEY_TRADE=food");
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

const TAX = 5;
const STATIONS = ["Kitchen", "Bar"] as const;
const DISHES = [
  { name: "QA Chicken Biryani", price: 450, station: "Kitchen" },
  { name: "QA Mint Lemonade", price: 180, station: "Bar" },
] as const;
const TABLES = [{ name: "QA T1", seats: 4 }, { name: "QA T2", seats: 2 }] as const;
const BILL = { subtotal: 2 * 450 + 180, tax: 54, total: 1134 } as const;

type Row = Record<string, unknown>;

/** Everything handed to a printer, in order — the kitchen's tickets are the point of firing. */
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

test("H1 · the kitchen is set up: two stations, and the tax a dish is charged", async ({ page, request }) => {
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

test("H2 · the menu: a dish for each station, on the list at the price typed", async ({ page, request }) => {
  for (const dish of DISHES) {
    const have = (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(dish.name)}`)).some((p) => p.name === dish.name);
    if (have) continue;

    await page.goto("/tenant/products/new");
    const form = editor(page);
    await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });
    await form.getByLabel("Name *", { exact: true }).fill(dish.name);
    await form.getByLabel("Price *", { exact: true }).fill(String(dish.price));
    const description = form.getByLabel("Description *", { exact: true });
    if (await description.isVisible().catch(() => false)) await description.fill(`${dish.name} — added by the QA journey.`);

    // WHERE IT IS MADE. The stations saved a moment ago are the choices.
    const madeAt = form.locator("select").filter({ has: page.locator("option", { hasText: "Default kitchen" }) });
    await expect(madeAt, "a dish cannot be given a station").toBeVisible();
    await madeAt.selectOption({ label: dish.station });

    const create = form.getByRole("button", { name: "Create item" });
    await expect(create, `the form will not let ${dish.name} be created`).toBeEnabled();
    await create.click();
    await expect(form).toBeHidden({ timeout: 20_000 });
  }

  for (const dish of DISHES) {
    const held = (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(dish.name)}`)).find((p) => p.name === dish.name)!;
    expect(held, `${dish.name} is not on the menu`).toBeTruthy();
    expect(Number(held.price)).toBe(dish.price);
    expect(held.kitchen_station, `${dish.name} lost its station`).toBe(dish.station);
  }
});

test("H3 · the floor: two tables are laid out and both are free", async ({ page }) => {
  await page.goto("/tenant/dine-in");
  await expect(page.getByRole("heading", { name: "Dine-in Floor" })).toBeVisible({ timeout: 20_000 });
  await settled(page);

  for (const table of TABLES) {
    if (await page.getByRole("button", { name: new RegExp(`^${table.name}\\b`) }).count()) continue;

    const add = page.getByRole("button", { name: "+ Add table" });
    if (!(await add.first().isVisible().catch(() => false))) await page.getByRole("button", { name: "Edit floor" }).click();
    await add.first().click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add table" }) });
    await sheet.getByPlaceholder("e.g. T1 or Patio 3").fill(table.name);
    await sheet.getByRole("spinbutton").fill(String(table.seats));
    await sheet.getByRole("button", { name: "Add table" }).click();
    await expect(page.getByText("Table added").last()).toBeVisible({ timeout: 15_000 });
    await expect(sheet).toBeHidden();
    // The floor has caught up — and the layout is still open for the next
    // one, with "+ Add table" where it was. It used to vanish with the empty
    // floor after the very first table.
    await expect(page.getByRole("button", { name: new RegExp(`^${table.name}\\b`) })).toBeVisible({ timeout: 15_000 });
    await expect(add.first(), "after one table the way to add the next is gone").toBeVisible();
  }
  const done = page.getByRole("button", { name: "Done", exact: true });
  if (await done.isVisible().catch(() => false)) await done.click();

  for (const table of TABLES) {
    const tile = page.getByRole("button", { name: new RegExp(`^${table.name}\\b`) });
    await expect(tile).toBeVisible();
    await expect(tile).toContainText(`${table.seats} seats`);
    await expect(tile, `${table.name} already has a tab on it`).toContainText("Free");
  }
});

test("H4 · guests are seated, the order goes on the tab, and firing it sends each station its own ticket", async ({ page }) => {
  await watchThePrinter(page);
  await page.goto("/tenant/dine-in");
  await settled(page);

  const tile = page.getByRole("button", { name: new RegExp(`^${TABLES[0].name}\\b`) });
  if (/Free/.test(await tile.innerText())) {
    await tile.click();
    const seat = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Open tab — ${TABLES[0].name}` }) });
    // A party of two is one press.
    await seat.getByRole("group", { name: "Party size" }).getByRole("button", { name: "2", exact: true }).click();
    await expect(seat.getByLabel("Guests")).toHaveValue("2");
    await seat.getByRole("button", { name: "Open tab" }).click();
  } else {
    await tile.click();
  }
  await expect(page).toHaveURL(/\/tenant\/dine-in\/tickets\//, { timeout: 20_000 });
  remember({ foodTab: page.url().split("/").pop() });
  await expect(page.getByRole("heading", { name: TABLES[0].name, exact: true })).toBeVisible({ timeout: 20_000 });
  await settled(page);

  // Two biryanis and a lemonade. The second tap on the biryani JOINS the
  // first: one line that says two, not two lines of one.
  const menu = (name: string) => page.getByRole("button").filter({ hasText: name }).first();
  const unsent = page.getByRole("region", { name: "Not sent yet" });
  const sent = page.getByRole("region", { name: "In the kitchen" });
  if ((await unsent.count()) === 0 && (await sent.count()) === 0) {
    await menu(DISHES[0].name).click();
    await menu(DISHES[0].name).click();
    await menu(DISHES[1].name).click();
  }

  if (await unsent.count()) {
    await expect(unsent.getByLabel(`2 of ${DISHES[0].name}`), "two taps on a dish did not make one line of two").toBeVisible({ timeout: 15_000 });
    await expect(unsent.getByLabel(`1 of ${DISHES[1].name}`)).toBeVisible();
    await expect(unsent.getByRole("listitem")).toHaveCount(2);
    // The tile counts what is waiting to go.
    await expect(menu(DISHES[0].name).getByTestId("tile-count")).toHaveText("2");

    // A WORD FOR THE COOK, on the biryani only.
    await unsent.getByRole("listitem").filter({ hasText: DISHES[0].name }).getByRole("button", { name: "+ Kitchen note" }).click();
    const note = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Kitchen note" }) });
    await note.getByRole("button", { name: "Less spicy", exact: true }).click();
    await note.getByRole("button", { name: "Save note" }).click();
    await expect(unsent.getByRole("button", { name: "Less spicy" })).toBeVisible({ timeout: 15_000 });

    // The running total is the dishes; tax is added at the bill.
    await expect(page.getByText(`Rs ${BILL.subtotal.toLocaleString()}`).last()).toBeVisible();

    // SEND. Three portions; one ticket per station, so the bar never gets
    // the biryani.
    await page.getByRole("button", { name: "Send to kitchen (3)" }).click();
    await expect(page.getByText(/2 kitchen tickets sent/)).toBeVisible({ timeout: 20_000 });

    await expect.poll(async () => (await handed(page)).length, { timeout: 20_000, message: "sending printed no kitchen ticket" }).toBe(2);
    const slips = await handed(page);
    const forKitchen = slips.find((s) => /KITCHEN/.test(s.title))!;
    const forBar = slips.find((s) => /BAR/.test(s.title))!;
    expect(forKitchen, "no ticket went to the Kitchen").toBeTruthy();
    expect(forBar, "no ticket went to the Bar").toBeTruthy();
    expect(forKitchen.text).toContain(DISHES[0].name);
    expect(forKitchen.text, "the kitchen was sent the bar's drink").not.toContain(DISHES[1].name);
    expect(forBar.text).toContain(DISHES[1].name);
    expect(forBar.text, "the bar was sent the kitchen's dish").not.toContain(DISHES[0].name);
    // What was said for the cook is on the cook's paper — and only there.
    expect(forKitchen.text, "the kitchen note did not reach the printed ticket").toMatch(/less spicy/i);
    expect(forBar.text).not.toMatch(/less spicy/i);
    // It says which table, and that it is the kitchen's paper.
    for (const slip of slips) {
      expect(slip.text).toContain(TABLES[0].name);
      expect(slip.text).toContain("KITCHEN COPY — NOT A RECEIPT");
      expect(slip.text).not.toMatch(/Rs\s?\d/);
    }
  }

  // Sent is sent: nothing left to send, and the lines can no longer be stepped.
  await expect(page.getByRole("region", { name: "Not sent yet" })).toHaveCount(0);
  await expect(sent).toContainText(DISHES[0].name);
  await expect(sent.getByRole("button", { name: `One more ${DISHES[0].name}` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send to kitchen", exact: true })).toBeDisabled();

  // And the floor says where this table has got to.
  await page.goto("/tenant/dine-in");
  await settled(page);
  const sat = page.getByRole("button", { name: new RegExp(`^${TABLES[0].name}\\b`) });
  await expect(sat).toContainText("In kitchen", { timeout: 20_000 });
  await expect(sat).toContainText(`Rs ${BILL.subtotal.toLocaleString()}`);
  await expect(sat).toContainText("2 guests");
});

test("H5 · the kitchen board shows both tickets, and each is worked off it", async ({ page }) => {
  await page.goto("/tenant/kitchen");
  await expect(page.getByRole("heading", { name: "Kitchen", exact: true })).toBeVisible({ timeout: 20_000 });
  await settled(page);

  const cards = page.getByRole("article").filter({ has: page.getByRole("heading", { name: TABLES[0].name, exact: true }) });
  await expect(cards, "the pass does not show a ticket for each station").toHaveCount(2, { timeout: 20_000 });
  const ticket = (dish: string) => cards.filter({ hasText: dish });
  await expect(ticket(DISHES[0].name)).toContainText(STATIONS[0]);
  await expect(ticket(DISHES[1].name)).toContainText(STATIONS[1]);
  // ONE row saying two — not "1 biryani" twice — and the word for the cook.
  await expect(ticket(DISHES[0].name).getByRole("listitem")).toHaveCount(1);
  await expect(ticket(DISHES[0].name).getByRole("listitem")).toContainText("2");
  await expect(ticket(DISHES[0].name)).toContainText(/less spicy/i);
  // Two covers at the table, said on the card the cook reads.
  await expect(cards.first()).toContainText("2 covers");

  // Both start in New, and the head of the board says so.
  const lane = (name: RegExp) => page.getByRole("region", { name });
  await expect(lane(/^New — /).getByRole("article").filter({ has: page.getByRole("heading", { name: TABLES[0].name, exact: true }) })).toHaveCount(2);

  // New → Cooking → Ready → gone, each ticket, by the one button on its card.
  for (const dish of DISHES) {
    const card = ticket(dish.name);
    await card.getByRole("button", { name: "Start cooking", exact: true }).click();
    await expect(lane(/^Cooking — /).getByRole("article").filter({ hasText: dish.name })).toHaveCount(1, { timeout: 15_000 });
    await card.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(lane(/^Ready — /).getByRole("article").filter({ hasText: dish.name })).toHaveCount(1, { timeout: 15_000 });

    if (dish === DISHES[0]) {
      // The floor is told: the table's tile turns to "Food ready".
      const floor = await page.context().newPage();
      await floor.goto("/tenant/dine-in");
      await expect(floor.getByRole("button", { name: new RegExp(`^${TABLES[0].name}\\b`) })).toContainText("Food ready", { timeout: 20_000 });
      await floor.close();
    }

    await card.getByRole("button", { name: "Served", exact: true }).click();
    await expect(card, `${dish.station}'s ticket is still on the pass after it was served`).toHaveCount(0, { timeout: 15_000 });
  }
});

test("H6 · the bill is the dishes and the tax, it is paid, and the table is free again", async ({ page, request }) => {
  const r = record();
  await page.goto(`/tenant/dine-in/tickets/${String(r.foodTab)}`);
  await settled(page);

  await page.getByRole("button", { name: "Settle", exact: true }).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Settle tab" }) });
  await expect(sheet).toBeVisible();

  // The figures, as worked out at the top of this file.
  const row = async (label: string | RegExp) => rupees(await sheet.getByText(label).locator("xpath=following-sibling::span[1]").innerText());
  expect(await row("Whole bill")).toBe(BILL.subtotal);
  expect(await row(`Tax (${TAX}%)`)).toBe(BILL.tax);
  expect(await row(/^Bill$/)).toBe(BILL.total);

  await sheet.getByRole("button", { name: /^Take Rs 1,134/ }).click();
  await expect(page.getByText(/Settled — invoice \S+/)).toBeVisible({ timeout: 20_000 });

  const sale = (await ask<Row[]>(request, "owner", "/sales?per_page=5"))[0];
  expect(Number(sale.total)).toBe(BILL.total);
  expect(Number(sale.tax)).toBe(BILL.tax);
  expect(sale.order_type).toBe("dine_in");
  remember({ foodSales: [String(sale.invoice_number)] });

  // The table can be sat at again.
  await page.goto("/tenant/dine-in");
  await settled(page);
  await expect(page.getByRole("button", { name: new RegExp(`^${TABLES[0].name}\\b`) })).toContainText("Free");
});

test("H7 · a takeaway at the counter is paid first, and still reaches the pass", async ({ page, request }) => {
  await watchThePrinter(page);

  // Rung ONCE. A second run of this case must find the order it already
  // rang, not ring another — or stage H8's "exactly two bills" is three.
  let invoice = ((record().foodSales as string[] | undefined) ?? [])[1];
  if (!invoice) {
    await openTill(page);
    await ring(page, DISHES[0].name);

    // 450 at 5%.
    expect(await tender(page, "Card")).toBe(472.5);
    const sale = await complete(page, request);
    expect(Number(sale.total)).toBe(472.5);
    invoice = String(sale.invoice_number);
    remember({ foodSales: [...((record().foodSales as string[]) ?? []), invoice] });

    // The kitchen was sent it, and the till says which paper that was.
    await expect.poll(async () => (await handed(page)).filter((d) => /^KOT #/.test(d.title)).length, { timeout: 20_000, message: "a takeaway rung at the counter never printed a kitchen ticket" }).toBe(1);
  }

  await page.goto("/tenant/kitchen");
  await settled(page);
  // Nobody gave a name, so the card is HEADED by the receipt number — the one
  // thing in the customer's hand that says which bag is theirs.
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: invoice, exact: true }) });
  await expect(card, "the takeaway is not on the kitchen board under its receipt number").toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("Takeaway");
  await expect(card).toContainText(DISHES[0].name);

  // And it is NOT a tab on the floor: it is paid, and nobody is sitting.
  await page.goto("/tenant/dine-in");
  await settled(page);
  await expect(page.getByRole("region", { name: "Takeaway" })).toHaveCount(0);
});

test("H8 · the books have exactly the two bills", async ({ page }) => {
  await page.goto("/tenant/reports");
  await settled(page);

  const card = async (label: string): Promise<number> => {
    const value = page.locator(`xpath=//h4[preceding-sibling::*[1][normalize-space(.)="${label}"]]`).first();
    await expect(value, `the "${label}" card is not on the screen`).toBeVisible({ timeout: 20_000 });

    return rupees((await value.innerText()).replace("Rs -", "-"));
  };

  expect(await card("Sales")).toBe(2);
  // 1,134 at the table and 472.50 at the counter.
  expect(await card("Revenue")).toBe(1606.5);
  // 54 + 22.50 held for the government, and not the shop's.
  expect(await card("Sales Tax (not yours)")).toBe(76.5);
});
