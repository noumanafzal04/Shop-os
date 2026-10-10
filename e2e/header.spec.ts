import { expect, test, type Page } from "@playwright/test";

import { API, ownerAuth, roomToWork } from "./api";

/**
 * THE BAR ACROSS THE TOP — search, the branch, and what a phone was missing.
 *
 * Asked for by the owner in three lines: "on top header Branch dropdown make
 * more perfect", "and also search bar", "mean overall top header". What was
 * wrong with it, found by looking:
 *
 *   SEARCH said "Search or jump to…" and could not jump anywhere; said "⌘ K"
 *     to a Windows counter; was sized to its own placeholder; and on a phone
 *     was not there at all.
 *   THE BRANCH control looked the same with one branch chosen as with all of
 *     them — the one thing it exists to make obvious; its menu said "Main —
 *     Main"; it could not be used from a keyboard; and on a phone it was not
 *     there either.
 *
 * Reads only: which branch is being looked at is this browser's own choice,
 * sent as a header, and saved nowhere on the server.
 */

type Branch = { id: string; name: string; is_default: boolean };

// One owner, 240 requests a minute — see roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, ownerAuth(), 130, "/auth/me");
});

const header = (page: Page) => page.locator("header").first();
const branch = (page: Page) => page.getByTestId("branch-switcher");
const menu = (page: Page) => page.getByRole("listbox", { name: "Operating branch" });
const palette = (page: Page) => page.getByRole("dialog", { name: "Search" });

async function insideTheScreen(page: Page): Promise<void> {
  const measured = await header(page).evaluate((bar) => {
    const screen = document.documentElement.clientWidth;
    const past = [...bar.querySelectorAll("*")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > screen + 0.5; })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);

    return { past, sideways: document.documentElement.scrollWidth - screen };
  });
  expect(measured.past, "part of the header is past the right edge of the screen").toEqual([]);
  expect(measured.sideways, "the page can be dragged sideways").toBeLessThanOrEqual(0);
}

test("search says what it finds — and jumps to a screen, which it always claimed to", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one walk is enough; the phone has its own test below");

  await page.goto("/tenant");
  const field = page.getByTestId("header-search");
  await expect(field).toBeVisible({ timeout: 20_000 });
  await expect(field).toContainText("Search products, customers, sales — or jump to a screen");
  // A field, not a label: it takes the room there is, up to the width a
  // search box is comfortable at (30rem). Sized to its own words it stops short.
  expect(Math.round((await field.boundingBox())!.width), "the search field is the width of its own placeholder again").toBeGreaterThanOrEqual(478);

  // ── opened, it offers somewhere to go before a letter is typed ────
  await field.click();
  await expect(palette(page)).toBeVisible();
  const screens = palette(page).getByTestId("search-screens");
  await expect(screens).toContainText("Go to");
  await expect(screens.getByRole("button", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(screens.getByRole("button", { name: /^POS/ })).toBeVisible();
  await expect(palette(page).getByText("Type at least two characters")).toHaveCount(0);

  // ── a word finds a SCREEN — "exp" used to find nothing at all ─────
  await palette(page).getByRole("textbox", { name: "Search" }).fill("exp");
  await expect(screens).toContainText("Screens");
  const first = screens.getByRole("button").first();
  await expect(first).toContainText("Expenses");
  await expect(first).toContainText("Expense Manager");
  // What is on offer is counted as on offer: it read "0 results" under four screens.
  await expect(palette(page).getByTestId("search-count")).toHaveText(/^[1-9]\d* results?$/, { timeout: 10_000 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tenant\/expenses$/);
  await expect(palette(page)).toHaveCount(0);

  // ── and the keyboard opens it, with the control key a PC has ──────
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
});

test("the keys on the search field are the ones on the keyboard in front of the person", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one walk is enough");

  // A shop's counter: a Windows PC. It was told "⌘ K".
  const pc = await browser.newContext({ storageState: "e2e/.auth/owner.json", viewport: { width: 1366, height: 768 } });
  await pc.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36" });
  });
  const onPc = await pc.newPage();
  await onPc.goto("/tenant");
  await expect(onPc.getByTestId("header-search").locator("kbd")).toHaveText(["Ctrl", "K"], { timeout: 20_000 });
  await pc.close();

  const mac = await browser.newContext({ storageState: "e2e/.auth/owner.json", viewport: { width: 1366, height: 768 } });
  await mac.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
  });
  const onMac = await mac.newPage();
  await onMac.goto("/tenant");
  await expect(onMac.getByTestId("header-search").locator("kbd")).toHaveText(["⌘", "K"], { timeout: 20_000 });
  await mac.close();
});

