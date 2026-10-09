import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { API, tradeAuth } from "./api";

/**
 * THE PLATFORM'S DASHBOARD IS ASKED ABOUT A PERIOD — through the screen.
 *
 * Its six tiles read "revenue this month", "orders today" and "riders a month
 * ago" on one row — three windows nobody chose. It has a period now, and two
 * rows that say which kind of figure each is:
 *
 *   IN THE PERIOD  — money collected, shops that joined, orders, new buyers
 *   RIGHT NOW      — shops, subscriptions, riders: what the platform IS
 *
 * This holds in place: it opens on the last seven days and says so; the first
 * row is what the server has for the dates on screen; the second row does not
 * move when the period does; the arrows step a period at a time; and the
 * opening period is the absence of dates in the address, so the page follows
 * the clock.
 *
 * Reads only.
 */

type Kpi = { value: number };
type Answer = {
  period: { from: string; to: string; days: number; asked: boolean };
  in_period: { revenue?: Kpi; payments?: number; new_tenants: Kpi; online_orders: Kpi; new_customers: Kpi };
  kpis: { total_tenants: Kpi };
};

const admin = () => tradeAuth("admin");

async function asked(request: APIRequestContext, query: string): Promise<Answer> {
  const res = await request.get(`${API}/admin/dashboard${query}`, { headers: admin() });
  expect(res.ok(), `the platform dashboard could not be read for ${query || "its opening period"} (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Answer }).data;
}

const name = (page: Page) => page.getByTestId("period-name");
const menu = (page: Page) => page.getByTestId("period-bar").locator('button[aria-haspopup="listbox"]');
const pinned = (page: Page) => new URL(page.url()).searchParams;

const tile = (within: Locator, label: string): Locator =>
  within.getByText(label, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-3xl')][1]");

const printed = async (card: Locator): Promise<number> =>
  Number((await card.locator("p").first().innerText()).replace(/[^0-9.-]/g, ""));

test("the platform dashboard is asked about a period — and what the platform is does not move with it", async ({ page, request }) => {
  await page.goto("/admin");
  const inPeriod = page.getByTestId("in-period");
  const rightNow = page.getByTestId("right-now");

  // ── it opens on the last seven days, with nothing pinned ──────────
  await expect(name(page)).toHaveText("Last 7 days", { timeout: 20_000 });
  await expect(page.getByTestId("period-detail")).toHaveText(/ · 7 days · compared with \d/);
  expect(pinned(page).has("from"), "the opening period was written into the address").toBeFalsy();

  const opening = await asked(request, "");
  expect(opening.period.asked).toBe(false);
  expect(opening.period.days).toBe(7);

  // What happened in it — each tile is the server's count for those dates.
  await expect(tile(inPeriod, "New tenants").locator("p").first()).toHaveText(opening.in_period.new_tenants.value.toLocaleString());
  await expect(tile(inPeriod, "Online orders").locator("p").first()).toHaveText(opening.in_period.online_orders.value.toLocaleString());
  await expect(tile(inPeriod, "New customers").locator("p").first()).toHaveText(opening.in_period.new_customers.value.toLocaleString());
  expect(opening.in_period.revenue, "the super admin was not sent the money").toBeDefined();
  expect(Math.abs((await printed(tile(inPeriod, "Revenue collected"))) - opening.in_period.revenue!.value)).toBeLessThan(1);

  // What the platform is.
  const tenants = await tile(rightNow, "Total tenants").locator("p").first().innerText();
  expect(tenants).toBe(opening.kpis.total_tenants.value.toLocaleString());
  await expect(tile(rightNow, "Active subscriptions")).toBeVisible();
  await expect(tile(rightNow, "Active riders")).toBeVisible();

  // ── thirty days ───────────────────────────────────────────────────
  await menu(page).click();
  const list = page.getByRole("listbox", { name: "Period" });
  await expect(list.getByRole("option", { name: /^All time/ }), "a dashboard was offered all time").toHaveCount(0);
  await list.getByRole("option", { name: /^Last 30 days/ }).click();
  await expect(name(page)).toHaveText("Last 30 days");
  await expect(inPeriod).toHaveAttribute("aria-busy", "false");

  const from = pinned(page).get("from");
  const to = pinned(page).get("to");
  expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const month = await asked(request, `?from=${from}&to=${to}`);
  expect(month.period.days).toBe(30);
  await expect(tile(inPeriod, "New tenants").locator("p").first()).toHaveText(month.in_period.new_tenants.value.toLocaleString());
  expect(Math.abs((await printed(tile(inPeriod, "Revenue collected"))) - month.in_period.revenue!.value)).toBeLessThan(1);
  // Thirty days hold at least what seven of them did.
  expect(month.in_period.revenue!.value).toBeGreaterThanOrEqual(opening.in_period.revenue!.value);

  // The platform is the same size whichever month is being read.
  await expect(tile(rightNow, "Total tenants").locator("p").first()).toHaveText(tenants);

  // ── a step back is the thirty days before, called by their dates ──
  await page.getByTestId("period-bar").getByRole("button", { name: "Earlier period" }).click();
  await expect(name(page)).not.toHaveText("Last 30 days");
  await expect(page.getByTestId("period-detail")).toHaveText(/^30 days · compared with /);
  expect(pinned(page).get("to"), "the step back did not end the day before the period it left").not.toBe(to);
  await page.getByTestId("period-bar").getByRole("button", { name: "Later period" }).click();
  await expect(name(page)).toHaveText("Last 30 days");
  await expect(page.getByTestId("period-bar").getByRole("button", { name: "Later period" })).toBeDisabled();

  // ── a refresh lands on it ─────────────────────────────────────────
  await page.reload();
  await expect(name(page)).toHaveText("Last 30 days", { timeout: 20_000 });

  // ── the year so far: the longest period on the menu ───────────────
  // Seven days and thirty can hold the same shops on a young platform, and a
  // tile wired to the wrong figure would agree with both. The year cannot be
  // fewer than either — so if the three counts differ at all, it shows here.
  await menu(page).click();
  await page.getByRole("listbox", { name: "Period" }).getByRole("option", { name: /^This year/ }).click();
  await expect.poll(() => pinned(page).get("from"), { message: "the year did not reach the address" }).toMatch(/-01-01$/);
  await expect(inPeriod).toHaveAttribute("aria-busy", "false");
  const year = await asked(request, `?from=${pinned(page).get("from")}&to=${pinned(page).get("to")}`);
  await expect(tile(inPeriod, "New tenants").locator("p").first()).toHaveText(year.in_period.new_tenants.value.toLocaleString());
  await expect(tile(inPeriod, "Online orders").locator("p").first()).toHaveText(year.in_period.online_orders.value.toLocaleString());
  await expect(tile(inPeriod, "New customers").locator("p").first()).toHaveText(year.in_period.new_customers.value.toLocaleString());
  expect(year.in_period.new_tenants.value).toBeGreaterThanOrEqual(month.in_period.new_tenants.value);
  await expect(tile(rightNow, "Total tenants").locator("p").first()).toHaveText(tenants);

  // ── and the opening period un-pins ────────────────────────────────

  await menu(page).click();
  await page.getByRole("listbox", { name: "Period" }).getByRole("option", { name: /^Last 7 days/ }).click();
  await expect(name(page)).toHaveText("Last 7 days");
  expect(pinned(page).has("from"), "choosing the opening period from the menu pinned its dates").toBeFalsy();
});
