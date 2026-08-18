import { describe, expect, it } from "vitest";

import { tillFlag } from "./tillSettings";

/**
 * The shop's own close procedure, when the server cannot be asked.
 *
 * A missing answer is NOT a shop that turned something off — and the two must
 * not be confused, because one of them silently drops the card declaration for
 * a whole shift.
 */
describe("a setting the till remembers", () => {
  it("uses what the shop chose", () => {
    expect(tillFlag({ pos_declare_tenders: true }, "pos_declare_tenders", false)).toBe(true);
    expect(tillFlag({ pos_denomination_count: false }, "pos_denomination_count", true)).toBe(false);
  });

  it("falls back when the till has never pulled", () => {
    // Not false — the caller's default. A till with no cache must behave the
    // way the screen behaves for everybody else, not the way "off" behaves.
    expect(tillFlag(undefined, "pos_denomination_count", true)).toBe(true);
    expect(tillFlag({}, "pos_denomination_count", true)).toBe(true);
  });

  it("reads a value the server sent as 0 or 1", () => {
    // Settings arrive as JSON from a PHP boolean cast, which is not always a
    // JS boolean. Treating 1 as "unknown" would hand back the default and
    // quietly ignore the shop.
    expect(tillFlag({ pos_declare_tenders: 1 }, "pos_declare_tenders", false)).toBe(true);
    expect(tillFlag({ pos_declare_tenders: 0 }, "pos_declare_tenders", true)).toBe(false);
  });
});
