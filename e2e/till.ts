import { expect, type Page } from "@playwright/test";

/**
 * The till, with a shift open and products actually on it.
 *
 * A till with no shift open draws its shift prompt and nothing else — no
 * catalog, no tiles, no rows. Every rule about the product list then passes
 * against a screen that has no product list, which is how the card-surface rule
 * first went green against the exact design the shop had complained about.
 */
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

  const items = page.locator("[data-pos-item]:not([disabled])");
  const available = await items.count();
  expect(available, "the till listed no sellable products").toBeGreaterThanOrEqual(want);

  for (let i = 0; i < want; i++) {
    await items.nth(i).click();
    await page.waitForTimeout(120);
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
