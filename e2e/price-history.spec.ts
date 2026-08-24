import { test, expect } from "@playwright/test";

import { API, ownerAuth, removeProductsNamed } from "./api";

/**
 * WHAT THIS ITEM USED TO COST, ON THE SCREEN SOMEBODY ASKS THE QUESTION ON.
 *
 * The backend suite pins that a price change files a row with the old figure in
 * it. That is not the same as a shopkeeper being able to read it — this
 * repository's most repeated defect is a working capability with nothing
 * reaching it, and the audit trail has been through exactly that once already
 * (recorded for the platform, unreadable by the shop it was about).
 *
 * So this drives the actual drawer: change a price, reopen the item, and the
 * old price is on screen with a name beside it.
 */

test.describe.configure({ mode: "serial" });

test.beforeEach(({ browserName }, testInfo) => {
  void browserName;
  test.skip(
    testInfo.project.name !== "desktop",
    "a flow test, not a layout one — chrome.spec walks every screen at every size",
  );
});

const NAME = "E2E Price History";

test("a price change shows up on the item, with what it used to be", async ({ page, request }) => {
  const auth = ownerAuth();

  await removeProductsNamed(request, NAME);

  const made = await request.post(`${API}/products`, {
    headers: auth,
    data: { name: NAME, item_type: "physical_product", price: 180, track_inventory: true },
  });
  expect(made.ok(), `could not create the fixture: ${made.status()}`).toBeTruthy();
  const id = ((await made.json()) as { data: { id: string } }).data.id;

  // The change itself, through the API — this spec is about whether the shop
  // can READ its own trail, not about which button moved the price.
  const moved = await request.put(`${API}/products/${id}`, {
    headers: auth,
    data: { name: NAME, price: 210 },
  });
  expect(moved.ok(), `the price did not move: ${moved.status()}`).toBeTruthy();

  await page.goto(`/tenant/products/${id}/edit`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);

  const section = page.locator("[data-price-history]");
  await expect(section, "the item shows no history of its own price").toBeVisible();

  // THE assertion: the figure that is gone from the field is still on screen.
  // "It is 210 now" is in the price box already; what a trail adds is 180.
  await expect(section, "the old price is not shown — which is the only thing a history adds")
    .toContainText("180");
  await expect(section).toContainText("210");
});

test("a fresh item shows no history at all", async ({ page, request }) => {
  // Not an empty card saying "no changes yet". An item nobody has re-priced has
  // nothing to say, and a section that is permanently empty is one people learn
  // to skip past.
  const auth = ownerAuth();
  const name = `${NAME} Fresh`;

  await removeProductsNamed(request, name);
  const made = await request.post(`${API}/products`, {
    headers: auth,
    data: { name, item_type: "physical_product", price: 99, track_inventory: true },
  });
  const id = ((await made.json()) as { data: { id: string } }).data.id;

  await page.goto(`/tenant/products/${id}/edit`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);

  await expect(page.locator("[data-price-history]")).toHaveCount(0);
});
