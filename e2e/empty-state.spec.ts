import { expect, test, type Page } from "@playwright/test";

/**
 * "NOTHING HERE YET" HAS TO BE SOMEWHERE THE SHOP CAN SEE IT.
 *
 * Every list on the site is a table inside `overflow-x-auto`, and the table
 * carries a `min-w-[…rem]` so its columns stay readable — 48rem is typical.
 * The empty-state row is a single `<td colSpan={n} class="text-center">`, so
 * its message is centred in the TABLE: at 384px, in a window 390px wide.
 *
 * What a shop sees on a phone is a white box with nothing in it, and no
 * indication that the sentence explaining why is sitting off to the right.
 * They cannot scroll to it either without realising the box scrolls at all.
 *
 * The list is emptied here by blanking the `data` array on the way back from
 * the API — the same screen, the same envelope, no rows. Filling a filter with
 * nonsense would test the filter as much as the layout, and some of these
 * screens have no text filter at all.
 */

/** Screen → the request whose rows to blank. */
const LISTS: Array<{ path: string; api: RegExp }> = [
  { path: "/tenant/purchases", api: /\/api\/v1\/purchase-orders(\?|$)/ },
  { path: "/tenant/suppliers", api: /\/api\/v1\/suppliers(\?|$)/ },
  { path: "/tenant/customers", api: /\/api\/v1\/customers(\?|$)/ },
  { path: "/tenant/transfers", api: /\/api\/v1\/inventory\/transfers(\?|$)/ },
  { path: "/tenant/coupons", api: /\/api\/v1\/coupons(\?|$)/ },
  { path: "/tenant/sales", api: /\/api\/v1\/sales(\?|$)/ },
];

/**
 * Blank the rows, and COUNT that it happened.
 *
 * The first version returned nothing, and two of the six patterns were wrong —
 * `/api/v1/tenant/sales` where the client asks for `/api/v1/sales`. Nothing was
 * intercepted, the screen drew its real rows, and the spec reported "never drew
 * an empty-state row" as if the SCREEN were at fault. A pattern that matches
 * nothing must not read as a screen with nothing to say.
 */
async function serveNoRows(page: Page, api: RegExp): Promise<() => number> {
  let hits = 0;

  await page.route(api, async (route) => {
    hits += 1;
    const response = await route.fetch();
    let body: unknown;

    try {
      body = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }

    const envelope = body as { data?: unknown };
    if (Array.isArray(envelope.data)) envelope.data = [];
    else if (envelope.data && Array.isArray((envelope.data as { data?: unknown }).data)) {
      (envelope.data as { data: unknown[] }).data = [];
    }

    await route.fulfill({ response, json: envelope });
  });

  return () => hits;
}

/**
 * Where the empty-state SENTENCE actually is on screen.
 *
 * A Range over the text, not the cell: the cell is as wide as the table by
 * definition, so measuring it can only ever say "yes, the table is wide".
 */
function messageBox(cell: HTMLElement) {
  const range = document.createRange();
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  let best: DOMRect | null = null;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.textContent ?? "").trim()) continue;
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (!best || rect.width > best.width) best = rect;
  }

  return best && { left: Math.round(best.left), right: Math.round(best.right), text: (cell.textContent ?? "").trim().slice(0, 60) };
}

let measured = 0;

for (const { path, api } of LISTS) {
  test(`${path} — its "nothing here" message is on screen`, async ({ page }) => {
    const hits = await serveNoRows(page, api);
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(900);

    // Before anything else: did this screen's list request actually go through
    // the pattern above? If not, the emptiness below is not this test's doing
    // and nothing it measures means what it says.
    expect(hits(), `${path} never asked for the list this test blanks — the pattern is wrong`)
      .toBeGreaterThan(0);

    const cell = page.locator("td[colspan]").filter({ hasNotText: /^\s*$/ }).first();
    await expect(cell, `${path} never drew an empty-state row to measure`)
      .toBeVisible({ timeout: 10_000 });

    const box = await cell.evaluate(messageBox);
    expect(box, `${path}'s empty-state cell had no text to measure`).not.toBeNull();

    measured += 1;
    const width = page.viewportSize()!.width;

    expect(
      box!.left,
      `${path}: "${box!.text}" starts at ${box!.left}px, off the left of a ${width}px screen`,
    ).toBeGreaterThanOrEqual(0);

    expect(
      box!.right,
      `${path}: "${box!.text}" runs to ${box!.right}px on a ${width}px screen — the shop sees an empty box`,
    ).toBeLessThanOrEqual(width);
  });
}

test.afterAll(() => {
  // The denominator. Six screens are asked; a run that measured none of them
  // proved nothing and must not read as green.
  if (measured === 0) throw new Error("no empty state was measured on any screen");
});
