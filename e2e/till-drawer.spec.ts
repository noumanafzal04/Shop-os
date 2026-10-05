import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API, ownerAuth } from "./api";
import { TAXED, completeAndFetch, openTender, ring, rupees, stockTaxedShelf } from "./taxedShelf";

/**
 * THE DRAWER, start to finish, in a browser against the server.
 *
 * *"Drawer b achy sy test krna, isk sary option sahi work kr rhy."* The API
 * sweep proves the drawer's arithmetic; nothing proved the SCREEN shows it,
 * or that each of the five things a cashier can do to a drawer is reachable
 * and lands where it says.
 *
 * One shift, lived through in order, because a drawer is a running total and
 * every step is only checkable against the one before it:
 *
 *     open with a float     2,000
 *     paid in        +500   2,500
 *     paid out       −300   2,200
 *     safe drop    −1,000   1,200
 *     add float      +800   2,000
 *     no sale           0   2,000   (the drawer opened, nothing moved)
 *     cash sale    +4,956   6,956   (5,000 handed over, 44 back)
 *     card sale         0   6,956   (a card is not in the drawer)
 *     count 6,906           SHORT 50
 *
 * After every step the figure on the screen is compared with the server's own
 * X-read, not with this file's arithmetic alone — the file says what SHOULD
 * be there, the server says what IS, and the screen has to be both.
 */

test.describe.configure({ mode: "serial" });

type Report = { drawer: Record<string, number | undefined>; session: Record<string, unknown> };

async function api<T>(request: APIRequestContext, method: "get" | "post", path: string, data?: unknown): Promise<{ status: number; data: T }> {
  const res = await request[method](`${API}${path}`, { headers: ownerAuth(), ...(data === undefined ? {} : { data }) });
  const body = (await res.json().catch(() => ({}))) as { data?: T };

  return { status: res.status(), data: body.data as T };
}

const xRead = async (request: APIRequestContext) => (await api<Report>(request, "get", "/pos/session/report")).data;

/** The drawer sheet, opened from the top bar. */
async function openDrawer(page: Page) {
  await page.getByRole("button", { name: "Drawer" }).first().click();
  const sheet = page.getByRole("dialog").filter({ hasText: "Record cash movement" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });

  return sheet;
}

/** What the screen says the drawer should hold. */
async function expectedOnScreen(sheet: ReturnType<Page["getByRole"]>): Promise<number> {
  return rupees(await sheet.getByText("Expected in drawer").locator("..").innerText());
}

async function move(page: Page, request: APIRequestContext, label: string, amount: number | null, reason: string, want: number) {
  const sheet = await openDrawer(page);
  await sheet.getByRole("button", { name: label, exact: true }).click();

  const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: label }) });
  await expect(form).toBeVisible();
  if (amount !== null) await form.getByPlaceholder("0.00").fill(String(amount));
  await form.getByPlaceholder(/courier charges|Why the drawer was opened/).fill(reason);
  await form.getByRole("button", { name: amount === null ? "Open drawer" : new RegExp(`^Record ${label}$`, "i") }).click();

  // Back on the read, with the new figure — the screen's AND the server's.
  const read = page.getByRole("dialog").filter({ hasText: "Record cash movement" });
  await expect(read).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => expectedOnScreen(read), { message: `after ${label}`, timeout: 15_000 }).toBe(want);
  expect((await xRead(request)).drawer.expected_cash, `the server after ${label}`).toBe(want);

  // The movement is on the trail, by the reason it was given.
  await expect(read.getByText(reason).first()).toBeVisible();

  await read.getByRole("button", { name: "Close" }).first().click();
  await expect(read).toBeHidden();
}

test.beforeAll(async ({ request }) => {
  await stockTaxedShelf(request);

  // A clean counter. A shift left open by an earlier run would make every
  // figure below a figure about somebody else's day.
  const open = await api<{ id: string } | null>(request, "get", "/pos/session");
  if (open.data) {
    const report = await xRead(request);
    await api(request, "post", "/pos/session/close", { counted_cash: report.drawer.expected_cash ?? 0, notes: "e2e: closing a shift left open" });
  }
});

