import { OWNER_STATE, ask, expect, record, rupees, session, settled, test } from "./kit";
import { CUSTOMERS, PURCHASE, item } from "./shop";

/**
 * STAGE D — THE BOOKS AGREE WITH THE DAY.
 *
 * Nothing is entered here. Everything the journey did has been done; this
 * stage walks the screens that SUMMARISE it and holds each figure to the one
 * worked out by hand from what was actually rung:
 *
 *   ten sales                                     43,543.96
 *   of which sales tax                             3,599.96
 *   two bags of rice returned                     −4,095.00   (195.00 of it tax)
 *   cost of what stayed sold                      31,769.95
 *   rent, electricity, tea                        33,700.00
 *   shelf space rented out                        +5,000.00
 *
 *   gross profit = 43,543.96 − 4,095 − 3,404.96 − 31,769.95 =   4,274.05
 *   net profit   =  4,274.05 + 5,000 − 33,700               = −24,425.95
 */

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Row = Record<string, unknown>;

/**
 * A report card: the figure whose OWN label, right beside it, is this one.
 *
 * Found by the label being the element immediately before the figure. Finding
 * "the first thing on the page that says Expenses" found the menu entry, and
 * read the next figure after it — which was the sales count.
 */
const card = async (page: import("@playwright/test").Page, label: string): Promise<number> => {
  const value = page.locator(`xpath=//h4[preceding-sibling::*[1][normalize-space(.)="${label}"]]`).first();
  await expect(value, `the "${label}" card is not on the screen`).toBeVisible({ timeout: 20_000 });

  return rupees((await value.innerText()).replace("Rs -", "-"));
};

test("D2 · Reports: the month's figures are the day's, and the row adds up", async ({ page }) => {
  expect((record().day as unknown[]).length).toBe(10);

  await page.goto("/tenant/reports");
  await settled(page);

  const sales = await card(page, "Sales");
  const revenue = await card(page, "Revenue");
  const refunds = await card(page, "Refunds");
  const other = await card(page, "Other Income");
  const tax = await card(page, "Sales Tax (not yours)");
  const cogs = await card(page, "Cost of Goods");
  const gross = await card(page, "Gross Profit");
  const expenses = await card(page, "Expenses");
  const net = await card(page, "Net Profit");

  expect(sales).toBe(10);
  expect(revenue).toBe(43543.96);
  expect(refunds).toBe(4095);
  expect(other).toBe(5000);
  // 3,599.96 charged, 195 handed back with the rice.
  expect(tax).toBe(3404.96);
  expect(cogs).toBe(31769.95);
  // The shop's own money, with the government's taken out of it.
  expect(gross).toBe(4274.05);
  expect(expenses).toBe(33700);
  expect(net).toBe(-24425.95);

  // And a person with a calculator gets the same answer from the cards.
  expect(Math.round((revenue - refunds - tax - cogs) * 100) / 100, "the row does not add up on screen").toBe(gross);
  expect(Math.round((gross + other - expenses) * 100) / 100).toBe(net);
});

test("D2 · Reports: the best sellers, with weighed goods counted by weight", async ({ page }) => {
  await page.goto("/tenant/reports");
  await settled(page);

  const top = async (name: string) => {
    const cells = await page.getByRole("row").filter({ hasText: name }).first().getByRole("cell").allInnerTexts();

    return { units: Number(cells[1]), revenue: rupees(cells[2]) };
  };

  // 2 + 10 + 1 sold, 2 came back.
  expect(await top(item("rice").name)).toEqual({ units: 11, revenue: 19950 });
  expect(await top(item("oil").name)).toEqual({ units: 4, revenue: 11400 });
  expect(await top(item("tea").name)).toEqual({ units: 3, revenue: 3897 });
  expect(await top(item("soap").name)).toEqual({ units: 7, revenue: 840 });
  // 2.5 kg and 1 kg. It read "3".
  expect(await top(item("sugar").name)).toEqual({ units: 3.5, revenue: 560 });
});

test("D2 · Reports: the tax a shop files is what it charged less what it handed back", async ({ page }) => {
  await page.goto("/tenant/reports");
  await page.getByRole("button", { name: "Tax", exact: true }).click();

  expect(await card(page, "Tax collected")).toBe(3599.96);
  expect(await card(page, "Tax refunded")).toBe(195);
  expect(await card(page, "Tax payable")).toBe(3404.96);
  expect(await card(page, "Gross sales")).toBe(43543.96);
});

test("D3 · the shelf is opening + received − sold + returned, for every item", async ({ page, request }) => {
  const expected: Record<string, number> = {
    oil: 40 + 20 - 4,          // 56
    rice: 60 + 30 - 13 + 2,    // 79
    sugar: 200 - 3.5,          // 196.5
    tea: 30 - 3,               // 27
    soap: 150 - 7,             // 143
  };

  for (const [key, want] of Object.entries(expected)) {
    const name = item(key).name;
    const held = (await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`)).find((p) => p.name === name)!;
    expect(Number(held.stock_quantity), `${name} on the server`).toBe(want);
  }

  // …and the Inventory screen says the same as the server for each.
  await page.goto("/tenant/inventory");
  await settled(page);
  for (const [key, want] of Object.entries(expected)) {
    await page.getByPlaceholder(/search/i).first().fill(item(key).name);
    const row = page.getByRole("row").filter({ hasText: item(key).name }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row, `${item(key).name} on the Inventory screen`).toContainText(String(want));
  }
});

test("D4 · who owes the shop, and whom the shop owes", async ({ page, request }) => {
  const bilal = CUSTOMERS.find((c) => c.key === "trader")!;

  // He bought 18,900 on khata and paid 5,000.
  expect((await ask<{ credit_balance: number }>(request, "owner", `/customers-lookup?phone=${bilal.phone}`)).credit_balance).toBe(13900);
  await page.goto("/tenant/customers");
  await page.getByRole("row").filter({ hasText: bilal.name }).first().getByText(bilal.name).click();
  await expect(page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: bilal.name }) })).toContainText("Rs 13,900");

  // The shop has paid its supplier nothing yet.
  await page.goto("/tenant/suppliers");
  await settled(page);
  const owed = ((await page.getByRole("row").filter({ hasText: PURCHASE.supplier }).first().innerText()).match(/Rs\s?[0-9,]+(?:\.[0-9]+)?/g) ?? []).map(rupees);
  expect(owed).toContain(PURCHASE.total);
});

test("D4 · the activity trail has what was changed, and by whom", async ({ page }) => {
  const r = record();

  await page.goto("/tenant/activity");
  await settled(page);
  await expect(page.getByText(r.ownerName).first(), "the trail names nobody").toBeVisible({ timeout: 20_000 });
  // The credit limit given to the trader is a money authority, and is on it.
  await expect(page.getByText(/QA Bilal Traders/).first()).toBeVisible();
});

test("D5 · every screen once more, now that it has a day in it — nothing refused, nothing blank", async ({ page }) => {
  test.setTimeout(600_000);
  const screens = record().screens as string[];
  expect(screens.length).toBeGreaterThanOrEqual(30);

  const bounced: string[] = [];
  const blank: string[] = [];
  for (const href of screens) {
    await page.goto(href);
    await settled(page);
    await page.waitForTimeout(350);
    if (new URL(page.url()).pathname.replace(/\/$/, "") !== href.replace(/\/$/, "")) bounced.push(`${href} → ${new URL(page.url()).pathname}`);
    if ((await page.locator("body").innerText()).trim().length < 40) blank.push(href);
  }

  expect(bounced).toEqual([]);
  expect(blank).toEqual([]);
});
