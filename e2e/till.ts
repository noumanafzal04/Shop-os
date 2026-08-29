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

/**
 * The shelf fixture's own products, by the name `shelf.setup` gives them.
 *
 * Kept beside PLAIN_ITEM because the two are one rule: fill a cart from stock
 * this suite controls, never from whatever a sibling spec left lying about.
 */
export const SHELF_ITEM = /E2E Shelf Item/;

export async function openTill(page: Page): Promise<void> {
  await page.goto("/tenant/pos");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);

  // ── Are we even signed in? ──────────────────────────────────────────
  //
  // Access tokens live 60 minutes and the browser holds one in localStorage. A
  // suite that runs long — competing with a backend run on the same machine, say
  // — crosses that line mid-flight, and every screen after it is the signed-out
  // shell. What that produced was thirteen failures reading "no product cards on
  // screen", "the till listed no sellable products", and an a11y ratchet saying
  // `2/5 unnamed` on EVERY screen: the same two controls everywhere, because
  // every screen was the same page.
  //
  // None of it was about the product. A precondition that cannot hold has to say
  // WHICH precondition, or the suite spends an afternoon accusing the till.
  if (/\/signin/.test(page.url())) {
    throw new Error(
      "signed out at the till — the saved session expired mid-run (tokens live 60 "
      + "minutes). Nothing after this point is evidence about the product.",
    );
  }

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
   *
   * ── AND ONLY THE SHELF'S OWN ITEMS ───────────────────────────────────
   *
   * "Any plain product" is not a shelf, it is whatever the database happens to
   * hold — and by now that is twenty `E2E …` products left behind by other
   * specs, every one of the strays sitting at ZERO stock while the shelf's own
   * fourteen hold 240 each.
   *
   * `E2E Family Deal` is the one that bit: a DEAL is not sized, so it looks
   * plain, and this helper rang it. Offline that works — the till sells from
   * the mirror it pulled at boot — and then the server refuses the sync,
   * correctly, because the pizza inside the deal has none left:
   *
   *     Not enough E2E Deal Pizza (Large): only 0 in stock.
   *
   * Two projects failed on that and neither was about deals, sizes or stock.
   * The one before them had sold the last of it and passed; the one after ran
   * `deal-size.spec` first, which restocks, and passed too. A suite whose
   * result depends on which project ran first is not measuring the product.
   *
   * So this asks for the shelf BY NAME. The shelf is topped up before every
   * run and belongs to nobody else.
   */
  const items = page.locator(PLAIN_ITEM).filter({ hasText: SHELF_ITEM });
  const available = await items.count();
  expect(
    available,
    `the till listed no sellable shelf items (looking for "${SHELF_ITEM}"). `
      + "The shelf fixture tops these up before every run — if this is zero the "
      + "setup project did not run, or the till's catalog has not arrived yet.",
  ).toBeGreaterThanOrEqual(want);

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
