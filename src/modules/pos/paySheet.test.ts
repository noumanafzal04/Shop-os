import { describe, expect, it } from "vitest";

/**
 * THE PAY SHEET, as the user asked for it (2026-10-21): the shop's default
 * tender is the one button and the rest are a list; goods taken in part-payment
 * are folded away until wanted; khata asks whose, right there; and Enter
 * completes the sale from wherever the cursor is in the sheet.
 */
const SOURCE = Object.values(
  import.meta.glob("./pages/PosPage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("the pay sheet", () => {
  it("asks how it is paid in one list, the shop's default already chosen", () => {
    const row = code.slice(code.indexOf('id="tender-method"'), code.indexOf('id="tender-method"') + 700);
    expect(row).toMatch(/value=\{method\}\s*onChange=\{\(e\) => setMethod\(e\.target\.value as PayMethod\)\}/);
    expect(row).toContain('{METHOD_LABEL[m]}{m === defaultTender ? " (default)" : ""}');
    // …and the sheet opens on the default (openTender), so it is selected.
    expect(code).toMatch(/setMethod\(defaultTender\);\s*setTradeInOpen\(false\);/);
    expect(code).not.toContain('aria-label="Pay another way"');
  });

  it("puts the extras — who served, a tip, goods taken in — under the money", () => {
    const at = (needle: string) => code.indexOf(needle);
    expect(at('id="tender-method"')).toBeLessThan(at("data-pay-extras"));
    expect(at("data-pay-extras")).toBeLessThan(at("<ServedByRow"));
    expect(at("data-pay-extras")).toBeLessThan(at('id="till-tip"'));
    expect(at("data-pay-extras")).toBeLessThan(at("Take goods in part-payment"));
  });

  it("does not let khata through on a name alone — the server finds the account by phone", () => {
    expect(code).toMatch(/const creditNeedsCustomer = \(method === "credit" \|\| splitHasCredit\) && customerPhone\.trim\(\) === "";/);
  });

  it("folds the trade-in away until it is asked for, and opens each sheet folded", () => {
    expect(code).toMatch(/has\("inventory"\) && !tradeInOpen && tradeIns\.length === 0 && \(/);
    expect(code).toMatch(/has\("inventory"\) && \(tradeInOpen \|\| tradeIns\.length > 0\) && \(/);
    expect(code).toMatch(/setTradeInOpen\(false\);\s*setTendered/);
  });

  it("asks whose khata on the sheet itself", () => {
    const khata = code.slice(code.indexOf("data-khata-who"), code.indexOf("data-khata-who") + 700);
    expect(khata).toMatch(/aria-label="Customer name"[^>]*value=\{customer\}/);
    expect(khata).toMatch(/aria-label="Customer phone"[^>]*value=\{customerPhone\}/);
    expect(code).not.toContain("Attach a customer (Customer button)");
  });

  it("completes on Enter wherever the cursor is — but leaves buttons and lists to answer it themselves", () => {
    expect(code).toMatch(/if \(e\.key === "Enter" && !e\.isComposing && a\.complete\(e\.target\)\) \{ e\.preventDefault\(\); return; \}/);
    const complete = code.slice(code.indexOf("complete: (target) => {"), code.indexOf("complete: (target) => {") + 400);
    expect(complete).toMatch(/if \(!tenderModal\.isOpen\) return false;/);
    expect(complete).toMatch(/\["BUTTON", "SELECT", "TEXTAREA", "A"\]\.includes\(target\.tagName\)\) return false;/);
    expect(complete).toMatch(/if \(!canCheckout \|\| checkout\.isPending\) return false;\s*checkout\.mutate\(\);/);
  });

  it("opens with the cash box ready to type into", () => {
    expect(code).toMatch(/<Input id="tender-cash"/);
    expect(code).toMatch(/document\.getElementById\("tender-cash"\) as HTMLInputElement \| null\)\?\.select\(\)/);
  });
});
