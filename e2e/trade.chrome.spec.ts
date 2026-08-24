import { test, expect } from "@playwright/test";

import { everyRule, everythingHasAName, renderedSize, report, projectOnly } from "./rules";

/**
 * THE SCREENS BEHIND A TRADE.
 *
 * `chrome.spec.ts` walks the thirty-four screens the MART fixture can reach.
 * Nine more sit behind a trade it does not have, and had never been opened by a
 * browser at all — not a lower standard on them, none.
 *
 * The restaurant project was added the same day for exactly this reason, and
 * the first walk of its two screens found a kitchen board showing dockets for
 * tabs that had been cancelled six days earlier. These are the rest.
 *
 * Each project carries its own trade's sign-in, so a screen is opened by a shop
 * that actually has it. A spec that asked the mart for a forecourt would be
 * refused and SKIP, which is a check deleting itself quietly —
 * see e2e/skipReporter.ts.
 */

const BY_TRADE: Record<string, Array<{ path: string; name: string }>> = {
  petroleum: [
    { path: "/tenant/fuel", name: "the forecourt" },
    { path: "/tenant/fuel/deliveries", name: "fuel deliveries" },
    { path: "/tenant/fuel/setup", name: "tanks & pumps" },
  ],
  pharmacy: [
    { path: "/tenant/pharmacy", name: "the dispensary" },
  ],
  automotive: [
    { path: "/tenant/workshop", name: "the bay board" },
    { path: "/tenant/vehicles", name: "vehicles" },
  ],
  retail: [
    { path: "/tenant/warranty", name: "warranty claims" },
  ],
  services: [
    { path: "/tenant/reservations", name: "reservations" },
  ],
};

for (const [trade, screens] of Object.entries(BY_TRADE)) {
  test.describe(trade, () => {
    test.beforeEach(({ browserName }, testInfo) => {
      void browserName;
      test.skip(
        testInfo.project.name !== `trade-${trade}`,
        projectOnly(`these screens belong to a ${trade} shop and are walked by its own project`),
      );
    });

    for (const screen of screens) {
      test(`${screen.name} — nothing covered, nothing off the edge`, async ({ page }) => {
        await page.goto(screen.path);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(800);

        // THE DENOMINATOR. A screen that rendered nothing has nothing covered
        // and nothing off its edge, and passes every rule below — which is how
        // the till check once ran fourteen times against a redirect.
        const size = await renderedSize(page);
        expect(size.elements, `${screen.name} (${screen.path}) rendered almost nothing`)
          .toBeGreaterThan(40);
        expect(size.text, `${screen.name} (${screen.path}) rendered no words`)
          .toBeGreaterThan(60);

        report(
          await everyRule(page),
          `${screen.name} (${screen.path}) · ${size.elements} elements, ${size.text} chars`,
        );
      });
    }

    test("every control on these screens can be called by name", async ({ page }) => {
      const worse: string[] = [];
      let measured = 0;

      for (const screen of screens) {
        await page.goto(screen.path);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(800);

        const found = await everythingHasAName(page);
        measured += found.examined;

        console.log(
          `  ${screen.name.padEnd(20)} ${found.findings.length}/${found.examined} unnamed`
          + `, ${found.hinted} named by placeholder alone`,
        );

        if (found.findings.length > 0) {
          worse.push(
            `${screen.name}: ${found.findings.length} of ${found.examined} — `
            + found.findings.slice(0, 6).map((f) => f.what).join(", "),
          );
        }
      }

      expect(measured, "no controls were measured at all — the walk found nothing to judge")
        .toBeGreaterThan(2);
      expect(worse, `controls with no accessible name:\n${worse.join("\n")}`).toEqual([]);
    });
  });
}
