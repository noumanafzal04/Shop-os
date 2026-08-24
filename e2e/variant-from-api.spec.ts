import { test, expect } from "@playwright/test";

import { projectOnly } from "./rules";

import { API, ownerAuth, removeProductsNamed } from "./api";

/**
 * SIZES THAT ARRIVED THROUGH THE API, OPENED IN THE FORM.
 *
 * `variant-form.spec.ts` next door creates a product THROUGH the grid, so the
 * product it reopens carries `attributes.variant_axes` — the axes the shop
 * typed. Every product that predates the grid, every one seeded, and every one
 * pushed in over the API has `attributes = null` and a flat list of names.
 *
 * That is most of the catalogue in a real shop, and it was the one shape the
 * editor had never been opened on. A grocer with three sizes of frozen pizza
 * reported the sizes tab missing entirely on edit, and nothing in the suite
 * could have contradicted them.
 */

test.describe.configure({ mode: "serial" });

test.beforeEach(({ browserName }, testInfo) => {
  void browserName;
  test.skip(
    testInfo.project.name !== "desktop",
    projectOnly("a flow test, not a layout one — chrome.spec walks every screen at every size"),
  );
});

// Fixed, and cleared below. See removeProductsNamed.
const NAME = "E2E API Sized";

test("a product whose sizes came from the API still opens its sizes", async ({ page, request }) => {
  const auth = ownerAuth();

  await removeProductsNamed(request, NAME);

  // The shape the form never produces: variants, no axes, no description of
  // where the names came from.
  const made = await request.post(`${API}/products`, {
    headers: auth,
    data: {
      name: NAME,
      item_type: "physical_product",
      price: 650,
      track_inventory: true,
      variants: [
        { name: 'Small 7"', price: 650, stock_quantity: 10 },
        { name: 'Medium 9"', price: 950, stock_quantity: 10 },
        { name: 'Large 12"', price: 1350, stock_quantity: 10 },
      ],
    },
  });
  expect(made.ok(), `could not create the fixture: ${made.status()}`).toBeTruthy();
  const id = ((await made.json()) as { data: { id: string; attributes: unknown } }).data.id;

  await page.goto(`/tenant/products/${id}/edit`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  // THE assertion the report is about: the tab is there at all.
  const tab = page.getByRole("button", { name: /Sizes & options/i });
  await expect(tab, "the sizes tab is missing on a product that HAS sizes").toBeVisible();

  await tab.click();
  await page.waitForTimeout(500);

  // And the sizes themselves came back, priced. Without recorded axes the
  // editor rebuilds them from the names; what must never happen is a tab that
  // opens on nothing while the list screen says "3 variants".
  for (const size of ['Small 7"', 'Medium 9"', 'Large 12"']) {
    await expect(page.locator("[data-variant-grid]"), `${size} is not in the grid`).toContainText(size);
  }
});

test("and opening it from the LIST row shows the same tab", async ({ page, request }) => {
  const auth = ownerAuth();

  // The path the report came from: the shopkeeper is on the products screen,
  // the row says "3 variants", and they press Edit on that row. It reaches the
  // same url — but the drawer opens over a list whose cached rows already
  // answered half of what the form asks for, and that is a different first
  // render from a cold navigation.
  const res = await request.get(`${API}/products?search=${encodeURIComponent(NAME)}&per_page=5`, { headers: auth });
  const rows = ((await res.json()) as { data: Array<{ id: string; name: string }> }).data;
  expect(rows.find((r) => r.name === NAME), "the first test's fixture is missing").toBeTruthy();

  await page.goto("/tenant/products");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByPlaceholder(/Search/i).first().fill(NAME);
  await page.waitForTimeout(1200);

  await page.getByLabel(`Edit ${NAME}`).click();
  await page.waitForTimeout(1200);

  await expect(
    page.getByRole("button", { name: /Sizes & options/i }),
    "the sizes tab is missing when the drawer is opened from the row",
  ).toBeVisible();
});
