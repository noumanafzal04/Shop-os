import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, roomToWork, tradeAuth } from "./api";

/**
 * THE TENANT LIST AND A SHOP'S OWN PAGE — through the screen.
 *
 * Three things were wrong with the list a CEO would be shown first:
 *
 *   every shop that had ever been DELETED was mixed into it — the ones closed
 *     down sitting among the ones trading, and "All 71" over a platform the
 *     dashboard beside it called 44
 *   a shop on NO PLAN was labelled "paid", in green, beside the words
 *     "no plan" — the shops most waiting to be acted on, told there was
 *     nothing to do
 *   and a shop's own page was four screens long with no way to the part
 *     that was wanted, its four headline answers scattered down it
 *
 * Reads only.
 */

type Row = {
  id: string; business_name: string; deleted_at: string | null; payment_status: string | null;
  plan: { id: string; name: string } | null; city: { name: string } | null;
};
type Listing = { data: Row[]; meta: { pagination: { total: number }; payment_counts: Record<string, number> } };

const admin = () => tradeAuth("admin");

async function listing(request: APIRequestContext, query = ""): Promise<Listing> {
  const res = await request.get(`${API}/admin/tenants?per_page=100${query}`, { headers: admin() });
  expect(res.ok(), `the tenant list could not be read for ${query || "everything"} (${res.status()})`).toBeTruthy();

  return (await res.json()) as Listing;
}

const rows = (page: Page) => page.locator("tbody tr");
const shown = async (page: Page): Promise<string[]> =>
  rows(page).locator("td:first-child a").evaluateAll((links) => links.map((a) => (a.textContent ?? "").trim()));

// One signed-in admin, 240 requests a minute: wait for the minute to turn
// rather than be refused half-way through a test. See roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, tradeAuth("admin"));
});

