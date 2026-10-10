import fs from "node:fs";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { API, roomToWork, tradeAuth } from "./api";

/**
 * THE BILLING SCREEN IS ASKED ABOUT A PERIOD — through the screen.
 *
 * Its owner, looking at it: "should Billing and Payments not have a date
 * picker?" It had one — at the bottom, on the ledger, called "Any date" — and
 * everything above it was fixed at this month, this year and all time. It has
 * a period at its head now. This holds in place:
 *
 *   it opens on this month so far, with no dates in the address
 *   Collected, Payments and Shops that paid are the server's figures for the
 *     dates on screen — and Collected is the ledger's own total under it
 *   what is late does not move when the period does
 *   the ledger follows the period, says so, and can be given every date —
 *     which does not move the period
 *   a search that finds nothing under a period says the payment may be on
 *     another date, and offers them all
 *
 * Reads only.
 */

type Kpi = { value: number };
type Summary = { period: { from: string; to: string; days: number; asked: boolean; today: string }; in_period: { collected: Kpi; payments: Kpi; shops: Kpi } };
type Ledger = { data: Array<{ tenant: { business_name: string | null } }>; meta: { totals: { payments: number; amount: number } } };

const admin = () => tradeAuth("admin");

async function summary(request: APIRequestContext, query = ""): Promise<Summary> {
  const res = await request.get(`${API}/admin/billing/summary${query}`, { headers: admin() });
  expect(res.ok(), `the billing summary could not be read for ${query || "its opening period"} (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Summary }).data;
}

async function ledger(request: APIRequestContext, query: string): Promise<Ledger> {
  const res = await request.get(`${API}/admin/billing/payments${query}`, { headers: admin() });
  expect(res.ok(), `the ledger could not be read for ${query} (${res.status()})`).toBeTruthy();

  return (await res.json()) as Ledger;
}

const name = (page: Page) => page.getByTestId("period-name");
const menu = (page: Page) => page.getByTestId("period-bar").locator('button[aria-haspopup="listbox"]');
const pinned = (page: Page) => new URL(page.url()).searchParams;
const strip = (page: Page) => page.getByTestId("billing-in-period");
const note = (page: Page) => page.getByTestId("ledger-note");
const total = (page: Page) => page.getByTestId("ledger-total");

const tile = (within: Locator, label: string): Locator =>
  within.getByText(label, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-3xl')][1]");
const figure = (card: Locator): Locator => card.locator("p").first();
const rupees = async (from: Locator): Promise<number> => Number((await from.innerText()).replace(/[^0-9.-]/g, ""));
/** "Rs 255,984 This month" → 255984: the figure only, not a date beside it. */
const firstRupees = async (from: Locator): Promise<number> => Number((await from.innerText()).match(/Rs\s*([\d,]+(?:\.\d+)?)/)?.[1].replace(/,/g, "") ?? NaN);

async function shows(page: Page, said: Summary): Promise<void> {
  await expect(strip(page)).toHaveAttribute("aria-busy", "false");
  await expect(figure(tile(strip(page), "Payments"))).toHaveText(said.in_period.payments.value.toLocaleString("en-US"));
  await expect(figure(tile(strip(page), "Shops that paid"))).toHaveText(said.in_period.shops.value.toLocaleString("en-US"));
  expect(Math.abs((await rupees(figure(tile(strip(page), "Collected")))) - said.in_period.collected.value), "Collected is not the server's figure for these dates").toBeLessThan(1);
}

// One signed-in admin, 240 requests a minute — see roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, tradeAuth("admin"));
});

test("billing is asked about a period — what came in follows it, what is late does not, and the ledger says whose dates it shows", async ({ page, request }) => {
  await page.goto("/admin/payments");

  // ── it opens on this month so far, with nothing pinned ────────────
  await expect(name(page)).toHaveText("This month", { timeout: 20_000 });
  expect(pinned(page).has("from"), "the opening period was written into the address").toBeFalsy();
  const opening = await summary(request);
  expect(opening.period.asked).toBe(false);
  expect(opening.period.from.endsWith("-01"), "the opening period does not start on the 1st").toBeTruthy();
  expect(opening.period.to).toBe(opening.period.today);
  await shows(page, opening);

  // What is late, as it stands now.
  const late = page.getByTestId("money-late");
  await expect(late).toContainText("Rs", { timeout: 15_000 });
  const lateNow = await late.innerText();
  const toDate = await page.getByTestId("revenue-to-date").innerText();

  // The ledger is the period's payments, says so, and adds up to Collected.
  await expect(note(page)).toHaveText("Following the period above — This month. Clear the date to search every payment.");
  if (opening.in_period.payments.value > 0) {
    await expect(total(page)).toContainText("This month", { timeout: 15_000 });
    expect(Math.abs((await firstRupees(total(page))) - opening.in_period.collected.value), "the ledger's total and Collected are two numbers").toBeLessThan(1);
  }

  // ── last month ────────────────────────────────────────────────────
  await menu(page).click();
  const list = page.getByRole("listbox", { name: "Period" });
  await expect(list.getByRole("option", { name: /^All time/ }), "the period was offered all time — that is the ledger's to ask for").toHaveCount(0);
  await list.getByRole("option", { name: /^Last month/ }).click();
  await expect(name(page)).toHaveText("Last month");
  const from = pinned(page).get("from")!;
  const to = pinned(page).get("to")!;
  expect(from).toMatch(/^\d{4}-\d{2}-01$/);
  const lastMonth = await summary(request, `?from=${from}&to=${to}`);
  expect(lastMonth.period.asked).toBe(true);
  await shows(page, lastMonth);

  // What is late and what has come in to date did not move.
  expect(await late.innerText(), "Money late moved with the period — it is what is late NOW").toBe(lateNow);
  expect(await page.getByTestId("revenue-to-date").innerText()).toBe(toDate);

  // The ledger went with it: last month's payments, and their total.
  await expect(note(page)).toHaveText("Following the period above — Last month. Clear the date to search every payment.");
  const paidLastMonth = await ledger(request, `?from=${from}&to=${to}`);
  expect(paidLastMonth.meta.totals.amount, "the ledger and the period disagree about last month").toBe(lastMonth.in_period.collected.value);
  const results = page.getByText(new RegExp(`^${paidLastMonth.meta.totals.payments.toLocaleString("en-US")} payments$`));
  await expect(results, "the ledger did not follow the period").toBeVisible({ timeout: 15_000 });

  // ── a refresh lands on it ─────────────────────────────────────────
  await page.reload();
  await expect(name(page)).toHaveText("Last month", { timeout: 20_000 });
  await shows(page, lastMonth);

  // ── a step back is the month before ───────────────────────────────
  await page.getByTestId("period-bar").getByRole("button", { name: "Earlier period" }).click();
  await expect.poll(() => pinned(page).get("to"), { message: "the step back did not leave last month" }).not.toBe(to);
  const before = await summary(request, `?from=${pinned(page).get("from")}&to=${pinned(page).get("to")}`);
  expect(pinned(page).get("to")! < from, "the step back did not end before last month began").toBeTruthy();
  await shows(page, before);
  await page.getByTestId("period-bar").getByRole("button", { name: "Later period" }).click();
  await expect(name(page)).toHaveText("Last month");

  // ── the year so far: where a payment and a shop stop being the same count ──
  // In one month most shops pay once, so Payments and Shops that paid can be
  // the same number and a tile wired to the wrong one would agree. Over the
  // year a shop pays again and again — if the two differ at all, it is here.
  await menu(page).click();
  await page.getByRole("listbox", { name: "Period" }).getByRole("option", { name: /^This year/ }).click();
  await expect.poll(() => pinned(page).get("from"), { message: "the year did not reach the address" }).toMatch(/-01-01$/);
  const year = await summary(request, `?from=${pinned(page).get("from")}&to=${pinned(page).get("to")}`);
  await shows(page, year);
  expect(year.in_period.payments.value, "no shop on this database has paid twice this year — Payments and Shops that paid cannot be told apart here").toBeGreaterThan(year.in_period.shops.value);
  await expect(tile(strip(page), "Shops that paid")).toContainText("Some paid more than once");
  await menu(page).click();
  await page.getByRole("listbox", { name: "Period" }).getByRole("option", { name: /^Last month/ }).click();
  await expect(name(page)).toHaveText("Last month");
  await shows(page, lastMonth);

  // ── a search under a period that does not hold the answer ─────────
  // Somebody who paid this month and not last: under "Last month" their name
  // finds nothing, and "nothing" must not read as "they never paid".
  const thisMonth = await ledger(request, `?from=${opening.period.from}&to=${opening.period.to}&per_page=100`);
  const then = new Set((await ledger(request, `?from=${from}&to=${to}&per_page=100`)).data.map((p) => p.tenant.business_name));
  const who = thisMonth.data.map((p) => p.tenant.business_name).find((n): n is string => n !== null && !then.has(n));
  expect(who, "nobody on this database paid this month without also paying last month — this case needs such a shop").toBeTruthy();

  await page.getByRole("searchbox", { name: "Search payments" }).or(page.getByLabel("Search payments")).first().fill(who!);
  await expect(page.getByText("No payment in Last month matches — it may be on another date.")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Search every date" }).click();
  await expect(page.getByRole("row").filter({ hasText: who! }).first(), "every date was asked for and the payment is still not shown").toBeVisible({ timeout: 15_000 });
  await expect(note(page)).toHaveText("Every payment recorded, whatever the period above.");
  await expect(total(page)).toContainText("in this filter");

  // The period did not move because the ledger was given every date.
  await expect(name(page)).toHaveText("Last month");
  expect(pinned(page).get("from")).toBe(from);
  await shows(page, lastMonth);

  // With the search gone and every date asked for, the total is all time's.
  await page.getByLabel("Search payments").fill("");
  await expect(total(page)).toContainText("all time", { timeout: 15_000 });
  const everything = await ledger(request, "?per_page=1");
  expect(Math.abs((await firstRupees(total(page))) - everything.meta.totals.amount)).toBeLessThan(1);

  // ── a new period is a new question, and the ledger answers it too ─
  await menu(page).click();
  await page.getByRole("listbox", { name: "Period" }).getByRole("option", { name: /^This month/ }).click();
  await expect(name(page)).toHaveText("This month");
  expect(pinned(page).has("from"), "choosing the opening period from the menu pinned its dates").toBeFalsy();
  await expect(note(page)).toHaveText("Following the period above — This month. Clear the date to search every payment.");
  await shows(page, await summary(request));

  // ── the cross on the date is "no dates", not "back to the period" ─
  await page.getByRole("button", { name: "Remove filter Paid: This month" }).click();
  await expect(note(page)).toHaveText("Every payment recorded, whatever the period above.");
  await expect(total(page)).toContainText("all time");
  await expect(name(page)).toHaveText("This month");
});

/** A CSV's rows, header first. Quoted cells with commas in them are one cell. */
function csv(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line !== "")
    .map((line) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.slice(0, -1).map((cell) => cell.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')));
}

test("the ledger's export is every payment the list holds — not the page that is on screen", async ({ page, request }) => {
  // The button read "Export this page" and meant it: twenty rows. A month has
  // more than twenty payments, and page one of three handed to an accountant
  // is a wrong answer that looks complete.
  await page.goto("/admin/payments");
  await expect(name(page)).toHaveText("This month", { timeout: 20_000 });

  // Every date, so there is certainly more than one page of it.
  await page.getByRole("button", { name: "Remove filter Paid: This month" }).click();
  await expect(note(page)).toHaveText("Every payment recorded, whatever the period above.");
  const all = await ledger(request, "?per_page=20");
  expect(all.meta.totals.payments, "this database has one page of payments or less — the case needs more than twenty").toBeGreaterThan(all.data.length);

  const button = page.getByTestId("export-ledger");
  await expect(button).toHaveText("Export CSV");
  await expect(button).toHaveAttribute("title", new RegExp(`all ${all.meta.totals.payments.toLocaleString("en-US")}, not only this page`), { timeout: 15_000 });

  const downloading = page.waitForEvent("download");
  await button.click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/^subscription-payments-\d{4}-\d{2}-\d{2}\.csv$/);
  const rows = csv(fs.readFileSync(await file.path(), "utf8"));

  expect(rows[0]).toEqual(["Paid", "Business", "Plan", "Period start", "Period end", "Method", "Reference", "Amount", "Currency"]);
  // All of them, and they add up to the figure above the table.
  expect(rows.length - 1, "the file holds the page, not the ledger").toBe(all.meta.totals.payments);
  const sum = rows.slice(1).reduce((total, row) => total + Number(row[7]), 0);
  expect(Math.abs(sum - all.meta.totals.amount), "the file does not add up to the ledger's own total").toBeLessThan(0.01);
  await expect(button).toHaveText("Export CSV");

  // ── narrowed, the file is narrowed the same way ───────────────────
  const who = all.data.map((p) => p.tenant.business_name).find((n): n is string => n !== null)!;
  await page.getByLabel("Search payments").fill(who);
  const narrowed = await ledger(request, `?search=${encodeURIComponent(who)}&per_page=1`);
  await expect(button).toHaveAttribute("title", new RegExp(`all ${narrowed.meta.totals.payments.toLocaleString("en-US")}, not only this page`), { timeout: 15_000 });
  const again = page.waitForEvent("download");
  await button.click();
  const some = csv(fs.readFileSync(await (await again).path(), "utf8"));
  expect(some.length - 1).toBe(narrowed.meta.totals.payments);
  expect(some.slice(1).every((row) => row[1].toLowerCase().includes(who.toLowerCase()) || row[2].toLowerCase().includes(who.toLowerCase()) || row[6].toLowerCase().includes(who.toLowerCase())), "a row in the file is not one the search found").toBeTruthy();
});

test("on a phone the period and its figures fit, and the period menu opens inside the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/payments");
  await expect(name(page)).toHaveText("This month", { timeout: 20_000 });
  await expect(strip(page)).toHaveAttribute("aria-busy", "false");

  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await sideways(), "the billing screen can be dragged sideways on a phone").toBeLessThanOrEqual(0);

  // The figure the row is for has the width to itself; the two counts share the row under it.
  const collected = (await tile(strip(page), "Collected").boundingBox())!;
  const payments = (await tile(strip(page), "Payments").boundingBox())!;
  const shops = (await tile(strip(page), "Shops that paid").boundingBox())!;
  expect(collected.width).toBeGreaterThan(payments.width * 1.8);
  expect(Math.abs(payments.y - shops.y), "the two counts are not side by side").toBeLessThan(2);
  expect(payments.y).toBeGreaterThan(collected.y + collected.height - 1);

  // The period's menu opens inside the screen.
  await menu(page).click();
  const list = page.getByRole("listbox", { name: "Period" });
  await expect(list).toBeVisible();
  const box = (await list.boundingBox())!;
  expect(box.x, "the period menu opens off the left of the screen").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "the period menu opens off the right of the screen").toBeLessThanOrEqual(390);
  expect(await sideways()).toBeLessThanOrEqual(0);
});
