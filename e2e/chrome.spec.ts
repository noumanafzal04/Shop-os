import { test, expect } from "@playwright/test";
import { everyRule, renderedSize, tapTargetsAreFingerSized, report } from "./rules";

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
