import { OWNER_STATE, ask, expect, record, rupees, session, settled, test } from "./kit";
import { COUPON, EXPENSES, INCOMES, PROMOTION, item } from "./shop";

/**
 * STAGE B (offers and money) — the rules that change a bill, and the money
 * that moves without a sale.
 *
 * A coupon and a promotion are entered here and SPENT in the trading day
 * (stage 07), which is where they are judged. What is judged here is that
 * each was saved as it was typed, and that an expense and an income land in
 * the cashbook on the day they say.
 */

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Row = Record<string, unknown>;

test("B13 · a coupon is created and reads back as typed", async ({ page, request }) => {
  const held = await ask<Row[]>(request, "owner", "/coupons?per_page=100");
  if (!held.some((c) => c.code === COUPON.code)) {
    await page.goto("/tenant/coupons");
    await page.getByRole("button", { name: "+ New coupon" }).click();
    const form = page.getByRole("dialog", { name: "New coupon" });
    await form.getByPlaceholder("CODE (e.g. EID20)").fill(COUPON.code);
    await form.getByLabel("Coupon type", { exact: true }).selectOption({ label: "Percentage %" });
    await form.getByRole("spinbutton", { name: "Value %" }).fill(String(COUPON.pct));
    await form.getByRole("spinbutton", { name: "Min spend (optional)" }).fill(String(COUPON.minSpend));
    await form.getByRole("spinbutton", { name: "Max discount cap (optional)" }).fill(String(COUPON.cap));
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }

  await page.goto("/tenant/coupons");
  await settled(page);
  await expect(page.getByRole("row").filter({ hasText: COUPON.code }).first()).toBeVisible();

  const mine = (await ask<Row[]>(request, "owner", "/coupons?per_page=100")).find((c) => c.code === COUPON.code)!;
  expect(mine.type).toBe("percent");
  expect(Number(mine.value)).toBe(COUPON.pct);
  expect(Number(mine.min_spend)).toBe(COUPON.minSpend);
  expect(Number(mine.max_discount)).toBe(COUPON.cap);

  // What the TILL will be quoted for it, at three bills: under the minimum,
  // inside the cap, and past it.
  const quote = async (subtotal: number) => {
    const res = await request.post(`${process.env.E2E_API_URL ?? "http://localhost:8000/api/v1"}/coupons/validate`, {
      headers: { Accept: "application/json", Authorization: (await page.evaluate(() => `Bearer ${JSON.parse(localStorage.getItem("shopos-auth")!).state.accessToken}`)) },
      data: { code: COUPON.code, subtotal },
    });

    return { status: res.status(), discount: Number(((await res.json()) as { data?: { discount?: number } }).data?.discount ?? 0) };
  };
  expect((await quote(900)).status, "a bill under the minimum spend took the coupon").toBe(422);
  expect((await quote(1500)).discount).toBe(150);
  expect((await quote(5000)).discount, "the cap did not hold").toBe(200);
});

