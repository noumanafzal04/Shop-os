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
    // Quotes and invoices sat in `chrome.spec.ts`, where the MART opened it —
    // and a mart has no `documents` module, so `RequireFeature` sent every one
    // of those walks to the dashboard. Four device sizes, green, about the
    // dashboard. A retail shop has it.
    { path: "/tenant/documents", name: "quotes & invoices" },
    // Reservations was listed under `services`, and the services shop does
    // not have the module — so this walk was redirected to the dashboard and,
    // since the guard below, failed saying so. The retail shop has it.
    { path: "/tenant/reservations", name: "reservations" },
  ],
  services: [
    // The portfolio is behind `services`. It was listed under `finance`,
    // which is a business that keeps books and nothing else: same redirect.
    { path: "/tenant/portfolio", name: "the portfolio" },
  ],
  // An office that bought only the books has no screen of its own that the
  // mart cannot reach — but it draws the SAME four differently: no till, no
  // shelf, "your business" where the mart reads "your shop". Walked as itself.
  finance: [
    { path: "/tenant/expenses", name: "expenses, for an office" },
    { path: "/tenant/income", name: "other income, for an office" },
    { path: "/tenant/ledger", name: "the ledger, for an office" },
    { path: "/tenant/cashbook", name: "the cashbook, for an office" },
    { path: "/tenant/subscription", name: "the subscription, for an office" },
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

        // One first heading, saying which screen this is — see chrome.spec.
        const firsts = await page.locator("h1").evaluateAll((hs) => hs.map((h) => (h.textContent ?? "").trim()));
        expect(firsts, `${screen.name} (${screen.path}) has ${firsts.length} first headings — a screen has one`).toHaveLength(1);
        expect(firsts[0].length).toBeGreaterThan(1);

        // STILL ON THE SCREEN IT ASKED FOR. The size check above was written
        // for a redirect to an EMPTY page; a guard here redirects to the
        // DASHBOARD, which is not empty and passes everything.
        expect(
          new URL(page.url()).pathname,
          `${screen.name} did not stay on ${screen.path} — a guard redirected it`,
        ).toBe(screen.path);

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
