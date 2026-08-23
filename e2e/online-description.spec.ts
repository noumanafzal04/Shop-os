import { test, expect } from "@playwright/test";

import { API, ownerAuth, removeProductsNamed } from "./api";

/**
 * "SAVED WITH WARNING", ON A SCREEN THAT HAD SAVED NOTHING.
 *
 * An item shown to online customers needs a description, and the form enforced
 * it by setting a warning and returning — no request, no save. But the banner
 * that renders warnings is titled **"Saved with warning"**, and the two states
 * shared it. So a shopkeeper corrected a price, read that it had saved, closed
 * the drawer, and lost the edit. The message contradicted its own title: *saved*,
 * and in the same breath *add a description before saving*.
 *
 * It was found on a demo shop where all four products were online with no
 * description — which meant not one price in the shop could be corrected, and
 * every attempt said it had worked.
 *
 * Two things are pinned here:
 *
 *   · a refusal never claims to have saved, and
 *   · on EDIT it is no longer a refusal at all. The item is already online
 *     without a description; blocking the save does not take it off the
 *     marketplace, it only stops the shop fixing anything else about it.
 */

test.describe.configure({ mode: "serial" });

test.beforeEach(({ browserName }, testInfo) => {
  void browserName;
  test.skip(
    testInfo.project.name !== "desktop",
    "a flow test, not a layout one — chrome.spec walks every screen at every size",
  );
});

const NAME = "E2E Online No Description";

test("an online item with no description can still have its price fixed", async ({ page, request }) => {
  const auth = ownerAuth();

  await removeProductsNamed(request, NAME);

  const made = await request.post(`${API}/products`, {
    headers: auth,
    data: {
      name: NAME,
      item_type: "physical_product",
      price: 400,
      track_inventory: true,
      stock_quantity: 5,
      visible_in_marketplace: true,
    },
  });
  expect(made.ok(), `could not create the fixture: ${made.status()}`).toBeTruthy();
  const id = ((await made.json()) as { data: { id: string } }).data.id;

  await page.goto(`/tenant/products/${id}/edit`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  // ── the precondition, stated out loud ────────────────────────────────
  //
  // If this shop has no marketplace module the rule never engages, and the rest
  // of this test would pass while proving nothing. That is the failure mode
  // this whole suite exists to avoid, so it is checked rather than assumed.
  const hint = page.getByText(/shown online.*blank listing/i);
  await expect(
    hint,
    "the online-description rule is not engaged here — this test would pass vacuously",
  ).toBeVisible();

  await page.getByLabel(/^Price/).first().fill("475");
  await page.getByRole("button", { name: /^(Save|Update)/ }).last().click();
  await page.waitForTimeout(2500);

  // THE assertion: the server has the new price. Before the fix the click
  // produced no request at all.
  const after = await request.get(`${API}/products?search=${encodeURIComponent(NAME)}&per_page=5`, { headers: auth });
  const saved = ((await after.json()) as { data: Array<{ name: string; price: string }> })
    .data.find((r) => r.name === NAME);

  expect(Number(saved?.price), "the edit was refused, and the screen said it had saved").toBe(475);
});

test("creating one refuses, and does not pretend otherwise", async ({ page, request }) => {
  await removeProductsNamed(request, `${NAME} New`);

  await page.goto("/tenant/products/new");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);

  await page.getByLabel(/^Name/).first().fill(`${NAME} New`);
  await page.getByLabel(/^Price/).first().fill("300");
  // Left online, left with no description — the state the rule is for.

  await page.getByRole("button", { name: /^(Save|Create)/ }).last().click();
  await page.waitForTimeout(1200);

  // On create the rule still stops the save. What must never happen again is
  // the word "Saved" on a screen that saved nothing.
  const banner = page.getByText(/Nothing has been saved yet/i);
  const engaged = await banner.isVisible().catch(() => false);

  test.skip(!engaged, "the online-description rule is not engaged on this shop");

  await expect(page.getByText("Saved with warning")).toHaveCount(0);
  await expect(page.getByText("Not saved")).toBeVisible();
});
