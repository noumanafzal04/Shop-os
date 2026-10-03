import { test, expect, type Page } from "@playwright/test";

/**
 * THE SCREENS, AT THE SIZE A REAL SHOP IS.
 *
 * Six thousand products, 18,000 stock rows, 1,440 customers, 91 closed
 * shifts, 23,400 stock-count lines. Almost everything works at twenty-eight
 * rows, which is what every other browser project here is looking at.
 *
 * Three questions only a browser at this size can answer:
 *
 *   DOES IT ARRIVE      a screen that takes eleven seconds is a screen the
 *                       shopkeeper force-quits. Measured, with a ceiling.
 *   IS THERE A PAGE TWO a list that can only ever show page one has been
 *                       this repo's single most repeated defect — nine
 *                       separate instances before anybody counted.
 *   DOES SEARCH REACH   typing has to ask the SERVER. A filter over the
 *                       first page is a filter over 50 of 6,000 rows, and it
 *                       looks exactly like a working one.
 */

type Screen = {
  path: string;
  name: string;
  /** Rows this screen must be showing — it has the data. */
  rows: boolean;
  /** A term that must find something the first page does not already show. */
  search?: string;
  /** Seconds this screen may take before it is a finding. */
  budget?: number;
};

const SCREENS: Screen[] = [
  { path: "/tenant", name: "dashboard", rows: false, budget: 8 },
  { path: "/tenant/products", name: "catalog · 6,000 lines", rows: true, search: "Rice" },
  { path: "/tenant/inventory", name: "inventory", rows: true },
  { path: "/tenant/customers", name: "customers · 1,440", rows: true, search: "Khan" },
  { path: "/tenant/sales", name: "sales", rows: true },
  { path: "/tenant/suppliers", name: "suppliers", rows: true },
  { path: "/tenant/purchases", name: "purchase orders", rows: true },
  { path: "/tenant/expenses", name: "expenses", rows: true },
  { path: "/tenant/disposals", name: "write-offs", rows: true },
  { path: "/tenant/stocktake", name: "stock counts", rows: true },
  { path: "/tenant/transfers", name: "branch transfers", rows: true },
  { path: "/tenant/coupons", name: "coupons", rows: true },
  // A real screen no browser had ever opened. It is behind `bank_offers`,
  // which only two load-test shops have, so it fell through every list.
  { path: "/tenant/bank-offers", name: "bank card offers", rows: true },
  { path: "/tenant/day", name: "day & banking · 91 shifts", rows: true },
  { path: "/tenant/cashbook", name: "the cashbook", rows: false },
  { path: "/tenant/ledger", name: "the ledger", rows: false },
  { path: "/tenant/reports", name: "reports", rows: false, budget: 10 },
  // The other door. Both of these were empty on every load-test shop until
  // the fixture switched the marketplace module on beside the flag — so
  // neither screen had ever been looked at with a real queue on it.
  { path: "/tenant/orders", name: "online orders", rows: true },
  { path: "/tenant/riders", name: "riders · cash held", rows: true },
];

/**
 * The two trades that had no load-test shop at all until today. They are a
 * DIFFERENT TENANT, so they get their own sign-in and their own project —
 * putting them in the list above would have asked a grocery for its bay
 * board.
 */
const FORECOURT: Screen[] = [
  { path: "/tenant/fuel", name: "the forecourt", rows: false, budget: 8 },
  { path: "/tenant/fuel/deliveries", name: "tanker deliveries", rows: true },
  { path: "/tenant/fuel/setup", name: "tanks & pumps", rows: false },
  { path: "/tenant/day", name: "day & banking · forecourt", rows: true },
];

/**
 * THE BOOKS-ONLY OFFICE — no till, no catalogue, no stock.
 *
 * The seeder calls it "the shape most likely to be broken by a change made
 * for everybody else", and it had never been walked by a browser. It is also
 * the one shop granted Basic HR, so these nine placeholder screens are
 * finally opened by something: they render a "not built yet" notice, and a
 * notice that throws is indistinguishable from a broken product.
 */
const FINANCE: Screen[] = [
  { path: "/tenant", name: "the office dashboard", rows: false, budget: 8 },
  { path: "/tenant/expenses", name: "expenses · books-only", rows: true },
  { path: "/tenant/income", name: "other income", rows: true },
  { path: "/tenant/cashbook", name: "the cashbook · no sales to lean on", rows: false },
  { path: "/tenant/hrm", name: "Basic HR", rows: false },
  { path: "/tenant/hrm/attendance", name: "HR · attendance", rows: false },
  { path: "/tenant/hrm/leaves", name: "HR · leaves", rows: false },
  { path: "/tenant/hrm/shifts", name: "HR · shifts", rows: false },
  { path: "/tenant/hrm/advances", name: "HR · advances", rows: false },
  { path: "/tenant/hrm/commission", name: "HR · commission", rows: false },
  { path: "/tenant/hrm/payroll", name: "HR · payroll", rows: false },
  { path: "/tenant/hrm/reports", name: "HR · reports", rows: false },
  { path: "/tenant/hrm/settings", name: "HR · settings", rows: false },
];

const WORKSHOP: Screen[] = [
  { path: "/tenant/workshop", name: "the bay board", rows: false, budget: 8 },
  { path: "/tenant/documents", name: "quotes & job cards", rows: true },
  { path: "/tenant/warranty", name: "warranty claims", rows: true },
  { path: "/tenant/customers", name: "customers · with cars", rows: true, search: "Khan" },
];

