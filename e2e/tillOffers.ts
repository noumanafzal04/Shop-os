import { expect, type Page } from "@playwright/test";
import { PLAIN_ITEM, showPane } from "./till";

/**
 * THE TILL OFFERS ONLY WHAT THE SHOP HAS — walked, in a browser, as the shop.
 *
 * Reported from a mart: *"This module is not enabled for your shop — Quote and
 * Advance, so why is it showing if not enabled?"* The till showed every control
 * to every shop and let the server do the refusing. By default four of the
 * eight trades have no Quotes module, five have no Coupons & Promotions and
 * none has Bank Card Offers.
 *
 * Two questions, asked of whichever shop is signed in:
 *
 *   1. Is each control there exactly when its module is?
 *   2. Did the server refuse ANYTHING as "module not enabled" while a cashier
 *      did an ordinary sale's worth of things? That is the one that matters:
 *      it catches the control nobody thought to list here.
 *
 * Shared by three spec files, because a spec runs under one sign-in and this
 * has to be asked as a mart, a restaurant and each of the other trades.
 */
export async function theTillOffersOnlyWhatTheShopHas(page: Page): Promise<void> {
  const refused: string[] = [];
  page.on("response", async (res) => {
    if (res.status() !== 403) return;
    const body = (await res.json().catch(() => null)) as { meta?: { error_code?: string } } | null;
    if (body?.meta?.error_code === "MODULE_DISABLED") {
      refused.push(`${res.request().method()} ${new URL(res.url()).pathname.replace(/^\/api\/v1/, "")}`);
    }
  });

  await page.goto("/tenant/pos");
  await page.waitForLoadState("networkidle").catch(() => {});

  // What THIS shop has — read from where the till itself reads it.
  const features = await page.evaluate(() => {
    const raw = localStorage.getItem("shopos-auth");
    const state = raw ? (JSON.parse(raw) as { state?: { user?: { tenant?: { features?: Record<string, boolean> } } } }) : null;

    return state?.state?.user?.tenant?.features ?? {};
  });

  if (!features.pos) {
    // A shop with no till has no till screen to offer anything on.
    await expect(page.getByPlaceholder(/scan barcode or search/i)).toHaveCount(0);
    return;
  }

  await expect(page.getByPlaceholder(/scan barcode or search/i).first()).toBeVisible({ timeout: 30_000 });

  // ── Quotes & Advances ──────────────────────────────────────────────
  const quote = page.getByRole("button", { name: /Quote/ });
  if (features.documents) await expect(quote.first(), "the shop HAS quotes and the till hides them").toBeVisible();
  else await expect(quote, "a Quote button for a shop without the module").toHaveCount(0);

  // ── Coupons & Promotions ───────────────────────────────────────────
  await page.getByRole("button", { name: /discount/i }).first().click();
  const discount = page.getByRole("dialog").filter({ hasText: /Manual discount/ });
  await expect(discount).toBeVisible();
  await expect(discount.getByText("Coupon code", { exact: true }), "the coupon box follows the module").toHaveCount(features.promotions ? 1 : 0);
  await discount.getByRole("button", { name: "Done" }).click();
  await expect(discount).toBeHidden();

  // ── A customer at the counter (the lookup is the Customers module's) ─
  await page.getByTitle(/No customer attached|Customer:/).first().click();
  const customer = page.getByRole("dialog").filter({ hasText: "Leave blank for a walk-in sale" });
  await customer.getByPlaceholder("03xx-xxxxxxx").fill("03001234567");
  await customer.getByRole("button", { name: "Done" }).click();
  await expect(customer).toBeHidden();

  // ── Something in the cart, if this shop's shelf has anything plain ──
  await showPane(page, "Products");
  const item = page.locator(PLAIN_ITEM).first();
  if (await item.isVisible().catch(() => false)) {
    await item.click();
    await page.waitForTimeout(600);
    await showPane(page, "Cart");

    const pay = page.getByRole("button", { name: /Tender \/ Pay/i });
    if (await pay.isEnabled().catch(() => false)) {
      await pay.click();
      const tender = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Tender / Pay" }) });
      await expect(tender).toBeVisible();
      // Khata writes a debt only the Customers screen can show or collect.
      await expect(tender.getByRole("button", { name: /^Khata/ }), "Khata follows the Customers module").toHaveCount(features.customers ? 1 : 0);
      await page.waitForTimeout(1200);
      await tender.getByRole("button", { name: "Close" }).click();
    }
  }

  await page.waitForTimeout(1500);

  // ── And through all of that, nothing bounced ───────────────────────
  expect(refused, "the till asked for a module this shop does not have").toEqual([]);
}
