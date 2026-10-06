import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

import { API, foodAuth } from "./api";

/**
 * TAKING AN ORDER, THE WAY A WAITER'S HAND DOES IT.
 *
 * A tab had two verbs — add a line, void a line — and every tap on a dish
 * added one line of one. Eight naan was eight taps, eight rows on the tab and
 * eight rows on the kitchen's docket. There was no way to say "make that
 * three", and no way at all to tell the kitchen "no chilli": the note column
 * had been on the line since the first day and no screen ever wrote to it.
 *
 * The rules are held by tests that do not need a browser (tabLines.test.ts,
 * ATabLineCanChangeBeforeItIsSentTest). This holds the thing only a browser
 * can: that three quick taps on a real tile, on a real network, end as ONE
 * line of three — and that what the waiter sent is what the kitchen reads.
 *
 * Runs at three sizes (the restaurant projects). On a phone the menu and the
 * order take turns, so the test goes and looks where a waiter would.
 */

/** Fixed, never stamped: a fixture named for the moment it ran is one more row for ever. */
const DISH = "E2E Tab Naan";

let toClear: string | null = null;

async function theDish(request: APIRequestContext): Promise<string> {
  const auth = foodAuth();
  const found = await request.get(`${API}/products?search=${encodeURIComponent(DISH)}&per_page=10`, { headers: auth });
  const have = ((await found.json()) as { data: Array<{ id: string; name: string }> }).data.find((p) => p.name === DISH);
  if (have) return have.id;

  const made = await request.post(`${API}/products`, {
    headers: auth,
    data: { item_type: "food_item", name: DISH, description: "A fixture for the tab's order pane.", price: 70, is_active: true },
  });
  expect(made.ok(), `could not make the fixture dish: ${made.status()} ${await made.text()}`).toBeTruthy();

  return ((await made.json()) as { data: { id: string } }).data.id;
}

async function aFreeTable(request: APIRequestContext): Promise<string> {
  const floor = await request.get(`${API}/restaurant/floor`, { headers: foodAuth() });
  expect(floor.ok()).toBeTruthy();
  const free = ((await floor.json()) as { data: { tables: Array<{ name: string; open_ticket: unknown | null }> } })
    .data.tables.find((t) => t.open_ticket === null);
  expect(free, "the fixture shop has no free table to seat").toBeTruthy();

  return free!.name;
}

/** On a phone the order is behind a tab; on anything wider it is already beside the menu. */
async function lookAt(page: Page, pane: "Menu" | "Order"): Promise<void> {
  const tab = page.getByRole("tab", { name: new RegExp(`^${pane}`) });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}

test.beforeEach(async ({ page }) => {
  // Sending prints the kitchen's ticket. A print window is the one dialog a
  // headless browser cannot dismiss.
  await page.addInitScript(() => { window.print = () => {}; });
});

test.afterEach(async ({ request }) => {
  if (toClear === null) return;
  await request.post(`${API}/restaurant/tickets/${toClear}/cancel`, {
    headers: foodAuth(), data: { reason: "e2e fixture" },
  }).catch(() => {});
  toClear = null;
});

test("three taps are one line of three, and the kitchen reads what was sent", async ({ page, request }) => {
  await theDish(request);
  const table = await aFreeTable(request);

  // ── seat the table, from the floor ─────────────────────────────────
  await page.goto("/tenant/dine-in");
  await page.getByRole("button", { name: new RegExp(`^${table}\\b`) }).click();
  const seat = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Open tab — ${table}` }) });
  // One press for a party of four — not a number box and a keyboard.
  await seat.getByRole("group", { name: "Party size" }).getByRole("button", { name: "4", exact: true }).click();
  await expect(seat.getByLabel("Guests")).toHaveValue("4");
  await seat.getByRole("button", { name: "Open tab" }).click();

  await expect(page).toHaveURL(/\/tenant\/dine-in\/tickets\//, { timeout: 20_000 });
  toClear = page.url().split("/").pop() ?? null;
  await expect(page.getByRole("heading", { name: table, exact: true })).toBeVisible();

  // ── three taps, as fast as a thumb goes ────────────────────────────
  await page.getByLabel("Search menu").fill(DISH);
  const tile = page.getByRole("button").filter({ hasText: DISH }).first();
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await tile.click();
  await tile.click();
  await tile.click();

  // The tile counts under the finger…
  await expect(tile.getByTestId("tile-count")).toHaveText("3", { timeout: 15_000 });

  // …and the tab holds ONE line of three, not three lines of one.
  await lookAt(page, "Order");
  const unsent = page.getByRole("region", { name: "Not sent yet" });
  await expect(unsent.getByLabel(`3 of ${DISH}`)).toBeVisible({ timeout: 15_000 });
  await expect(unsent.getByRole("listitem")).toHaveCount(1);
  // 3 × 70.
  await expect(unsent).toContainText("210");

  // ── more, fewer ────────────────────────────────────────────────────
  await unsent.getByRole("button", { name: `One more ${DISH}` }).click();
  await expect(unsent.getByLabel(`4 of ${DISH}`)).toBeVisible({ timeout: 15_000 });
  await unsent.getByRole("button", { name: `One fewer ${DISH}` }).click();
  await expect(unsent.getByLabel(`3 of ${DISH}`)).toBeVisible({ timeout: 15_000 });

  // ── a word for the kitchen ─────────────────────────────────────────
  await unsent.getByRole("button", { name: "+ Kitchen note" }).click();
  const note = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Kitchen note" }) });
  await note.getByRole("button", { name: "No chilli", exact: true }).click();
  await expect(note.getByRole("textbox", { name: "Note" })).toHaveValue("No chilli");
  await note.getByRole("button", { name: "Save note" }).click();
  await expect(unsent.getByRole("button", { name: "No chilli" })).toBeVisible({ timeout: 15_000 });

  // ── send it ────────────────────────────────────────────────────────
  // The big button says how many portions are going, not how many rows.
  await page.getByRole("button", { name: "Send to kitchen (3)" }).click();
  await expect(page.getByText(/Kitchen ticket #\d+.* sent/)).toBeVisible({ timeout: 20_000 });

  await lookAt(page, "Order");
  await expect(page.getByRole("region", { name: "Not sent yet" })).toHaveCount(0);
  const cooking = page.getByRole("region", { name: "In the kitchen" });
  await expect(cooking).toContainText(DISH);
  // Sent is sent: no stepper, and nothing left to send.
  await expect(cooking.getByRole("button", { name: `One more ${DISH}` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send to kitchen", exact: true })).toBeDisabled();

  // ── what the cook reads ────────────────────────────────────────────
  await page.goto("/tenant/kitchen");
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: table, exact: true }) });
  await expect(card).toHaveCount(1, { timeout: 20_000 });
  // ONE row saying three. Eight naan used to be "1 Naan", eight times over.
  await expect(card.getByRole("listitem")).toHaveCount(1);
  await expect(card.getByRole("listitem")).toContainText("3");
  await expect(card.getByRole("listitem")).toContainText(DISH);
  await expect(card).toContainText(/no chilli/i);

  // ── and what the floor says about the table ────────────────────────
  await page.goto("/tenant/dine-in");
  const sat = page.getByRole("button", { name: new RegExp(`^${table}\\b`) });
  await expect(sat).toContainText("In kitchen", { timeout: 20_000 });
  await expect(sat).toContainText("210");
  await expect(sat).toContainText("4 guests");
});
