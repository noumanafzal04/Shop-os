import { test, expect } from "@playwright/test";

import { API, foodAuth, removeProductsNamed } from "./api";

/**
 * WHEN A LARGE USES MORE THAN A SMALL.
 *
 * A recipe belonged to a DISH, so a pizzeria that wrote one recipe for a pizza
 * sold in three sizes had every size draw the same flour. Measured before any
 * of this existed, on a dish with a `2 dough` recipe:
 *
 *     one SMALL sold → dough 2 consumed
 *     one LARGE sold → dough 2 consumed
 *
 * Nothing was broken. The feature had been built one dimension short of the
 * thing it describes, and the shop's food cost was right for one size at most.
 *
 * The server can store the answer now, which means the question has to be
 * ASKABLE on the screen — and only on a dish already saved, because a size
 * still being typed into the grid has no id for a recipe line to point at.
 * That last part is exactly what a unit test cannot see.
 */

test.describe.configure({ mode: "serial" });

// No project guard. `playwright.config.ts` runs this in the `restaurant`
// project and nowhere else — a spec that guards itself with a skip is a spec
// that can quietly stop running, which is exactly what this one did before
// there was a shop that could host it.


const DOUGH = "E2E Recipe Dough";
const PIZZA = "E2E Recipe Pizza";

test("a recipe line can name which size it is for, and the server keeps it", async ({ page, request }) => {
  const auth = foodAuth();

  await removeProductsNamed(request, PIZZA);
  await removeProductsNamed(request, DOUGH);

  const madeDough = await request.post(`${API}/products`, {
    headers: auth,
    data: { name: DOUGH, item_type: "physical_product", price: 0, cost: 30, track_inventory: true, stock_quantity: 500 },
  });
  expect(madeDough.ok(), `could not create the ingredient: ${madeDough.status()}`).toBeTruthy();

  // The dish is created ALREADY SAVED with its sizes, because a recipe line can
  // only point at a size the server has an id for.
  const madePizza = await request.post(`${API}/products`, {
    headers: auth,
    data: {
      name: PIZZA, item_type: "food_item", price: 900, track_inventory: false,
      variants: [
        { name: "Small", price: 700 },
        { name: "Large", price: 1200 },
      ],
    },
  });
  expect(
    madePizza.ok(),
    `the restaurant shop could not keep a food dish (${madePizza.status()}) — `
    + "this project exists precisely because it can, so a refusal here is a real failure",
  ).toBeTruthy();
  const pizza = (await madePizza.json()) as { data: { id: string; variants: Array<{ id: string; name: string }> } };
  const large = pizza.data.variants.find((v) => v.name === "Large")!.id;

  await page.goto(`/tenant/products/${pizza.data.id}/edit`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  const addIngredient = page.getByRole("button", { name: "+ Add ingredient" });
  await expect(
    addIngredient,
    "no recipe editor on a food dish — the restaurant shop runs Inventory, so this is a real failure",
  ).toBeVisible();

  await addIngredient.click();
  await page.getByLabel("Ingredient 1", { exact: true }).selectOption({ label: DOUGH });
  await page.waitForTimeout(300);

  // THE control that did not exist. Its absence is the entire bug: without it
  // a pizzeria has one recipe for three sizes and no way to say otherwise.
  const size = page.getByLabel("Which size ingredient 1 is for", { exact: true });
  await expect(size, "the recipe editor still cannot name a size").toBeVisible();
  await size.selectOption({ label: "Large only" });

  await page.getByLabel("Quantity of ingredient 1", { exact: true }).fill("5");

  await page.getByRole("button", { name: /^(Save|Create)/ }).last().click();
  await page.waitForTimeout(2500);

  const after = await request.get(`${API}/products/${pizza.data.id}`, { headers: auth });
  const saved = (await after.json()) as {
    data: { recipe_items: Array<{ variant_id: string | null; quantity: string }> };
  };

  const row = saved.data.recipe_items?.[0];
  expect(row, "the recipe was not saved at all").toBeTruthy();
  expect(
    row!.variant_id,
    "the recipe saved without a size — which is the state where a Large drew a Small's flour",
  ).toBe(large);
  expect(Number(row!.quantity)).toBe(5);

  // These are the QA sweep's own shops. A fixture left behind is one the next
  // run has to explain, and an `E2E ` dish sitting in a 160-item menu is the
  // first thing a food-cost check trips over.
  await removeProductsNamed(request, PIZZA);
  await removeProductsNamed(request, DOUGH);
});
