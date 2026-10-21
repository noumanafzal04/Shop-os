import { describe, expect, it } from "vitest";

/**
 * THE RETAIL FLOW, #13 (2026-10-21): a figure was kept only when its box lost
 * focus. The last shelf, typed and handed over, read "never reached" — and
 * applying the count skips exactly those.
 */
const SOURCE = Object.values(
  import.meta.glob("./pages/StockCountSheetPage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("a counted figure", () => {
  it("is kept when the counter stops typing, not only on blur", () => {
    expect(code).toMatch(/typing\.current\[line\.id\] = setTimeout\(\(\) => commit\(line, raw\), 800\);/);
    expect(code).toMatch(/onBlur=\{\(\) => commit\(line\)\}/);
  });

  it("is kept before the Apply sheet asks", () => {
    expect(code).toMatch(/items\.forEach\(\(line\) => \{ if \(draft\[line\.id\] !== undefined\) commit\(line\); \}\);\s*applyModal\.openModal\(\);/);
  });

  it("does not throw away what was typed while it was being saved", () => {
    expect(code).toMatch(/if \(d\[line\.id\] !== raw\) return d;/);
  });
});
