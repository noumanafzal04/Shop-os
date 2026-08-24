import { test, expect } from "@playwright/test";

import { projectOnly } from "./rules";

import { API, ownerAuth, removeProductsNamed } from "./api";

/**
 * WHICH PIZZA IS IN THE FAMILY DEAL.
 *
 * A deal listed its parts by PRODUCT, and a product can have sizes — so a deal
 * containing a pizza never said which one, and the sale had nothing to take off
 * the shelf. Measured before the fix, on a shop holding ten Small and ten Large:
 *
 *     PARENT stock: 0 · effective: 20
 *     SALE → 422  "Insufficient stock: only 0 in stock."
 *
 * Not a wrong number — a refusal, on a full shelf. Any deal containing a sized
 * product was unsellable.
 *
 * The server refuses to save such a deal now, which means the question has to be
 * ASKABLE on the screen. That is what this drives: the second dropdown existing
 * at all is the whole point, and a unit test cannot see a control that is absent.
 */

test.describe.configure({ mode: "serial" });

test.beforeEach(({ browserName }, testInfo) => {
  void browserName;
  test.skip(
    testInfo.project.name !== "desktop",
    projectOnly("a flow test, not a layout one — chrome.spec walks every screen at every size"),
  );
});

const SIZED = "E2E Deal Pizza";
const DEAL = "E2E Family Deal";

test("a deal names which size it contains, and the server keeps it", async ({ page, request }) => {
  const auth = ownerAuth();

  await removeProductsNamed(request, DEAL);
  await removeProductsNamed(request, SIZED);

  const made = await request.post(`${API}/products`, {
    headers: auth,
    data: {
      name: SIZED, item_type: "physical_product", price: 900, track_inventory: true,
      variants: [
        { name: "Small", price: 700, stock_quantity: 10 },
        { name: "Large", price: 1200, stock_quantity: 10 },
      ],
    },
  });
  expect(made.ok(), `could not create the fixture: ${made.status()}`).toBeTruthy();
  const pizza = (await made.json()) as { data: { variants: Array<{ id: string; name: string }> } };
  const large = pizza.data.variants.find((v) => v.name === "Large")!.id;

  await page.goto("/tenant/products/new");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(900);

  // A deal is an item type, chosen at creation.
  const dealChip = page.getByRole("button", { name: /Combo \/ Deal/i });
  test.skip(!(await dealChip.isVisible().catch(() => false)), "this shop cannot sell deals");
  await dealChip.click();

  await page.getByLabel(/^Name/).first().fill(DEAL);
  await page.getByLabel(/^Price/).first().fill("1500");
  await page.getByLabel(/^Description/).first().fill("Two sizes, one price.");

  await page.getByRole("button", { name: "+ Add item to deal" }).click();
  await page.getByLabel("Item 1 in this deal").selectOption({ label: SIZED });
  await page.waitForTimeout(400);

  // THE control that did not exist. Its absence is the entire bug.
  const size = page.getByLabel("Which size of item 1");
  await expect(size, "the deal editor still cannot name a size").toBeVisible();
  await size.selectOption({ label: "Large" });

  await page.getByRole("button", { name: /^(Save|Create)/ }).last().click();
  await page.waitForTimeout(2500);

  const after = await request.get(`${API}/products?search=${encodeURIComponent(DEAL)}&per_page=5`, { headers: auth });
  const deal = ((await after.json()) as {
    data: Array<{ name: string; combo_items: Array<{ variant_id: string | null }> }>;
  }).data.find((r) => r.name === DEAL);

  expect(deal, "the deal was not created at all").toBeTruthy();
  expect(
    deal!.combo_items?.[0]?.variant_id,
    "the deal saved without a size — which is the state that made it unsellable",
  ).toBe(large);
});
