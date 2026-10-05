import { OWNER_STATE, ask, expect, rupees, session, settled, test } from "./kit";
import { DEFAULT_TAX, ITEMS, TAX_GROUPS, addItem, findOnShelf, selling } from "./shop";

/**
 * STAGE B (the shelf) — WHAT THE SHOP SELLS, entered by hand.
 *
 * Settings first, because a product's tax depends on them; then the tax
 * groups a product can name; then the products, each read back from the list
 * and from the server.
 */

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

test("B3 · the shop's default tax is set, saved, and still there after a reload", async ({ page, request }) => {
  await page.goto("/tenant/settings");
  await page.getByRole("button", { name: "Tax & Delivery" }).click();

  const rate = page.getByLabel("Default tax %", { exact: true });
  await expect(rate).toBeVisible();
  await rate.fill(String(DEFAULT_TAX));
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await page.getByRole("button", { name: "Tax & Delivery" }).click();
  await expect(page.getByLabel("Default tax %", { exact: true })).toHaveValue(String(DEFAULT_TAX));

  const settings = await ask<{ default_tax_rate: number | string }>(request, "owner", "/shop/settings");
  expect(Number(settings.default_tax_rate)).toBe(DEFAULT_TAX);
});

test("B4 · tax groups are added and listed with the rate typed", async ({ page, request }) => {
  await page.goto("/tenant/settings");
  await page.getByRole("button", { name: "Tax & Delivery" }).click();

  for (const group of TAX_GROUPS) {
    await page.getByLabel("New group", { exact: true }).fill(group.name);
    await page.getByLabel("Rate %", { exact: true }).fill(String(group.rate));
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(group.name).first(), `${group.name} did not appear after Add`).toBeVisible({ timeout: 15_000 });
  }

  const held = await ask<Array<{ name: string; rate: number | string }>>(request, "owner", "/tax-groups");
  for (const group of TAX_GROUPS) {
    const mine = held.find((g) => g.name === group.name);
    expect(mine, `${group.name} is not on the server`).toBeTruthy();
    expect(Number(mine!.rate)).toBe(group.rate);
  }
});

test("B5 · a category is added and is on the list", async ({ page }) => {
  await page.goto("/tenant/categories");
  await expect(page.getByRole("heading", { name: "Categories", exact: true })).toBeVisible();

  await page.getByRole("textbox", { name: "Category name" }).fill("QA Stationery");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByText("QA Stationery").first()).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await settled(page);
  await expect(page.getByText("QA Stationery").first()).toBeVisible();
});

for (const i of ITEMS) {
  test(`B6 · ${i.name} is added by hand and reads back the same`, async ({ page, request }) => {
    // RESUMABLE. A journey is long, and a stage that stopped halfway is run
    // again from where it stopped — so an item an earlier attempt already
    // made is not made twice (the server would refuse the duplicate SKU, and
    // rightly). Everything it is CHECKED against below still runs.
    const before = await ask<Array<Record<string, unknown>>>(request, "owner", `/products?search=${encodeURIComponent(i.name)}`);
    if (before.some((p) => p.name === i.name)) {
      test.info().annotations.push({ type: "resumed", description: `${i.name} was already on the shelf` });
    } else {
      await addItem(page, i);
    }

    // On the list, with its price.
    const row = await findOnShelf(page, i.name);
    const prices = (await row.innerText()).match(/Rs\s?[0-9,]+(?:\.[0-9]+)?/g) ?? [];
    expect(prices.map(rupees), `${i.name}'s row shows ${prices.join(", ")}`).toContain(selling(i));

    // And on the server, field for field.
    const found = await ask<Array<Record<string, unknown>>>(request, "owner", `/products?search=${encodeURIComponent(i.name)}`);
    const held = found.find((p) => p.name === i.name);
    expect(held, `${i.name} is not on the server`).toBeTruthy();

    expect(Number(held!.price)).toBe(i.price);
    if (i.salePrice !== undefined) expect(Number(held!.discount_price)).toBe(i.salePrice);
    if (i.cost !== undefined) expect(Number(held!.cost)).toBe(i.cost);
    if (i.sku) expect(held!.sku).toBe(i.sku);
    if (i.wholesale !== undefined) expect(Number(held!.wholesale_price)).toBe(i.wholesale);
    if (i.taxRate !== undefined) expect(Number(held!.tax_rate)).toBe(i.taxRate);
    if (i.taxGroup) expect(Number(held!.tax_group_rate), "the group's rate did not reach the product").toBe(i.effectiveTax);
    if (i.stock !== undefined) expect(Number(held!.stock_quantity), "opening stock").toBe(i.stock);
    if (i.weighed) expect(held!.sold_by).toBe("weight");
    if (i.type === "service") expect(held!.item_type).toBe("service");
  });
}
