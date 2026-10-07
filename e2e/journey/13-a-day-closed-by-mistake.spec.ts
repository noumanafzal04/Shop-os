import fs from "node:fs";
import type { APIRequestContext, Page } from "@playwright/test";
import { API } from "../api";
import { OWNER_STATE, ask, expect, record, remember, session, settled, test } from "./kit";
import { item } from "./shop";
import { complete, openTill, ring, tender, tenderSheet } from "./till";

/**
 * STAGE I — THE DAY IS CLOSED OFF BY MISTAKE, AND THE SHOP CARRIES ON.
 *
 *     "Ghalti se band kiya hua din dobara khul nahi sakta."
 *
 * Two o'clock in the afternoon. Somebody on Day & banking presses "Close off
 * day" — the wrong screen, the wrong hour. A closed day takes no shift, so
 * the till refuses to open one; and a shop that requires a shift to sell has
 * stopped trading until tomorrow.
 *
 * The product was right to refuse the shift and had no answer for the slip.
 * This stage is the slip and the answer, at the counter, in a browser:
 *
 *   the close sheet says BEFOREHAND that there is a way back
 *   the till's refusal names it
 *   the Day screen says what happened — not "No day open yet" — and offers it
 *   a reason is asked for, and nothing happens without one
 *   the afternoon goes on in the SAME day, which says it was opened again
 *   closed off properly, the day is the whole day: both shifts
 *
 * The drawer is counted through the API here. Counting a drawer is stage C's
 * subject (C9) and stage G's (blind close); here it is plumbing between the
 * two things this stage is about.
 */

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

const REASON = "Closed off by mistake — wrong screen";
const FLOAT = 1000;

const token = (): string => {
  const state = JSON.parse(fs.readFileSync(OWNER_STATE, "utf8")) as { origins: Array<{ localStorage: Array<{ name: string; value: string }> }> };
  const auth = state.origins.flatMap((o) => o.localStorage).find((i) => i.name === "shopos-auth")!;

  return (JSON.parse(auth.value) as { state: { accessToken: string } }).state.accessToken;
};

const post = (request: APIRequestContext, path: string, data: Record<string, unknown>) =>
  request.post(`${API}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${token()}` }, data });

interface DayView { day: { id: string; status: string; trading_date: string; reopen_reason: string | null }; sessions: Array<{ status: string }> }

const currentDay = (request: APIRequestContext) => ask<DayView | null>(request, "owner", "/pos/day");

/** Open a shift at the till, as a cashier does. */
async function openShift(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open shift" }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Open shift" }) });
  await sheet.getByRole("spinbutton").first().fill(String(FLOAT));
  await sheet.getByRole("button", { name: "Open", exact: true }).click();
  await expect(sheet, "the shift did not open").toBeHidden({ timeout: 15_000 });
}

/** One bar of soap for cash, and what the server says it came to. */
async function sellSoap(page: Page, request: APIRequestContext): Promise<number> {
  await ring(page, item("soap").name);
  await tender(page, "Cash");
  await tenderSheet(page).getByRole("button", { name: /^Exact ·/ }).click();

  return Number((await complete(page, request)).total);
}

/** Count the drawer out. Plumbing — see the note at the top. */
async function countOut(request: APIRequestContext, takings: number): Promise<void> {
  const closed = await post(request, "/pos/session/close", { counted_cash: Math.round((FLOAT + takings) * 100) / 100 });
  expect(closed.ok(), `the shift would not close (${closed.status()}): ${await closed.text()}`).toBeTruthy();
}

