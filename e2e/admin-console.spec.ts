import { test, expect, type Page } from "@playwright/test";

/**
 * THE CONSOLE THAT PRICES EVERY SHOP.
 *
 * Nothing walked it. Six trade projects and three volume projects cover the
 * shop side; the screens that decide what a shop is ALLOWED to be had no
 * browser test of any kind — which is the wrong way round, because a shop
 * screen breaking hurts one business and a plan screen breaking prices all of
 * them.
 *
 * These checks are deliberately about the things a unit test cannot see:
 *
 *   IT ARRIVES        a console page that 500s or redirects is invisible to
 *                     jsdom, which never resolves a route guard.
 *   IT SAYS THE SIX   a plan card that silently dropped branches and staff
 *                     would look fine and sell the wrong thing.
 *   A SWITCH IS A     `offline selling (0 = off, 1 = on)  0 / 0` passed every
 *   SWITCH            unit test it had. It is only wrong on screen.
 */

const SCREENS: Array<{ path: string; name: string; budget?: number }> = [
  { path: "/admin", name: "the console", budget: 8 },
  { path: "/admin/tenants", name: "businesses" },
  { path: "/admin/plans", name: "plans" },
  { path: "/admin/payments", name: "payments" },
  { path: "/admin/enquiries", name: "enquiries" },
  { path: "/admin/audit-logs", name: "audit trail" },
];

async function open(page: Page, path: string): Promise<number> {
  const started = Date.now();
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});

  return (Date.now() - started) / 1000;
}

for (const screen of SCREENS) {
  test(`${screen.name} — arrives`, async ({ page }) => {
    const seconds = await open(page, screen.path);

    // A guard redirect would make every assertion below describe the
    // dashboard instead — see four-doors.spec.ts for why this comes first.
    expect(new URL(page.url()).pathname, `${screen.name} was redirected`).toBe(screen.path);
    expect(seconds, `${screen.name} took ${seconds.toFixed(1)}s`).toBeLessThan(screen.budget ?? 6);
  });
}

/**
 * WHAT A PLAN SAYS IT GIVES.
 *
 * The three figures a buyer asks about first were on no plan at all until
 * today, and a card that quietly dropped them again would still render, still
 * pass every unit test, and sell an organisation nobody agreed to.
 */
test("a plan card states the organisation it includes", async ({ page }) => {
  await open(page, "/admin/plans");

  const card = page.locator("text=Basic").first();
  await expect(card).toBeVisible();

  // Lowercased for the same reason as below: `innerText` renders
  // `text-transform`, and a case-sensitive compare here would be testing the
  // stylesheet rather than the content.
  const body = (await page.locator("body").innerText()).toLowerCase();
  for (const word of ["branches", "staff", "tills", "bills a month", "history online", "selling offline"]) {
    expect(body, `the plan cards never mention "${word}"`).toContain(word);
  }
});

/**
 * A SWITCH IS NOT A QUOTA.
 *
 * `offline selling (0 = off, 1 = on)   0 / 0` is what this screen used to
 * print — a yes/no drawn as a progress bar of zero, with the instructions
 * stuffed into the label because the control was the wrong shape. Both halves
 * are asserted: the old label is gone, and the three sections exist.
 */
test("a tenant's limits read as capacity, usage and policy", async ({ page }) => {
  await open(page, "/admin/tenants");

  const firstShop = page.locator("table tbody tr td a").first();
  await expect(firstShop).toBeVisible();
  await firstShop.click();
  await page.waitForURL(/\/admin\/tenants\/[^/]+$/, { timeout: 20_000 });

  /**
   * WAIT FOR THE CARD, NOT FOR THE NETWORK.
   *
   * `networkidle` on this page is reached while the detail is still a row of
   * skeletons — the usage snapshot arrives in its own request behind a lazy
   * chunk. Reading the body at that moment returned the LIST's text and the
   * failure said "the usage card has no Capacity section", which was a true
   * sentence about a page that had not rendered yet.
   */
  await expect(page.getByText("Usage & limits")).toBeVisible({ timeout: 20_000 });

  /**
   * LOWERCASED, BECAUSE `innerText` APPLIES `text-transform`.
   *
   * These headings are `uppercase` in CSS, so Chrome hands back "CAPACITY".
   * The first version of this check compared against "Capacity" and PASSED —
   * not because the heading was there, but because the Bought & granted card
   * happens to contain the sentence "Capacity on top of the plan". A green
   * assertion aimed at the wrong string is worse than a missing one.
   */
  const body = (await page.locator("body").innerText()).toLowerCase();

  for (const section of ["capacity", "usage this period", "policies"]) {
    expect(body, `the usage card has no "${section}" section`).toContain(section);
  }

  expect(
    body,
    "the policy label is still carrying its own instructions, which means it is still drawn as a quota",
  ).not.toContain("(0 = off, 1 = on)");
});

/**
 * A MODULE THAT IS NOT BUILT STILL HAS TO BE ASSIGNABLE.
 *
 * Basic HR is nine screens that say "not built yet" and save nothing. It had
 * no module key, so `RequireFeature` had nothing to gate on and EVERY shop
 * carried an HR department in its sidebar — a one-person accountancy office,
 * a filling station, a tyre shop.
 *
 * The key is what makes it optional. This checks the admin can actually see
 * and reach it, which is the only reason to add a key before the feature.
 */
test("Basic HR can be handed to a shop, and is not there by default", async ({ page }) => {
  await open(page, "/admin/tenants");

  const firstShop = page.locator("table tbody tr td a").first();
  await expect(firstShop).toBeVisible();
  await firstShop.click();
  await page.waitForURL(/\/admin\/tenants\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByText("Usage & limits")).toBeVisible({ timeout: 20_000 });

  /**
   * WAIT FOR THE PICKER, NOT FOR THE CARD ABOVE IT.
   *
   * The module catalogue is its own request. Reading the page after "Usage &
   * limits" appears finds the picker still empty, and the failure says "does
   * not offer Basic HR at all" — a true sentence about a list that had not
   * arrived. A module nobody can press is the same as a module that does not
   * exist, so the switch is what this waits on.
   */
  const hr = page.getByRole("switch", { name: "Basic HR" });
  await expect(hr).toBeVisible({ timeout: 20_000 });

  // Its own group, so HR is not filed under "Trade-specific" beside a kitchen
  // docket — it belongs to no trade and to all of them.
  const body = (await page.locator("body").innerText()).toLowerCase();
  expect(body, "Basic HR has no group of its own in the picker").toContain("people");
});
