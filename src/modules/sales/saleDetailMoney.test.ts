import { describe, expect, it } from "vitest";

/**
 * THE FULL RE-TEST (2026-10-18), #5 and #2/#11: what stands between a bill's
 * total and what was paid is said where the owner reads the bill — the staff
 * tip and the cash rounding — and the rounding is on the Reports row it
 * changes (net profit).
 */
const read = (glob: Record<string, unknown>): string =>
  (Object.values(glob)[0] as string).replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const SALES = read(import.meta.glob("./pages/SalesPage.tsx", { query: "?raw", import: "default", eager: true }));
const REPORTS = read(import.meta.glob("../expenses/pages/ReportsPage.tsx", { query: "?raw", import: "default", eager: true }));

describe("the bill as the owner reads it", () => {
  it("says the tip and the rounding between the total and what was paid", () => {
    const total = SALES.indexOf("Total: {money(detail.data.total)}");
    const paid = SALES.indexOf("Paid {money(detail.data.amount_paid)}");
    const between = SALES.slice(total, paid);

    expect(between).toMatch(/Number\(detail\.data\.tip_amount \?\? 0\) > 0 && \(\s*<div data-sale-tip[^>]*>Staff tip: \{money\(Number\(detail\.data\.tip_amount\)\)\}/);
    expect(between).toMatch(/Number\(detail\.data\.rounding_adjustment \?\? 0\) !== 0 && \(\s*<div data-sale-rounding[^>]*>Cash rounding: \{money\(Number\(detail\.data\.rounding_adjustment\)\)\}/);
  });
});

describe("a bill whose prices already held the tax (#AZ6)", () => {
  it("says the tax inside the total, not between the subtotal and it", () => {
    const subtotal = SALES.indexOf("Subtotal: {money(detail.data.subtotal)}");
    const total = SALES.indexOf("Total: {money(detail.data.total)}");
    const paid = SALES.indexOf("Paid {money(detail.data.amount_paid)}");

    // Added on top only when the prices did not hold it.
    expect(SALES.slice(subtotal, total)).toMatch(/Number\(detail\.data\.tax\) > 0 && !detail\.data\.tax_inclusive && <div>Tax: /);
    // Held inside: said under the total, as the invoice does.
    expect(SALES.slice(total, paid)).toMatch(/Number\(detail\.data\.tax\) > 0 && detail\.data\.tax_inclusive && \(\s*<div data-sale-tax-inside[^>]*>Includes tax \{money/);
  });
});

describe("Reports", () => {
  it("shows the cash rounding beside the net profit it is part of", () => {
    const rounding = REPORTS.indexOf('<MetricCard label="Cash Rounding" value={money(data.totals.cash_rounding ?? 0)} />');
    expect(rounding).toBeGreaterThan(-1);
    expect(rounding).toBeLessThan(REPORTS.indexOf('<MetricCard label="Net Profit"'));
    expect(REPORTS).toMatch(/\(data\.totals\.cash_rounding \?\? 0\) !== 0 && \(\s*<MetricCard label="Cash Rounding"/);
  });
});
