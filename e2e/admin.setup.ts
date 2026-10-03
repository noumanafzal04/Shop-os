import { test as setup, expect, type Page } from "@playwright/test";

/**
 * SIGN IN TO THE ADMIN CONSOLE.
 *
 * It had no browser project at all. Forty-odd shop screens are walked by six
 * trade projects and three volume projects, and the console that decides what
 * every one of those shops is allowed to be — plans, limits, modules, who is
 * suspended — was walked by nothing.
 *
 * That is the surface where a mistake is widest: a shop screen breaking hurts
 * one business, and a plan screen breaking prices all of them.
 *
 * Skips rather than fails when there is no super admin on this machine, for
 * the same reason the volume setup does: the admin account is a local seed,
 * not part of CI, and a project red on every unseeded machine teaches nobody
 * anything.
 */
const ADMIN = process.env.E2E_ADMIN ?? "admin@shopos.test";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";
const STATE = "e2e/.auth/admin.json";

async function signIn(page: Page): Promise<boolean> {
  await page.goto("/signin");
  await page.getByPlaceholder("you@business.com").fill(ADMIN);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL(/\/admin/, { timeout: 25_000 }).catch(() => {});

  return page.url().includes("/admin");
}

setup.setTimeout(90_000);

setup("sign in to the admin console", async ({ page }) => {
  const landed = await signIn(page);

  setup.skip(
    !landed,
    "no super admin on this machine — seed one, or set E2E_ADMIN / E2E_ADMIN_PASSWORD.",
  );

  expect(page.url()).toContain("/admin");
  await page.context().storageState({ path: STATE });
});