test("B13 · a promotion on one product is created and reads back as typed", async ({ page, request }) => {
  const held = await ask<Row[]>(request, "owner", "/promotions");
  if (!held.some((p) => p.name === PROMOTION.name)) {
    await page.goto("/tenant/promotions");
    await page.getByRole("button", { name: "+ New promotion" }).click();
    const form = page.getByRole("dialog", { name: "New promotion" });
    await form.getByLabel("Name", { exact: true }).fill(PROMOTION.name);
    await form.getByLabel("Discount", { exact: true }).selectOption({ label: "Percent %" });
    await form.getByLabel("Value", { exact: true }).fill(String(PROMOTION.pct));
    await form.getByLabel("Applies to", { exact: true }).selectOption({ label: "Specific products" });

    const soap = item(PROMOTION.item).name;
    await form.getByLabel("Products", { exact: true }).fill(soap);
    await form.getByRole("button", { name: new RegExp(soap) }).first().click();
    await expect(form.getByText(soap).first(), "the product did not attach to the promotion").toBeVisible();

    await form.getByRole("button", { name: "Create" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }

  await page.goto("/tenant/promotions");
  await settled(page);
  await expect(page.getByText(PROMOTION.name).first()).toBeVisible();

  const mine = (await ask<Row[]>(request, "owner", "/promotions")).find((p) => p.name === PROMOTION.name)!;
  expect(mine.type).toBe("percent");
  expect(Number(mine.value)).toBe(PROMOTION.pct);
  expect(mine.scope).toBe("product");
  expect(mine.is_active).toBe(true);
  expect((mine.product_ids as string[]).length, "the promotion names no product").toBe(1);
});

test("B14 · expenses are added and are on the list for the day and the amount typed", async ({ page, request }) => {
  const held = await ask<Row[]>(request, "owner", "/expenses?per_page=100");

  for (const e of EXPENSES) {
    if (held.some((h) => h.description === e.description)) continue; // resumed

    await page.goto("/tenant/expenses");
    await page.getByRole("button", { name: "Add expense" }).first().click();
    const form = page.getByRole("dialog", { name: "Add expense" });
    await form.getByLabel("Category *", { exact: true }).selectOption({ label: e.category });
    await form.getByLabel("Description *", { exact: true }).fill(e.description);
    await form.getByLabel("Amount *", { exact: true }).fill(String(e.amount));
    await form.getByLabel("Paid by", { exact: true }).selectOption({ label: e.paidBy });
    await form.getByRole("button", { name: "Save expense" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }

  await page.goto("/tenant/expenses");
  await settled(page);
  for (const e of EXPENSES) {
    const row = page.getByRole("row").filter({ hasText: e.description }).first();
    await expect(row, `${e.description} is not on the Expenses list`).toBeVisible();
    expect(((await row.innerText()).match(/Rs\s?[0-9,]+(?:\.[0-9]+)?/g) ?? []).map(rupees)).toContain(e.amount);
  }

  const now = await ask<Row[]>(request, "owner", "/expenses?per_page=100");
  const total = now.filter((h) => EXPENSES.some((e) => e.description === h.description)).reduce((s, h) => s + Number(h.amount), 0);
  expect(total).toBe(EXPENSES.reduce((s, e) => s + e.amount, 0));
});

test("B14 · income is added and is on the list", async ({ page, request }) => {
  const held = await ask<Row[]>(request, "owner", "/incomes?per_page=100");

  for (const i of INCOMES) {
    if (held.some((h) => h.description === i.description)) continue; // resumed

    await page.goto("/tenant/income");
    await page.getByRole("button", { name: "Add income" }).first().click();
    const form = page.getByRole("dialog", { name: "Add income" });
    await form.getByLabel("Category *", { exact: true }).selectOption({ label: i.category });
    await form.getByLabel("Description *", { exact: true }).fill(i.description);
    await form.getByLabel("Amount *", { exact: true }).fill(String(i.amount));
    await form.getByLabel("Received by", { exact: true }).selectOption({ label: i.receivedBy });
    await form.getByRole("button", { name: "Save income" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }

  await page.goto("/tenant/income");
  await settled(page);
  for (const i of INCOMES) {
    await expect(page.getByRole("row").filter({ hasText: i.description }).first()).toBeVisible();
  }
});

test("B14 · the cashbook's day is the sum of what was entered", async ({ page }) => {
  record(); // the journey exists

  const out = EXPENSES.reduce((s, e) => s + e.amount, 0); // 33,400
  const into = INCOMES.reduce((s, i) => s + i.amount, 0); // 5,000

  await page.goto("/tenant/cashbook");
  await settled(page);

  // The cashbook is a book of DAYS, not of entries: each line is a date and
  // what moved on it. So what is checked is the arithmetic.
  const figure = async (label: string) =>
    rupees((await page.getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]").innerText()).replace("Rs -", "-"));

  expect(await figure("Money in"), "other income").toBe(into);
  expect(await figure("Money out"), "expenses").toBe(out);
  expect(await figure("Net this period")).toBe(into - out);

  const today = page.getByRole("row").filter({ hasText: "Today" }).first();
  await expect(today).toContainText("Rs 5,000");
  await expect(today).toContainText("Rs 33,400");
});
