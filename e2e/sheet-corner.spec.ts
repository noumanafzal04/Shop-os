import { expect, test, type Page } from "@playwright/test";

import { nothingIsWrittenUnderAButton, report } from "./rules";

/**
 * A SHEET'S ✕ COVERS NOTHING.
 *
 * ── The report ───────────────────────────────────────────────────────
 *
 *     "Modal cross ✕ button ke piche text bhi cut raha hai, bohat jagah."
 *
 * An order's stage, at the right-hand end of the sheet's first row, read
 * "Waiting to be conf…" with the ✕ on top of the rest. On a phone the last
 * word of "Adjust stock — E2E API Sized / Small 7"" was under it. The ✕ hangs
 * on the sheet's corner now (see components/ui/modal), outside the room the
 * content has — so this opens the sheets that showed it, and three kinds that
 * did not, and asks of each one whether anything is written under any control
 * in it.
 */

/** A sheet is open, and its ✕ is on the glass where a thumb can reach it. */
async function theSheetAndItsClose(page: Page) {
  // The sheet that is OPEN. The Appearance panel is a dialog too, and it is
  // always in the page — parked off the right-hand edge until it is asked for.
  const sheet = page.locator('.modal [role="dialog"]').last();
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  // Its own ✕ — a sheet may also have a "Close" among its buttons at the foot.
  const close = sheet.locator(':scope > button[aria-label="Close"]');
  await expect(close).toBeVisible();
  // Settled: a sheet that is still filling in moves its own first row.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(300);

  const box = (await close.boundingBox())!;
  const glass = page.viewportSize()!;
  expect(box.x, "the ✕ hangs off the left of the screen").toBeGreaterThanOrEqual(0);
  expect(box.y, "the ✕ hangs off the top of the screen").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "the ✕ hangs off the right of the screen").toBeLessThanOrEqual(glass.width);
  expect(Math.min(box.width, box.height), "the ✕ is too small for a thumb").toBeGreaterThanOrEqual(36);

  return { sheet, close };
}

const SHEETS: Array<{ name: string; open: (page: Page) => Promise<void> }> = [
  {
    // The one in the report: a stage chip at the right-hand end of the first row.
    name: "an order",
    open: async (page) => {
      // The past, which is a table whatever today holds.
      await page.goto("/tenant/orders?show=past");
      // A row with an order IN it — the rows drawn while the list loads are rows too.
      const row = page.getByRole("row").filter({ hasText: /ORD-\d+/ }).first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      await row.getByRole("button", { name: /ORD-\d+/ }).click();
    },
  },
  {
    // A title long enough to reach the corner on a phone.
    name: "a stock adjustment",
    open: async (page) => {
      await page.goto("/tenant/inventory");
      await page.getByRole("button", { name: /^Adjust/ }).first().click({ timeout: 20_000 });
    },
  },
  {
    // A sheet with its own header band (ModalForm).
    name: "a new customer",
    open: async (page) => {
      await page.goto("/tenant/customers");
      await page.getByRole("button", { name: /Add customer|New customer/ }).first().click({ timeout: 20_000 });
    },
  },
  {
    name: "a sale",
    open: async (page) => {
      await page.goto("/tenant/sales");
      const row = page.getByRole("row").filter({ hasText: /INV-\d+/ }).first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      await row.getByRole("cell").first().click();
    },
  },
  {
    name: "a new expense",
    open: async (page) => {
      await page.goto("/tenant/expenses");
      await page.getByRole("button", { name: /Add expense|New expense|Record expense/ }).first().click({ timeout: 20_000 });
    },
  },
];

for (const { name, open } of SHEETS) {
  test(`the sheet for ${name}: nothing is written under its ✕, and the ✕ closes it`, async ({ page }) => {
    await open(page);
    const { sheet, close } = await theSheetAndItsClose(page);

    report(await nothingIsWrittenUnderAButton(page), `the sheet for ${name}`);

    await close.click();
    await expect(sheet, "the ✕ did not close the sheet").toBeHidden({ timeout: 10_000 });
  });
}
