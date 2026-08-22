import { test, expect } from "@playwright/test";
import { cardsAreSurfaces, everyRule, everythingHasAName, onlyWhatAFingerCanReach, renderedSize, scrollersCanReachTheirEnd, tapTargetsAreFingerSized, report } from "./rules";
import { PLAIN_ITEM, openTill, showPane } from "./till";

/**
 * Walk the shop's screens at a real size and ask what a browser can see.
 *
 * Deliberately not "does the button work" — that is what the other thousand
 * tests are for. These are the questions only a layout engine can answer, and
 * every one of them is a defect a shop reported after a green build:
 *
 *   · a close button underneath the header
 *   · a 28px tap target
 *   · a payment panel taller than the tablet
 *   · a page that scrolls sideways so the Close button is simply gone
 *   · content drawn behind the sidebar
 */

const SCREENS: Array<{ path: string; name: string }> = [
  { path: "/tenant", name: "dashboard" },
  { path: "/tenant/products", name: "catalog" },
  { path: "/tenant/inventory", name: "inventory" },
  { path: "/tenant/customers", name: "customers" },
  { path: "/tenant/sales", name: "sales" },
  { path: "/tenant/expenses", name: "expenses" },
  { path: "/tenant/reports", name: "reports" },
  { path: "/tenant/day", name: "day & banking" },
  { path: "/tenant/staff", name: "staff" },
  { path: "/tenant/suppliers", name: "suppliers" },
  { path: "/tenant/purchases", name: "purchases" },
  { path: "/tenant/settings", name: "settings" },
  { path: "/tenant/help", name: "help centre" },
  // `/tenant/pos`, not `/pos`. The first version of this list had the short
  // one, so every till check ran against a redirect — and passed, because an
  // empty page has nothing covered and nothing off its edge. Its denominator
  // said 1 tap target where the till has fifty, which is the only reason
  // anybody found out.
  { path: "/tenant/pos", name: "the till" },
];

for (const screen of SCREENS) {
  test(`${screen.name} — nothing covered, nothing off the edge`, async ({ page }) => {
    await page.goto(screen.path);
    // Let the first paint settle: a rule that measures a skeleton measures the
    // skeleton's mistakes.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(600);

    // THE DENOMINATOR — see `renderedSize`. Counted in elements and words, not
    // in buttons: the Help Centre in portrait folds its topic list behind a
    // toggle and shows two controls and four thousand words, and the first
    // version of this line called that an empty page.
    const size = await renderedSize(page);
    expect(size.elements, `${screen.name} (${screen.path}) rendered almost nothing`)
      .toBeGreaterThan(60);
    expect(size.text, `${screen.name} (${screen.path}) rendered no words`)
      .toBeGreaterThan(120);

    report(
      await everyRule(page),
      `${screen.name} (${screen.path}) · ${size.elements} elements, ${size.text} chars`,
    );
  });
}

/**
 * How many controls on each screen cannot be called by name.
 *
 * Built as a ratchet — each screen allowed the debt it already had — and then
 * the debt turned out to be payable in an afternoon, so **the budget is empty
 * and every screen is at zero**. It is a gate now, not a ratchet.
 *
 * The measurement is the reason it was payable at all. The backlog had been
 * recorded from a static grep as "245 form fields with no accessible name",
 * which was wrong in a way that mattered: it made the job sound like writing
 * 245 names, so it stayed a backlog item. Asking a browser instead:
 *
 *     34 of 367 visible controls, of which 24 were TWO buttons
 *                                 in the shared header, on every screen
 *
 * The ratchet machinery stays because a screen can legitimately arrive with
 * debt — a big new module, mid-migration — and blocking that is how a rule gets
 * switched off. Per screen rather than one total, so a fix on the dashboard
 * cannot pay for a regression on the till.
 *
 * It has failed honestly four times while being written — at 34, at 10, at 3,
 * and once for a screen that rendered nothing — so the denominator assertion
 * below is doing its job too.
 */
const NAMELESS_BUDGET: Record<string, number> = {};

test("every control on screen can be called by name", async ({ page }) => {
  const worse: string[] = [];
  let total = 0;
  let measured = 0;
  let borrowed = 0;

  for (const screen of SCREENS) {
    await page.goto(screen.path);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(600);

    const { findings, examined, hinted } = await everythingHasAName(page);

    // THE DENOMINATOR. Zero findings on a screen that rendered no controls is
    // not a pass, it is a screen that did not load — and it looks identical.
    expect(examined, `${screen.name} rendered no usable controls at all`).toBeGreaterThan(0);

    total += findings.length;
    measured += examined;
    borrowed += hinted;

    const allowed = NAMELESS_BUDGET[screen.name] ?? 0;
    const mark = findings.length > allowed ? "WORSE" : findings.length < allowed ? "better" : "same";
    console.log(`  ${mark.padEnd(6)} ${screen.name.padEnd(14)} ${findings.length}/${examined} unnamed, ${hinted} named by hint (budget ${allowed})`);

    if (findings.length > allowed) {
      worse.push(
        `${screen.name}: ${findings.length} unnamed, budget ${allowed}\n`
        + findings.slice(0, 8).map((f) => `      · ${f.what} — ${f.detail}`).join("\n"),
      );
    }
  }

  console.log(`\n  ${total} of ${measured} visible controls across ${SCREENS.length} screens have no accessible name`);
  // Reported, never asserted on. These are named — just not by a name anybody
  // chose. Printing it keeps the second-best category from disappearing behind
  // a green tick; asserting on it would block the build over a real
  // improvement.
  console.log(`  ${borrowed} more are named only by their own placeholder text`);

  expect(worse, worse.length ? `\n${worse.join("\n")}\n` : "no screen got worse").toEqual([]);
});

