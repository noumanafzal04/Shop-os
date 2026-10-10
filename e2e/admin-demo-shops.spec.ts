import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, roomToWork, tradeAuth } from "./api";

/**
 * THE ADMIN KEEPS A DEMO SHOP FOR ITS OWNER — through the screen.
 *
 * Asked for in these words: "the demo shop made from the landing page — how
 * is it approved until the tenant fills their details into Keep this shop?
 * The admin can do it directly too; I did not see that anywhere on the admin
 * side."
 *
 * It was not anywhere. A demo reached an admin only if its visitor pressed
 * "Keep this shop"; every other demo was a number on the dashboard. This
 * walks what is there now, with a demo opened the way a visitor opens one:
 *
 *   it is on a list — "Trying it now" — with what has been done in it
 *   the row offers to make it a real shop, and asks for the owner's sign-in
 *   an email somebody already uses is refused in words, and nothing happens
 *   the demo's own page says it is a demo, and offers the same thing
 *   kept, it is THE SAME SHOP: real, found under "kept their shop", its
 *     shelf still on it — and its owner can sign in with what was typed
 *
 * The shop it makes is taken away again at the end.
 */

const admin = () => tradeAuth("admin");

type Row = Record<string, unknown>;

async function adminGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${API}${path}`, { headers: admin() });
  expect(res.ok(), `GET ${path} → ${res.status()}`).toBeTruthy();

  return ((await res.json()) as { data: T }).data;
}

/** A demo, opened through the front page's own door, with one sale rung in it. */
async function openADemo(request: APIRequestContext): Promise<{ id: string; name: string; shelf: number }> {
  const made = await request.post(`${API}/demo`, { data: { business_type: "mart" } });
  expect(made.ok(), `a demo could not be opened (${made.status()} ${await made.text()})`).toBeTruthy();
  const body = ((await made.json()) as { data: { access_token: string; user: { tenant: { id: string } }; demo: { shop: string } } }).data;
  const visitor = { Authorization: `Bearer ${body.access_token}`, Accept: "application/json" };

  const shelf = await request.get(`${API}/products?per_page=50`, { headers: visitor });
  expect(shelf.ok(), `the demo's shelf could not be read (${shelf.status()})`).toBeTruthy();
  const items = ((await shelf.json()) as { data: Array<{ id: string }> }).data;
  expect(items.length, "a demo was opened with nothing on its shelf").toBeGreaterThan(0);

  const sale = await request.post(`${API}/sales`, {
    headers: visitor,
    data: { channel: "walk_in", items: [{ product_id: items[0].id, quantity: 1 }], payment_method: "cash", amount_paid: 100000 },
  });
  expect(sale.ok(), `the visitor could not ring a sale in their demo (${sale.status()} ${await sale.text()})`).toBeTruthy();

  return { id: body.user.tenant.id, name: body.demo.shop, shelf: items.length };
}

const KEPT = "E2E Kept Corner Store";

/** A shop an earlier run kept and did not get to take away. */
async function clearTheGround(request: APIRequestContext): Promise<void> {
  const left = await adminGet<Array<{ id: string; business_name: string }>>(request, `/admin/tenants?search=${encodeURIComponent(KEPT)}`);
  for (const shop of left.filter((t) => t.business_name === KEPT)) {
    const gone = await request.delete(`${API}/admin/tenants/${shop.id}`, { headers: admin() });
    expect(gone.ok(), `an earlier run's shop could not be removed (${gone.status()})`).toBeTruthy();
  }
}

const row = (page: Page, name: string) => page.locator(`[data-demo="${name}"]`);

// One signed-in admin, 240 requests a minute: wait for the minute to turn
// rather than be refused half-way through a test. See roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, tradeAuth("admin"));
});

