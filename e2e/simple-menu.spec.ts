import { expect, test, type Page } from "@playwright/test";

import { ownerAuth, roomToWork } from "./api";

/**
 * YOUR SIMPLE MENU — the gear at the foot of the rail.
 *
 * Asked for in the owner's words: the Simple view is the menus used every
 * day, by permission — "or they add them themselves: a settings icon on the
 * sidebar, with a toggle to add a menu or a sub-menu to the simple view".
 *
 * Walked the way a person would use it, on every shape of screen the rail
 * has (pinned, a strip of icons, a drawer):
 *
 *   the Simple view starts as the day's work — no Reports, no Purchases
 *   the gear lists every screen, and its title is not under the header
 *   a sub-menu switched on alone is a link that says where it goes
 *   its sibling switched on makes the group a group again
 *   it is still there after a reload — and is this person's own
 *   a whole group goes with one switch; the Dashboard cannot go at all
 *   "Back to the usual menu" undoes all of it and keeps nothing
 *
 * Nothing is written to the server: a menu is this browser's own.
 */

// One owner, 240 requests a minute — see roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, ownerAuth(), 60, "/auth/me");
});

const rail = (page: Page) => page.locator("aside").first().locator("nav");
/**
 * A ROW of the rail — not a screen inside an open group, which is a link too.
 * By its name, which a strip of icons carries as a title.
 */
const link = (page: Page, name: string) =>
  rail(page).getByRole("link", { name, exact: true }).and(rail(page).locator(":scope > ul > li > a"));
const group = (page: Page, name: string) => rail(page).getByRole("button", { name, exact: true });
const gear = (page: Page) => page.getByRole("button", { name: "Choose what Simple view shows" });
const chooser = (page: Page) => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Your Simple menu" }) });
const flip = (page: Page, name: string) => chooser(page).getByRole("switch", { name, exact: true });

/** Below this the rail is a drawer, and has to be opened to be pressed. */
const isDrawer = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024;

/** Where the drawer is: fully on the screen, fully off it, or on its way. */
async function drawer(page: Page): Promise<"open" | "shut" | "moving"> {
  const box = await page.locator("aside").first().boundingBox();
  if (box === null || box.x + box.width <= 0) return "shut";

  return box.x >= 0 ? "open" : "moving";
}

/** A drawer steps aside for whatever was pressed on it, and takes a moment to go. */
async function theDrawerHasGone(page: Page): Promise<void> {
  if (!isDrawer(page)) return;
  await expect.poll(() => drawer(page), { message: "the drawer stayed over what it opened" }).toBe("shut");
}

async function openTheRail(page: Page): Promise<void> {
  if (!isDrawer(page)) return;

  await expect.poll(() => drawer(page)).not.toBe("moving");
  if ((await drawer(page)) === "open") return;
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect.poll(() => drawer(page)).toBe("open");
}

async function openTheChooser(page: Page): Promise<void> {
  await openTheRail(page);
  await gear(page).click();
  await expect(chooser(page)).toBeVisible();
  await theDrawerHasGone(page);
}

/** The switch says its name on a wide rail and wears it as a title on a strip of icons. */
const fullView = (page: Page) => page.getByRole("button", { name: /^(Full view|Switch to full view)$/ });

async function done(page: Page): Promise<void> {
  await chooser(page).getByRole("button", { name: "Done", exact: true }).click();
  await expect(chooser(page)).toHaveCount(0);
}

const kept = (page: Page) => page.evaluate(() =>
  Object.keys(localStorage).filter((k) => k.startsWith("shopos-simple-menu:")).map((k) => [k, localStorage.getItem(k)] as const));