const DEFAULT_BUDGET = 6;

/**
 * HOW MANY RECORDS THIS SCREEN IS SHOWING.
 *
 * It counted table rows and nothing else, which made it blind to every
 * screen built as a list — and it reported those as EMPTY rather than as
 * unmeasurable. The warranty desk, on a shop holding seven units, failed
 * with "showed no rows, in a shop that has the data": a finding about this
 * function, stated as a finding about the product.
 *
 * A screen that renders records as a list says so with `data-rows`. Being
 * told beats guessing at a selector: `ul li` would have counted every
 * navigation menu on the page.
 */
async function rowCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bodies = Array.from(document.querySelectorAll("tbody"));
    let rows = 0;
    for (const b of bodies) rows += b.querySelectorAll("tr").length;
    // An empty table still renders one row saying "Nothing here".
    if (rows === 1 && (bodies[0]?.querySelector("tr")?.querySelectorAll("td").length ?? 0) <= 1) rows = 0;

    for (const list of Array.from(document.querySelectorAll("[data-rows]"))) {
      rows += list.children.length;
    }

    return rows;
  });
}

function walk(screen: Screen): void {
  test(`${screen.name} — arrives, pages and searches`, async ({ page }) => {
    const started = Date.now();
    await page.goto(screen.path);
    await page.waitForLoadState("networkidle").catch(() => {});
    const seconds = (Date.now() - started) / 1000;

    // Still where it asked for. A guard redirect would make everything below
    // describe the dashboard — see four-doors.spec.ts.
    expect(new URL(page.url()).pathname, `${screen.name} was redirected`).toBe(screen.path);

    expect(
      seconds,
      `${screen.name} took ${seconds.toFixed(1)}s to settle at this size`,
    ).toBeLessThan(screen.budget ?? DEFAULT_BUDGET);

    if (!screen.rows) return;

    const first = await rowCount(page);
    expect(first, `${screen.name} showed no rows, in a shop that has the data`).toBeGreaterThan(0);

    // ── PAGE TWO ─────────────────────────────────────────────────────
    const next = page.getByRole("button", { name: /^next$/i }).first();
    if (await next.isVisible().catch(() => false)) {
      const before = await page.locator("tbody tr").first().innerText().catch(() => "");
      await next.click({ force: true });
      await page.waitForTimeout(1200);

      const after = await page.locator("tbody tr").first().innerText().catch(() => "");
      expect(await rowCount(page), `${screen.name} page two is empty`).toBeGreaterThan(0);
      expect(after, `${screen.name} page two shows the same first row as page one`).not.toBe(before);
    }

    // ── SEARCH REACHES THE WHOLE SHOP ────────────────────────────────
    if (screen.search !== undefined) {
      const box = page.getByPlaceholder(/search/i).first();
      await box.fill(screen.search);
      await page.waitForTimeout(1400);

      const found = await rowCount(page);
      expect(found, `searching "${screen.search}" found nothing on ${screen.name}`).toBeGreaterThan(0);

      const text = (await page.locator("tbody").first().innerText()).toLowerCase();
      expect(
        text.includes(screen.search.toLowerCase()),
        `${screen.name} kept showing rows that do not match "${screen.search}"`,
      ).toBeTruthy();
    }
  });
}

const WHICH = process.env.E2E_VOLUME_SHOP ?? "grocery";
const LIST: Record<string, Screen[]> = {
  grocery: SCREENS,
  petrol: FORECOURT,
  workshop: WORKSHOP,
  finance: FINANCE,
};

for (const screen of LIST[WHICH] ?? SCREENS) walk(screen);

/**
 * A DEPARTMENT THIS SHOP DOES OR DOES NOT HAVE.
 *
 * Basic HR is nine screens that say "not built yet" and save nothing. Until
 * it had a module key there was nothing to gate it on, so every shop on the
 * platform carried an HR department in its sidebar — a grocery, a filling
 * station, a one-person accountancy office.
 *
 * Both directions, because only the pair is evidence. An absence assertion
 * passes for every reason the thing could be missing and only one of them is
 * the reason you meant — this one already passed twice with the gate
 * deliberately removed, first because HRM is a collapsible group whose
 * children are not in the DOM, then because the sidebar hides it in Simple
 * mode and Simple is the default.
 *
 * The books-only office is the one shop granted it; everybody else is a live
 * check that the gate holds.
 */
test("the sidebar offers HR to exactly the shop that was given it", async ({ page }) => {
  /**
   * IN FULL VIEW, which is the only view that could show it: HRM is
   * back-office work and the sidebar hides it in Simple mode. Set before the
   * reload, because the mode is read from localStorage once, on mount.
   */
  await page.goto("/tenant");
  await page.evaluate(() => localStorage.setItem("ui_mode", "advanced"));
  await page.reload();
  await page.waitForLoadState("networkidle").catch(() => {});

  const sidebar = page.locator("aside").first();
  await expect(sidebar).toBeVisible();

  // The GROUP label, not its children — see the docblock above.
  const text = await sidebar.innerText();

  if (WHICH === "finance") {
    expect(text, "the shop that WAS given Basic HR cannot reach it").toMatch(/\bHRM\b/);

    return;
  }

  expect(text, "a shop with no HR module was offered an HRM menu").not.toMatch(/\bHRM\b/);
});
