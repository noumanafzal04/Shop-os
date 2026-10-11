import { expect, test, type Page } from "@playwright/test";

import { ownerAuth, roomToWork } from "./api";
import { openTill } from "./till";

/**
 * A PRODUCT LIST THAT DID NOT ARRIVE IS NOT AN EMPTY SHOP.
 *
 * Found by a run that was not about the till at all: five spec files, one
 * owner, and the API's own limit of 240 requests a minute. The sixth spec
 * opened the till, its product request was answered 429 — and the till said
 * "No products match." over a shelf of forty items.
 *
 * A refusal for lack of permission has had its own words for a long time. A
 * request that FAILED did not: slowed down, an error on the server, an answer
 * that never came — each drew the same sentence as a search with no results.
 * And nothing asked again: a failed request of that kind is not retried, so
 * the till stayed that way until somebody thought to type in the box.
 */

// One owner, 240 requests a minute — see roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, ownerAuth(), 130, "/auth/me");
});

const tiles = (page: Page) => page.locator("[data-pos-item]");

/** Answer the till's product list the way a server in trouble does. */
async function refuseTheList(page: Page, status: number, message: string): Promise<void> {
  await page.route("**/api/v1/products?*", (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ success: false, message, data: null, errors: {}, meta: {} }),
    }),
  );
}

for (const trouble of [
  // `askedFrom`: which drawing of the shelf Try again is pressed on. Each has
  // its own button, and a button that asks nobody looks exactly like one that
  // does until it is pressed.
  { status: 429, message: "Too many requests. Please slow down.", name: "the server slows the till down", askedFrom: "the other view" },
  { status: 500, message: "Server Error", name: "the server fails", askedFrom: "the view it opened in" },
] as const) {
  test(`when ${trouble.name}, the till says its list did not load — and Try again brings the shelf back`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one walk is enough; it is a sentence, not a layout");
    info.setTimeout(120_000);

    await refuseTheList(page, trouble.status, trouble.message);
    await openTill(page).catch(() => {});

    const failed = page.getByRole("alert").filter({ hasText: "The product list could not be loaded." });
    await expect(failed, "a list that failed to arrive was not said to have failed").toBeVisible({ timeout: 30_000 });
    // In the server's own words…
    await expect(failed).toContainText(trouble.message);
    // …and never as an empty shop.
    await expect(page.getByText("No products match.")).toHaveCount(0);
    await expect(tiles(page)).toHaveCount(0);

    // Tiles or rows, it is the same answer: the till has two ways of drawing
    // its shelf, each with its own empty state to get this wrong in.
    const view = page.getByRole("group", { name: "Product view" });
    const drawnAs = await view.getByRole("button", { pressed: true }).innerText();
    await view.getByRole("button", { pressed: false }).click();
    await expect(view.getByRole("button", { pressed: true })).not.toHaveText(drawnAs);
    await expect(failed, "the other view of the shelf called a failed list an empty one").toBeVisible();
    await expect(page.getByText("No products match.")).toHaveCount(0);

    if (trouble.askedFrom === "the view it opened in") {
      await view.getByRole("button", { pressed: false }).click();
      await expect(view.getByRole("button", { pressed: true })).toHaveText(drawnAs);
      await expect(failed).toBeVisible();
    }

    // The line recovers; the till is asked again and the shelf is there.
    await page.unroute("**/api/v1/products?*");
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(tiles(page).first(), "Try again did not bring the product list back").toBeVisible({ timeout: 20_000 });
    await expect(failed).toHaveCount(0);
  });
}

test("a search that finds nothing still says nothing matches — that sentence is for THAT", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one walk is enough");

  await openTill(page);
  await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 });

  await page.getByPlaceholder(/scan barcode or search/i).first().fill("zzz-nothing-is-called-this-9000");
  await expect(page.getByText("No products match.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("alert").filter({ hasText: "could not be loaded" })).toHaveCount(0);
});

/**
 * …AND A SEARCH THAT WAS TURNED AWAY IS NOT THE LIST FROM BEFORE IT.
 *
 * The failure above was only ever drawn over an EMPTY shelf. A till that had
 * its shelf, and was then refused a search, went on showing the items from
 * before the cashier typed — under the new word, with "20+ results · Enter to
 * add" beneath it. Found, again, by a run that was not about the till: a
 * chemist's stage that typed a brand name while the server was slowing it
 * down, and was shown everything but.
 */
test("a search that is turned away says so — the shelf from before is not left up under the new word", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one walk is enough; it is a sentence, not a layout");

  await openTill(page);
  await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 });
  // A word the shelf really answers to: the first of the first tile's name.
  const word = (await tiles(page).first().innerText()).trim().split(/\s+/)[0];
  expect(word.length, "the first tile has no name to search for").toBeGreaterThan(1);

  // Only a SEARCH is refused from here on. The till keeps the shelf it has.
  const aSearch = (url: URL) => url.pathname.endsWith("/api/v1/products") && (url.searchParams.get("search") ?? "") !== "";
  await page.route(aSearch, (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ success: false, message: "Too many requests. Please slow down.", data: null, errors: {}, meta: { error_code: "RATE_LIMITED" } }),
    }),
  );

  const box = page.getByPlaceholder(/scan barcode or search/i).first();
  await box.fill(word);

  const failed = page.getByRole("alert").filter({ hasText: "The product list could not be loaded." });
  await expect(failed, "a search that was turned away was not said to have failed").toBeVisible({ timeout: 20_000 });
  await expect(failed).toContainText("Too many requests. Please slow down.");
  await expect(tiles(page), "the list from before the search was left on the shelf").toHaveCount(0);
  // …and nothing counts it as results, or offers Enter on it.
  await expect(page.getByTestId("search-hint")).toHaveText("That search did not go through — press Try again below.");
  await expect(page.getByText(/· Enter to add/)).toHaveCount(0);

  // The line recovers: asked again, the shelf answers the word in the box.
  await page.unroute(aSearch);
  await failed.getByRole("button", { name: "Try again" }).click();
  await expect(tiles(page).first(), "Try again did not bring the search's answer").toBeVisible({ timeout: 20_000 });
  await expect(failed).toHaveCount(0);
  await expect(tiles(page).first()).toContainText(new RegExp(word, "i"));
  await expect(page.getByTestId("search-hint")).toContainText("Enter to add");
});
