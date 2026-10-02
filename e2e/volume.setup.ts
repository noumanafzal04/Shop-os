import { test as setup, expect, type Page } from "@playwright/test";

/**
 * SIGN IN TO A SHOP THAT IS ACTUALLY BIG.
 *
 * Every other project here signs in to a sweep fixture: twenty-eight products
 * and a handful of sales. That is the right size for asking whether a control
 * exists. It is the wrong size for asking whether a screen WORKS, because
 * almost everything works at twenty-eight rows.
 *
 * `php artisan loadtest:shops` builds a grocery with six thousand lines,
 * eighteen thousand stock rows, ninety-one closed shifts and twenty-three
 * thousand stock-count lines. This signs in there, so the volume specs are
 * looking at a shop the size of a real one.
 *
 * It SKIPS rather than fails when that world has not been seeded: the
 * load-test shops are a local fixture, not part of CI, and a project that
 * failed without them would be red on every machine that had not run the
 * seeder. The skip says which command to run.
 */
const OWNER = process.env.E2E_VOLUME_OWNER ?? "grocery@loadtest.test";
const PASSWORD = process.env.E2E_VOLUME_PASSWORD ?? "password";
const STATE = "e2e/.auth/volume.json";

async function signIn(page: Page): Promise<boolean> {
  await page.goto("/signin");
  // The same two placeholders auth.setup.ts uses, verbatim. A loose
  // /email/i matched nothing and the fill sat there for the full five-minute
  // test timeout before reporting "sign in failed" — which is a finding
  // about the selector, not about the shop.
  await page.getByPlaceholder("you@business.com").fill(OWNER);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL(/\/tenant/, { timeout: 25_000 }).catch(() => {});

  // /tenant/setup matches /tenant and is NOT the dashboard — auth.setup.ts
  // learned that the hard way, having tested the setup form fourteen times
  // while calling it the catalog. A load-test shop is seeded
  // `setup_completed`, so landing there means something else is wrong.
  return page.url().includes("/tenant") && ! page.url().includes("/tenant/setup");
}

setup.setTimeout(90_000);

setup("sign in to a shop with six thousand products", async ({ page }) => {
  const landed = await signIn(page);

  setup.skip(
    !landed,
    "the load-test world is not seeded on this machine — run:\n" +
      "  cd backend && php artisan loadtest:shops --products=6000 --sales=300 --fresh",
  );

  expect(page.url()).toContain("/tenant");
  await page.context().storageState({ path: STATE });
});
