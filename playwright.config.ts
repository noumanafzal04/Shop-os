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

    // The three shapes a shop actually holds. Tablet landscape is the one that
    // broke: 1024–1279 is `lg` in this codebase, NOT `xl`, so a strip hidden
    // "below xl" is on every tablet in the shop.
    {
      name: "tablet-landscape",
      dependencies: ["setup"],
      use: { ...devices["iPad (gen 7) landscape"], storageState: "e2e/.auth/owner.json" },
    },
    {
      name: "tablet-portrait",
      dependencies: ["setup"],
      use: { ...devices["iPad (gen 7)"], storageState: "e2e/.auth/owner.json" },
    },
    {
      name: "desktop",
      dependencies: ["setup"],
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