test("a person puts their own screens on the Simple view, and takes them off again", async ({ page }) => {
  // The first load of this walk, and only the first: Simple view, with
  // nothing chosen. Later loads have to find what the walk itself left.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-simple-menu")) return;
    sessionStorage.setItem("e2e-simple-menu", "1");
    localStorage.setItem("ui_mode", "basic");
    for (const key of Object.keys(localStorage)) if (key.startsWith("shopos-simple-menu")) localStorage.removeItem(key);
  });

  await page.goto("/tenant");
  await expect(link(page, "Dashboard")).toHaveCount(1, { timeout: 20_000 });

  // ── the usual menu: the day's work, and the back office out of the way ──
  for (const daily of ["POS", "Sales", "Day & banking", "Settings", "Help Centre"]) {
    await expect(link(page, daily), `${daily} is not on the Simple view`).toHaveCount(1);
  }
  for (const backOffice of ["Reports", "Purchases", "Suppliers", "Subscription"]) {
    await expect(link(page, backOffice), `${backOffice} is on the Simple view before anybody asked`).toHaveCount(0);
  }
  await expect(group(page, "Purchases")).toHaveCount(0);

  // ── the gear ──────────────────────────────────────────────────────
  await openTheChooser(page);

  // Its title is ON TOP, not printed over by the header it was opened under.
  const title = chooser(page).getByRole("heading", { name: "Your Simple menu" });
  const covered = await title.evaluate((h) => {
    const r = h.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);

    return r.top < 0 || at === null || !(h === at || h.contains(at));
  });
  expect(covered, "the dialog's title is under something else").toBe(false);
  // …and the way out is on the screen without scrolling a forty-row list.
  await expect(chooser(page).getByRole("button", { name: "Done", exact: true })).toBeInViewport();

  // The Dashboard is where a refused screen sends you. It cannot be switched off.
  await expect(flip(page, "Dashboard")).toBeDisabled();
  await expect(flip(page, "Dashboard")).toHaveAttribute("aria-checked", "true");

  // What is on says so, and what is not says so.
  await expect(flip(page, "POS")).toHaveAttribute("aria-checked", "true");
  await expect(flip(page, "Reports")).toHaveAttribute("aria-checked", "false");
  await expect(flip(page, "Purchases")).toHaveAttribute("aria-checked", "false");
  await expect(chooser(page).getByTestId("simple-menu-group-Purchases")).toContainText("0 of 2");

  // ── a menu, and a sub-menu on its own ─────────────────────────────
  await flip(page, "Reports").click();
  await flip(page, "Suppliers").click();
  await expect(chooser(page).getByTestId("simple-menu-group-Purchases")).toContainText("1 of 2");
  await expect(flip(page, "Purchases"), "a group with one screen on does not read as on").toHaveAttribute("aria-checked", "true");
  await done(page);

  await expect(link(page, "Reports")).toHaveCount(1);
  // One screen of the group: a link, and it says where it goes — not "Purchases".
  await expect(link(page, "Suppliers")).toHaveCount(1);
  await expect(link(page, "Purchases")).toHaveCount(0);
  await expect(group(page, "Purchases")).toHaveCount(0);

  // It goes where it says.
  await openTheRail(page);
  await link(page, "Reports").click();
  await expect(page).toHaveURL(/\/tenant\/reports$/);
  await theDrawerHasGone(page);

  // ── its sibling makes the group a group again ─────────────────────
  await openTheChooser(page);
  await flip(page, "Purchase orders").click();
  await expect(chooser(page).getByTestId("simple-menu-group-Purchases")).toContainText("2 of 2");
  await done(page);
  await expect(group(page, "Purchases")).toHaveCount(1);
  await expect(link(page, "Suppliers"), "a group of two is still drawn as a loose link").toHaveCount(0);

  // ── remembered, and as this person's own ──────────────────────────
  await page.reload();
  await expect(link(page, "Reports")).toHaveCount(1, { timeout: 20_000 });
  await expect(group(page, "Purchases")).toHaveCount(1);

  const mine = await kept(page);
  expect(mine, "the choice is not kept under one person's key").toHaveLength(1);
  expect(mine[0][0]).toMatch(/^shopos-simple-menu:[0-9a-f-]{36}$/);
  expect(JSON.parse(mine[0][1] ?? "{}")).toEqual({
    add: ["/tenant/purchases", "/tenant/reports", "/tenant/suppliers"],
    drop: [],
  });

  // ── a usual screen off, and a whole group off with one switch ─────
  await openTheChooser(page);
  await flip(page, "Sales").click();
  await flip(page, "Expense Manager").click();
  await expect(chooser(page).getByTestId("simple-menu-group-Expense Manager")).toContainText("0 of 4");
  for (const book of ["Cashbook", "Ledger", "Income", "Expenses"]) {
    await expect(flip(page, book), `${book} stayed on after its group was switched off`).toHaveAttribute("aria-checked", "false");
  }
  await done(page);
  await expect(link(page, "Sales")).toHaveCount(0);
  await expect(group(page, "Expense Manager")).toHaveCount(0);
  // Off the Simple view is not off the shop: the screen still opens.
  await page.goto("/tenant/sales");
  await expect(page.getByRole("heading", { name: "Sales", level: 1 })).toBeVisible({ timeout: 20_000 });

  // ── Full view has everything, whatever was chosen ─────────────────
  await openTheRail(page);
  await fullView(page).click();
  await expect(link(page, "Sales")).toHaveCount(1);
  await expect(group(page, "Expense Manager")).toHaveCount(1);
  await expect(group(page, "Offers & discounts")).toHaveCount(1);

  // Opened from Full view, the dialog says where its result is — and goes there.
  await gear(page).click();
  await expect(chooser(page)).toContainText("You are in Full view");
  await chooser(page).getByRole("button", { name: "Switch to Simple" }).click();
  await expect(chooser(page).getByText("You are in Full view")).toHaveCount(0);
  await expect(link(page, "Sales"), "the rail did not go back to this person's Simple view").toHaveCount(0);

  // ── and back to the usual menu, keeping nothing ───────────────────
  const usual = chooser(page).getByRole("button", { name: "Back to the usual menu" });
  await expect(usual).toBeEnabled();
  await usual.click();
  await expect(usual, "nothing is chosen and the way back is still offered").toBeDisabled();
  await expect(flip(page, "Sales")).toHaveAttribute("aria-checked", "true");
  await expect(flip(page, "Reports")).toHaveAttribute("aria-checked", "false");
  await done(page);

  await expect(link(page, "Sales")).toHaveCount(1);
  await expect(group(page, "Expense Manager")).toHaveCount(1);
  await expect(link(page, "Reports")).toHaveCount(0);
  await expect(group(page, "Purchases")).toHaveCount(0);
  expect(await kept(page), "the usual menu was kept as a record of its own").toEqual([]);
});
