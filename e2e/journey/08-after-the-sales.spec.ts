import { OWNER_STATE, ask, expect, record, rupees, session, settled, test } from "./kit";
import { customer, item } from "./shop";
import { openTill } from "./till";

/**
 * STAGE C (after the sales) — what a shop does with a day once it has rung it.
 *
 * The ledger is read back against what was sold; a customer brings something
 * back, twice; a trader pays down his khata; a little cash leaves the till for
 * tea; the drawer is counted; the day is closed.
 *
 * Each of these moves a figure the stage before established, so every case
 * says what the figure was, what it did, and what it must now be.
 */

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Row = Record<string, unknown>;
type Day = Array<{ case: string; invoice: string; total: number; method: string }>;

const drawer = async (request: Parameters<typeof ask>[0]) =>
  (await ask<{ drawer: Record<string, number> }>(request, "owner", "/pos/session/report")).drawer;
const stock = async (request: Parameters<typeof ask>[0], name: string) =>
  Number((await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`)).find((p) => p.name === name)!.stock_quantity);

test("C5 · the ledger has every sale of the day, at the total it was rung at", async ({ page }) => {
  const day = record().day as Day;
  expect(day.length, "the trading day recorded no sales").toBeGreaterThanOrEqual(10);

  await page.goto("/tenant/sales");
  await settled(page);

  for (const sale of day) {
    const row = page.getByRole("row").filter({ hasText: sale.invoice }).first();
    await expect(row, `${sale.invoice} is not in the ledger`).toBeVisible();
    const shown = ((await row.innerText()).match(/Rs\s?[0-9,]+(?:\.[0-9]+)?/g) ?? []).map(rupees);
    expect(shown, `${sale.invoice} shows ${shown.join(", ")}`).toContain(sale.total);
    // A status in WORDS. (One of these sales is returned later in this stage,
    // so "Completed" is not the only right answer on a second pass.)
    await expect(row).toContainText(/Completed|Partially refunded|Refunded/);
    await expect(row).not.toContainText(/_/);
  }

  // A sale that HAS a customer does not say "Walk-in". The khata sale is the
  // one that matters: Rs 18,900 a named trader owes.
  const khata = day.find((s) => s.method === "credit")!;
  await expect(page.getByRole("row").filter({ hasText: khata.invoice }).first()).not.toContainText("Walk-in");
});

test("C5 · a sale's own sheet shows its tax and a quantity a person can read", async ({ page }) => {
  const day = record().day as Day;
  const rice = day.find((s) => s.total === 4095)!;

  await page.goto("/tenant/sales");
  await page.getByRole("row").filter({ hasText: rice.invoice }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: rice.invoice }) });
  await expect(sheet).toBeVisible();

  await expect(sheet.getByText(/2 × Rs 1,950/)).toBeVisible();
  await expect(sheet.getByText(/2\.000/), "a quantity printed as 2.000").toHaveCount(0);
  await expect(sheet).toContainText("Subtotal: Rs 3,900");
  await expect(sheet).toContainText("Tax: Rs 195");
  await expect(sheet).toContainText("Total: Rs 4,095");
});

test("C6 · a customer brings one bag back, then the other — each is refunded and restocked", async ({ page, request }) => {
  const day = record().day as Day;
  const sale = day.find((s) => s.total === 4095)!;
  const rice = item("rice").name;
  const before = await stock(request, rice);

  const held = await ask<Row[]>(request, "owner", "/sales?per_page=30");
  const status = String(held.find((s) => s.invoice_number === sale.invoice)!.status);
  // RESUMED when both bags are already back: the screens are not pressed
  // again, but the money and the shelf are still checked at the end.
  const done = status === "refunded";

  const open = async () => {
    await page.goto("/tenant/sales");
    await page.getByRole("row").filter({ hasText: sale.invoice }).first().click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: sale.invoice }) });
    await expect(sheet).toBeVisible();

    return sheet;
  };

  if (!done) {
    // ── the first bag ──────────────────────────────────────────────────
    // (Skipped when an earlier attempt at this case already took it back.)
    let sheet = await open();
    const first = status === "completed";
    if (first) {
      await sheet.getByRole("button", { name: "Return / Refund" }).click();
      await expect(sheet.getByText(/· 2 returnable/)).toBeVisible();
      await sheet.getByLabel(`How many ${rice} to return`).fill("1");
      await sheet.getByRole("button", { name: "Refund & restock" }).click();
      // Said in words, and not under the close button.
      await expect(sheet.getByText("Partially refunded", { exact: true }), "the status is not shown as words").toBeVisible({ timeout: 20_000 });
      await expect(sheet.getByText(/partially_refunded/), "a database value on the screen").toHaveCount(0);
      // One bag: "1 item(s)", not "01.000".
      await expect(sheet.getByText(/RET-\d+ · 1 item\(s\)/)).toBeVisible();
      expect(await stock(request, rice), "the first bag did not go back on the shelf").toBe(before + 1);
    }

    // ── the second, on the same line ───────────────────────────────────
    //
    // This is the one that broke: the sheet added up what had already come
    // back as TEXT, and a second return of a line read "NaN returnable".
    sheet = await open();
    await sheet.getByRole("button", { name: "Return / Refund" }).click();
    await expect(sheet.getByText(/· 1 returnable/), "what is still returnable was not a number").toBeVisible();
    await sheet.getByLabel(`How many ${rice} to return`).fill("1");
    await sheet.getByRole("button", { name: "Refund & restock" }).click();
    await expect(page.getByRole("row").filter({ hasText: sale.invoice }).first()).toContainText(/refunded/i, { timeout: 20_000 });

    expect(await stock(request, rice)).toBe(before + (first ? 2 : 1));
  }

  // The money: both bags, WITH the tax that was charged on them.
  const now = await ask<{ status: string; returns: Array<{ refund_total: string | number }> }>(
    request, "owner", `/sales/${String(held.find((s) => s.invoice_number === sale.invoice)!.id)}`,
  );
  expect(now.status).toBe("refunded");
  expect(now.returns).toHaveLength(2);
  // 1,950 + 97.50 of tax, twice: the whole bill, to the paisa.
  expect(now.returns.map((r) => Number(r.refund_total))).toEqual([2047.5, 2047.5]);
  expect(now.returns.reduce((s, r) => s + Number(r.refund_total), 0), "refunded in all").toBe(4095);
});

test("C7 · the trader pays Rs 5,000 off his khata, in cash, and the drawer takes it", async ({ page, request }) => {
  const bilal = customer("trader");
  const owedBefore = (await ask<{ credit_balance: number }>(request, "owner", `/customers-lookup?phone=${bilal.phone}`)).credit_balance;
  test.skip(owedBefore !== 18900, `resumed: the khata is at ${owedBefore}`);
  const drawerBefore = (await drawer(request)).expected_cash;

  await page.goto("/tenant/customers");
  await page.getByRole("row").filter({ hasText: bilal.name }).first().getByText(bilal.name).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: bilal.name }) });
  await expect(sheet).toContainText("Rs 18,900");
  await expect(sheet).toContainText("Rs 50,000 limit");

  await sheet.getByRole("spinbutton", { name: "Payment amount" }).fill("5000");
  await sheet.getByLabel("Paid by", { exact: true }).selectOption({ label: "Cash" });
  await sheet.getByRole("button", { name: "Record" }).click();
  await expect(sheet.getByText(/Rs 13,900/).first(), "the sheet did not show the new balance").toBeVisible({ timeout: 20_000 });

  expect((await ask<{ credit_balance: number }>(request, "owner", `/customers-lookup?phone=${bilal.phone}`)).credit_balance).toBe(13900);
  // Notes handed over the counter are in the drawer, whatever they were for.
  expect((await drawer(request)).expected_cash, "cash paid off a khata did not reach the drawer").toBe(drawerBefore + 5000);
});

test("C7 · cash for tea leaves the till as an expense, and the drawer gives it up", async ({ page, request }) => {
  const held = await ask<Row[]>(request, "owner", "/expenses?per_page=100");
  test.skip(held.some((e) => e.description === "QA tea for the counter"), "resumed: the tea is already bought");
  const before = (await drawer(request)).expected_cash;

  await page.goto("/tenant/expenses");
  await page.getByRole("button", { name: "Add expense" }).first().click();
  const form = page.getByRole("dialog", { name: "Add expense" });
  await form.getByLabel("Category *", { exact: true }).selectOption({ label: "Staff Salary" });
  await form.getByLabel("Description *", { exact: true }).fill("QA tea for the counter");
  await form.getByLabel("Amount *", { exact: true }).fill("300");
  await form.getByLabel("Paid by", { exact: true }).selectOption({ label: "Cash (from till)" });
  await form.getByRole("button", { name: "Save expense" }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });

  expect((await drawer(request)).expected_cash, "an expense paid from the till did not come out of the drawer").toBe(before - 300);
});

test("C9 · the drawer is what the day says it should be, and counts out to the rupee", async ({ page, request }) => {
  const open = await ask<unknown>(request, "owner", "/pos/session");
  test.skip(!open, "resumed: the shift is already closed");

  // 5,000 float + 9,395.90 cash sales + 5,000 khata − 300 tea.
  const expected = (await drawer(request)).expected_cash;
  expect(expected).toBe(19095.9);

  await openTill(page);
  await page.getByRole("button", { name: "Drawer" }).first().click();
  const read = page.getByRole("dialog").filter({ hasText: "Record cash movement" });
  await expect(read).toBeVisible({ timeout: 15_000 });
  expect(rupees(await read.getByText("Expected in drawer").locator("..").innerText())).toBe(19095.9);
  await read.getByRole("button", { name: "Close" }).first().click();

  await page.getByRole("button", { name: "Close shift" }).first().click();
  const closing = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Close shift" }) });
  const typed = closing.locator("#counted-cash");
  if (await typed.count()) {
    await typed.fill("19095.9");
  } else {
    // By note: 3×5000 + 4×1000 + 0×500 + 0×100 + 1×50 + 2×20 + 1×5, and the 90 paisa cannot be a note.
    for (const [note, qty] of [["5,000", 3], ["1,000", 4], ["50", 1], ["20", 2], ["5", 1]] as const) {
      await closing.getByLabel(`How many ${note} notes`).fill(String(qty));
    }
  }
  await closing.getByRole("button", { name: "Close shift" }).click();
  await expect(closing).toBeHidden({ timeout: 20_000 });

  expect(await ask<unknown>(request, "owner", "/pos/session"), "the shift is still open").toBeNull();
  const closed = (await ask<{ sessions: Array<Record<string, string>> }>(request, "owner", "/pos/sessions?per_page=1")).sessions[0];
  expect(Number(closed.expected_cash)).toBe(19095.9);
  expect(Math.abs(Number(closed.variance)), "the count and the books disagree by more than the paisa a note cannot carry").toBeLessThan(1);
});

test("C10 · Day & banking tells the day as it was, and the day is closed off", async ({ page }) => {
  await page.goto("/tenant/day");
  await settled(page);

  const figure = async (label: string) =>
    rupees(await page.getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]").innerText());

  // RESUMED when the day is already closed: Today is empty, and that is right.
  const open = !(await page.getByText("No day open yet.").isVisible().catch(() => false));
  if (open) {
    // Ten sales were RUNG. Two bags coming back does not un-ring them.
    expect(await figure("Rung up")).toBe(43543.96);
    await expect(page.getByText("10 sales")).toBeVisible();
    // Every drawer has been counted, so the day may be closed.
    await expect(page.getByText("1 of 1 shift counted")).toBeVisible();

    await page.getByRole("button", { name: "Close off day" }).click();
    // Before the button: what closing does that cannot be taken back TODAY.
    // It said the figures freeze; it did not say no shift can be opened again
    // until tomorrow — and a shop that requires a shift to sell found that
    // out at the till.
    await expect(page.getByTestId("close-day-consequence")).toContainText("No shift can be opened again today.");
    const confirm = page.getByRole("dialog").getByRole("button", { name: /Close off|Close the day|Confirm/i }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();

    // A closed day is no longer "today".
    await expect(page.getByText("No day open yet.")).toBeVisible({ timeout: 20_000 });
  }

  // It is in the past days, with the figure it closed on.
  await page.getByRole("button", { name: "Past days" }).click();
  const row = page.getByRole("row").filter({ hasText: /43,543\.96/ }).first();
  await expect(row, "the closed day is not among the past days at the figure it rang").toBeVisible({ timeout: 20_000 });
});