test("I1 · A morning's trading, and the day closed off at the wrong hour", async ({ page, request }) => {
  expect(await ask<unknown>(request, "owner", "/pos/session"), "a shift was left open by an earlier stage").toBeNull();

  await openTill(page);
  await openShift(page);
  const morning = await sellSoap(page, request);
  await countOut(request, morning);

  const before = await currentDay(request);
  expect(before, "no trading day is open after a shift was opened and counted").not.toBeNull();
  remember({ mistakeDay: before!.day.id, mistakeMorning: morning, mistakeShifts: before!.sessions.length });

  await page.goto("/tenant/day");
  await settled(page);
  // The hour this day runs until is on the screen now — the reason a shift
  // opened after midnight lands here was an hour nobody had been shown.
  await expect(page.getByTestId("day-ends-at")).toContainText("Your shop's day runs until");

  await page.getByRole("button", { name: "Close off day" }).click();
  const consequence = page.getByTestId("close-day-consequence");
  await expect(consequence).toContainText("No shift can be opened on a closed day.");
  // Said BEFORE the button: there is a way back, and where it is.
  await expect(consequence).toContainText("a manager can open today again from this screen");
  await page.getByRole("dialog").getByRole("button", { name: "Close off day" }).click();

  // Not "No day open yet". Somebody closed it, and the screen says so.
  const card = page.getByTestId("closed-today");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("has been closed off");
  await expect(card).toContainText("in sales.");
  await expect(page.getByText("No day open yet.")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Open today again" })).toBeVisible();

  expect(await currentDay(request), "the server still has a day open").toBeNull();
});

test("I2 · The till will not open a shift on a closed day — and says where the way back is", async ({ page, request, watch }) => {
  watch.expect(/BUSINESS_DAY_CLOSED/);

  await openTill(page);
  await page.getByRole("button", { name: "Open shift" }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Open shift" }) });
  await sheet.getByRole("spinbutton").first().fill(String(FLOAT));
  await sheet.getByRole("button", { name: "Open", exact: true }).click();

  await expect(page.getByText(/has already been closed off/).first()).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText(/A manager can open it again from Day & banking/).first(),
    "the refusal does not say there is a way back",
  ).toBeVisible();

  expect(await ask<unknown>(request, "owner", "/pos/session"), "a shift opened on a closed day").toBeNull();
});

test("I3 · Opened again with a reason, the afternoon is sold in the same day", async ({ page, request }) => {
  await page.goto("/tenant/day");
  await settled(page);

  await page.getByTestId("closed-today").getByRole("button", { name: "Open today again" }).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByText("Why is it being opened again?") });
  await expect(sheet).toBeVisible();

  // Nothing without a reason — and a reason is not two letters.
  const confirm = sheet.getByRole("button", { name: "Open it again" });
  await expect(confirm).toBeDisabled();
  await sheet.getByRole("textbox").fill("ok");
  await expect(confirm).toBeDisabled();
  await sheet.getByRole("textbox").fill(REASON);
  await confirm.click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });

  // The day is back, and it says what happened to it.
  await expect(page.getByTestId("closed-today")).toHaveCount(0);
  const reopened = page.getByTestId("day-reopened");
  await expect(reopened).toBeVisible({ timeout: 20_000 });
  await expect(reopened).toContainText("Closed off earlier and opened again");
  await expect(reopened).toContainText(REASON);

  const day = await currentDay(request);
  expect(day?.day.id, "a DIFFERENT day is open — the old one was not opened again").toBe(record().mistakeDay);
  expect(day?.day.reopen_reason).toBe(REASON);

  // The afternoon.
  await openTill(page);
  await openShift(page);
  const afternoon = await sellSoap(page, request);
  await countOut(request, afternoon);
  remember({ mistakeAfternoon: afternoon });

  const after = await currentDay(request);
  expect(after?.day.id).toBe(record().mistakeDay);
  expect(after?.sessions.length, "the afternoon's shift is not in the day that was opened again")
    .toBe(Number(record().mistakeShifts) + 1);
});

test("I4 · The trail says who undid the sign-off, why, and what it had said", async ({ page }) => {
  await page.goto("/tenant/activity");
  await settled(page);

  const row = page.getByRole("row").filter({ hasText: "opened again" }).first();
  await expect(row, "nothing on the activity trail says the day was opened again").toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText("Trading day");
  await expect(row).toContainText(REASON);
});

test("I5 · Closed off properly, the day is the whole day", async ({ page, request }) => {
  await page.goto("/tenant/day");
  await settled(page);

  await page.getByRole("button", { name: "Close off day" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close off day" }).click();
  await expect(page.getByTestId("closed-today")).toBeVisible({ timeout: 20_000 });

  const day = await ask<{ status: string; shifts_count: number; sales_total: string; reopen_reason: string | null }>(
    request, "owner", `/pos/days/${String(record().mistakeDay)}`,
  );
  expect(day.status).toBe("closed");
  expect(day.shifts_count, "the day closed without the shifts it had before it was opened again")
    .toBe(Number(record().mistakeShifts) + 1);
  // Both halves of the day are in its total: the morning's and the afternoon's.
  expect(Number(day.sales_total)).toBeGreaterThanOrEqual(
    Math.round((Number(record().mistakeMorning) + Number(record().mistakeAfternoon)) * 100) / 100,
  );
  // That it was opened again stays on the day after it is closed.
  expect(day.reopen_reason).toBe(REASON);

  // Left OPEN for whatever is run next today: a journey is lived in one
  // sitting, and the stage after this one may need a drawer.
  const again = await post(request, `/pos/days/${String(record().mistakeDay)}/reopen`, { reason: "Journey: left open for the next stage" });
  expect(again.ok(), `could not leave the day open (${again.status()})`).toBeTruthy();
});
