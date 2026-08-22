import { expect, type Page } from "@playwright/test";

/**
 * The till, with a shift open and products actually on it.
 *
 * A till with no shift open draws its shift prompt and nothing else — no
 * catalog, no tiles, no rows. Every rule about the product list then passes
 * against a screen that has no product list, which is how the card-surface rule
 * first went green against the exact design the shop had complained about.
 */
/**
 * A tile or row that adds a line when you press it.
 *
 * Exported because it was written twice — here and in `chrome.spec` — and the
 * copy that did not know about `data-pos-sized` clicked a sized product, opened
 * the size sheet, and then spent its whole five-minute timeout being blocked by
 * an overlay it never asked for. Same fault as the product code it tests: one
 * question, two implementations, only one of them current.
 *
 * `:not([data-pos-sized])` because a product with sizes ASKS before it adds, so
 * it is not a plain tile. `size-picker.spec` is the one place that wants those,
 * and it reaches them by name.
 */
export const PLAIN_ITEM = "[data-pos-item]:not([disabled]):not([data-pos-sized])";

export async function openTill(page: Page): Promise<void> {
  await page.goto("/tenant/pos");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);

  const start = page.getByRole("button", { name: /open (the )?(shift|drawer)|start shift/i }).first();
  if (await start.isVisible().catch(() => false)) {
    await start.click();
    // The float dialog, if the shop asks for one.
    const confirm = page.getByRole("button", { name: /open|start|confirm/i }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(600);
}

/**
 * Ring `want` DISTINCT products, and return how many lines actually landed.
 *
 * Distinct on purpose: tapping one product nine times makes one line with
 * quantity nine, which is not the cart anybody was looking at. The count comes
 * back so the caller can assert on it — a cart that quietly took fewer items
 * than it was given turns every later assertion into a description of
 * something else.
 */
export async function fillCart(page: Page, want: number): Promise<number> {
  await showPane(page, "Products");

  /**
   * PLAIN products only.
   *
   * A product with sizes adds nothing when you tap it — it asks which size
   * first. This helper exists to get N lines into a cart for specs that are
   * about something else entirely (a cash sale reaching the server, a full cart
   * showing every line), and the moment the shelf fixture gained a sized product
   * those specs started answering size sheets. One of them then met a sheet whose
   * every size was out of stock, could not dismiss it, and spent its full
   * five-minute timeout being blocked by a modal.
   *
   * A fixture addition must not change what other specs exercise. `data-pos-sized`
   * is on the tile and the row for exactly this, and `size-picker.spec` reaches
   * the sized product by name.
   */
  const items = page.locator(PLAIN_ITEM);
  const available = await items.count();
  expect(available, "the till listed no sellable products").toBeGreaterThanOrEqual(want);

  for (let i = 0; i < want; i++) {
    await items.nth(i).click();
    await page.waitForTimeout(120);

    // A safety net, not the plan. The selector above should mean no sheet ever
    // opens here; if one does, it must be cleared or every later click in this
    // loop is intercepted by the overlay. Escape AND the dialog's own Close,
    // because a sheet whose sizes are all out of stock has nothing to click.
    const sheet = page.getByRole("dialog");
    if (await sheet.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      if (await sheet.isVisible().catch(() => false)) {
        await sheet.getByRole("button", { name: "Close" }).first().click().catch(() => {});
      }
      await page.waitForTimeout(150);
    }
  }

  await showPane(page, "Cart");
  return page.locator("[data-cart-row]").count();
}

/**
 * A phone shows ONE pane at a time behind a Products / Cart switch. On anything
 * wider the switch is not rendered at all, so this is a no-op there.
 */
export async function showPane(page: Page, which: "Products" | "Cart"): Promise<void> {
  const tab = page.getByRole("button", { name: new RegExp(`^${which}`) }).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(300);
  }
}
