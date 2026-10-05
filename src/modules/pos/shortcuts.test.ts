import { describe, expect, it } from "vitest";
import { SHORTCUT_KEYS, isAppleKeyboard, keyLabel, keyTitle, shortcutFor } from "./shortcuts";

/**
 * THE TILL'S KEYS.
 *
 * Reported: *"short key b work ni kr rhi keyboard keys."* Two different
 * faults, and no test pressed a key to find either:
 *
 *   F9 asked a different question from the button it mirrors. The Pay button
 *   opens when the till `canRing`; F9 opened only when a shift was OPEN. Most
 *   shops never ask for shifts, so on most shops F9 did nothing at all.
 *
 *   On a Mac every F-key is a media key unless `fn` is held. The keydown never
 *   arrives, and from the screen that is a shortcut that is broken.
 */

const SOURCE = Object.values(
  import.meta.glob("./pages/PosPage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("which key does what", () => {
  it("the function keys, with nothing held", () => {
    expect(shortcutFor({ key: "F2" })).toBe("focusSearch");
    expect(shortcutFor({ key: "F4" })).toBe("hold");
    expect(shortcutFor({ key: "F6" })).toBe("openHeld");
    expect(shortcutFor({ key: "F7" })).toBe("document");
    expect(shortcutFor({ key: "F9" })).toBe("pay");
  });

  it("Alt + a letter, for a keyboard whose F-keys are not F-keys", () => {
    expect(shortcutFor({ key: "p", code: "KeyP", altKey: true })).toBe("pay");
    expect(shortcutFor({ key: "s", code: "KeyS", altKey: true })).toBe("focusSearch");
  });

  it("is matched on the KEY POSITION — Option+P on a Mac types π", () => {
    // A rule written against the letter would never fire on the one machine
    // this exists for.
    expect(shortcutFor({ key: "π", code: "KeyP", altKey: true })).toBe("pay");
    expect(shortcutFor({ key: "ß", code: "KeyS", altKey: true })).toBe("focusSearch");
  });

  it("leaves ordinary typing alone", () => {
    // A cashier typing "pepsi" into the search box.
    expect(shortcutFor({ key: "p", code: "KeyP" })).toBeNull();
    // AltGr on a European layout is Ctrl+Alt: somebody typing a character.
    expect(shortcutFor({ key: "p", code: "KeyP", altKey: true, ctrlKey: true })).toBeNull();
    // Cmd+Option+… belongs to the browser.
    expect(shortcutFor({ key: "p", code: "KeyP", altKey: true, metaKey: true })).toBeNull();
    expect(shortcutFor({ key: "F5" })).toBeNull();
  });

  it("every action has both keys, and no two actions share one", () => {
    expect(SHORTCUT_KEYS).toHaveLength(5);
    expect(new Set(SHORTCUT_KEYS.map((s) => s.fn)).size).toBe(5);
    expect(new Set(SHORTCUT_KEYS.map((s) => s.code)).size).toBe(5);
  });
});

describe("what is printed is the key the counter was taught", () => {
  it("the function key, on every machine", () => {
    // "⌥P" on a Mac was read as the keys having been removed.
    expect(keyLabel("pay")).toBe("F9");
    expect(keyLabel("focusSearch")).toBe("F2");
  });

  it("the tooltip names the second key, and how to reach the first on a Mac", () => {
    expect(keyTitle("pay", false)).toBe("Pay · F9 or Alt+P");
    expect(keyTitle("pay", true)).toMatch(/hold fn/);
    expect(keyTitle("pay", true)).toMatch(/Option\+P/);
  });

  it("knows an Apple keyboard", () => {
    expect(isAppleKeyboard({ platform: "MacIntel" })).toBe(true);
    expect(isAppleKeyboard({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)" })).toBe(false);
    expect(isAppleKeyboard(undefined)).toBe(false);
  });
});

describe("the page listens through the one table", () => {
  it("still SHOWS the keys, in the bar a cashier learns them from", () => {
    // The legend was removed once, as a duplicate of the hints on the buttons
    // below it. The shop asked for it back the same day: it is where the keys
    // are learned, and taking it away looked like taking the keys away.
    expect(code).toMatch(/SHORTCUT_KEYS\.filter\([^\n]*\)\.map\(\(\{ action, label \}\) => \(/);
    expect(code).toMatch(/\{keyLabel\(action\)\}/);
  });

  it("asks `shortcutFor`, and has no key list of its own", () => {
    expect(code).toMatch(/const run = shortcutFor\(e\);/);
    expect(code).not.toMatch(/case "F9"/);
  });

  it("F9 asks the question the Pay button asks", () => {
    /**
     * The button: `disabled={cart.length === 0 || !canRing}`.
     * The key used to say `&& open` — a shift — which is a different rule.
     * A shop that never asked for shifts could click Pay and not press it.
     */
    const pay = code.slice(code.indexOf("pay: () => {"), code.indexOf("openHeld: () => {"));
    expect(pay).toMatch(/canRing/);
    expect(pay).not.toMatch(/&& open\b/);
    expect(code).toMatch(/disabled=\{cart\.length === 0 \|\| !canRing\}/);
  });

  it("a key that cannot act says why, instead of doing nothing", () => {
    // "Nothing happened" is how a working shortcut gets reported as broken.
    const actions = code.slice(code.indexOf("actionsRef.current = {"), code.indexOf("return (", code.indexOf("actionsRef.current = {")));
    expect((actions.match(/setPosNotice\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe("a key for a module the shop does not have", () => {
  it("is not printed, and says so if pressed anyway", () => {
    /**
     * Reported from a mart: Quote / Advance on the till, "This module is not
     * enabled for your shop" when pressed. Four of the eight trades have no
     * Quotes module by default, and every one of them was shown F7.
     */
    expect(code).toMatch(/SHORTCUT_KEYS\.filter\(\(k\) => k\.action !== "document" \|\| sellsQuotes\)/);
    const from = code.indexOf("document: () => {");
    // AFTER it: the ref's type annotation names `clearSearch` too, far above.
    const doc = code.slice(from, code.indexOf("clearSearch: () =>", from));
    expect(doc).toMatch(/if \(!sellsQuotes\) \{ setPosNotice\(/);
  });
});
