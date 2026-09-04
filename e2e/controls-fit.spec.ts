import { expect, test } from "@playwright/test";

/**
 * A CONTROL'S LABEL IS NOT A PARAGRAPH, AND A TOOLBAR IS NOT A PAGE.
 *
 * Both rules here come from a shop holding a real device, and neither was
 * visible to anything the suite already had.
 *
 * ── What the shop saw ───────────────────────────────────────────────────
 *
 * "purchase, supplier like this types screen mobile response — button not
 * showing good." At 390px "+ New purchase order" was a THREE-LINE blue slab
 * 250px tall, and "+ New supplier" a two-line one: sixteen screens put a
 * heading and a primary action in one `justify-between` row, and without
 * `whitespace-nowrap` the button is a flex item that shrinks until its label
 * breaks mid-phrase.
 *
 * "POS screen bottom footer responsive only for mobile, and also for tab when
 * vertical; for landscape it's good." The till's action bar wrapped to three
 * rows at 390 and FOUR at 360 — 145px and 191px, a fifth to a quarter of the
 * screen, taken from the cart.
 *
 * ── Why nothing caught them ─────────────────────────────────────────────
 *
 * `chrome.spec` walks every screen at four widths and asks whether anything is
 * covered, off the edge, or too small to tap. A wrapped button is none of
 * those: it is fully visible, fully inside the viewport, and enormous. The bar
 * likewise. "Nothing is broken" and "this is usable" are different questions,
 * and only the first was being asked.
 *
 * jsdom cannot ask either — it has no layout engine, so every line box here
 * would measure zero.
 */

/** Screens whose header carries a primary "+ …" action. */
const HEADERS = [
  "/tenant/suppliers",
  "/tenant/purchases",
  "/tenant/customers",
  "/tenant/branches",
  "/tenant/coupons",
  "/tenant/transfers",
];

/**
 * How many LINE BOXES a control's own text occupies.
 *
 * A Range over the text gives one rect per line, which is the direct question —
 * "did this label break?" — rather than an inference from height, which changes
 * with padding and font and would have to be re-tuned every time either does.
 *
 * It is a FUNCTION, not a string. The first version passed the source as a
 * string, which Playwright evaluated to a function object it could not
 * serialise, so `lines` came back `undefined` and the guard measured nothing at
 * all. It failed loudly on the matcher rather than passing blind, which is the
 * only reason it was caught — an `undefined ?? 0` would have made every screen
 * green for ever.
 */
function lineBoxes(el: HTMLElement | SVGElement): number {
  const range = document.createRange();
  let lines = 0;

  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE || !(node.textContent ?? "").trim()) continue;

    range.selectNodeContents(node);
    lines = Math.max(lines, range.getClientRects().length);
  }

  return lines;
}

for (const path of HEADERS) {
  test(`${path} — its primary action reads on one line`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(800);

    const buttons = page.locator("button", { hasText: /^\s*\+\s/ });
    const count = await buttons.count();

    // THE DENOMINATOR. A screen that renders no such button passes every
    // assertion below by having nothing to assert on.
    expect(count, `${path} offered no "+ …" action to measure`).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      if (!(await button.isVisible())) continue;

      const label = (await button.textContent())?.trim() ?? "";
      const lines = await button.evaluate(lineBoxes);

      // Zero is not "one line" — it is "this measured nothing", which is
      // exactly how the first version of this file ran while blind.
      expect(lines, `"${label}" on ${path} had no text node to measure`).toBeGreaterThan(0);

      expect(lines, `"${label}" on ${path} broke across ${lines} lines`).toBeLessThanOrEqual(1);
    }
  });
}

test("the till's action bar stays a bar, not a panel", async ({ page }) => {
  await page.goto("/tenant/pos");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  const measured = await page.evaluate(() => {
    const viewport = document.documentElement.clientHeight;
    // Anchored on a control only this bar has, so a markup change that moves
    // the bar fails loudly instead of measuring some other element.
    const anchor = [...document.querySelectorAll("button")]
      .find((b) => /parked ticket/.test(b.getAttribute("title") ?? ""));
    // The bar is a COLUMN below `sm` (two rows) and a wrapping row above
    // it. `flex-col` is on the element at every width; `flex-wrap` is not
    // any more, and anchoring on it silently found nothing.
    const bar = anchor?.closest("div.flex.shrink-0.flex-col");

    if (!bar) return null;

    // Line up by TOP, bucketed — the connection pill is 36px tall and the
    // action buttons 38px, so their tops differ by a pixel on the same row.
    // Counting raw tops reported "2 rows" for a bar that plainly had one.
    const tops: number[] = [];
    for (const el of bar.querySelectorAll("button")) {
      const top = el.getBoundingClientRect().top;
      if (!tops.some((t) => Math.abs(t - top) < 12)) tops.push(top);
    }

    return {
      rows: tops.length,
      height: Math.round(bar.getBoundingClientRect().height),
      share: bar.getBoundingClientRect().height / viewport,
      buttons: bar.querySelectorAll("button").length,
    };
  });

  expect(measured, "the till's action bar was not on the page at all").not.toBeNull();
  // The denominator again: an empty bar is one row and no height.
  expect(measured!.buttons, "the bar held no controls, so its shape proves nothing")
    .toBeGreaterThanOrEqual(5);

  expect(
    measured!.rows,
    `the till's action bar wrapped onto ${measured!.rows} rows`,
  ).toBeLessThanOrEqual(2);

  expect(
    measured!.share,
    `the till's action bar takes ${Math.round(measured!.share * 100)}% of the screen `
    + `(${measured!.height}px) — that room belongs to the cart`,
  ).toBeLessThan(0.15);
});