test("a demo somebody is trying can be kept as a real shop from the admin side, with the sign-in its owner will use", async ({ page, request }) => {
  await clearTheGround(request);
  const demo = await openADemo(request);
  // Its own four letters, so no two runs ever ask for the same sign-in.
  const email = `e2e-kept-${demo.name.split(" ").pop()!.toLowerCase()}@qa.test`;
  const password = "counter-side-8";

  // ── it is on a list ───────────────────────────────────────────────
  await page.goto("/admin/shop-requests");
  await expect(page.getByRole("heading", { name: "Demo shops", level: 1 })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("group", { name: "Which demo shops to show" }).getByRole("button", { name: /^Trying it now/ }).click();
  await expect(page).toHaveURL(/show=trying/);

  const mine = row(page, demo.name);
  await expect(mine, "the demo just opened is not on the list of demos being tried").toBeVisible({ timeout: 20_000 });
  // What has been done in it — the reason to look at this one and not the others.
  await expect(mine).toContainText(/^.*1 sale · Rs /s);
  await expect(mine).toContainText(`${demo.shelf} items on the shelf`);
  await expect(mine).toContainText(/opened (just now|\dm ago)/);
  await expect(mine).toContainText("Ends in 23 h");

  // ── the row offers it, and asks for a sign-in ─────────────────────
  await mine.getByRole("button", { name: "Make it a real shop" }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Make it a real shop" }) });
  await expect(dialog).toBeVisible();
  const submit = dialog.getByRole("button", { name: "Make it a real shop" });
  await expect(submit, "a demo could be kept with no sign-in for its owner").toBeDisabled();

  await dialog.getByLabel("Owner's name").fill("Hamza Tariq");
  // The admin's own address: somebody already signs in with it.
  await dialog.getByLabel("Email").fill("admin@shopos.test");
  await expect(submit, "a sign-in with no password could be saved").toBeDisabled();
  await dialog.getByRole("button", { name: "Suggest one" }).click();
  // Built to be said across a counter, and shown — not dotted — so it can be.
  await expect(dialog.getByLabel("Password")).toHaveValue(/^[a-z]{4}-[2-9]{4}-[a-z]{4}$/);
  await expect(dialog.getByLabel("Password")).toHaveAttribute("type", "text");
  await submit.click();
  await expect(dialog).toContainText("Somebody already signs in with that email");
  // Refused whole: it is still a demo.
  expect((await adminGet<Row>(request, `/admin/tenants/${demo.id}`)).is_demo, "a refused keep still made the shop real").toBe(true);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // ── the demo's own page says what it is, and offers the same ──────
  await mine.getByRole("link", { name: "Open" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/tenants/${demo.id}`));
  const banner = page.getByTestId("demo-banner");
  await expect(banner).toContainText("This is a demo shop");
  await expect(banner).toContainText("Nobody can sign in to it");

  await banner.getByRole("button", { name: "Make it a real shop" }).click();
  await expect(dialog).toBeVisible();
  // Nothing typed into the other dialog came along.
  await expect(dialog.getByLabel("Owner's name")).toHaveValue("");
  await dialog.getByLabel("What the business is called").fill(KEPT);
  await dialog.getByLabel("Owner's name").fill("Hamza Tariq");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Phone (optional)").fill("03214567890");
  await dialog.getByLabel("Password").fill(password);
  await submit.click();

  // ── it is the same shop, and it is real ───────────────────────────
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: KEPT, level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(banner, "a shop that was kept still says it is a demo").toHaveCount(0);

  const kept = await adminGet<Row & { users?: Array<{ email: string; name: string }> }>(request, `/admin/tenants/${demo.id}`);
  expect(kept.is_demo).toBe(false);
  expect(kept.origin).toBe("converted");
  expect(kept.business_name).toBe(KEPT);
  // Back through setup: the owner picks their own city and drops their own pin.
  expect(kept.setup_completed).toBe(false);
  // Nothing was paid, so nothing is on its ledger and it is on no plan.
  expect(kept.plan ?? null).toBeNull();

  // The owner signs in with what the admin typed — and lands in THEIR shop,
  // with the shelf they were trying it on.
  const signIn = await request.post(`${API}/auth/login`, { data: { identifier: email, password } });
  expect(signIn.ok(), `the owner could not sign in with what the admin typed (${signIn.status()} ${await signIn.text()})`).toBeTruthy();
  const session = ((await signIn.json()) as { data: { access_token: string; user: { name: string; tenant: { id: string } } } }).data;
  expect(session.user.tenant.id).toBe(demo.id);
  expect(session.user.name).toBe("Hamza Tariq");
  const theirs = await request.get(`${API}/products?per_page=50`, { headers: { Authorization: `Bearer ${session.access_token}`, Accept: "application/json" } });
  expect(((await theirs.json()) as { data: unknown[] }).data.length, "the shelf they built did not come with the shop").toBe(demo.shelf);

  // ── and it has left the list of demos ─────────────────────────────
  await page.goto("/admin/shop-requests?show=trying");
  await expect(page.getByRole("heading", { name: "Demo shops", level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("demo-shops").or(page.getByText("Nobody is trying a demo right now"))).toBeVisible();
  await expect(row(page, demo.name)).toHaveCount(0);
  await expect(row(page, KEPT), "a real shop is still listed as a demo").toHaveCount(0);

  await clearTheGround(request);
});
