import { describe, expect, it } from "vitest";

/**
 * #RS13 — AN UNKNOWN COST IS NOT A COST OF NOTHING.
 *
 * A karahi nobody had costed read "cogs 0 · margin 100%" on the margins tab,
 * and the day's margin with it; a deal's own card never said what it cost.
 * The server now sends null and the revenue it could not cost; these screens
 * must say so rather than print 0. Read as text — the tabs sit behind a shop.
 */
const read = (glob: Record<string, unknown>): string => Object.values(glob).join("\n");
const margins = read(import.meta.glob("./components/StockReportTabs.tsx", { query: "?raw", import: "default", eager: true }));
const overview = read(import.meta.glob("./pages/ReportsPage.tsx", { query: "?raw", import: "default", eager: true }));
const form = read(import.meta.glob("../catalog/pages/ProductFormPage.tsx", { query: "?raw", import: "default", eager: true }));

describe("a cost nobody recorded", () => {
  it("prints as unknown on the margins tab, never as a profit", () => {
    expect(margins).toMatch(/data\.totals\.cogs === null \? "—" : money\(data\.totals\.cogs\)/);
    expect(margins).toMatch(/data\.totals\.profit === null \? "—" : money\(data\.totals\.profit\)/);
    expect(margins).toMatch(/row\.profit === null \? <span[^>]*>No cost<\/span> : money\(row\.profit\)/);
    expect(margins).toMatch(/data\.totals\.uncosted_revenue > 0 &&/);
  });

  it("is named beside the overview's profit", () => {
    expect(overview).toMatch(/\(data\.totals\.uncosted_sales \?\? 0\) > 0 &&/);
  });

  it("is told on a deal's own card, in the shop's money", () => {
    expect(form).toMatch(/<FoodCost deal cost=\{recipeCost\} missing=\{recipeMissing\}/);
    expect(form).toMatch(/function FoodCost\(\{ cost, missing, price, deal = false \}/);
    expect(form).not.toMatch(/Rs \{cost\.toLocaleString\(\)\}/);
  });
});
