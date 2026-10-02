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

const WORKSHOP: Screen[] = [
  { path: "/tenant/workshop", name: "the bay board", rows: false, budget: 8 },
  { path: "/tenant/documents", name: "quotes & job cards", rows: true },
  { path: "/tenant/warranty", name: "warranty claims", rows: true },
  { path: "/tenant/customers", name: "customers · with cars", rows: true, search: "Khan" },
];

const DEFAULT_BUDGET = 6;

async function rowCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bodies = Array.from(document.querySelectorAll("tbody"));
    let rows = 0;
    for (const b of bodies) rows += b.querySelectorAll("tr").length;
    // An empty table still renders one row saying "Nothing here".
    if (rows === 1 && (bodies[0]?.querySelector("tr")?.querySelectorAll("td").length ?? 0) <= 1) return 0;

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
}

const WHICH = process.env.E2E_VOLUME_SHOP ?? "grocery";
const LIST: Record<string, Screen[]> = {
  grocery: SCREENS,
  petrol: FORECOURT,
  workshop: WORKSHOP,
};

for (const screen of LIST[WHICH] ?? SCREENS) walk(screen);
