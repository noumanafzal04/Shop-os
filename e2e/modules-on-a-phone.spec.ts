import { expect, test } from "@playwright/test";

import { API, ownerAuth } from "./api";
import { everyRule, everythingHasAName, report } from "./rules";

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

/**
 * THE PAY DIALOG, WHICH IS NOW THE BIGGEST FORM ON THE SCREEN.
 *
 * It used to be an amount and a method. It now carries the account balance,
 * an amount with a Pay-full shortcut, the line saying what is left after the
 * payment, an order picker, a method, a date and a reference — and it is
 * opened from a row action, which is the one place `New supplier` above
 * cannot reach. On a phone this is the dialog most likely to push its Record
 * payment button off the bottom.
 */

/** Stable, and reused rather than remade — a fixture per run breeds strays. */
const VENDOR = "E2E Pay Vendor";

test("suppliers · pay — the dialog fits and Record payment is reachable", async ({ page, request }) => {
  // Set up through the API, not the UI: this test is about the DIALOG, and a
  // failure while creating a supplier should not read as a layout fault.
  const auth = ownerAuth();
  const existing = await request.get(`${API}/suppliers?search=${encodeURIComponent(VENDOR)}`, { headers: auth });
  const found = existing.ok() ? ((await existing.json()).data ?? []) : [];
  if (found.length === 0) {
    const made = await request.post(`${API}/suppliers`, { headers: auth, data: { name: VENDOR } });
    expect(made.ok(), `could not create the fixture supplier: ${made.status()}`).toBeTruthy();
  }

  await page.goto("/tenant/suppliers");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByPlaceholder(/Search suppliers/i).fill(VENDOR);
  await page.waitForTimeout(800);

  const row = page.locator("tr").filter({ hasText: VENDOR }).first();
  await expect(row, "the fixture supplier never appeared in the list").toBeVisible({ timeout: 10_000 });
  await row.getByRole("button", { name: /^Pay$/ }).click();

  // The denominator, same as above: no dialog, nothing measured.
  const dialog = page.getByRole("dialog").first();
  await expect(dialog, "the pay dialog never opened").toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByRole("button", { name: /Record payment/i })).toBeVisible();

  // And with an amount typed, because the "still owed after this" line only
  // exists then — it is extra height the empty dialog never shows.
  await dialog.getByLabel(/Amount/i).fill("1500");
  await page.waitForTimeout(300);

  report(await everyRule(page), "suppliers · pay dialog with an amount typed");

  // Five controls were added to this dialog at once — an order picker, a
  // method, a date, a reference, and Pay full. Two of the labels above them
  // point at a <Select>, which takes no id, so an htmlFor there would name
  // nothing at all: labelled, and unattached.
  const named = await everythingHasAName(page);
  expect(named.examined, "no controls were examined, so this proved nothing").toBeGreaterThan(6);
  report(named.findings, "suppliers · pay dialog — controls with no name");
});
