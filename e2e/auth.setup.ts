import { test as setup, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const OWNER = process.env.E2E_OWNER ?? "sweep-mart@qa.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "password";
const STATE = "e2e/.auth/owner.json";

// A SECOND SHOP, because a mart cannot hold a dish.
//
// `itemTypesFor('mart')` is ["physical_product", "deal"], so every food screen
// — a recipe, a dine-in tab, a kitchen board, menu hours — was unreachable in a
// browser. A spec that wanted one asked the server for a dish, was refused, and
// SKIPPED. Forever, printing as a line in a green run. See e2e/skipReporter.ts,
// which is what made that visible.
const FOOD_OWNER = process.env.E2E_FOOD_OWNER ?? "sweep-food-restaurant@qa.test";
const FOOD_STATE = "e2e/.auth/food.json";

/**
 * A SHOP PER TRADE, because nine screens still have none.
 *
 * The mart fixture reaches thirty-four of the shop's forty-eight screens. The
 * other nine sit behind a trade it does not have — the forecourt, the
 * dispensary, the workshop, the bay board, vehicles, warranty, riders, the
 * portfolio, reservations — and had never been opened by a browser at all.
 *
 * That is not a theoretical gap. The restaurant shop was added the same day and
 * the first walk of its screens found a kitchen board showing dockets for tabs
 * cancelled six days earlier.
 *
 * These are the QA sweep's own tenants, the same as the mart and the
 * restaurant. Each sign-in costs one of `throttle:auth`'s five per minute, so
 * they run once and the sessions are reused.
 */
const TRADES: Array<{ key: string; owner: string }> = [
  { key: "petroleum", owner: "sweep-petroleum@qa.test" },
  { key: "pharmacy", owner: "sweep-pharmacy@qa.test" },
  { key: "automotive", owner: "sweep-automotive@qa.test" },
  { key: "retail", owner: "sweep-retail@qa.test" },
  { key: "services", owner: "sweep-services@qa.test" },
  { key: "finance", owner: "sweep-finance@qa.test" },
];

/**
 * Sign in once, keep the session, and let every other spec start inside the app.
 *
 * The QA sweep's own tenants are the fixtures — a mart with a catalog, a till,
 * staff, branches and a trading day, built through the API by `docs/qa/sweep`.
 * Nothing here creates data: a layout test that also seeds is a layout test
 * that fails for two reasons and tells you neither.
 *
 * `throttle:auth` is 5 logins per minute per IP, so this runs ONCE and the
 * session is reused. See the same note in the sweep's client.
 */
async function signIn(page: Page, who: string, into: string): Promise<void> {
  fs.mkdirSync("e2e/.auth", { recursive: true });

  // `throttle:auth` is 5 per minute per IP and it is CORRECT — it is the
  // brute-force guard. When the QA sweep is running against the same API it
  // uses that budget up, so wait the limit out rather than failing a layout
  // suite for a reason that has nothing to do with layout.
  for (let attempt = 1; ; attempt++) {
    await page.goto("/signin");
    await page.getByPlaceholder("you@business.com").fill(who);
    await page.getByPlaceholder("Enter your password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    try {
      await expect(page).toHaveURL(/\/tenant/, { timeout: 20_000 });
      break;
    } catch (e) {
      if (attempt >= 4) throw e;
      await page.waitForTimeout(65_000);
    }
  }

  // ── A SHOP THAT HAS NOT FINISHED SETUP SEES ONE SCREEN ──────────────
  //
  // The panel sends every route to /tenant/setup until the shop has a city.
  // The API sweep's tenants have never needed one, because the API does not
  // gate on it — so every one of them lands here.
  //
  // The first version of this file asserted `/tenant` and stopped. That URL
  // matches /tenant/setup, so the suite signed in, landed on the setup form,
  // and then tested THAT form fourteen times over while reporting it as the
  // dashboard, the catalog, the reports and the till. Nothing failed: an
  // unchanging page has nothing covered and nothing off its edge.
  //
  // An assertion that names one thing and checks something adjacent is the
  // failure this codebase keeps meeting. So: finish the setup, then insist on
  // the dashboard by name.
  if (page.url().includes("/tenant/setup")) {
    // A native <select> whose placeholder is a DISABLED <option>. Clicking the
    // placeholder text waits forever for something that is never visible.
    const city = page.locator("select").first();
    await city.waitFor({ state: "attached", timeout: 15_000 });
    await expect
      .poll(async () => city.locator("option:not([disabled])").count(), { timeout: 20_000 })
      .toBeGreaterThan(0);
    await city.selectOption({ index: 1 });

    await page.getByPlaceholder(/street address/i).fill("1 Sweep Road, Lahore");
    await page.getByRole("button", { name: /finish setup/i }).click();
    await expect(page).not.toHaveURL(/\/tenant\/setup/, { timeout: 20_000 });
  }

  expect(page.url(), "still on the setup form").not.toContain("/tenant/setup");

  await page.context().storageState({ path: into });
}

setup("sign in as a shop owner", async ({ page }) => {
  await signIn(page, OWNER, STATE);
});

setup("sign in as a restaurant owner", async ({ page }) => {
  // Same throttle budget, one more login. Worth it: without this shop the
  // entire food vertical has no browser coverage at all.
  await signIn(page, FOOD_OWNER, FOOD_STATE);
});

for (const trade of TRADES) {
  setup(`sign in as a ${trade.key} owner`, async ({ page }) => {
    await signIn(page, trade.owner, `e2e/.auth/${trade.key}.json`);
  });
}
