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
