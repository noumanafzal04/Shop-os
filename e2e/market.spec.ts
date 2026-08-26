import { expect, test, type Page } from "@playwright/test";

/**
 * THE STOREFRONT, WALKED BY A STRANGER.
 *
 * Signed out on purpose — see STOREFRONT_ONLY in playwright.config.ts. A
 * customer arriving from a search result has no account, and running these
 * under an owner's session would hide anything that only breaks when
 * `isAuthenticated` is false.
 *
 * What is asserted here cannot be asserted in jsdom, which is why it is here
 * and not in a unit test: whether the page scrolls sideways, whether a count
 * beside a filter matches the list it produces, and whether pressing Add on a
 * card changes the number in the header.
 */

/** Wait for what the page is FOR, not for a fixed number of milliseconds. */
async function settled(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20_000 });
  await page.waitForLoadState("load");
}

test.describe("the aisle", () => {
  test("shows products from more than one shop", async ({ page }) => {
    await page.goto("/browse");
    await settled(page, "article");

    const cards = await page.locator("article").count();
    expect(cards, "the aisle rendered nothing at all").toBeGreaterThan(3);

    // A marketplace whose every row is the same shop is a shop page wearing a
    // marketplace's clothes.
    const shops = await page.locator('article a[href^="/shop/"]').allInnerTexts();
    const distinct = new Set(shops.map((s) => s.trim()).filter(Boolean));
    expect(distinct.size, "every product on the page belongs to one shop").toBeGreaterThan(1);
  });

  test("the count beside a filter is the number of rows clicking it produces", async ({ page }) => {
    // THE INVARIANT THIS WHOLE FEATURE RESTS ON. A rail that says
    // "Lahore (12)" over a list of nine is a rail nobody believes again, and
    // it is what happens the moment the facet query and the listing query are
    // written twice.
    await page.goto("/browse");
    await settled(page, "article");

    // ON A PHONE THE RAIL IS A SHEET. It is `hidden lg:block` beside the grid
    // and reachable through a Filters button below that, so a test that only
    // knows the desktop shape hangs for five minutes clicking at a rail that
    // is not on the screen. Both shapes, one test — because the count has to
    // be right in both.
    const openSheet = page.getByRole("button", { name: /^Filters/ });
    if (await openSheet.isVisible()) await openSheet.click();

    // `:visible`, because BOTH rails are in the DOM at once — the desktop
    // `aside` is hidden by CSS below `lg`, not unmounted, so `.first()` picked
    // the invisible copy and clicked at nothing for five minutes.
    const option = page.locator('button[aria-pressed="false"]:visible').filter({ hasText: /\d\s*$/ }).first();
    test.skip((await option.count()) === 0, "no counted filter option was offered");

    const label = (await option.innerText()).trim();
    const promised = Number(label.match(/(\d[\d,]*)\s*$/)?.[1]?.replace(/,/g, ""));
    expect(Number.isFinite(promised)).toBe(true);

    await option.click();

    // Close the sheet if that is where we are, so the grid's own count is
    // readable rather than covered by the thing that filtered it.
    const showResults = page.getByRole("button", { name: /^Show \d/ });
    if (await showResults.isVisible()) await showResults.click();

    await expect(page.locator("p", { hasText: "across every shop" })).toBeVisible();

    const said = await page.locator("p", { hasText: "across every shop" }).first().innerText();
    const shown = Number(said.match(/^(\d[\d,]*)/)?.[1]?.replace(/,/g, ""));

    expect(shown, `the rail offered ${promised} and the grid shows ${shown}`).toBe(promised);
  });

  test("a card puts something in the basket and the header says so", async ({ page }) => {
    await page.goto("/browse");
    await settled(page, "article");

    const basket = page.locator('button[aria-label^="Basket"]');
    await expect(basket).toBeVisible();

    await page.locator('article button:has-text("Add")').first().click();

    // The badge is the only feedback a customer gets that the press landed.
    await expect(basket.locator("span").first()).toHaveText("1");
  });

  test("a card opens a page of its own, with a price and a way to buy", async ({ page }) => {
    await page.goto("/browse");
    await settled(page, "article");

    await page.locator("article a[aria-label]").first().click();
    await page.waitForURL(/\/p\//);
    await settled(page, "h1");

    await expect(page.locator("h1")).not.toBeEmpty();
    // The button carries the total, so it says what pressing it costs.
    await expect(page.locator('button:has-text("Add")').first()).toContainText("Rs");
  });

  test("nothing scrolls sideways", async ({ page }) => {
    // The failure a phone shows and a desk hides. Measured rather than eyeballed
    // — 20px of sideways drift from one glow is invisible in a screenshot and
    // unmistakable under a thumb.
    for (const path of ["/shops", "/browse", "/cart", "/saved"]) {
      await page.goto(path);
      await page.waitForLoadState("load");
      await page.waitForTimeout(700);

      const drift = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(drift, `${path} scrolls sideways by ${drift}px`).toBeLessThanOrEqual(1);
    }
  });

  test("an empty basket says so instead of showing an empty page", async ({ page }) => {
    await page.goto("/cart");
    await settled(page, "h1");

    await expect(page.locator("h1")).toContainText("basket");
    await expect(page.getByRole("link", { name: /browsing/i })).toBeVisible();
  });

  test("checkout asks a stranger to sign in rather than failing at the end", async ({ page }) => {
    // The worst version of this screen takes the whole order and THEN says
    // "sign in", losing the basket on the way. It has to ask first, and it has
    // to promise the basket survives — which it does, being in this browser.
    await page.goto("/browse");
    await settled(page, "article");
    await page.locator('article button:has-text("Add")').first().click();

    await page.goto("/checkout");
    await settled(page, "h1");

    await expect(page.locator("h1")).toContainText(/sign in/i);
    await expect(page.getByText(/basket is safe/i)).toBeVisible();
  });
});
