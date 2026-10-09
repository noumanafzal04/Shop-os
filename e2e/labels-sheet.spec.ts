import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, ownerAuth } from "./api";

/**
 * BARCODE LABELS — the products on one side, the paper on the other.
 *
 * What the screen could not say before, and what this holds in place:
 *
 *   how many stickers fit on a sheet, how many sheets a run takes, and what is
 *     on each one — it previewed "one of each product"
 *   that a carton is its own sticker, with the carton's barcode and price
 *   which settings are in force — two were under Settings, six behind a
 *     collapsed panel here; they are one set now, on this page, saved for the shop
 *   and what prints is the sheets the screen paged through, every one of them
 *
 * Two fixtures, carded once and left: nothing here sells or counts anything.
 */

const BISCUIT = { name: "E2E Label Biscuit", barcode: "8961230000011", price: 50, carton: "8961230000028" };
const SOAP = { name: "E2E Label Soap", barcode: "8961230000035", price: 120 };

type Row = Record<string, unknown>;

async function shelf(request: APIRequestContext): Promise<void> {
  const res = await request.get(`${API}/products?search=${encodeURIComponent("E2E Label")}&per_page=20`, { headers: ownerAuth() });
  const held = ((await res.json()) as { data: Array<{ name: string }> }).data ?? [];

  const make = async (data: Row) => {
    const made = await request.post(`${API}/products`, { headers: ownerAuth(), data });
    expect(made.ok(), `the fixture could not be carded (${made.status()} ${await made.text()})`).toBeTruthy();
  };

  if (!held.some((p) => p.name === BISCUIT.name)) {
    await make({
      item_type: "physical_product", name: BISCUIT.name, price: BISCUIT.price, barcode: BISCUIT.barcode, is_active: true,
      description: "A fixture for the label sheet.", tax_rate: 0, track_inventory: false,
      units: [{ name: "Carton", factor: 24, price: 1080, barcode: BISCUIT.carton }],
    });
  }
  if (!held.some((p) => p.name === SOAP.name)) {
    await make({
      item_type: "physical_product", name: SOAP.name, price: SOAP.price, barcode: SOAP.barcode, is_active: true,
      description: "A fixture for the label sheet.", tax_rate: 0, track_inventory: false,
    });
  }
}

