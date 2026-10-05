import { expect, test } from "@playwright/test";
import { API, ownerAuth } from "./api";
import { TAXED, ring, stockTaxedShelf } from "./taxedShelf";

/**
 * THE TILL'S KEYS, pressed.
 *
 * *"short key b work ni kr rhi keyboard keys."* No test had ever pressed one.
 *
 * Two faults, and this file is each of them reproduced:
 *
 *   F9 asked whether a SHIFT was open; the Pay button asks whether the till
 *   `canRing`. This shop does not require shifts, so with none open the button
 *   worked and the key did nothing. Every case below runs with NO shift open,
 *   which is how most shops trade.
 *
 *   A key that could not act did nothing at all. On an empty cart F4, F7 and
 *   F9 were silent — and "nothing happened" is how a working shortcut is
 *   reported as a broken one.
 */

test.beforeAll(async ({ request }) => {
  await stockTaxedShelf(request);

  // No shift, on purpose — and stated, not assumed.
  const open = await request.get(`${API}/pos/session`, { headers: ownerAuth() });
  if (((await open.json()) as { data: unknown }).data) {
    const report = (await (await request.get(`${API}/pos/session/report`, { headers: ownerAuth() })).json()) as { data: { drawer: { expected_cash?: number } } };
    await request.post(`${API}/pos/session/close`, {
      headers: ownerAuth(),
      data: { counted_cash: report.data.drawer.expected_cash ?? 0, notes: "e2e: keys are tested with no shift open" },
    });
  }
});

test.beforeEach(async ({ page }) => {
  // Not `openTill`, which opens a shift.
  await page.goto("/tenant/pos");
  await expect(page.getByPlaceholder(/scan barcode or search/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Open shift" }).first(), "a shift is open; this spec is about a till with none").toBeVisible();
});

const tender = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Tender / Pay" }) });

test("F2 puts the cursor in the search box", async ({ page }) => {
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("F2");
  await expect(page.getByPlaceholder(/scan barcode or search/i).first()).toBeFocused();
});

test("on an empty cart a key says why, instead of doing nothing", async ({ page }) => {
  // The notice is drawn twice — once for a phone, once for everything wider —
  // and only one is on screen. The VISIBLE one is the one being asked about.
  await page.keyboard.press("F9");
  await expect(page.getByText(/Nothing to pay for yet/).filter({ visible: true }).first()).toBeVisible();
  await expect(tender(page)).toHaveCount(0);

  await page.keyboard.press("F4");
  await expect(page.getByText(/Nothing to hold yet/).filter({ visible: true }).first()).toBeVisible();
});

test("F9 takes payment with no shift open, exactly as the Pay button does", async ({ page }) => {
  await ring(page, [TAXED.C.name]);

  // The button is enabled — this shop does not ask for a shift…
  await expect(page.getByRole("button", { name: /Tender \/ Pay/i })).toBeEnabled();

  // …so the key must open the same sheet. It used to do nothing here.
  await page.keyboard.press("F9");
  await expect(tender(page)).toBeVisible();
});

test("Alt+P is F9, for a keyboard whose F-keys are media keys", async ({ page }) => {
  await ring(page, [TAXED.C.name]);
  await page.keyboard.press("Alt+KeyP");
  await expect(tender(page)).toBeVisible();
});

test("F4 parks the ticket and F6 opens the parked ones", async ({ page }) => {
  await ring(page, [TAXED.C.name]);

  await page.keyboard.press("F4");
  const hold = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Hold this ticket" }) });
  await expect(hold).toBeVisible();
  await hold.getByRole("button", { name: "Cancel" }).click();
  await expect(hold).toBeHidden();

  await page.keyboard.press("F6");
  await expect(page.getByRole("dialog").filter({ has: page.getByRole("button", { name: /Resume|Close/ }) }).first()).toBeVisible();
});

test("the keys are printed where a cashier learns them", async ({ page }) => {
  // The legend was removed for an afternoon and asked for back the same day.
  for (const key of ["F2", "F4", "F6", "F9"]) {
    await expect(page.locator("kbd", { hasText: new RegExp(`^${key}$`) }).first(), `${key} is not printed`).toBeVisible();
  }
});
