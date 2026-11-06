import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { API, ownerAuth, removeProductsNamed, roomToWork } from "./api";
import { projectOnly } from "./rules";

/**
 * "SOLD AT" — PRODUCTS AND CATEGORIES BY BRANCH (v2), THROUGH THE SCREENS.
 *
 * The server's rules are proven in AnItemIsListedAtItsBranchesTest and
 * ABranchSellsWhatItListsTest. What only a browser can prove is that the
 * screens SEND them and SHOW them: that the owner's ticks reach the server,
 * that the till at one branch offers what that branch sells and nothing
 * else, and that a branch manager is told where their item goes — and why an
 * item sold everywhere is not theirs to change — before they press Save.
 *
 * The fixture shop already has a second branch ("E2E Second Branch", from
 * staff-branch.spec); it is made here when missing.
 */
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }, info) => {
  test.skip(info.project.name !== "desktop", projectOnly("a flow test — chrome.spec walks every screen at every size"));
  await roomToWork(request, ownerAuth(), 130, "/auth/me");
});

const SECOND = "E2E Second Branch";
const PREFIX = "E2E SoldAt";
const TOWN_ITEM = `${PREFIX} Town Kulfi`;
const EVERYWHERE = `${PREFIX} Everywhere Rice`;
const MAIN_ONLY = `${PREFIX} Main Only Atta`;
const MANAGERS = `${PREFIX} Manager Lassi`;
const SHELF = `${PREFIX} Town Shelf`;
const MANAGER = { name: "E2E SoldAt Manager", email: "e2e.soldat.manager@qa.test", password: "password" };

type Row = Record<string, unknown>;
interface Places { main: { id: string; name: string }; second: { id: string; name: string } }

async function places(request: APIRequestContext): Promise<Places> {
  const listed = await request.get(`${API}/branches`, { headers: ownerAuth() });
  let rows = ((await listed.json()) as { data: Array<{ id: string; name: string; is_default: boolean; kind?: string }> }).data ?? [];
  if (!rows.some((b) => b.name === SECOND)) {
    const made = await request.post(`${API}/branches`, { headers: ownerAuth(), data: { name: SECOND, is_active: true } });
    expect(made.ok(), `the second branch could not be made (${made.status()} ${await made.text()})`).toBeTruthy();
    rows = ((await (await request.get(`${API}/branches`, { headers: ownerAuth() })).json()) as { data: typeof rows }).data;
  }
  const main = rows.find((b) => b.is_default)!;
  const second = rows.find((b) => b.name === SECOND)!;

  return { main: { id: main.id, name: main.name }, second: { id: second.id, name: second.name } };
}

async function card(request: APIRequestContext, name: string, extra: Row = {}): Promise<string> {
  const made = await request.post(`${API}/products`, {
    headers: ownerAuth(),
    data: { item_type: "physical_product", name, price: 120, is_active: true, track_inventory: false, tax_rate: 0, ...extra },
  });
  expect(made.ok(), `${name} could not be carded (${made.status()} ${await made.text()})`).toBeTruthy();

  return String(((await made.json()) as { data: Row }).data.id);
}

async function listed(request: APIRequestContext, name: string): Promise<{ all_branches: boolean; places: string[] } | null> {
  const res = await request.get(`${API}/products?search=${encodeURIComponent(name)}&per_page=20`, { headers: ownerAuth() });
  const row = ((await res.json()) as { data: Array<{ name: string; all_branches?: boolean; places?: Array<{ name: string }> }> }).data
    .find((p) => p.name === name);

  return row ? { all_branches: row.all_branches !== false, places: (row.places ?? []).map((p) => p.name).sort() } : null;
}

/** The owner's header, set the way the switcher sets it. */
async function standAt(page: Page, branchId: string | null): Promise<void> {
  await page.goto("/tenant/dashboard");
  await page.evaluate((id) => {
    localStorage.setItem("shopos-branch", JSON.stringify({ state: { activeBranchId: id }, version: 0 }));
  }, branchId);
}

async function tillOffers(page: Page, name: string): Promise<number> {
  await page.goto("/tenant/pos");
  const box = page.getByPlaceholder(/scan barcode or search/i).first();
  await expect(box).toBeVisible({ timeout: 30_000 });
  await box.fill(name);
  await page.waitForTimeout(1500);

  return page.locator("[data-pos-item]").filter({ hasText: name }).count();
}

