import type { APIRequestContext } from "@playwright/test";

import { API, ownerAuth } from "./api";
import { expect, expectTheAppStillAnswers, test } from "./printWindow";
import { completeAndFetch, openTender } from "./taxedShelf";
import { fillCart, openTill } from "./till";

/**
 * AFTER A PRINT, THE SHOP CARRIES ON — at a counter.
 *
 * ── The report ───────────────────────────────────────────────────────
 *
 *     "kuch button ko click krny k bad dobara click ni ho rhy … print
 *      nikala to dobara print py click ni huwa … sells page view modal main
 *      print, refund py b aise click ni ho raha — aik br ho raha, jb dobara
 *      krta to app stuck hojati, kuch b work ni krta, koi b route."
 *
 * One print, and nothing on any screen could be pressed again until the page
 * was reloaded. Why is in `common/print.ts`; why no test saw it is in
 * `e2e/printWindow.ts`. This presses Print with the browser's real print
 * window, closes it the way a cashier does, and then asks the screen for the
 * next thing a cashier asks it for.
 */

test.describe.configure({ mode: "serial" });

const settings = async (request: APIRequestContext, patch?: Record<string, unknown>) => {
  const res = patch
    ? await request.put(`${API}/shop/settings`, { headers: ownerAuth(), data: patch })
    : await request.get(`${API}/shop/settings`, { headers: ownerAuth() });
  expect(res.ok(), `the shop's settings ${patch ? "did not save" : "could not be read"} (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Record<string, unknown> }).data;
};

let before: Record<string, unknown> = {};
let invoice = "";

test.beforeAll(async ({ request }) => {
  before = await settings(request);
  // The receipt is printed when it is asked for: every window here is one the
  // test pressed a button to get.
  await settings(request, { pos_auto_print: false });
});

test.afterAll(async ({ request }) => {
  await settings(request, { pos_auto_print: before.pos_auto_print ?? false });
});

test("at the till: the receipt prints, prints again, and the next sale can be rung", async ({ page, printWindow, request }) => {
  await openTill(page);
  expect(await fillCart(page, 1), "nothing could be rung").toBe(1);
  await openTender(page, "Card");
  invoice = String((await completeAndFetch(page, request)).invoice_number);

  // One button, three things it says: "Print receipt", "Printing…" while the
  // window is up, "Print again" once a copy has gone.
  const print = page.getByRole("button", { name: /^(Print receipt|Printing…|Print again)$/ });
  await expect(print).toHaveText("Print receipt");

  await print.click();
  await printWindow.seenAndClosed("the receipt");
  // It stops saying "Printing…" — which it said, disabled, for ever.
  await expect(print, "after one print the button never came back").toHaveText("Print again", { timeout: 10_000 });
  await expect(print).toBeEnabled();
  await expect(page.getByText(/Receipt sent to the printer/), "nothing said the receipt was sent").toBeVisible();

  await print.click();
  await printWindow.seenAndClosed("the receipt, a second time");
  await expect(print).toHaveText("Print again", { timeout: 10_000 });
  await expect(print).toBeEnabled();
  await expect(page.getByText(/Copy sent to the printer/), "nothing said the copy was sent").toBeVisible({ timeout: 10_000 });

  // …and the till is still a till.
  await page.getByRole("button", { name: "New sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" }), "New sale did nothing").toBeHidden({ timeout: 10_000 });
  expect(await fillCart(page, 1), "after a print the till would not ring another item").toBe(1);
});

test("on a sale's sheet: Print, Print again, Refund opens, the sheet closes, the menu answers", async ({ page, printWindow }) => {
  expect(invoice, "the till case above made no sale to open").not.toBe("");
  await page.goto("/tenant/sales");
  await page.getByRole("row").filter({ hasText: invoice }).first().getByRole("cell").first().click({ timeout: 20_000 });
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: invoice }) });
  await expect(sheet).toBeVisible({ timeout: 15_000 });

  const print = sheet.getByRole("button", { name: /^Print (receipt|a copy)$/ });
  for (const press of ["the first press", "the second press", "the third press"]) {
    await expect(print, `${press}: Print cannot be pressed`).toBeEnabled({ timeout: 10_000 });
    await print.click();
    await printWindow.seenAndClosed(press);
    // Said on the screen each time — a screen that has stopped drawing says nothing.
    await expect(page.getByText(/sent to the printer|it prints marked as a reprint/).last(), `${press}: nothing said it was sent`).toBeVisible({ timeout: 10_000 });
  }

  // "refund py b aise click ni ho raha"
  await sheet.getByRole("button", { name: "Return / Refund", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "Refund & restock" }), "Return / Refund opened nothing").toBeVisible({ timeout: 10_000 });
  await sheet.getByRole("button", { name: "Back", exact: true }).click();
  await expect(print, "Back did not bring the sheet's own buttons back").toBeVisible({ timeout: 10_000 });

  await page.keyboard.press("Escape");
  await expect(sheet, "the sheet would not close").toBeHidden({ timeout: 10_000 });
  await expectTheAppStillAnswers(page, "Dashboard", /\/tenant\/?$/);
});

test("the labels page prints the page itself — and is still a page afterwards", async ({ page, printWindow }) => {
  await page.goto("/tenant/labels");
  await expect(page.getByRole("heading", { name: "Barcode labels" })).toBeVisible({ timeout: 20_000 });
  const count = page.getByRole("textbox", { name: /^Labels for / }).first();
  await count.fill("3");
  await count.blur();
  await expect(page.getByTestId("label-count")).toContainText("3 labels");

  // This button prints the page it is on, there and then: the press itself
  // does not come back until the window is closed, so it is not waited for
  // before the window is.
  const print = page.getByRole("button", { name: /^Print/ }).first();
  const pressed = print.click();
  await printWindow.seenAndClosed("the label sheet");
  await pressed;

  // The count is the page's own state: it has to be drawn again to change.
  await count.fill("5");
  await count.blur();
  await expect(page.getByTestId("label-count"), "after a print the page stopped answering").toContainText("5 labels", { timeout: 10_000 });
  await expectTheAppStillAnswers(page, "Dashboard", /\/tenant\/?$/);
});
