import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, ownerAuth, removeProductsNamed, roomToWork } from "./api";
import { openTill } from "./till";

/**
 * A CARTON CARRIES MORE THAN ONE CODE — through the form, and at the till.
 *
 * A carton of 24 biscuits, Rs 50 a piece and Rs 1,080 the carton. It has the
 * maker's outer code on it and a distributor's sticker with another.
 *
 *   The form gave a pack room for ONE barcode. The second had one other place
 *   to go — "Additional barcodes", whose own hint said "e.g. a different
 *   supplier's pack" — and every code there means a single piece. Scanned, the
 *   carton rang one biscuit: Rs 50 for Rs 1,080.
 *
 *   And every save of an item gave its packs new ids, so a till that already
 *   had the carton on its bill was refused the sale after somebody corrected
 *   the item's description.
 *
 * One fixture, fixed names and codes, cleared before it is carded.
 */

const BISCUIT = { name: "E2E Pack Biscuits", barcode: "8961230000103", price: 50 };
const CARTON = { name: "Carton", factor: 24, price: 1080, barcode: "8961230000110" };
const STICKER = "8961230000127";
const OLD_ART = "8961230000134";

type Row = Record<string, unknown>;
type Pack = { id: string; name: string; barcode: string | null; codes?: Array<{ barcode: string }> };

async function card(request: APIRequestContext): Promise<string> {
  await removeProductsNamed(request, "E2E Pack ");
  const made = await request.post(`${API}/products`, {
    headers: ownerAuth(),
    data: {
      item_type: "physical_product", name: BISCUIT.name, price: BISCUIT.price, barcode: BISCUIT.barcode, is_active: true,
      description: "A fixture for a pack's codes.", tax_rate: 0, track_inventory: false,
      units: [{ name: CARTON.name, factor: CARTON.factor, price: CARTON.price, barcode: CARTON.barcode }],
    },
  });
  expect(made.ok(), `the fixture could not be carded (${made.status()} ${await made.text()})`).toBeTruthy();

  return String(((await made.json()) as { data: Row }).data.id);
}

async function packs(request: APIRequestContext, id: string): Promise<Pack[]> {
  const res = await request.get(`${API}/products/${id}`, { headers: ownerAuth() });
  expect(res.ok()).toBeTruthy();

  return ((await res.json()) as { data: { units: Pack[] } }).data.units;
}

// One owner, 240 requests a minute — see roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, ownerAuth(), 130, "/auth/me");
});

const box = (page: Page) => page.getByPlaceholder(/scan barcode or search/i).first();
const bill = (page: Page) => page.locator("[data-cart-row]");

/** As a scanner does: every character, then Enter. */
async function scan(page: Page, code: string): Promise<void> {
  await box(page).pressSequentially(code, { delay: 5 });
  await box(page).press("Enter");
}

async function emptyBill(page: Page): Promise<void> {
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  if (await reset.isEnabled().catch(() => false)) await reset.click();
  await expect(bill(page)).toHaveCount(0);
}

test("a second code is put on the carton in the form — and at the till it rings the carton, not a piece", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "one walk of the form and the till is enough; their fit is the chrome spec's");
  info.setTimeout(180_000);

  const id = await card(request);
  const [carton] = await packs(request, id);

  // ── the form ──────────────────────────────────────────────────────
  await page.goto(`/tenant/products/${id}/edit`);
  const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Edit ${BISCUIT.name}` }) });
  await expect(form).toBeVisible({ timeout: 20_000 });
  await form.getByRole("button", { name: "Codes & packs", exact: true }).click();

  // "Additional barcodes" says what it is for — and that a carton's code is
  // NOT it. It used to say "e.g. a different supplier's pack".
  await expect(form.getByText("A code on a carton or a box goes on that pack, under Pack sizes.")).toBeVisible();
  await expect(form.getByText(/different supplier's pack of the same item/)).toHaveCount(0);

  const pack = form.getByTestId("pack-1");
  await expect(pack.getByLabel("Pack 1: barcode", { exact: true })).toHaveValue(CARTON.barcode);
  await expect(pack.getByText("Another code on the Carton?")).toBeVisible();

  // Two more codes, on the carton.
  await pack.getByRole("button", { name: "+ Add a code" }).click();
  await pack.getByLabel("Pack 1: another barcode 1", { exact: true }).fill(STICKER);
  await pack.getByRole("button", { name: "+ Add a code" }).click();
  await pack.getByLabel("Pack 1: another barcode 2", { exact: true }).fill(OLD_ART);
  await expect(pack.getByText("Also on the Carton:")).toBeVisible();

  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form).toBeHidden({ timeout: 20_000 });

  // Saved ON THE PACK, and it is the same pack it was: the save did not
  // replace it with a new one under a new id.
  const [after] = await packs(request, id);
  expect((after.codes ?? []).map((c) => c.barcode)).toEqual([STICKER, OLD_ART]);
  expect(after.id, "saving the item gave its carton a new id").toBe(carton.id);

  // And they are there when the form is opened again.
  await page.goto(`/tenant/products/${id}/edit`);
  await expect(form).toBeVisible({ timeout: 20_000 });
  await form.getByRole("button", { name: "Codes & packs", exact: true }).click();
  await expect(form.getByLabel("Pack 1: another barcode 1", { exact: true })).toHaveValue(STICKER);
  await expect(form.getByLabel("Pack 1: another barcode 2", { exact: true })).toHaveValue(OLD_ART);
  // Not among the piece's own.
  await expect(form.getByText("None yet.")).toBeVisible();

  // ── the till ──────────────────────────────────────────────────────
  await openTill(page);
  await emptyBill(page);

  await scan(page, STICKER);
  const line = bill(page).filter({ hasText: BISCUIT.name });
  await expect(line, "the carton's second code rang nothing").toHaveCount(1, { timeout: 15_000 });
  // A CARTON, at the carton's price. This scan used to be Rs 50.
  await expect(line).toContainText("Carton");
  await expect(line, "the carton's second code rang a single piece").toContainText("1,080");

  // Its other code is the same carton: one line, two of them.
  await scan(page, OLD_ART);
  await expect(bill(page)).toHaveCount(1);
  await expect(line).toContainText("2,160");

  // The piece's own code is still a piece, on a line of its own.
  await scan(page, BISCUIT.barcode);
  await expect(bill(page)).toHaveCount(2, { timeout: 15_000 });
  await expect(bill(page).filter({ hasText: BISCUIT.name }).filter({ hasNotText: "Carton" })).toContainText("50");

  await emptyBill(page);
});

test("a code cannot be the piece's and the carton's — and the form says which box is wrong", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "one walk is enough");

  const id = await card(request);

  await page.goto(`/tenant/products/${id}/edit`);
  const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Edit ${BISCUIT.name}` }) });
  await expect(form).toBeVisible({ timeout: 20_000 });
  await form.getByRole("button", { name: "Codes & packs", exact: true }).click();

  // The item's own barcode, typed again as one of its carton's.
  const pack = form.getByTestId("pack-1");
  await pack.getByRole("button", { name: "+ Add a code" }).click();
  await pack.getByLabel("Pack 1: another barcode 1", { exact: true }).fill(BISCUIT.barcode);
  await form.getByRole("button", { name: "Save changes" }).click();

  // Refused, in words that say why — and nothing was saved.
  await expect(form.getByText(`Barcode ${BISCUIT.barcode} is this item's own barcode — that one means a single piece.`).first()).toBeVisible({ timeout: 15_000 });
  await expect(form).toBeVisible();
  expect(((await packs(request, id))[0].codes ?? []).length, "a refused code was saved on the carton").toBe(0);
});