/**
 * THE BELL, ON A PHONE.
 *
 * Notifications used to fold behind a three-dots button below 640px, together
 * with the theme switch and the update check — so the one control in that
 * corner that ever has news to deliver was the hardest of the three to reach.
 * The other two moved into the account menu, where a setting somebody changes
 * once belongs, and the bell came out into the header at every width.
 *
 * Asked in a browser because it is a question about layout: a source scan can
 * only see whether the word `hidden` appears nearby, and nearby is not the
 * same as wrapping it.
 */
test("the notification bell is on screen without opening a menu", async ({ page }) => {
  await page.goto("/tenant");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);

  const bell = page.getByRole("button", { name: /notification/i }).first();

  await expect(bell, "the bell is not reachable without opening something first")
    .toBeVisible({ timeout: 10_000 });

  // And it is IN the header strip, not somewhere down the page.
  const box = await bell.boundingBox();

  expect(box, "the bell has no box at all").not.toBeNull();
  expect(box!.y, "the bell is below the header row").toBeLessThan(120);
});

/**
 * WHAT A PHONE'S TWO ROWS ARE FOR.
 *
 * The bar fitting in two rows was the first half. The shop asked for the
 * second: "jo kam button use hote like quote, ya reset unko upar le jao sync
 * button ke sath / baaki 3 neeche / aur teeno full adjust hon."
 *
 * So the split is not arbitrary and not left to wrapping. Row one is what a
 * cashier only glances at — the connection pill — plus the two they hardly
 * press. Row two is the three they press during a sale, in equal thirds
 * across the full width, because a thumb finds a third of a screen without
 * looking and does not find a button that moved because a discount got longer.
 *
 * Wrapping cannot express that: it packs greedily, so "Add discount" becoming
 * "Discount −Rs 12,500" moves Hold onto the next row.
 */
test("the till's bar splits the way a hand uses it", async ({ page }) => {
  await page.goto("/tenant/pos");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  const seen = await page.evaluate(() => {
    const at = (title: string) =>
      [...document.querySelectorAll("button")].find(
        (b) => (b.getAttribute("title") ?? "") === title,
      );

    const pill = [...document.querySelectorAll("button")].find((b) =>
      /reached the server|never reached the server|saved on this device/.test(
        b.getAttribute("title") ?? "",
      ),
    );
    const wanted = {
      quote: at("Quotation or advance booking (F7)"),
      reset: at("Empty this ticket"),
      discount: at("Discount / coupon"),
      hold: at("Hold this ticket (F4)"),
      drafts: at("Open a parked ticket (F6)"),
    };

    const box = (el?: Element) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), width: Math.round(r.width), left: Math.round(r.left) };
    };

    return {
      pill: box(pill),
      quote: box(wanted.quote),
      reset: box(wanted.reset),
      discount: box(wanted.discount),
      hold: box(wanted.hold),
      drafts: box(wanted.drafts),
    };
  });

  // THE DENOMINATOR. Every rule below is about six controls; if one of them is
  // not on the page, the rule it belongs to passes by being unasked.
  for (const [name, box] of Object.entries(seen)) {
    expect(box, `the till's bar had no "${name}" to measure`).not.toBeNull();
  }

  const sameRow = (a: { top: number }, b: { top: number }) => Math.abs(a.top - b.top) < 12;
  const phone = page.viewportSize()!.width < 640;

  if (!phone) {
    // One row from `sm` up — and that is what the old layout was, so this half
    // is here to fail if the phone split leaks upward.
    expect(sameRow(seen.pill!, seen.drafts!), "the bar broke into rows on a wide screen")
      .toBe(true);
    return;
  }

  expect(sameRow(seen.pill!, seen.quote!), "Quote is not on the connection pill's row").toBe(true);
  expect(sameRow(seen.pill!, seen.reset!), "Reset is not on the connection pill's row").toBe(true);

  expect(sameRow(seen.discount!, seen.hold!), "Discount and Hold are not on one row").toBe(true);
  expect(sameRow(seen.discount!, seen.drafts!), "Discount and Drafts are not on one row").toBe(true);
  expect(seen.discount!.top, "the three a cashier presses are not BELOW the row they glance at")
    .toBeGreaterThan(seen.pill!.top);

  // Equal thirds. Not "roughly": they are a grid, so any difference at all
  // means something is sizing itself off its own label again.
  const widths = [seen.discount!.width, seen.hold!.width, seen.drafts!.width];
  expect(
    Math.max(...widths) - Math.min(...widths),
    `the three are ${widths.join(" / ")}px — not equal thirds`,
  ).toBeLessThanOrEqual(1);

  // …and they use the whole width, rather than three thirds of half a bar.
  const span = seen.drafts!.left + seen.drafts!.width - seen.discount!.left;
  expect(
    span / page.viewportSize()!.width,
    `the three cover ${Math.round((span / page.viewportSize()!.width) * 100)}% of the screen`,
  ).toBeGreaterThan(0.85);
});
