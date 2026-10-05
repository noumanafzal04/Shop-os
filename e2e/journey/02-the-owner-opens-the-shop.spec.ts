import fs from "node:fs";
import { OWNER_STATE, ask, expect, record, remember, session, settled, signIn, test } from "./kit";

/**
 * STAGE B (first half) — THE OWNER WALKS IN.
 *
 * The admin has made the business; nobody has been inside it. The owner signs
 * in with the password they were given, is asked where the shop is, and then
 * sees the product for the first time — every screen of it, because every
 * module is on.
 */

test.describe.configure({ mode: "serial" });

test("B1 · the owner signs in, finishes setup, and reaches the dashboard", async ({ page, request }) => {
  const r = record();

  // Through the form, and not from a saved session: this is the first time
  // anybody has typed this password.
  await signIn(page, r.ownerEmail, r.ownerPassword, /\/tenant/);

  // A shop with no location sees ONE screen, whatever it asked for.
  await expect(page).toHaveURL(/\/tenant\/setup/);
  await expect(page.getByRole("heading", { name: new RegExp(`Set up ${r.business}`) })).toBeVisible();

  const city = page.getByLabel("City *", { exact: true });
  await expect.poll(async () => city.locator("option:not([disabled])").count()).toBeGreaterThan(0);
  await city.selectOption({ label: "Lahore" });
  await page.getByLabel("Address (optional)", { exact: true }).fill("12 Journey Road, Gulberg");

  const finish = page.getByRole("button", { name: "Finish setup" });
  await expect(finish).toBeEnabled();
  await finish.click();

  await expect(page).not.toHaveURL(/\/tenant\/setup/, { timeout: 30_000 });
  await settled(page);
  await expect(page).toHaveURL(/\/tenant\/?$/);

  await page.context().storageState({ path: OWNER_STATE });
  expect(fs.existsSync(OWNER_STATE)).toBe(true);

  // The server agrees the shop is set up, and still has every module.
  const me = await ask<{ tenant: { setup_completed: boolean; features: Record<string, boolean> } }>(request, "owner", "/auth/me");
  expect(me.tenant.setup_completed).toBe(true);
  expect(Object.values(me.tenant.features).every(Boolean), "a module went missing between the admin and the owner").toBe(true);
});

test.describe("inside the shop", () => {
  test.beforeAll(async ({ browser }) => {
    await session(browser, "owner");
  });
  test.use({ storageState: OWNER_STATE });

  test("B2 · every entry in the menu opens its own screen, and nothing is refused", async ({ page }) => {
    test.setTimeout(600_000);

    await page.goto("/tenant");
    await settled(page);

    // Full view: every module the shop has, not the day-to-day subset.
    const full = page.getByRole("button", { name: "Full view" });
    if (await full.isVisible().catch(() => false)) await full.click();

    // Open every group so its screens are in the menu to be read.
    const nav = page.getByRole("navigation").first();
    for (let pass = 0; pass < 3; pass++) {
      const groups = nav.getByRole("button");
      const n = await groups.count();
      for (let i = 0; i < n; i++) {
        const g = groups.nth(i);
        if ((await g.getAttribute("aria-expanded")) === "false") await g.click().catch(() => {});
      }
    }

    const links = await nav.getByRole("link").evaluateAll((as) =>
      [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""))].filter((h) => h.startsWith("/tenant")),
    );
    expect(links.length, "a shop with every module has a long menu").toBeGreaterThanOrEqual(30);

    const bounced: string[] = [];
    const blank: string[] = [];
    for (const href of links) {
      await page.goto(href);
      await settled(page);
      await page.waitForTimeout(350);

      const at = new URL(page.url()).pathname;
      // The till and the floor are full-screen; everything else keeps its address.
      if (at.replace(/\/$/, "") !== href.replace(/\/$/, "")) bounced.push(`${href} → ${at}`);

      const words = (await page.locator("body").innerText()).trim().length;
      if (words < 40) blank.push(href);
    }

    expect(bounced, "menu entries that did not open their own screen").toEqual([]);
    expect(blank, "screens that drew nothing").toEqual([]);
    remember({ screens: links });
  });
});
