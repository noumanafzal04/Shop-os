import { defineConfig, devices } from "@playwright/test";

/**
 * The tests that need a real browser.
 *
 * Everything in `src/**.test.ts` runs under jsdom, which has NO LAYOUT ENGINE:
 * `getBoundingClientRect()` returns zeros, no stylesheet is applied, and no
 * media query ever matches. That is not a gap in the tests — it is a gap in
 * what the tool can see, and it is why every one of the seven defects a shop
 * found by holding a tablet was invisible to a thousand green tests.
 *
 * A close button under a header, a 28px tap target, a modal taller than the
 * screen, content behind the sidebar: none of those are wrong in the SOURCE.
 * They are wrong only once something computes a position. So this suite runs a
 * real browser at real device sizes and asks questions about pixels.
 *
 * It runs against the BUILT app, not the dev server — the dev server tests the
 * dev server.
 */
// Specs that belong to the RESTAURANT project and nowhere else. A mart shop
// cannot hold a dish, so running them anywhere else is a guaranteed skip — and
// a guaranteed skip is a check that was deleted quietly (e2e/skipReporter.ts).
const RESTAURANT_ONLY = /food\..*\.spec\.ts|recipe-size\.spec\.ts/;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // Beside whichever reporter is reading the run, one that names the checks
  // which did NOT run. "30 skipped" hides a spec that skips itself out of
  // existence — see e2e/skipReporter.ts.
  reporter: process.env.CI
    ? [["line"], ["./e2e/skipReporter.ts"]]
    : [["list"], ["./e2e/skipReporter.ts"]],
  // A whole minute of it can be waiting out `throttle:auth` while the QA sweep
  // is running against the same API. See e2e/auth.setup.ts.
  timeout: 300_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // The shelf is a FIXTURE, and it is built where a fixture belongs — not
    // inside a layout spec, and not assumed. See e2e/shelf.setup.ts.
    { name: "shelf", testMatch: /shelf\.setup\.ts/, dependencies: ["setup"] },

    // The three shapes a shop actually holds. Tablet landscape is the one that
    // broke: 1024–1279 is `lg` in this codebase, NOT `xl`, so a strip hidden
    // "below xl" is on every tablet in the shop.
    {
      name: "tablet-landscape",
      testIgnore: RESTAURANT_ONLY,
      dependencies: ["shelf"],
      use: { ...devices["iPad (gen 7) landscape"], storageState: "e2e/.auth/owner.json" },
    },
    {
      name: "tablet-portrait",
      testIgnore: RESTAURANT_ONLY,
      dependencies: ["shelf"],
      use: { ...devices["iPad (gen 7)"], storageState: "e2e/.auth/owner.json" },
    },
    // A phone. The shop's own device, and the one nobody had ever looked at:
    // every defect the shop reported was found on a tablet, so the tablet is
    // where the fixes went. A phone is narrower than the drawer breakpoint
    // (DRAWER_BELOW = 1024), so it is a different layout entirely — the rail
    // becomes a drawer, the till stacks into one column, and the totals bar and
    // the catalog share a screen that is 390 points wide.
    {
      name: "phone",
      testIgnore: RESTAURANT_ONLY,
      dependencies: ["shelf"],
      use: { ...devices["iPhone 14"], storageState: "e2e/.auth/owner.json" },
    },
    {
      name: "desktop",
      testIgnore: RESTAURANT_ONLY,
      dependencies: ["shelf"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/owner.json" },
    },

    // THE RESTAURANT. A mart cannot hold a dish, so every food screen — a
    // recipe, a dine-in tab, a kitchen board, menu hours — had no browser
    // coverage at all and any spec that wanted one skipped itself out of
    // existence. This project signs in somewhere that can.
    //
    // It depends on `setup` and not on `shelf`: the shelf is the MART's
    // fixture, and a food spec builds what it needs itself.
    {
      name: "restaurant",
      testMatch: RESTAURANT_ONLY,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/food.json" },
    },

    // A restaurant works on a TABLET. The first version of this project ran
    // desktop only, which measured the floor, the tab and the kitchen board at
    // the one size nobody uses them at — and the product form had just proved
    // what that costs: it passes at 1280 and its Cancel button is unreachable
    // at 768, because rows wrap and the pane outgrows the dialog.
    //
    // The board is the wall screen and stays desktop-shaped; the FLOOR and the
    // TAB are held in a waiter's hands.
    {
      name: "restaurant-tablet",
      testMatch: RESTAURANT_ONLY,
      dependencies: ["setup"],
      use: { ...devices["iPad (gen 7)"], storageState: "e2e/.auth/food.json" },
    },
  ],

  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
