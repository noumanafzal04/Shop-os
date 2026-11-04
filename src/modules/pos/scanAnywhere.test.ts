import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { backToTheScanBox, cursorFellToThePage, isScannedCode, scanCatcher, SCAN_KEY_GAP_MS } from "./scanAnywhere";

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

/**
 * #POS3 — a shop's USB scanner: scan, press a line's ✕ (or Reset), scan again —
 * nothing until a reload. The ✕ took the cursor with it, and the scanner was
 * slower than the catcher's old 50 ms. Both halves are fixed: the cursor goes
 * back to the box, and the catcher keeps a slow scanner's pace.
 */
describe("after ✕ or Reset the scanner still scans", () => {
  const setup = () => {
    document.body.innerHTML = "";
    const box = document.createElement("input");
    const other = document.createElement("input");
    const btn = document.createElement("button");
    document.body.append(box, other, btn);
    return { box, other, btn };
  };
  const keyboard = { locked: false, finePointer: true };

  it("the cursor that fell to the page goes back to the scan box", () => {
    const { box } = setup();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(cursorFellToThePage(document)).toBe(true);
    expect(backToTheScanBox(box, keyboard)).toBe(true);
    expect(document.activeElement).toBe(box);
  });

  it("so does one left on a button that switched itself off — Reset with the cart empty", () => {
    const { box, btn } = setup();
    btn.focus();
    btn.disabled = true;
    expect(backToTheScanBox(box, keyboard)).toBe(true);
    expect(document.activeElement).toBe(box);
  });

  it("never takes the cursor from a box somebody is typing in", () => {
    const { box, other } = setup();
    other.focus();
    expect(backToTheScanBox(box, keyboard)).toBe(false);
    expect(document.activeElement).toBe(other);
  });

  it("never on a tablet, behind the lock screen, or while a dialog is open", () => {
    const { box } = setup();
    expect(backToTheScanBox(box, { locked: false, finePointer: false })).toBe(false);
    expect(backToTheScanBox(box, { locked: true, finePointer: true })).toBe(false);

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    Object.assign(dialog, { checkVisibility: () => true });
    document.body.append(dialog);
    expect(backToTheScanBox(box, keyboard)).toBe(false);
    expect(document.activeElement).not.toBe(box);
  });

  it("a hidden dialog — the Appearance panel is always in the page — does not count", () => {
    const { box } = setup();
    const hidden = document.createElement("div");
    hidden.setAttribute("role", "dialog");
    Object.assign(hidden, { checkVisibility: () => false });
    document.body.append(hidden);
    expect(backToTheScanBox(box, keyboard)).toBe(true);
  });

  it("a scanner that types a key every 80 ms is still a scanner off the box", () => {
    const h = harness();
    expect(h.scanInto(document.body, "8964001234561", 80).prevented).toBe(true);
    expect(h.scans).toEqual(["8964001234561"]);
  });

  it("the till sends the cursor back after ✕, after Reset, and whenever it falls to the page", () => {
    const till = readFileSync(resolve(__dirname, "pages/PosPage.tsx"), "utf8");
    const remove = till.slice(till.indexOf("const removeLine = "), till.indexOf("const commitQty = "));
    const reset = till.slice(till.indexOf("const clearSale = "), till.indexOf("const clearSale = ") + 3000);
    expect(remove).toContain("backToTheScanBox(scanRef.current");
    expect(reset.slice(0, reset.indexOf("\n  };") + 5)).toContain("backToTheScanBox(scanRef.current");
    expect(till).toMatch(/addEventListener\("focusout", fell\)/);
  });
});
