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
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "line" : [["list"]],
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
      dependencies: ["shelf"],
      use: { ...devices["iPad (gen 7) landscape"], storageState: "e2e/.auth/owner.json" },
    },
    {
      name: "tablet-portrait",
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
      dependencies: ["shelf"],
      use: { ...devices["iPhone 14"], storageState: "e2e/.auth/owner.json" },
    },
    {
      name: "desktop",
      dependencies: ["shelf"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/owner.json" },
    },
  ],

  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
