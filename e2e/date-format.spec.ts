import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, ownerAuth, roomToWork } from "./api";
import { nothingIsWrittenUnderAButton, report } from "./rules";

/**
 * A SHOP WRITES ITS DATES ITS OWN WAY — and types them.
 *
 * ── The asks ─────────────────────────────────────────────────────────
 *
 *     "date picker humne use ni kia kahin — date picker b to hona chaye? or
 *      sth khud b type kr sky."
 *     "date ka format setting main hona chahye — for international?"
 *     "currency and date format business tab man any chahye."
 *
 * Every date in the panel was the browser's: `10/12/2026` for the twelfth of
 * October on the laptop this was found on, in a box that was the browser's
 * too. A shop chooses how a date is written on the first page of its settings,
 * every screen follows, and every date box is one field that shows the day
 * that way, takes what is typed, and opens a calendar.
 */

const settings = async (request: APIRequestContext, patch?: Record<string, unknown>) => {
  const res = patch
    ? await request.put(`${API}/shop/settings`, { headers: ownerAuth(), data: patch })
    : await request.get(`${API}/shop/settings`, { headers: ownerAuth() });
  expect(res.ok(), `the shop's settings ${patch ? "did not save" : "could not be read"} (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Record<string, unknown> }).data;
};

let before: Record<string, unknown> = {};

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  before = await settings(request);
  await settings(request, { date_format: "dmy_text" });
});

test.afterAll(async ({ request }) => {
  await settings(request, { date_format: before.date_format ?? "dmy_text" });
});

test.beforeEach(async ({ request }) => {
  await roomToWork(request, ownerAuth(), 130, "/auth/me");
});

const TEXT = /\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/;
const DAY_FIRST = /\b\d{2}\/\d{2}\/\d{4}\b/;

/** The Add-expense sheet, with its date box. */
async function anExpenseSheet(page: Page) {
  await page.goto("/tenant/expenses");
  await page.getByRole("button", { name: /Add expense|New expense|Record expense/ }).first().click({ timeout: 20_000 });
  const sheet = page.locator('.modal [role="dialog"]').last();
  await expect(sheet).toBeVisible({ timeout: 15_000 });

  return { sheet, date: sheet.getByLabel(/^Date/).first() };
}

test("the format is chosen on the first page of Settings, beside the currency — and the sales list follows it", async ({ page, request }) => {
  await page.goto("/tenant/settings");
  // No tab to open: the Business page is where Settings starts.
  await expect(page.getByRole("heading", { name: "Currency", exact: true }), "the currency is not on the first page of Settings").toBeVisible({ timeout: 20_000 });
  const choice = page.getByRole("combobox", { name: "Date format", exact: true });
  await expect(choice, "a new shop does not start on the date nobody can misread").toHaveValue("dmy_text");
  await expect(page.getByTestId("date-format-example")).toHaveText(TEXT);

  // Shown before anything is saved.
  await choice.selectOption("dmy");
  await expect(page.getByTestId("date-format-example")).toHaveText(DAY_FIRST);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Settings saved.").first()).toBeVisible({ timeout: 15_000 });
  expect((await settings(request)).date_format).toBe("dmy");

  // Still chosen after a reload.
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Date format", exact: true })).toHaveValue("dmy", { timeout: 20_000 });

  // …and the Tax tab no longer carries either card.
  await page.getByRole("button", { name: "Tax & Delivery", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tax", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Date format", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Currency", exact: true })).toHaveCount(0);

  // Every sale on the list is dated the shop's way, and none the old way.
  await page.goto("/tenant/sales");
  const first = page.getByRole("row").filter({ hasText: /INV-\d+/ }).first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  await expect(first, "a sale is not dated day/month/year").toContainText(/\d{2}\/\d{2}\/\d{4}, \d{1,2}:\d{2} (AM|PM)/);
  const rows = await page.getByRole("row").filter({ hasText: /INV-\d+/ }).allInnerTexts();
  expect(rows.filter((r) => TEXT.test(r)), "some sales are still dated the old way").toEqual([]);
});

test("a date box shows the day the shop's way, takes what is typed, and refuses what is not a date", async ({ page }) => {
  const { sheet, date } = await anExpenseSheet(page);

  // Today, in the shop's format — not the browser's.
  await expect(date).toHaveValue(DAY_FIRST);
  const today = await date.inputValue();

  // Typed the way a hand types it, read day-first because this shop writes day-first.
  await date.fill("5/3/2026");
  await date.blur();
  await expect(date).toHaveValue("05/03/2026");
  await expect(date).toHaveAttribute("data-day", "2026-03-05");

  // A month by name is the same day in any shop.
  await date.fill("12 aug 2026");
  await date.blur();
  await expect(date).toHaveValue("12/08/2026");

  // Not a date: said where it was typed, and the last real day is kept.
  await date.fill("31/02/2026");
  await date.blur();
  await expect(sheet.getByRole("alert").filter({ hasText: "is not a date" })).toBeVisible();
  await expect(date).toHaveValue("12/08/2026");
  await expect(date).toHaveAttribute("data-day", "2026-08-12");

  // An expense is not dated in the future, and the box says so rather than taking it.
  await date.fill("01/01/2099");
  await date.blur();
  await expect(sheet.getByRole("alert").filter({ hasText: "the latest day this takes" })).toBeVisible();
  await expect(date).toHaveAttribute("data-day", "2026-08-12");

  // "today" is a date.
  await date.fill("today");
  await date.blur();
  await expect(date).toHaveValue(today);
});

test("the calendar opens under the box, fits the screen, and a pressed day is the day", async ({ page }) => {
  const { sheet, date } = await anExpenseSheet(page);
  await date.fill("12/08/2026");
  await date.blur();

  await sheet.getByRole("button", { name: /^Choose a date/ }).first().click();
  const calendar = page.getByRole("dialog", { name: "Choose a date" });
  await expect(calendar).toBeVisible();
  await expect(calendar).toContainText("August 2026");

  // All of it on the glass — a sheet that scrolls its own middle must not cut it.
  const box = (await calendar.boundingBox())!;
  const glass = page.viewportSize()!;
  expect(box.x, "the calendar hangs off the left").toBeGreaterThanOrEqual(0);
  expect(box.y, "the calendar hangs off the top").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "the calendar hangs off the right").toBeLessThanOrEqual(glass.width + 0.5);
  expect(box.y + box.height, "the calendar hangs off the bottom").toBeLessThanOrEqual(glass.height + 0.5);
  // …and it is the thing on top where it is drawn.
  const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[role="dialog"]')?.getAttribute("aria-label") ?? null, [box.x + box.width / 2, box.y + 20]);
  expect(top, "something is drawn over the calendar").toBe("Choose a date");

  await calendar.getByRole("button", { name: "The month before" }).click();
  await expect(calendar).toContainText("July 2026");
  await calendar.getByRole("button", { name: "20 Jul 2026", exact: true }).click();
  await expect(calendar).toBeHidden();
  await expect(date).toHaveValue("20/07/2026");

  // Escape closes the calendar and NOT the sheet it is in.
  await sheet.getByRole("button", { name: /^Choose a date/ }).first().click();
  await expect(calendar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(calendar).toBeHidden();
  await expect(sheet, "Escape in the calendar closed the whole sheet").toBeVisible();
  await expect(date).toHaveValue("20/07/2026");

  report(await nothingIsWrittenUnderAButton(page), "the expense sheet, with a date box in it");
});

test("month-first is written month-first and READ month-first — the one place the format changes what is meant", async ({ page, request }) => {
  await settings(request, { date_format: "mdy" });
  const { date } = await anExpenseSheet(page);

  await date.fill("03/05/2026");
  await date.blur();
  // The fifth of March, to a shop that writes the month first — and the third of May to one that does not.
  await expect(date).toHaveAttribute("data-day", "2026-03-05");
  await expect(date).toHaveValue("03/05/2026");

  await settings(request, { date_format: "dmy_text" });
});