test("the list is the shops there are — deleted ones are asked for, and a shop on no plan is not called paid", async ({ page, request }) => {
  const open = await listing(request);
  const gone = await listing(request, "&only_deleted=1");
  expect(open.data.every((r) => r.deleted_at === null), "the server put a deleted shop in the list nobody asked it for").toBeTruthy();

  await page.goto("/admin/tenants");
  await expect(page.getByRole("heading", { name: "Tenants", level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });

  // ── the list an admin opens is the shops there ARE ────────────────
  await expect(page.getByRole("group", { name: /payment/i }).getByRole("button", { name: /^All/ })).toContainText(String(open.meta.payment_counts.all));
  await expect(page.getByText(`${open.meta.pagination.total} tenants`, { exact: true })).toBeVisible();
  await expect(rows(page).getByText("deleted", { exact: true }), "a deleted shop is in the list nobody asked for").toHaveCount(0);

  // ── deleted shops are asked for ───────────────────────────────────
  // Clicked, not `.check()`ed: the box is ticked by the ADDRESS, which follows
  // the click by a render — and `.check()` reads the box in between.
  await page.getByRole("checkbox", { name: "Deleted" }).click();
  await expect(page).toHaveURL(/deleted=1/);
  await expect(page.getByRole("checkbox", { name: "Deleted" })).toBeChecked();
  await expect(page.getByRole("button", { name: /Remove filter.*Deleted shops/ })).toBeVisible();
  if (gone.meta.pagination.total === 0) {
    await expect(rows(page).locator("td:first-child a")).toHaveCount(0);
  } else {
    await expect(page.getByText(`${gone.meta.pagination.total} tenants`, { exact: true })).toBeVisible({ timeout: 15_000 });
    // Every row is one that can be put back, and says so.
    const names = await shown(page);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(gone.data.map((r) => r.business_name)).toContain(name);
    await expect(rows(page).getByText("deleted", { exact: true })).toHaveCount(names.length);
  }

  await page.getByRole("checkbox", { name: "Deleted" }).click();
  await expect(page.getByRole("checkbox", { name: "Deleted" })).not.toBeChecked();
  expect(new URL(page.url()).searchParams.has("deleted")).toBeFalsy();
  await expect(page.getByText(`${open.meta.pagination.total} tenants`, { exact: true })).toBeVisible({ timeout: 15_000 });

  // ── a shop on no plan has paid nothing, and its row says so ───────
  const unpriced = (await listing(request, "&plan_id=none")).data.find((r) => r.payment_status === "no_plan");
  if (unpriced) {
    await page.getByPlaceholder("Search name, email, phone…").fill(unpriced.business_name);
    const row = rows(page).filter({ has: page.getByRole("link", { name: unpriced.business_name, exact: true }) }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText("not priced yet", { exact: true }), "a shop on no plan is not said to be waiting for one").toBeVisible();
    await expect(row.getByText("paid", { exact: true }), "a shop on no plan is called paid").toHaveCount(0);
    await page.getByPlaceholder("Search name, email, phone…").fill("");
  }

  // ── …and the FILTER says the same as the row ──────────────────────
  // "Paid 40" used to be forty shops of which the ones on no plan had paid
  // nothing: the heading for "nothing to do" held the shops most in need of it.
  const buckets = page.getByRole("group", { name: /payment/i });
  const counts = open.meta.payment_counts;
  await expect(buckets.getByRole("button", { name: /^No plan yet/ })).toContainText(String(counts.no_plan));
  await expect(buckets.getByRole("button", { name: /^Paid/ })).toContainText(String(counts.paid));
  // Every shop is in exactly one of them.
  expect(counts.paid + counts.grace + counts.unpaid + counts.no_plan + counts.suspended, "the buckets do not add up to the shops there are").toBe(counts.all);

  if (counts.no_plan > 0) {
    await buckets.getByRole("button", { name: /^No plan yet/ }).click();
    await expect(page).toHaveURL(/payment_status=no_plan/);
    await expect(page.getByText(`${counts.no_plan} tenants`, { exact: true })).toBeVisible({ timeout: 15_000 });
    const listed = await rows(page).locator("td:first-child a").count();
    await expect(rows(page).getByText("not priced yet", { exact: true }), "a row under No plan yet does not say so").toHaveCount(listed);
  }
  if (counts.paid > 0) {
    await buckets.getByRole("button", { name: /^Paid/ }).click();
    await expect(page).toHaveURL(/payment_status=paid/);
    await expect(page.getByText(`${counts.paid} tenants`, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(rows(page).getByText("not priced yet", { exact: true }), "a shop that has paid nothing is listed under Paid").toHaveCount(0);
  }
});

test("a shop's page answers the four questions first, and has a way down it", async ({ page, request }) => {
  const shop = (await listing(request)).data.find((r) => r.plan !== null && r.city !== null);
  test.skip(shop === undefined, "no shop on a plan with a city to open");

  await page.goto(`/admin/tenants/${shop!.id}`);
  await expect(page.getByRole("heading", { name: shop!.business_name, level: 1 })).toBeVisible({ timeout: 20_000 });
  // The line somebody reads to check they opened the right one.
  await expect(page.getByTestId("shop-line")).toContainText(shop!.city!.name);

  // ── what plan, when it renews, what it pays, how big it is ────────
  const glance = page.getByTestId("shop-glance");
  await expect(glance.getByText("Plan", { exact: true })).toBeVisible();
  await expect(glance).toContainText(shop!.plan!.name);
  await expect(glance.getByText(/^(Renews|Ran out)$/)).toBeVisible();
  await expect(glance.getByText("Pays", { exact: true })).toBeVisible();
  await expect(glance).toContainText(/Rs [\d,]+/);
  await expect(glance.getByText("Size", { exact: true })).toBeVisible();
  await expect(glance).toContainText(/\d+ branch/);
  // Above the fold: nobody scrolls to learn what plan a shop is on.
  const box = (await glance.boundingBox())!;
  expect(box.y + box.height, "the four answers are below the first screen").toBeLessThan(page.viewportSize()!.height);

  // ── and a way to the part that is wanted ──────────────────────────
  const nav = page.getByRole("navigation", { name: "On this page" });
  const payments = page.locator("#payments");
  expect((await payments.boundingBox())!.y, "the payments are already in sight — this proves nothing").toBeGreaterThan(page.viewportSize()!.height);

  await nav.getByRole("button", { name: "Payments" }).click();
  await expect.poll(async () => (await payments.boundingBox())!.y, { message: "pressing Payments did not bring the payments into sight" })
    .toBeLessThan(page.viewportSize()!.height - 80);
  await expect(payments.getByRole("heading", { name: "Payment history" })).toBeInViewport();
  // The menu came with it: it is still there to go somewhere else from.
  await expect(nav).toBeInViewport();

  await nav.getByRole("button", { name: "Modules" }).click();
  await expect(page.locator("#modules").getByRole("heading", { name: "Modules" })).toBeInViewport();
  // …and, once the page has stopped moving, it is not underneath the menu
  // that brought it. Where it comes to REST is the claim — the scroll is
  // animated, and half-way there it is still on its way up.
  const top = async () => Math.round((await page.locator("#modules").boundingBox())!.y);
  await expect.poll(async () => { const a = await top(); await page.waitForTimeout(250); return a === (await top()); }, { message: "the page never came to rest" }).toBe(true);
  const bar = (await nav.boundingBox())!;
  expect(await top(), "the section jumped to rests underneath the menu").toBeGreaterThanOrEqual(Math.round(bar.y + bar.height) - 1);
});

test("renewing a plan says what the shop would be paying — offered, never typed in — and starts clean each time", async ({ page, request }) => {
  const shop = (await listing(request)).data.find((r) => r.plan !== null && r.payment_status !== "suspended");
  test.skip(shop === undefined, "no shop on a plan to renew");

  // What the server says this shop's bill comes to: its plan AND its add-ons.
  const res = await request.get(`${API}/admin/tenants/${shop!.id}`, { headers: admin() });
  const bill = ((await res.json()) as { data: { package: { bill: { total: number; addons_total: number } } } }).data.package.bill;
  test.skip(!(bill.total > 0), "this shop's plan is free — there is no figure to offer");

  await page.goto(`/admin/tenants/${shop!.id}`);
  await expect(page.getByRole("heading", { name: shop!.business_name, level: 1 })).toBeVisible({ timeout: 20_000 });

  const open = () => page.getByRole("button", { name: "Assign / renew plan" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Assign / renew plan" });
  const amount = dialog.getByLabel("Amount", { exact: true });
  const figure = `Rs ${Math.round(bill.total).toLocaleString("en-US")}`;

  await open();
  await expect(dialog).toBeVisible();
  // Its own plan is already chosen, and the figure is said under the box…
  await expect(dialog.getByTestId("renew-due")).toContainText(figure, { timeout: 15_000 });
  if (bill.addons_total > 0) await expect(dialog.getByTestId("renew-due")).toContainText("add-on");
  // …but the box is EMPTY: blank is how a free assignment is recorded, and a
  // figure that arrived already typed would be a payment nobody took.
  await expect(amount).toHaveValue("");

  // One press uses it.
  await dialog.getByRole("button", { name: `Use ${figure}` }).click();
  await expect(amount).toHaveValue(String(Math.round(bill.total)));
  await dialog.getByLabel("Reference (optional)", { exact: true }).fill("E2E-NOT-SAVED");

  // Closed without saving, and opened again: a fresh sheet. The last amount
  // and receipt number used to still be in their boxes.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await open();
  await expect(amount).toHaveValue("");
  await expect(dialog.getByLabel("Reference (optional)", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});
