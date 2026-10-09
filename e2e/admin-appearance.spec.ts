import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, tradeAuth } from "./api";

/**
 * THE CONSOLE'S OWN APPEARANCE — through the screen.
 *
 * Asked for in these words: "keep the admin side primary — the sidebar and
 * the colour theme — and let them change it themselves too."
 *
 * A shop has always had this canvas. The platform console had none: it was
 * drawn from a fallback. This walks the canvas on the console:
 *
 *   untouched, the console is the house colour with its menu in it
 *   a choice is PREVIEWED on the real console behind the canvas, and an
 *     abandoned one leaves nothing behind
 *   saved, it is the platform's — the server has it, and a reload opens in it
 *     from the first paint, not after a request
 *   Reset hands the console back to the house colour
 *
 * Whatever look the console had before this ran, it has again after.
 */

const HOUSE = { console_theme_primary: null, console_theme_tint: "subtle", console_theme_sidebar: "primary" };
const EMERALD = "#12b76a";
type Look = typeof HOUSE | { console_theme_primary: string | null; console_theme_tint: string; console_theme_sidebar: string };

const admin = () => tradeAuth("admin");

async function stored(request: APIRequestContext): Promise<Look> {
  const res = await request.get(`${API}/admin/appearance`, { headers: admin() });
  expect(res.ok(), `the console's look could not be read (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Look }).data;
}

async function put(request: APIRequestContext, look: Look): Promise<void> {
  const res = await request.put(`${API}/admin/appearance`, { headers: admin(), data: look });
  expect(res.ok(), `the console's look could not be put back (${res.status()} ${await res.text()})`).toBeTruthy();
}

/** What the page is actually wearing: the menu's style, and its own colour if it has one. */
const worn = (page: Page) =>
  page.evaluate(() => ({
    sidebar: document.documentElement.dataset.sidebar ?? null,
    brand: document.documentElement.style.getPropertyValue("--color-brand-500") || null,
  }));

const canvas = (page: Page) => page.getByRole("dialog", { name: "Appearance" });
const launcher = (page: Page) => page.getByRole("button", { name: "Open appearance settings" });

test("the console's colour and its menu can be changed from the console, for everybody on it", async ({ page, request }, info) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1280, "the canvas is a sit-down job: its launcher is not drawn below a desktop's width");
  info.setTimeout(120_000);

  const before = await stored(request);

  try {
    await put(request, HOUSE);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Platform Overview" })).toBeVisible({ timeout: 20_000 });

    // ── untouched: the house colour, the menu in it ─────────────────
    await expect.poll(() => worn(page)).toEqual({ sidebar: "primary", brand: null });

    // ── a choice is previewed on the real console ───────────────────
    await launcher(page).click();
    await expect(canvas(page)).toBeVisible();
    await expect(canvas(page)).toContainText("Save to apply for everyone on the console");
    const save = canvas(page).getByRole("button", { name: /^(Save|Saved)$/ });
    await expect(save, "there is something to save before anything was changed").toBeDisabled();

    await canvas(page).getByRole("button", { name: "Emerald" }).click();
    await canvas(page).getByRole("button", { name: "Dark" }).last().click();
    await expect.poll(() => worn(page)).toEqual({ sidebar: "dark", brand: EMERALD });
    // Previewed is not saved.
    expect(await stored(request)).toEqual(HOUSE);

    // ── abandoned, it leaves nothing behind ─────────────────────────
    await canvas(page).getByRole("button", { name: "Close" }).click();
    await expect.poll(() => worn(page), { message: "a look that was never saved stayed on the console" }).toEqual({ sidebar: "primary", brand: null });

    // ── saved, it is the platform's ─────────────────────────────────
    await launcher(page).click();
    await canvas(page).getByRole("button", { name: "Emerald" }).click();
    await canvas(page).getByRole("button", { name: "Dark" }).last().click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => stored(request), { message: "Save did not reach the server" }).toEqual({
      console_theme_primary: EMERALD, console_theme_tint: "subtle", console_theme_sidebar: "dark",
    });
    await canvas(page).getByRole("button", { name: "Close" }).click();
    await expect.poll(() => worn(page)).toEqual({ sidebar: "dark", brand: EMERALD });

    // ── and a reload opens in it from the first paint ───────────────
    // With the request for it held back: what is on the page is what this
    // device remembered, not what the server has just said.
    await page.route("**/admin/appearance", (route) => new Promise((go) => setTimeout(() => go(route.continue()), 4_000)));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => worn(page), { timeout: 3_000, message: "the console opened in the house colour and waited for a request" })
      .toEqual({ sidebar: "dark", brand: EMERALD });
    await page.unroute("**/admin/appearance");
    await expect(page.getByRole("heading", { name: "Platform Overview" })).toBeVisible({ timeout: 20_000 });

    // Another screen of the console wears it too.
    await page.goto("/admin/plans");
    await expect.poll(() => worn(page)).toEqual({ sidebar: "dark", brand: EMERALD });

    // ── Reset hands it back to the house ────────────────────────────
    await launcher(page).click();
    await canvas(page).getByRole("button", { name: "Reset" }).click();
    await canvas(page).getByRole("button", { name: /^Save$/ }).click();
    await expect.poll(() => stored(request), { message: "Reset did not hand the console back to the house colour" }).toEqual(HOUSE);
    await canvas(page).getByRole("button", { name: "Close" }).click();
    await expect.poll(() => worn(page)).toEqual({ sidebar: "primary", brand: null });
  } finally {
    await put(request, before);
  }
});
