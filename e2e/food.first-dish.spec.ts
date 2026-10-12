import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { API, foodAuth } from "./api";

/**
 * THE FIRST DISH — and the switch that could not put it right.
 *
 * ── What was found ───────────────────────────────────────────────────
 *
 * A new restaurant carded its first dish and could not sell it: "none left"
 * at every table. Walking a whole restaurant from an empty shop met it on the
 * fourth step.
 *
 *   it was born counted   The item form's "Track stock" started as ON and was
 *                         put right when the item types arrived from the
 *                         server. A dish created before they arrived — the
 *                         first one, when nothing is cached, on a slow line —
 *                         was sent as counted, at a stock of nothing.
 *
 *   and stayed that way   On an item that exists the same switch flipped, the
 *                         form saved, and the item was what it had been: the
 *                         form never sent it and the server refused it.
 *
 * So the form now says nothing about counting until somebody has chosen or it
 * has been told what the kind of item does, and an edit sends the switch when
 * it was moved — with what moving it will do said before Save is pressed.
 *
 * Fixed names; each test clears its own ground first.
 */

const PREFIX = "E2E First Dish ";

type Row = Record<string, unknown>;

const find = async (request: APIRequestContext, name: string): Promise<Row | undefined> => {
  const res = await request.get(`${API}/products?search=${encodeURIComponent(name)}&per_page=20`, { headers: foodAuth() });
  expect(res.ok(), `the menu could not be read (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Row[] }).data.find((p) => p.name === name);
};

/** This spec's own items, off the restaurant's menu. Dishes first: a dish holds its ingredients. */
async function clear(request: APIRequestContext): Promise<void> {
  const res = await request.get(`${API}/products?search=${encodeURIComponent(PREFIX)}&per_page=100`, { headers: foodAuth() });
  if (!res.ok()) return;
  const mine = ((await res.json()) as { data: Array<{ id: string; name: string; item_type: string }> }).data.filter((p) => p.name.startsWith(PREFIX));
  for (const p of [...mine].sort((a, b) => Number(b.item_type === "food_item") - Number(a.item_type === "food_item"))) {
    await request.delete(`${API}/products/${p.id}`, { headers: foodAuth() });
  }
}

/** A dish as the race left the first one: counted, with nothing to count. */
async function bornCounted(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post(`${API}/products`, {
    headers: foodAuth(),
    data: { item_type: "food_item", name, price: 450, description: "A fixture: a dish that was born counted.", track_inventory: true, stock_quantity: 0 },
  });
  expect(res.ok(), `the fixture could not be carded (${res.status()} ${await res.text()})`).toBeTruthy();

  return String(((await res.json()) as { data: { id: string } }).data.id);
}

// WHATEVER HAPPENS, the restaurant is left as it was found. The first run of
// this spec failed halfway (as it should have, on the form as it stood) and
// left a counted dish and a bag of rice on the menu — and the spec after it
// rings "the first tile" on the till, which was now the rice.
test.afterEach(async ({ request }) => {
  await clear(request);
});

const editor = (page: Page): Locator =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /^(Add item|Edit )/ }) });
const counted = (form: Locator): Locator => form.getByRole("button", { name: "Track stock for this item" });

async function openFor(page: Page, id: string): Promise<Locator> {
  await page.goto(`/tenant/products/${id}/edit`);
  const form = editor(page);
  await expect(form.getByRole("heading", { name: /^Edit / })).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");

  return form;
}

test("a dish made before the form is told what a dish is, is not born counted", async ({ page, request }, info) => {
  test.skip(info.project.name !== "restaurant", "what is sent is the same on every screen size");
  const name = `${PREFIX}Seekh Kebab`;
  await clear(request);

  // The item types arrive late — as they do the first time, on a slow line.
  let answered = false;
  await page.route("**/api/v1/item-types*", async (route) => {
    await new Promise((r) => setTimeout(r, 6_000));
    answered = true;
    await route.continue();
  });

  await page.goto("/tenant/products/new");
  const form = editor(page);
  await expect(form.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });

  // Until its name arrives, a kind of item is called something a person can read.
  const kinds = (await form.getByRole("button", { pressed: true }).allTextContents()).filter((t) => t.length > 0 && t.length < 30);
  expect(kinds.some((k) => /_/.test(k)), `a kind of item is shown by its code: ${kinds.join(", ")}`).toBe(false);
  // …and the form does not claim to know that a dish is counted.
  await expect(counted(form), "the form says a dish is counted before anybody has told it what a dish is").not.toHaveAttribute("aria-pressed", "true");

  await form.getByLabel("Name *", { exact: true }).fill(name);
  await form.getByLabel("Price *", { exact: true }).fill("450");
  const description = form.getByLabel("Description *", { exact: true });
  if (await description.isVisible().catch(() => false)) await description.fill("Made before the form was told what a dish is.");
  await form.getByRole("button", { name: "Create item" }).click();
  await expect(form).toBeHidden({ timeout: 20_000 });
  expect(answered, "the item types had already arrived, so this proved nothing").toBe(false);

  const made = await find(request, name);
  expect(made, "the dish is not on the menu").toBeTruthy();
  expect(made!.item_type).toBe("food_item");
  expect(made!.track_inventory, "a dish made in that gap was born counted, at a stock nobody gave it").toBe(false);

  await clear(request);
});

test("the switch on a dish that exists is kept — and says what it will do before Save is pressed", async ({ page, request }, info) => {
  test.skip(info.project.name !== "restaurant", "what is sent is the same on every screen size");
  const name = `${PREFIX}Chicken Biryani`;
  await clear(request);
  const id = await bornCounted(request, name);

  // ── stop counting it ──────────────────────────────────────────────
  let form = await openFor(page, id);
  await expect(counted(form)).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByTestId("counting-change"), "nothing has been moved, and the form warns anyway").toHaveCount(0);
  await counted(form).click();
  await expect(form.getByTestId("counting-change")).toHaveText("When you save, this is always available, whatever the shelf says.");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form).toBeHidden({ timeout: 20_000 });

  expect((await find(request, name))!.track_inventory, "the switch flipped, the form saved, and the dish is still counted").toBe(false);

  // …and it is still off when the dish is opened again.
  form = await openFor(page, id);
  await expect(counted(form)).toHaveAttribute("aria-pressed", "false");

  // ── start again: with none on the books, that takes it off every table ──
  await counted(form).click();
  await expect(form.getByTestId("counting-change")).toHaveText(
    "When you save, this is counted from nothing — it will be out of stock until you add some on the Inventory screen.",
  );
  // Moved back, there is nothing to warn about and nothing to send.
  await counted(form).click();
  await expect(form.getByTestId("counting-change")).toHaveCount(0);
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form).toBeHidden({ timeout: 20_000 });
  expect((await find(request, name))!.track_inventory).toBe(false);

  await clear(request);
});

test("an ingredient of a dish cannot stop being counted — the form says why, and stays open", async ({ page, request }, info) => {
  test.skip(info.project.name !== "restaurant", "what is sent is the same on every screen size");
  await clear(request);

  const make = async (data: Row): Promise<string> => {
    const res = await request.post(`${API}/products`, { headers: foodAuth(), data });
    expect(res.ok(), `the fixture could not be carded (${res.status()} ${await res.text()})`).toBeTruthy();

    return String(((await res.json()) as { data: { id: string } }).data.id);
  };
  const rice = await make({
    item_type: "physical_product", name: `${PREFIX}Rice`, price: 300, cost: 300, description: "A fixture: an ingredient.",
    track_inventory: true, stock_quantity: 10,
  });
  await make({
    item_type: "food_item", name: `${PREFIX}Pulao`, price: 350, description: "A fixture: a dish that uses the rice.",
    recipe_items: [{ ingredient_product_id: rice, quantity: 0.25 }],
  });

  const form = await openFor(page, rice);
  await counted(form).click();
  await form.getByRole("button", { name: "Save changes" }).click();

  await expect(
    page.getByText(`${PREFIX}Rice is an ingredient of 1 dish. A dish cannot use up something nobody counts — take it out of that recipe first.`).first(),
    "the refusal is not said where the owner is looking",
  ).toBeVisible({ timeout: 15_000 });
  await expect(form, "the form closed on a refusal").toBeVisible();
  expect((await find(request, `${PREFIX}Rice`))!.track_inventory).toBe(true);

  await clear(request);
});