test("the till's product cards are surfaces, not tints", async ({ page }) => {
  // The shop's own words, twice: "background transparent type, text show ho
  // raha" and later "simple text show ho raha, identify nahi ho raha ke ye
  // cards hain". The tint was raised once in between and it was still true,
  // because opacity was never the problem — a translucent panel on a dark
  // ground has no edge at any opacity.
  await openTill(page);

  const { findings, examined } = await cardsAreSurfaces(page);

  expect(examined, "no product cards on screen — is a shift open?")
    .toBeGreaterThan(3);

  report(findings, `the till's product list (${examined} cards measured)`);
});

test("a full cart shows every line a cashier put in it", async ({ page }) => {
  // The shop's words: "i add 8,9 rows cart / on mobile and tablet showing 6,7 /
  // last wali rows hide ho rahi". The list scrolled the whole time — its own
  // box simply hung below the card that clips it, so the bottom rows arrived in
  // a strip outside the frame.
  await openTill(page);

  // The shared definition, not a second copy of it — see PLAIN_ITEM.
  const items = page.locator(PLAIN_ITEM);
  const available = await items.count();
  expect(available, "the till listed no sellable products").toBeGreaterThan(7);

  // Nine DISTINCT products — tapping one product nine times makes one row with
  // qty 9, which is not what the shop was looking at.
  for (let i = 0; i < 9 && i < available; i++) {
    await items.nth(i).click();
    await page.waitForTimeout(120);
  }

  // A phone shows ONE pane at a time — the cart is behind its own tab there,
  // and a check that looked for cart rows without pressing it would find none
  // and blame the layout.
  await showPane(page, "Cart");

  const rows = page.locator("[data-cart-row]");
  const put = await rows.count();
  expect(put, "fewer than eight lines went into the cart").toBeGreaterThan(7);

  // ── AT REST, before anything is scrolled ─────────────────────────────
  const atRest = await scrollersCanReachTheirEnd(page);
  expect(atRest.examined, "nothing on the till was scrollable with a full cart")
    .toBeGreaterThan(0);
  const findings = atRest.findings;
  const examined = atRest.examined;

  // ── then scroll the way a hand would ─────────────────────────────────
  //
  // Not `scrollIntoViewIfNeeded`: that will scroll an `overflow: hidden` box,
  // which a finger cannot, and this check passed on a phone showing three lines
  // of nine because of exactly that. Only the cart's own scroller is moved, and
  // anything that cannot be scrolled by hand is put back first.
  await page.evaluate(() => {
    const rows = document.querySelectorAll("[data-cart-row]");
    const last = rows[rows.length - 1] as HTMLElement | undefined;
    let p = last?.parentElement ?? null;
    while (p) {
      const cs = getComputedStyle(p);
      // Vertically scrollable AND with something to scroll. `overflow-x-auto`
      // computes `overflow-y: auto` as well — CSS forces it once either axis
      // leaves `visible` — so the row's own horizontal wrapper looked like the
      // cart's scroller, took the scroll, and moved nothing.
      const canScroll =
        (cs.overflowY === "auto" || cs.overflowY === "scroll") &&
        p.scrollHeight > p.clientHeight + 1;
      if (canScroll) {
        // Bring the LAST LINE to the bottom edge — not `scrollTop =
        // scrollHeight`. The totals sit under the lines in this same scroller,
        // so scrolling to the very end scrolls the lines off the TOP and
        // reports them missing for the wrong reason.
        p.scrollTop += last!.getBoundingClientRect().bottom - p.getBoundingClientRect().bottom;
        return;
      }
      p = p.parentElement;
    }
  });
  await onlyWhatAFingerCanReach(page);
  await page.waitForTimeout(250);

  // The ground truth: with the cart scrolled to its end, is the last line on
  // screen?
  const lastLineSeen = await rows.last().evaluate((el) => {
    const box = el.getBoundingClientRect();
    let top = box.top, bottom = box.bottom;
    let p = el.parentElement;
    while (p) {
      const cs = getComputedStyle(p);
      if (cs.overflowY !== "visible" || cs.overflowX !== "visible") {
        const c = p.getBoundingClientRect();
        top = Math.max(top, c.top);
        bottom = Math.min(bottom, c.bottom);
      }
      p = p.parentElement;
    }
    bottom = Math.min(bottom, innerHeight);
    return { visible: bottom - top, height: box.height };
  });

  expect(
    lastLineSeen.visible,
    `line ${put} of ${put} is clipped — only ${Math.round(lastLineSeen.visible)}px ` +
      `of its ${Math.round(lastLineSeen.height)}px shows with the cart scrolled to its end`,
  ).toBeGreaterThan(lastLineSeen.height * 0.9);

  report(findings, `the till with ${put} lines in the cart (${examined} scrollers measured)`);
});

test("every tap target on the till is big enough for a finger", async ({ page }) => {
  await page.goto("/tenant/pos");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);

  const { findings, examined } = await tapTargetsAreFingerSized(page);

  // THE DENOMINATOR, and it is only claiming to be one thing: proof that the
  // page RENDERED. A rule that measured nothing passes for the same reason a
  // rule that measured everything passes, and the two are indistinguishable
  // from the outside — that is how this suite spent an afternoon testing the
  // shop setup form fourteen times while reporting it as the dashboard, the
  // catalog and the till.
  //
  // The floor is measured, not guessed. A till with NO OPEN SHIFT is a real
  // state a shop sees every morning, and it draws 18 controls — header, shift
  // prompt, search, view toggle — with no product tiles at all. The first
  // version of this line guessed 20 and failed a working page.
  expect(examined, "the till rendered almost nothing — did it load?")
    .toBeGreaterThan(12);

  report(findings, `the till (${examined} tap targets measured)`);
});
