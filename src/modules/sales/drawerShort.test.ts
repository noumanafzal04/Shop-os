import { describe, expect, it } from "vitest";

import { drawerShort } from "./drawerShort";
import type { ReturnWorth } from "./types";

/** $6 (money pass 2026-10-16): 3,509.99 handed back out of a 2,000 drawer, with no word. */
const back = (over: Partial<ReturnWorth>): ReturnWorth => ({
  refund_total: 3509.99, refund_tax: 509.99, tax_inclusive: false, lines: [],
  drawer: "open", back_by: "cash", handed_back: 3509.99, drawer_holds: 2000, ...over,
});

describe("a cash refund out of a drawer that does not hold it", () => {
  it("is named, with what the drawer holds", () => {
    expect(drawerShort(back({}), false)).toBe(2000);
  });

  it("is not named when the drawer holds it — to the paisa", () => {
    expect(drawerShort(back({ drawer_holds: 3509.99 }), false)).toBeNull();
    expect(drawerShort(back({ handed_back: 1500 }), false)).toBeNull();
  });

  it("reads what is handed over, not what comes off a khata", () => {
    // A khata sale: 3,000 comes off the account, 509.99 is handed back.
    expect(drawerShort(back({ handed_back: 509.99 }), false)).toBeNull();
  });

  it("is the server's to say for a card refund, another drawer, or none open", () => {
    expect(drawerShort(back({ back_by: "card" }), false)).toBeNull();
    expect(drawerShort(back({}), true)).toBeNull();
    expect(drawerShort(back({ drawer_holds: null }), false)).toBeNull();
    expect(drawerShort(null, false)).toBeNull();
  });
});
