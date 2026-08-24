import { test, expect } from "@playwright/test";

import { projectOnly } from "./rules";

import { API, ownerAuth, removeProductsNamed } from "./api";

/**
 * A KITCHEN RUNS OUT. A CHAIN DOES NOT.
 *
 * Eighty-sixing belonged to the shop, so a chain had ONE switch between its
 * kitchens: Gulberg lost its last bases, the chef took the pizza off, and DHA —
 * with a full tray — stopped selling it too.
 *
 * The backend suite pins the rule. What only a browser can say is whether the
 * sheet a chef actually presses TELLS them which kitchen they are describing:
 * a press that silently means "here" while the screen says nothing is the same
 * bug wearing a different face.
 */

test.describe.configure({ mode: "serial" });

test.beforeEach(({ browserName }, testInfo) => {
  void browserName;
  test.skip(
    testInfo.project.name !== "desktop",
    projectOnly("a flow test, not a layout one — chrome.spec walks every screen at every size"),
  );
});

const ITEM = "E2E Branch Pizza";

test("the sold-out sheet says which branch it is talking about", async ({ page, request }) => {
  const auth = ownerAuth();

  const branches = await request.get(`${API}/branches`, { headers: auth });
  const list = ((await branches.json()) as { data: Array<{ id: string; name: string }> }).data ?? [];
  test.skip(list.length < 2, "this shop is on a single-branch plan — there is no which");

  await removeProductsNamed(request, ITEM);
  const made = await request.post(`${API}/products`, {
    headers: auth,
    data: { name: ITEM, item_type: "physical_product", price: 900, track_inventory: false },
  });
  expect(made.ok(), `could not create the fixture: ${made.status()}`).toBeTruthy();

  await page.goto("/tenant/products");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  const search = page.getByPlaceholder(/search/i).first();
  await search.fill(ITEM);
  await page.waitForTimeout(900);

  const off = page.getByRole("button", { name: `Mark ${ITEM} sold out` });
  test.skip(!(await off.isVisible().catch(() => false)), "this shop does not offer 86 on the row");
  await off.click();
  await page.waitForTimeout(900);

  // An item with NO sizes has no sheet to open — the press lands straight away.
  // It used to land silently, which in a chain leaves a chef unable to tell
  // whether they closed their own kitchen or the company. The server's own
  // words carry the branch, so they are what gets shown.
  await expect(
    page.getByText(new RegExp(`${ITEM} is off the menu at .+`, "i")),
    "the press said nothing about WHICH kitchen it closed",
  ).toBeVisible();

  await removeProductsNamed(request, ITEM);
});

test("a sized item asks which size, and names the branch while it asks", async ({ page, request }) => {
  const auth = ownerAuth();

  const branches = await request.get(`${API}/branches`, { headers: auth });
  const list = ((await branches.json()) as { data: Array<{ id: string }> }).data ?? [];
  test.skip(list.length < 2, "this shop is on a single-branch plan — there is no which");

  const sized = `${ITEM} Sized`;
  await removeProductsNamed(request, sized);
  const made = await request.post(`${API}/products`, {
    headers: auth,
    data: {
      name: sized, item_type: "physical_product", price: 900, track_inventory: false,
      variants: [{ name: "Small", price: 700 }, { name: "Large", price: 1200 }],
    },
  });
  expect(made.ok(), `could not create the sized fixture: ${made.status()}`).toBeTruthy();

  await page.goto("/tenant/products");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  await page.getByPlaceholder(/search/i).first().fill(sized);
  await page.waitForTimeout(900);

  await page.getByRole("button", { name: `Mark ${sized} sold out` }).click();
  await page.waitForTimeout(700);

  const sheet = page.getByText(/Off for tonight/i);
  await expect(sheet, "the sheet did not open for a sized item").toBeVisible();
  await expect(
    sheet,
    "the sheet does not name the branch — a chain-wide press and a one-kitchen press read identically",
  ).toContainText(/at .+\./);
  await expect(
    page.getByText(/Other branches are not affected/i),
    "nothing tells the chef the rest of the chain keeps selling",
  ).toBeVisible();

  await removeProductsNamed(request, sized);
});