async function settings(request: APIRequestContext, patch?: Row): Promise<Row> {
  const res = patch
    ? await request.put(`${API}/shop/settings`, { headers: ownerAuth(), data: patch })
    : await request.get(`${API}/shop/settings`, { headers: ownerAuth() });
  expect(res.ok(), `shop settings ${patch ? "not saved" : "unreadable"} (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Row }).data;
}

/** How a label has always printed: the page starts from the shop's own choices, so they are put back first. */
const AS_ALWAYS = {
  label_stock: "50x25", label_paper: "sheet", barcode_show_name: true, barcode_show_price: true,
  label_show_digits: true, label_show_shop: false, label_show_pack: false, label_cut_lines: true,
};

const paper = (page: Page) => page.getByTestId("label-paper");
const count = (page: Page) => page.getByTestId("label-count");

async function howMany(page: Page, of: string, n: number): Promise<void> {
  const box = page.getByRole("textbox", { name: `Labels for ${of}`, exact: true }).first();
  await box.fill(String(n));
  await box.blur();
}

test("a run of labels is laid out on the sheets it will print on — a carton is its own sticker, and the settings are on the page", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "the sheet beside the list is the desktop layout; the arithmetic is the same everywhere");

  await shelf(request);
  await settings(request, AS_ALWAYS);

  // ── from the products list, carrying what it was narrowed to ──────
  await page.goto("/tenant/products");
  await page.getByPlaceholder("Search name or SKU…").fill("E2E Label");
  await expect(page.getByRole("row").filter({ hasText: BISCUIT.name })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Labels", exact: true }).click();
  await expect(page).toHaveURL(/\/tenant\/labels\?search=E2E(%20|\+)Label/);
  await expect(page.getByRole("heading", { name: "Barcode labels" })).toBeVisible();

  // Every setting is on this page — each a drop-down — and it says whose it is.
  const on = page.getByTestId("label-settings");
  await expect(on.getByLabel("Sticker size")).toHaveValue("50x25");
  await expect(on.getByLabel("Printed on")).toHaveValue("sheet");
  await expect(page.getByTestId("label-fields")).toHaveText(/Product name, Price, Barcode number, Cut lines/);
  await expect(page.getByTestId("label-settings-state")).toContainText("Saved for your shop");
  await expect(count(page)).toHaveText("30 fit on a sheet (3 across, 10 down)");

  // ── a carton is its own row, and its own sticker ──────────────────
  await expect(page.getByText("Carton of 24", { exact: true }), "a pack with its own barcode has no label of its own").toBeVisible({ timeout: 15_000 });
  await howMany(page, BISCUIT.name, 40);
  await howMany(page, `${BISCUIT.name} Carton of 24`, 25);
  await howMany(page, SOAP.name, 8);

  // 73 labels at 30 a sheet.
  await expect(count(page)).toHaveText("30 fit on a sheet (3 across, 10 down) · 73 labels · 3 sheets");
  await expect(page.getByTestId("label-page")).toHaveText("Sheet 1 of 3");
  await expect(paper(page).locator(".lbl")).toHaveCount(30);
  await expect(page.getByRole("button", { name: "Previous sheet" })).toBeDisabled();

  // Sheet two: the last ten biscuits, then the cartons — at the carton's price, under the carton's code.
  await page.getByRole("button", { name: "Next sheet" }).click();
  await expect(page.getByTestId("label-page")).toHaveText("Sheet 2 of 3");
  await expect(paper(page).locator(".lbl")).toHaveCount(30);
  const carton = paper(page).locator(".lbl").filter({ hasText: BISCUIT.carton }).first();
  await expect(carton, "the carton's sticker does not carry the carton's price").toContainText("Rs 1,080");
  await expect(carton).toContainText("Carton of 24");

  // Sheet three is part-full, and there is no sheet four.
  await page.getByRole("button", { name: "Next sheet" }).click();
  await expect(page.getByTestId("label-page")).toHaveText("Sheet 3 of 3");
  await expect(paper(page).locator(".lbl")).toHaveCount(13);
  await expect(page.getByRole("button", { name: "Next sheet" })).toBeDisabled();

  // ── a part-used sheet goes back in the printer ────────────────────
  await page.getByLabel("Stickers already used on the first sheet").fill("4");
  await page.getByRole("button", { name: "Previous sheet" }).click();
  await page.getByRole("button", { name: "Previous sheet" }).click();
  await expect(page.getByTestId("label-page")).toHaveText("Sheet 1 of 3");
  await expect(paper(page).locator("[data-used]"), "the used stickers are not left blank on the first sheet").toHaveCount(4);
  await expect(paper(page).locator(".lbl")).toHaveCount(26);
  await page.getByLabel("Stickers already used on the first sheet").fill("0");

  // ── the sheet is shown as large as the screen allows, and at its real size on request ──
  const a4 = 210 * (96 / 25.4);
  const fitted = (await paper(page).boundingBox())!.width;
  expect(fitted, "the sheet is drawn far smaller than the room it has").toBeGreaterThan(a4 * 0.6);
  const real = page.getByRole("button", { name: /^Actual size/ });
  if (fitted < a4 - 2) {
    await real.click();
    expect(Math.round((await paper(page).boundingBox())!.width), "actual size is not the paper's own width").toBe(Math.round(a4));
    await page.getByRole("button", { name: "Fit to screen" }).click();
  }

  // ── what prints is what was paged through: every sheet ────────────
  await expect(page.locator("#label-sheet .paper-page"), "the print run is not the sheets the screen showed").toHaveCount(3);
  await expect(page.locator("#label-sheet .lbl")).toHaveCount(73);

  // ── a setting changed here is the shop's, and the sheet follows it ─
  await on.getByLabel("Sticker size").selectOption("38x25");
  await expect(count(page)).toHaveText("40 fit on a sheet (4 across, 10 down) · 73 labels · 2 sheets");
  await expect.poll(async () => (await settings(request)).label_stock, { message: "the sticker size chosen here was not saved for the shop" }).toBe("38x25");

  // The price off, and the pack line on: a single's label then says what a
  // carton holds, and still not what it costs.
  await page.getByTestId("label-fields").click();
  await page.getByRole("checkbox", { name: "Price", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Pack size", exact: true }).check();
  await page.getByRole("heading", { name: "Barcode labels" }).click(); // away from the list, which closes it
  await expect(page.getByTestId("label-fields")).not.toContainText("Price");
  const single = paper(page).locator(".lbl").first();
  await expect(single, "the pack line was asked for and is not on the label").toContainText("Carton = 24");
  await expect(single, "the price was switched off and is still on the label").not.toContainText("Rs");
  await expect.poll(async () => (await settings(request)).barcode_show_price).toBe(false);

  // A roll is one sticker at a time.
  await on.getByLabel("Printed on").selectOption("roll");
  await expect(count(page)).toContainText("73 labels off the roll");
  await expect(page.getByTestId("label-page")).toHaveText("Label 1 of 73");
  await expect(paper(page).locator(".lbl")).toHaveCount(1);
  await expect(page.locator("#label-sheet .paper-page")).toHaveCount(73);

  // …and all of it is still the shop's on the next visit.
  await page.reload();
  await expect(page.getByTestId("label-settings").getByLabel("Sticker size")).toHaveValue("38x25", { timeout: 15_000 });
  await expect(page.getByTestId("label-settings").getByLabel("Printed on")).toHaveValue("roll");
  await expect(page.getByTestId("label-fields")).toHaveText(/^Product name, Barcode number, Pack size, Cut lines/);

  await settings(request, AS_ALWAYS);
});