test("the branch control says when ONE branch is chosen, works from the keyboard, and sends that branch", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "one walk is enough; the phone has its own test below");

  const res = await request.get(`${API}/branches`, { headers: ownerAuth() });
  expect(res.ok()).toBeTruthy();
  const branches = ((await res.json()) as { data: Branch[] }).data;
  expect(branches.length, "this shop has one branch — the control is not drawn, and this test needs it").toBeGreaterThan(1);
  const first = branches[0];

  await page.goto("/tenant");
  await expect(branch(page)).toBeVisible({ timeout: 20_000 });

  // ── every branch: said, and not tinted ────────────────────────────
  await expect(branch(page)).toHaveAttribute("data-scope", "all");
  await expect(branch(page)).toHaveAttribute("aria-label", "Operating branch: All branches");
  await expect(branch(page)).toHaveAttribute("aria-expanded", "false");

  // ── from the keyboard: down opens it, like a select ───────────────
  await branch(page).focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu(page)).toBeVisible();
  await expect(branch(page)).toHaveAttribute("aria-expanded", "true");
  await expect(menu(page).getByRole("option")).toHaveCount(branches.length + 1);
  const all = menu(page).getByRole("option").first();
  await expect(all).toHaveAttribute("aria-selected", "true");
  await expect(all).toContainText("Head office — every branch together");
  // The default branch is not tagged with its own name.
  const home = branches.find((b) => b.is_default);
  if (home && /^main$/i.test(home.name)) {
    await expect(menu(page).getByRole("option").filter({ hasText: "Default" })).toHaveCount(1);
    await expect(menu(page).getByRole("option").filter({ hasText: "Default" })).not.toContainText(/Main\s*Main/);
  }

  // ── choose the first branch: one step down, Enter ─────────────────
  const scoped = page.waitForRequest((r) => r.url().includes("/api/v1/") && r.headers()["x-branch-id"] === first.id, { timeout: 15_000 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(menu(page)).toHaveCount(0);
  await expect(branch(page), "one branch is chosen and the control looks the same as with all of them").toHaveAttribute("data-scope", "branch");
  await expect(branch(page)).toHaveAttribute("aria-label", `Operating branch: ${first.name}`);
  await expect(branch(page)).toContainText(first.name);
  await expect(branch(page), "the keyboard was left somewhere else after choosing").toBeFocused();
  // …and what is asked for next is asked for THAT branch.
  await scoped;

  // The tint is a real one: not the colour the control wears for every branch.
  const tinted = await branch(page).evaluate((el) => getComputedStyle(el).backgroundColor);

  // ── opened again, it shows which one, and Escape gives the keys back ──
  await branch(page).click();
  await expect(menu(page).getByRole("option").filter({ hasText: first.name }).first()).toHaveAttribute("aria-selected", "true");
  await expect(menu(page).getByRole("option").first()).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(branch(page)).toBeFocused();

  // ── back to every branch ──────────────────────────────────────────
  await branch(page).click();
  await menu(page).getByRole("option").first().click();
  await expect(branch(page)).toHaveAttribute("data-scope", "all");
  expect(await branch(page).evaluate((el) => getComputedStyle(el).backgroundColor), "chosen and not chosen are the same colour").not.toBe(tinted);

  // ── and the way to the branches themselves ────────────────────────
  await branch(page).click();
  await page.getByRole("link", { name: "Manage branches" }).click();
  await expect(page).toHaveURL(/\/tenant\/branches$/);
  await expect(menu(page)).toHaveCount(0);
});

for (const width of [390, 320]) {
  test(`on a ${width}px phone the header has search and the branch, and both open inside the screen`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one project sets its own width for this");

    await page.setViewportSize({ width, height: 760 });
    await page.goto("/tenant");
    await expect(branch(page), "a phone has no way to see or change the branch").toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("header-search-icon"), "a phone has no search").toBeVisible();
    await insideTheScreen(page);

    // The branch menu is pinned to the screen, not hung off a control that is
    // not at its edge — it ran off the left.
    await branch(page).click();
    await expect(menu(page)).toBeVisible();
    const panel = (await menu(page).boundingBox())!;
    expect(panel.x, "the branch menu opens off the left of the screen").toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width, "the branch menu opens off the right of the screen").toBeLessThanOrEqual(width);
    await insideTheScreen(page);

    // Chosen, the control says so in colour — on a phone the name is not on it.
    await menu(page).getByRole("option").nth(1).click();
    await expect(branch(page)).toHaveAttribute("data-scope", "branch");
    await insideTheScreen(page);
    await branch(page).click();
    await menu(page).getByRole("option").first().click();
    await expect(branch(page)).toHaveAttribute("data-scope", "all");

    // Search opens, offers somewhere to go, and fits.
    await page.getByTestId("header-search-icon").click();
    await expect(palette(page)).toBeVisible();
    await expect(palette(page).getByTestId("search-screens")).toContainText("Go to");
    const box = (await palette(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  });
}