async function manager(request: APIRequestContext, at: string, extra: string[] = []): Promise<void> {
  const permissions = ["products.manage", "sales.manage", ...extra];
  const found = await request.get(`${API}/staff?search=${encodeURIComponent(MANAGER.email)}`, { headers: ownerAuth() });
  const known = ((await found.json()) as { data: Array<{ id: string; email: string | null }> }).data?.find((u) => u.email === MANAGER.email);
  const res = known
    ? await request.put(`${API}/staff/${known.id}`, { headers: ownerAuth(), data: { name: MANAGER.name, email: MANAGER.email, branch_id: at, permissions } })
    : await request.post(`${API}/staff`, { headers: ownerAuth(), data: { ...MANAGER, branch_id: at, permissions } });
  expect(res.ok(), `the branch manager could not be set up (${res.status()} ${await res.text()})`).toBeTruthy();
}

async function signInAsManager(browser: Browser): Promise<Page> {
  const theirs = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await theirs.newPage();
  await page.goto("/signin");
  await page.getByPlaceholder("you@business.com").fill(MANAGER.email);
  await page.getByPlaceholder("Enter your password").fill(MANAGER.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/tenant/, { timeout: 30_000 });

  return page;
}

test("the owner lists a new item at one branch, and only that branch's till offers it", async ({ page, request }) => {
  test.setTimeout(150_000);
  const { main, second } = await places(request);
  await removeProductsNamed(request, TOWN_ITEM);

  await page.goto("/tenant/products/new");
  const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add item" }) });
  await expect(form).toBeVisible({ timeout: 20_000 });

  const soldAt = form.locator("[data-sold-at=choose]");
  await expect(soldAt, "the owner of a two-branch shop was not asked where it is sold").toBeVisible();
  await expect(soldAt.getByRole("radio", { name: "All branches" })).toHaveAttribute("aria-checked", "true");

  await soldAt.getByRole("radio", { name: "Only these branches" }).click();
  await soldAt.getByRole("checkbox", { name: second.name }).check();
  const mainBox = soldAt.getByRole("checkbox", { name: main.name });
  if (await mainBox.isChecked()) await mainBox.uncheck();
  await expect(soldAt.getByRole("checkbox", { name: second.name }), "the last branch ticked could be unticked").toBeDisabled();

  await form.getByLabel("Name *", { exact: true }).fill(TOWN_ITEM);
  await form.getByLabel("Price *", { exact: true }).fill("90");
  await form.getByRole("button", { name: "Create item" }).click();
  await expect(form).toBeHidden({ timeout: 20_000 });

  expect(await listed(request, TOWN_ITEM), "the ticks never reached the server").toEqual({ all_branches: false, places: [second.name] });

  // The list says where, without opening it.
  await page.goto(`/tenant/products?search=${encodeURIComponent(TOWN_ITEM)}`);
  await expect(page.locator("[data-product-branches]").first()).toHaveText(second.name, { timeout: 15_000 });

  // The owner's "All branches" view rings at Main — and its till does not
  // offer it either (sold_here); Main's does not; the second branch's does.
  await standAt(page, null);
  expect(await tillOffers(page, TOWN_ITEM), "the owner's All-branches till offered an item Main does not sell").toBe(0);
  await standAt(page, main.id);
  expect(await tillOffers(page, TOWN_ITEM), "Main's till offered an item sold only at the second branch").toBe(0);
  await standAt(page, second.id);
  expect(await tillOffers(page, TOWN_ITEM), "the second branch's till does not offer its own item").toBe(1);
});

