import { describe, expect, it } from "vitest";

/**
 * THE FULL RE-TEST, #3 (2026-10-18): a cashier's discount past the shop's
 * limit was refused with "a manager has to approve it", and the till offered
 * no way to. Now the refusal asks, a manager's PIN on this till answers, and
 * the answer goes with the next press — online only, kept nowhere.
 */
const SOURCE = Object.values(
  import.meta.glob("./pages/PosPage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("a discount past the limit, approved at the till", () => {
  it("turns the server's refusal into the question, not a failure", () => {
    expect(code).toMatch(/if \(error instanceof ApiError && error\.errorCode === "DISCOUNT_LIMIT_EXCEEDED"\) \{\s*setDiscountAsk\(error\.message\);\s*return;/);
    expect(code).toMatch(/!\(checkout\.error instanceof ApiError && checkout\.error\.errorCode === "DISCOUNT_LIMIT_EXCEEDED"\)/);
    expect(code).toMatch(/<RefundApproval needsApproval ownDrawer=\{null\} value=\{discountApproval\} onChange=\{setDiscountApproval\} purpose="discount" drawerNeeded=\{false\} \/>/);
  });

  it("holds Complete until a manager is chosen and their PIN typed", () => {
    expect(code).toMatch(/const discountHeld = discountAsk !== null && !approvalReady\(discountApproval, true\);/);
    expect(code).toMatch(/const canCheckout = [^;]*!discountHeld/);
  });

  it("sends the yes with the sale and with a re-ring — never into the offline queue", () => {
    expect(code).toMatch(/salesService\.create\(\{ \.\.\.payload, expected_payable: payable, \.\.\.discountYes\(\) \}\)/);
    const reRing = code.slice(code.indexOf("salesService.reRing("), code.indexOf("salesService.reRing(") + 300);
    expect(reRing).toMatch(/\.\.\.discountYes\(\)/);
    const payload = code.slice(code.indexOf("const payload: SaleInput = {"), code.indexOf("if (!connected) return { data: await ringOffline("));
    expect(payload).not.toMatch(/discount_approval|discountYes/);
  });

  it("forgets the yes when the sale is cleared or the bill changes", () => {
    const clear = code.slice(code.indexOf("const clearSale"), code.indexOf("const clearSale") + 400);
    expect(clear).toMatch(/setDiscountAsk\(null\)/);
    expect(clear).toMatch(/setDiscountApproval\(NO_APPROVAL\)/);
    expect(code).toMatch(/useEffect\(\(\) => \{\s*setDiscountAsk\(null\);\s*setDiscountApproval\(NO_APPROVAL\);\s*\}, \[cart, discount\]\);/);
  });
});
