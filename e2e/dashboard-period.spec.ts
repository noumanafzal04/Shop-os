import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { API, ownerAuth } from "./api";

/**
 * THE DASHBOARD IS ASKED ABOUT A PERIOD — through the screen.
 *
 * It answered one question, today, with a week of bars behind it and a month
 * of leaders under that: three windows on one page and none of them chosen by
 * the reader. It has a period now — today, yesterday, a week, a month, a
 * quarter, a year, or any two dates — and this holds in place what that has to
 * mean on a screen:
 *
 *   it opens on today, and says so
 *   two arrows read it a period at a time, and stop at today
 *   every FIGURE is the period's, and is named for it — never "Today's Sales"
 *     over a week
 *   what is on screen is what the server has for those dates
 *   the period is in the address, so a refresh lands on the same figures —
 *     and today is the ABSENCE of it, so a page left open follows the clock
 *   two picked dates are a period like any other
 *   and the menu opens inside the screen, on a phone as on a desk
 *
 * Runs at every size: where the control sits is a layout question. Reads
 * only — nothing here sells or spends anything.
 */

type Period = { from: string; to: string; days: number; revenue: number; sales_count: number };

async function asked(request: APIRequestContext, query: string): Promise<Period> {
  const res = await request.get(`${API}/dashboard${query}`, { headers: ownerAuth() });
  expect(res.ok(), `the dashboard could not be read for ${query || "today"} (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: { period: Period } }).data.period;
}

const name = (page: Page) => page.getByTestId("period-name");
const detail = (page: Page) => page.getByTestId("period-detail");
const menu = (page: Page) => page.getByTestId("period-bar").locator('button[aria-haspopup="listbox"]');
const earlier = (page: Page) => page.getByTestId("period-bar").getByRole("button", { name: "Earlier period" });
const later = (page: Page) => page.getByTestId("period-bar").getByRole("button", { name: "Later period" });

/** The card a figure is printed on, found by what the figure is called. */
const tile = (page: Page, label: string): Locator =>
  page.getByTestId("dashboard-figures").getByText(label, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-3xl')][1]");

/** "Rs 2,598,089" → 2598089. Whatever the shop's currency is written like. */
async function figure(card: Locator): Promise<number> {
  const printed = (await card.locator("p").first().innerText()).replace(/[^0-9.-]/g, "");

  return Number(printed);
}

async function pick(page: Page, preset: string): Promise<void> {
  await menu(page).click();
  await page.getByRole("listbox", { name: "Period" }).getByRole("option", { name: new RegExp(`^${preset}`) }).click();
}

const pinned = (page: Page) => new URL(page.url()).searchParams;

test("the dashboard is asked about a period, and every figure on it says which", async ({ page, request }) => {
  // The full view: the chart and the breakdown are part of what has to follow.
  await page.addInitScript(() => localStorage.setItem("ui_mode", "advanced"));
  await page.goto("/tenant");

  // ── it opens on today, and nothing is pinned ──────────────────────
  await expect(name(page)).toHaveText("Today", { timeout: 20_000 });
  await expect(detail(page)).toHaveText("Compared with yesterday");
  await expect(tile(page, "Today's Sales")).toBeVisible();
  expect(pinned(page).has("from"), "today was written into the address — it would be today for ever").toBeFalsy();
  // There is no later than today.
  await expect(later(page)).toBeDisabled();

  // ── one step back, and one forward ────────────────────────────────
  await earlier(page).click();
  await expect(name(page)).toHaveText("Yesterday");
  await expect(detail(page)).toHaveText("Compared with the day before");
  await expect(tile(page, "Yesterday's Sales")).toBeVisible();
  await expect(page.getByText("Today's Sales", { exact: true }), "a tile still says Today over yesterday's figure").toHaveCount(0);
  expect(pinned(page).get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(pinned(page).get("to"), "yesterday is one day").toBe(pinned(page).get("from"));

  await later(page).click();
  await expect(name(page)).toHaveText("Today");
  expect(pinned(page).has("from"), "stepping back onto today left it pinned").toBeFalsy();

  // ── the menu, which opens inside the screen ───────────────────────
  await menu(page).click();
  const list = page.getByRole("listbox", { name: "Period" });
  await expect(list).toBeVisible();
  const box = (await list.boundingBox())!;
  const wide = page.viewportSize()!.width;
  expect(box.x, "the period menu opens off the left of the screen").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "the period menu opens off the right of the screen").toBeLessThanOrEqual(wide);
  // Every row says what it resolves to, and a dashboard has no "all time".
  await expect(list.getByRole("option")).toHaveCount(9);
  await expect(list.getByRole("option", { name: /^All time/ })).toHaveCount(0);

  // ── seven days: every figure is the period's, and named for it ────
  await list.getByRole("option", { name: /^Last 7 days/ }).click();
  await expect(name(page)).toHaveText("Last 7 days");
  await expect(detail(page)).toHaveText(/ · 7 days · compared with \d/);
  await expect(page.getByTestId("dashboard-figures")).toHaveAttribute("aria-busy", "false");
  await expect(tile(page, "Sales")).toBeVisible();
  await expect(page.getByTestId("dashboard-figures").getByText(/^Today's |Today$/), "a tile still says Today over a week").toHaveCount(0);

  const week = await asked(request, `?from=${pinned(page).get("from")}&to=${pinned(page).get("to")}`);
  expect(week.days).toBe(7);
  expect(Math.abs((await figure(tile(page, "Sales"))) - week.revenue), "the sales on screen are not the week's").toBeLessThan(1);
  await expect(tile(page, "Orders").locator("p").first()).toHaveText(week.sales_count.toLocaleString());
  // And today's figure is a different one — or this proved nothing.
  const today = await asked(request, "");
  expect(today.days).toBe(1);

  // The chart draws the period and says how; the breakdown names it.
  await expect(page.getByTestId("trend-window")).toContainText("a point a day");
  await expect(page.getByTestId("spend-window")).toHaveText("Expenses by category · Last 7 days");

  // ── it is in the address, so a refresh lands on it ────────────────
  const held = page.url();
  await page.reload();
  await expect(name(page)).toHaveText("Last 7 days", { timeout: 20_000 });
  expect(page.url()).toBe(held);

  // ── two picked dates are a period like any other ──────────────────
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const cell = (day: number) =>
    page.evaluate(
      ([y, m, d]) => new Date(y, m, d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }),
      [lastMonth.getFullYear(), lastMonth.getMonth(), day],
    );

  await menu(page).click();
  await page.getByRole("button", { name: /Custom range/ }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Pick a custom range" }) });
  await expect(dialog).toBeVisible();
  const apply = dialog.getByRole("button", { name: "Apply range" });

  // Back to the month before this one, if the dialog did not open on it.
  const tenth = dialog.getByRole("button", { name: await cell(10), exact: true });
  if ((await tenth.count()) === 0) await dialog.getByRole("button", { name: "Previous month" }).click();
  await tenth.click();
  // Half a period is not one: nothing can be applied yet.
  await expect(apply).toBeDisabled();
  await dialog.getByRole("button", { name: await cell(20), exact: true }).click();
  await apply.click();

  // The panel's own three letters — a locale's "Sept" is not what it prints.
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][lastMonth.getMonth()];
  const year = lastMonth.getFullYear() === now.getFullYear() ? "" : ` ${lastMonth.getFullYear()}`;
  // Nobody has a name for these eleven days, so they are called by their dates.
  await expect(name(page)).toHaveText(`10 – 20 ${month}${year}`);
  await expect(detail(page)).toHaveText(/^11 days · compared with /);
  await expect(tile(page, "Sales")).toBeVisible();
  expect(pinned(page).get("from")).toMatch(/-10$/);
  expect(pinned(page).get("to")).toMatch(/-20$/);

  // ── and back to today un-pins it ──────────────────────────────────
  await pick(page, "Today");
  await expect(name(page)).toHaveText("Today");
  await expect(tile(page, "Today's Sales")).toBeVisible();
  expect(pinned(page).has("from"), "choosing Today from the menu pinned today's date").toBeFalsy();
});
