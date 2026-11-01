import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isScannedCode, scanCatcher, SCAN_KEY_GAP_MS } from "./scanAnywhere";

/**
 * #POS2 — measured on the 50k shop: a scan after pressing "+" pressed it again
 * (2 → 3, the scanned item never rung); with the cursor in a quantity box the
 * code became the quantity (× 7,980,000,000,091); after clicking a tile, the
 * tile was pressed again. A scan now finds the till wherever the cursor is.
 */
function harness(opts: { blocked?: boolean } = {}) {
  let clock = 1000;
  const scans: string[] = [];
  const search = document.createElement("input");
  const catcher = scanCatcher({
    isSearchBox: (t) => t === search,
    isBlocked: () => opts.blocked === true,
    onScan: (c) => scans.push(c),
    now: () => clock,
  });
  const press = (target: EventTarget, key: string, gap: number) => {
    clock += gap;
    const e = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true });
    Object.defineProperty(e, "target", { value: target });
    const stop = vi.spyOn(e, "stopPropagation");
    catcher(e);
    // The character lands after keydown, as in a browser.
    if (key.length === 1 && target instanceof HTMLInputElement && !e.defaultPrevented) target.value += key;
    return { prevented: e.defaultPrevented, stopped: stop.mock.calls.length > 0 };
  };
  const scanInto = (target: EventTarget, code: string, gap = 6) => {
    for (const ch of code) press(target, ch, gap);
    return press(target, "Enter", gap);
  };
  return { scans, search, press, scanInto };
}

describe("a scan finds the till wherever the cursor is", () => {
  it("on a button: the code is rung, and Enter does not press the button", () => {
    const h = harness();
    const plus = document.createElement("button");
    const enter = h.scanInto(plus, "7980000000084");
    expect(h.scans).toEqual(["7980000000084"]);
    expect(enter).toEqual({ prevented: true, stopped: true });
  });

  it("a box to type in keeps its own keys — the quantity box knows a barcode by its length", () => {
    const h = harness();
    const qty = document.createElement("input");
    qty.value = "2";
    expect(h.scanInto(qty, "7980000000091").prevented).toBe(false);
    expect(h.scans).toEqual([]);
  });

  it("a person typing on the page, slowly, is left alone", () => {
    const h = harness();
    for (const ch of "123456") h.press(document.body, ch, 180);
    expect(h.press(document.body, "Enter", 200).prevented).toBe(false);
    expect(h.scans).toEqual([]);
  });

  it("a person pressing Enter on a focused button still presses it", () => {
    const h = harness();
    expect(h.press(document.createElement("button"), "Enter", 500).prevented).toBe(false);
  });

  it("a short burst is not a code", () => {
    const h = harness();
    expect(h.scanInto(document.body, "1234").prevented).toBe(false);
    expect(h.scans).toEqual([]);
  });

  it("a run with a person-sized gap in it is not a scan", () => {
    const h = harness();
    const btn = document.createElement("button");
    for (const ch of "798000") h.press(btn, ch, 6);
    h.press(btn, "0", SCAN_KEY_GAP_MS + 200);   // the run starts again here
    expect(h.press(btn, "Enter", 6).prevented).toBe(false);
    expect(h.scans).toEqual([]);
  });

  it("the search box is left to the search box", () => {
    const h = harness();
    expect(h.scanInto(h.search, "7980000000077").prevented).toBe(false);
    expect(h.scans).toEqual([]);
  });

  it("nothing is caught inside a dialog or behind the lock screen", () => {
    const h = harness({ blocked: true });
    expect(h.scanInto(document.createElement("input"), "7980000000077").prevented).toBe(false);
    expect(h.scans).toEqual([]);
  });
});

describe("a quantity box knows a barcode by its length", () => {
  it("eight digits or more is a code; a quantity is not", () => {
    expect(isScannedCode("7980000000091")).toBe(true);
    expect(isScannedCode("96385074")).toBe(true);
    expect(isScannedCode("12")).toBe(false);
    expect(isScannedCode("1500000")).toBe(false);
    expect(isScannedCode("2.5")).toBe(false);
  });

  it("the till's quantity box rings such a code instead of keeping it as the quantity", () => {
    const till = readFileSync(resolve(__dirname, "pages/PosPage.tsx"), "utf8");
    const commit = till.slice(till.indexOf("const commitQty = "), till.indexOf("const setLineDiscount = "));
    expect(commit).toMatch(/if \(isScannedCode\(raw\)\) \{[^}]*scan\(raw\.trim\(\)\)/s);
    expect(commit.indexOf("isScannedCode(raw)")).toBeLessThan(commit.indexOf("setQty(l.key, n)"));
  });
});
