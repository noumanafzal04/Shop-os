import { expect, test } from "@playwright/test";

import { everyRule, report } from "./rules";

/**
 * THE SCREENS WITH THEIR WORK OPEN, ON A PHONE.
 *
 * `chrome.spec` walks every screen at four widths and passes — but it walks
 * them AT REST. It loads a page, measures it, and moves on. Nothing it does
 * opens a dialog, and a dialog is where these three screens do their actual
 * work: a supplier is added in one, a purchase order raised in one, a sheet of
 * labels chosen in one.
 *
 * So "suppliers is fine at 390px" has only ever meant "the suppliers TABLE is
 * fine at 390px". The form a shopkeeper types into had never been measured at
 * any width at all, and `openThingsFit` — the rule written for exactly this —
 * could not fire, because nothing was ever open when it ran.
 *
 * A dialog that overflows a phone is not a cosmetic fault: the Save button is
 * the thing that ends up off the bottom, and the screen then looks like a
 * feature that does not work.
 */

const WORK = [
  {
    name: "suppliers · new supplier",
    path: "/tenant/suppliers",
    open: /New supplier/i,
  },
  {
    name: "purchases · new purchase order",
    path: "/tenant/purchases",
    open: /New purchase order/i,
  },
];

for (const screen of WORK) {
  test(`${screen.name} — the form fits and its buttons are reachable`, async ({ page }) => {
    await page.goto(screen.path);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(600);

    const opener = page.getByRole("button", { name: screen.open }).first();
    await expect(opener, `no "${screen.open}" control on ${screen.path}`).toBeVisible({ timeout: 10_000 });
    await opener.click();

    // THE DENOMINATOR. If the dialog never opened, every rule below would
    // measure the page at rest and pass — which is the blind spot this file
    // exists to close, reproduced inside the file meant to close it.
    const dialog = page.getByRole("dialog").first();
    await expect(dialog, "the dialog never opened, so nothing below was measured").toBeVisible({ timeout: 10_000 });

    report(await everyRule(page), `${screen.name} (${screen.path}) with its dialog open`);
  });
}

test("barcode labels — the sheet and its controls fit", async ({ page }) => {
  await page.goto("/tenant/labels");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(900);

  // No dialog here: the whole screen IS the work. What it has instead is a
  // print sheet laid out in fixed millimetre columns beside a control column,
  // which is the shape that most reliably refuses to fold.
  await expect(page.getByRole("button", { name: /Print/i }).first()).toBeVisible({ timeout: 10_000 });

  report(await everyRule(page), "barcode labels (/tenant/labels)");
});