test("a category shown at one branch says so on its row", async ({ page, request }) => {
  const { main, second } = await places(request);
  const before = ((await (await request.get(`${API}/categories`, { headers: ownerAuth() })).json()) as { data: Array<{ id: string; name: string }> }).data;
  for (const old of before.filter((c) => c.name === SHELF)) {
    await request.delete(`${API}/categories/${old.id}`, { headers: ownerAuth() });
  }

  await page.goto("/tenant/categories");
  await page.getByPlaceholder("Category name").fill(SHELF);
  const soldAt = page.locator("[data-sold-at=choose]").first();
  await soldAt.getByRole("radio", { name: "Only these branches" }).click();
  await soldAt.getByRole("checkbox", { name: second.name }).check();
  const mainBox = soldAt.getByRole("checkbox", { name: main.name });
  if (await mainBox.isChecked()) await mainBox.uncheck();
  await page.getByRole("button", { name: "Add category" }).click();

  const row = page.locator("li, [role=treeitem], div").filter({ hasText: SHELF }).locator("[data-category-branches]").first();
  await expect(row, "the row does not say which branch shows it").toHaveText(second.name, { timeout: 15_000 });

  const made = ((await (await request.get(`${API}/categories`, { headers: ownerAuth() })).json()) as { data: Array<{ id: string; name: string; all_branches?: boolean; branch_ids?: string[] }> }).data
    .find((c) => c.name === SHELF);
  expect(made?.all_branches).toBe(false);
  expect(made?.branch_ids).toEqual([second.id]);
  await request.delete(`${API}/categories/${made!.id}`, { headers: ownerAuth() });
});

test("a branch manager lists at their own branch, and is told before Save that an item sold everywhere is not theirs", async ({ request, browser }) => {
  test.setTimeout(150_000);
  const { main, second } = await places(request);
  await removeProductsNamed(request, MANAGERS);
  await removeProductsNamed(request, EVERYWHERE);
  await removeProductsNamed(request, MAIN_ONLY);
  const everywhere = await card(request, EVERYWHERE);
  await card(request, MAIN_ONLY, { all_branches: false, branch_ids: [main.id] });
  await manager(request, second.id);

  const page = await signInAsManager(browser);
  try {
    // ── a new item: where it goes, said; nothing to choose ─────────
    await page.goto("/tenant/products/new");
    const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add item" }) });
    await expect(form).toBeVisible({ timeout: 20_000 });
    await expect(form.locator("[data-sold-at=fixed]")).toContainText(`${second.name} — your branch`);
    await expect(form.locator("[data-sold-at=choose]"), "a branch manager was offered other branches").toHaveCount(0);
    await form.getByLabel("Name *", { exact: true }).fill(MANAGERS);
    await form.getByLabel("Price *", { exact: true }).fill("80");
    await form.getByRole("button", { name: "Create item" }).click();
    await expect(form).toBeHidden({ timeout: 20_000 });
    expect(await listed(request, MANAGERS), "a manager's item reached another branch").toEqual({ all_branches: false, places: [second.name] });

    // ── their list is their branch ─────────────────────────────────
    await page.goto(`/tenant/products?search=${encodeURIComponent(PREFIX)}`);
    await expect(page.getByText(EVERYWHERE).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(MAIN_ONLY), "a manager saw another branch's item").toHaveCount(0);

    // ── an item sold everywhere: said before Save, refused at Save ──
    await page.goto(`/tenant/products/${everywhere}/edit`);
    const edit = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: new RegExp(`Edit ${EVERYWHERE}`) }) });
    await expect(edit).toBeVisible({ timeout: 20_000 });
    await expect(edit.locator("[data-sold-at=fixed]")).toContainText("sold at other branches too");
    await edit.getByLabel("Price *", { exact: true }).fill("999");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit.getByText(/only the owner, or someone the owner allows, can change it/).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await page.context().close();
  }
});

test("someone the owner allows chooses branches without the owner's login", async ({ request, browser }) => {
  const { second } = await places(request);
  await manager(request, second.id, ["products.any_branch"]);

  const page = await signInAsManager(browser);
  try {
    await page.goto("/tenant/products/new");
    const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add item" }) });
    await expect(form).toBeVisible({ timeout: 20_000 });
    const soldAt = form.locator("[data-sold-at=choose]");
    await expect(soldAt, "the permission did not open the branch choice").toBeVisible();
    // They start at their own branch, and may widen it.
    await expect(soldAt.getByRole("radio", { name: "Only these branches" })).toHaveAttribute("aria-checked", "true");
    await expect(soldAt.getByRole("checkbox", { name: second.name })).toBeChecked();
    await expect(soldAt.getByRole("radio", { name: "All branches" })).toBeEnabled();
  } finally {
    await page.context().close();
    // Back to branch-level for the next run.
    await manager(request, second.id);
  }
});