test("a shift from float to count: every drawer control lands where it says", async ({ page, request }) => {
  test.setTimeout(240_000);
  // NOT `openTill`: that helper opens a shift for any spec that just wants to
  // sell, and here opening the shift — with a float — is the first thing
  // under test.
  await page.goto("/tenant/pos");
  await expect(page.getByPlaceholder(/scan barcode or search/i).first()).toBeVisible({ timeout: 30_000 });

  // ── open with a float ──────────────────────────────────────────────
  await page.getByRole("button", { name: "Open shift" }).first().click();
  const opening = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Open shift" }) });
  await opening.getByRole("spinbutton").first().fill("2000");
  await opening.getByRole("button", { name: "Open", exact: true }).click();
  await expect(opening).toBeHidden({ timeout: 15_000 });

  const first = await xRead(request);
  expect(first.drawer.expected_cash, "this shop closes blind, so the drawer shows no expected figure").not.toBeUndefined();
  expect(first.drawer.expected_cash).toBe(2000);

  let sheet = await openDrawer(page);
  expect(await expectedOnScreen(sheet)).toBe(2000);
  await sheet.getByRole("button", { name: "Close" }).first().click();

  // ── the five things a cashier may do to a drawer ───────────────────
  await move(page, request, "Paid in", 500, "e2e change from the bank", 2500);
  await move(page, request, "Paid out", 300, "e2e tea for the counter", 2200);
  await move(page, request, "Safe drop", 1000, "e2e evening drop", 1200);
  await move(page, request, "Add float", 800, "e2e more change", 2000);
  await move(page, request, "No sale", null, "e2e customer needed change", 2000);

  // ── a cash sale puts in what was KEPT, not what was handed over ────
  await ring(page, [TAXED.A.name]);
  const due = await openTender(page, "Cash");
  expect(due).toBe(4956);
  await page.getByPlaceholder("Cash tendered").fill("5000");
  const cash = await completeAndFetch(page, request);
  expect(Number(cash.change_due)).toBe(44);
  await page.getByRole("button", { name: "New sale" }).click();

  // ── a card sale puts in nothing ────────────────────────────────────
  await ring(page, [TAXED.B.name]);
  expect(await openTender(page, "Card")).toBe(6941);
  await completeAndFetch(page, request);
  await page.getByRole("button", { name: "New sale" }).click();

  // ── the X-read: the screen, line by line, against the server ───────
  const report = await xRead(request);
  expect(report.drawer.expected_cash).toBe(6956);
  expect(report.drawer.cash_tendered).toBe(5000);
  expect(report.drawer.change_given).toBe(44);
  expect(report.drawer.cash_in).toBe(1300);
  expect(report.drawer.cash_out).toBe(1300);
  expect(report.drawer.sales_count).toBe(2);
  expect(report.drawer.sales_total).toBe(11897);

  sheet = await openDrawer(page);
  // Read the INSTANT the sheet is up, deliberately with no waiting. It used to
  // draw the figure from before these two sales until a refetch landed — and
  // a cashier counts cash against whatever this says.
  expect(await expectedOnScreen(sheet), "the drawer drew a figure from before the last sales").toBe(6956);

  // A row of the sum is a <dt> (its sign and its name) beside a <dd> (the money).
  const line = async (label: string) =>
    rupees(await sheet.locator("dt").filter({ hasText: label }).first().locator("xpath=following-sibling::dd").innerText());
  expect(await line("Cash tendered"), "cash tendered").toBe(5000);
  expect(await line("Change given"), "change given").toBe(44);
  expect(await line("Cash sales"), "cash sales").toBe(4956);
  expect(await line("Opening float"), "opening float").toBe(2000);
  expect(await line("Cash in (paid in, float)"), "cash in").toBe(1300);
  expect(await line("Cash out (pay-outs, drops)"), "cash out").toBe(1300);
  expect(await line("Expected cash"), "the sum's own last line").toBe(6956);
  expect(
    rupees(await sheet.getByText("Sales total", { exact: true }).locator("xpath=following-sibling::p").innerText()),
    "sales total",
  ).toBe(11897);
  // Both sales are in the tender mix, each under the way it was paid.
  const mix = sheet.getByText("Tender mix").locator("..");
  await expect(mix).toContainText(/Cash/);
  await expect(mix).toContainText(/Card/);
  // The column adds up to the headline, on the screen, by hand.
  expect(2000 + (5000 - 44) + 1300 - 1300).toBe(6956);
  await sheet.getByRole("button", { name: "Close" }).first().click();

  // ── count it, fifty short ──────────────────────────────────────────
  await page.getByRole("button", { name: "Close shift" }).first().click();
  const closing = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Close shift" }) });
  await expect(closing).toBeVisible();

  const typed = closing.locator("#counted-cash");
  if (await typed.count()) {
    await typed.fill("6906");
  } else {
    // Counted note by note: 5000 + 1000 + 500 + 4×100 + 5 + 1.
    for (const [note, qty] of [["5,000", 1], ["1,000", 1], ["500", 1], ["100", 4], ["5", 1], ["1", 1]] as const) {
      await closing.getByLabel(`How many ${note} notes`).fill(String(qty));
    }
  }

  // The sheet says so BEFORE the shift is closed: this is the cashier's one
  // chance to recount.
  await expect(closing.getByText("Short")).toBeVisible();
  expect(rupees(await closing.getByText("Short").locator("..").innerText())).toBe(50);

  await closing.getByRole("button", { name: "Close shift" }).click();
  await expect(closing).toBeHidden({ timeout: 20_000 });

  // ── and the books say the same ─────────────────────────────────────
  expect((await api<unknown>(request, "get", "/pos/session")).data, "the shift is still open").toBeNull();

  const closed = (await api<{ sessions: Array<Record<string, string>> }>(request, "get", "/pos/sessions?per_page=1")).data.sessions[0];
  expect(Number(closed.opening_float)).toBe(2000);
  expect(Number(closed.expected_cash)).toBe(6956);
  expect(Number(closed.counted_cash)).toBe(6906);
  expect(Number(closed.variance)).toBe(-50);
});
