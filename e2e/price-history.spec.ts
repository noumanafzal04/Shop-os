import { test, expect } from "@playwright/test";

import { projectOnly } from "./rules";

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
    projectOnly("a flow test, not a layout one — chrome.spec walks every screen at every size"),
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

test("the panel's link reaches the rest of that item's changes", async ({ page, request }) => {
  // The panel shows a handful and deliberately has no page two — a product form
  // is not a place to browse. That was only honest once Activity could be
  // narrowed to ONE item: before this, it filtered to Products and no further,
  // so an item's eleventh-oldest price change meant paging every product change
  // in the shop.
  const auth = ownerAuth();
  const name = `${NAME} Trail`;

  await removeProductsNamed(request, name);
  const made = await request.post(`${API}/products`, {
    headers: auth,
    data: { name, item_type: "physical_product", price: 100, track_inventory: true },
  });
  const id = ((await made.json()) as { data: { id: string } }).data.id;

  for (const price of [110, 120, 130]) {
    const moved = await request.put(`${API}/products/${id}`, { headers: auth, data: { name, price } });
    expect(moved.ok(), `the price did not move to ${price}: ${moved.status()}`).toBeTruthy();
  }

  await page.goto(`/tenant/products/${id}/edit`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);

  const link = page.getByRole("link", { name: /every change to this item/i });
  await expect(link, "the panel does not offer the rest of the trail").toBeVisible();
  await link.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  // Narrowed, and SAYING it is narrowed. A filtered list that looks unfiltered
  // is how somebody concludes their shop has no history.
  expect(page.url(), "the link did not carry which item").toContain(`record=${id}`);
  await expect(
    page.getByText(/Showing one item only/i),
    "the list is filtered and does not admit it",
  ).toBeVisible();

  // Every row on screen is about THIS item, which is the whole point of the
  // filter — and the thing that was impossible before it.
  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  await expect(rows.filter({ hasText: name })).toHaveCount(await rows.count());

  await page.getByRole("button", { name: /Show everything/i }).click();
  await page.waitForTimeout(900);
  expect(page.url(), "clearing the filter left it in the URL").not.toContain("record=");
});
