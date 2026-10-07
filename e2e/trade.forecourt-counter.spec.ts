import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

import { API, tradeAuth } from "./api";

/**
 * THE FORECOURT'S COUNTER AND ITS TWO SHEETS.
 *
 * Found by the pump's journey (stage N), which lives its day once. These are
 * the same screens somewhere they can be opened every time — and NOTHING HERE
 * IS SAVED: no sale is rung, no rate recorded, no tanker received. Every case
 * fills a sheet to the point of pressing the button and then cancels, so the
 * station it runs on is exactly as it was.
 *
 *   "do hazaar ka daal do" could only be rung from the on-screen keypad's
 *     sheet, behind a switch that is off by default
 *   a rate could only be entered for the moment it was saved — the midnight
 *     rate needed somebody at the screen at midnight
 *   a delivery could not say which supplier it came from, and one dip
 *     without the other was dropped in silence
 *
 * A forecourt's spec. In every other trade's project it stands aside.
 */

/** Fixed, never stamped. Not counted, so nothing runs down. */
const FUEL = { name: "E2E Fuel By Rupees", price: 290 } as const;

const headers = () => tradeAuth("petroleum");

async function fuel(request: APIRequestContext): Promise<void> {
  const res = await request.get(`${API}/products?search=${encodeURIComponent(FUEL.name)}&per_page=10`, { headers: headers() });
  if (((await res.json()) as { data: Array<{ name: string }> }).data.some((p) => p.name === FUEL.name)) return;

  const made = await request.post(`${API}/products`, {
    headers: headers(),
    data: {
      item_type: "physical_product", name: FUEL.name, price: FUEL.price, is_active: true,
      description: "A fixture for selling by the money.", unit: "Litre", sold_by: "weight", track_inventory: false, tax_rate: 0,
    },
  });
  expect(made.ok(), `could not card ${FUEL.name}: ${made.status()} ${await made.text()}`).toBeTruthy();
}

const features = (page: Page) =>
  page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("shopos-auth") ?? "{}") as {
      state?: { user?: { tenant?: { features?: Record<string, boolean> } } };
    };

    return state?.state?.user?.tenant?.features ?? {};
  });

const sheet = (page: Page, title: string) => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test("fuel is sold by the money on an ordinary till — typed on the keyboard it has", async ({ page, request }, info) => {
  test.skip(info.project.name !== "trade-petroleum", "a forecourt's till");
  await fuel(request);

  await page.goto("/tenant/pos");
  const search = page.getByPlaceholder(/scan barcode or search/i).first();
  await expect(search).toBeVisible({ timeout: 30_000 });
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  if (await reset.isEnabled().catch(() => false)) await reset.click();

  await search.fill(FUEL.name);
  await page.locator("[data-pos-item]").filter({ hasText: FUEL.name }).first().click();
  await search.fill("");
  const row = page.locator("[data-cart-row]").filter({ hasText: FUEL.name }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });

  const byRupees = row.getByRole("button", { name: `Sell ${FUEL.name} by rupees` });
  await expect(byRupees, "the till has no way to sell fuel by the money").toBeVisible();
  await byRupees.click();
  const pad = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: FUEL.name }) });
  await expect(pad).toBeVisible();

  // A real keyboard types into the sheet — and a slip is taken back with Backspace.
  await page.keyboard.type("20009");
  await page.keyboard.press("Backspace");
  await expect(pad, "the keys typed on the keyboard did not reach the sheet").toContainText("≈ 6.897 Litre at Rs 290");
  await page.keyboard.press("Enter");
  await expect(pad).toBeHidden();

  // The money is the figure; the litres are what it buys.
  await expect(row).toContainText("for Rs 2,000");
  await expect(row.locator("input").first()).toHaveValue("6.897");
  await expect(page.getByText("Grand Total", { exact: true }).locator("xpath=following-sibling::div[1]")).toHaveText(/2,000/);

  // Typing litres afterwards retires the amount: the last thing said is what counts.
  const qty = row.locator("input").first();
  await qty.fill("10");
  await qty.press("Enter");
  await expect(row).not.toContainText("for Rs 2,000");

  // Nothing is rung.
  await reset.click();
  await expect(page.locator("[data-cart-row]")).toHaveCount(0);
});

test("a rate can be entered for midnight, tonight — and not for an hour that has gone", async ({ page }, info) => {
  test.skip(info.project.name !== "trade-petroleum", "a forecourt's rates");

  await page.goto("/tenant/fuel/deliveries");
  await page.getByRole("button", { name: "New rate" }).click();
  const form = sheet(page, "New rate");
  await expect(form).toBeVisible({ timeout: 15_000 });

  // Now is what it opens on, and it says Apply.
  await expect(form.getByRole("button", { name: "Now", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByRole("button", { name: "Apply", exact: true })).toBeVisible();

  const later = form.getByRole("button", { name: "At a time" });
  await expect(later, "a rate can only be entered for this very moment").toBeVisible();
  await later.click();
  const when = form.getByLabel("When the rate takes effect").last();
  await expect(when, "midnight tonight is not offered").toHaveValue(/T00:00$/);
  await expect(form).toContainText("the pumps keep today's rate until then");
  // It RECORDS, it does not apply.
  const record = form.getByRole("button", { name: "Record", exact: true });
  await expect(record).toBeVisible();
  await expect(form.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);

  // An hour that has gone is not "later" — it would apply at once while saying it would wait.
  await when.fill("2020-01-01T00:00");
  await expect(form.getByText(/That time has passed/)).toBeVisible();
  // (Disabled for more than one reason here — no fuel is picked — so the words are what is asserted.)
  await expect(record).toBeDisabled();

  // Nothing is recorded.
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toBeHidden();
});

test("a delivery says who it came from, and one dip without the other is refused on the sheet", async ({ page }, info) => {
  test.skip(info.project.name !== "trade-petroleum", "a forecourt's goods-in");

  await page.goto("/tenant/fuel/deliveries");
  const keepsSuppliers = (await features(page)).purchasing === true;
  await page.getByRole("button", { name: "Record delivery" }).click();
  const form = sheet(page, "Record delivery");
  await expect(form).toBeVisible({ timeout: 15_000 });

  // Asked where the shop keeps a supplier book — and only there.
  await expect(form.getByLabel("Who the tanker came from"), "the delivery sheet and the supplier module disagree").toHaveCount(keepsSuppliers ? 1 : 0);

  const tank = form.getByRole("combobox").first();
  const tanks = await tank.locator("option:not([disabled])").allTextContents();
  test.skip(tanks.length === 0, "this station has no tank to receive into");
  await tank.selectOption({ label: tanks[0] });
  await form.getByLabel("Invoiced litres", { exact: true }).fill("1000");
  const save = form.getByRole("button", { name: "Record", exact: true });
  await expect(save).toBeEnabled();

  // One dip says nothing by itself. It used to be dropped, and the load received on the invoice.
  await form.getByLabel("Dip before", { exact: true }).fill("500");
  await expect(form.getByTestId("one-dip")).toBeVisible();
  await expect(save, "a delivery with one dip could be recorded").toBeDisabled();
  await form.getByLabel("Dip after", { exact: true }).fill("1500");
  await expect(form.getByTestId("one-dip")).toHaveCount(0);
  await expect(save).toBeEnabled();
  await form.getByLabel("Dip before", { exact: true }).fill("");
  await expect(form.getByTestId("one-dip")).toBeVisible();

  // Nothing is received.
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toBeHidden();
});
