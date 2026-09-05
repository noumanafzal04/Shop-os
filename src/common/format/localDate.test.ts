import { describe, expect, it } from "vitest";

/**
 * TODAY IS THE DAY IT IS HERE.
 *
 * `new Date().toISOString().slice(0, 10)` is the obvious way to write "today"
 * and it is wrong east of Greenwich for as many hours as the offset. In
 * Karachi (UTC+5) every moment before 05:00 local is still YESTERDAY in UTC —
 * so between midnight and five in the morning:
 *
 *   • a new expense defaulted to yesterday's date
 *   • the `max` on the date box refused today
 *   • "this month" started on the last day of the month before
 *
 * Nobody notices, because the shop is usually shut and the entry looks
 * plausible when it is read back. It is the same defect this codebase has
 * already met three times, and `toIsoDate()` in dateRanges.ts exists precisely
 * to be the only answer to it.
 *
 * Eleven call sites in nine files were still spelling it by hand. This is a
 * lint rule wearing a test's clothes so the twelfth cannot be.
 */
const SOURCES = import.meta.glob("../../modules/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** A Date turned into a `yyyy-mm-dd` through UTC. */
const BY_HAND = /toISOString\(\)\s*\.?\s*(?:slice\(0,\s*10\)|split\("T"\)\[0\]|split\('T'\)\[0\])/;

/**
 * Source with its comments removed.
 *
 * A grep cannot tell prose from code, and the FIRST file to explain this bug
 * in a docblock was reported as committing it. That is how a guard ends up
 * permanently red for the right reason, and how the next person's fix is to
 * delete the explanation rather than the mistake.
 *
 * Same shape as the comment-stripper the mobile app's inset guard needed, for
 * exactly the same reason.
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("a date the shop reads is a date in the shop's own timezone", () => {
  it("scans the modules at all, so a silent zero cannot pass as a clean sweep", () => {
    // The denominator. Without it a broken glob reports "no offenders".
    expect(Object.keys(SOURCES).length).toBeGreaterThan(200);
  });

  it("recognises the mistake when it sees it", () => {
    // …and the detector itself is checked against a known-bad line, so a
    // regex that stops matching fails here rather than passing everywhere.
    expect(BY_HAND.test('const today = new Date().toISOString().slice(0, 10);')).toBe(true);
    expect(BY_HAND.test('const d = new Date().toISOString().split("T")[0];')).toBe(true);
    expect(BY_HAND.test("toIsoDate(new Date())")).toBe(false);

    // …and stripping comments must not make it blind. A file that both
    // EXPLAINS the mistake and commits it is still caught.
    const both = [
      "// never write new Date().toISOString().slice(0, 10)",
      "const bad = new Date().toISOString().slice(0, 10);",
    ].join("\n");
    expect(BY_HAND.test(codeOnly(both))).toBe(true);
    expect(BY_HAND.test(codeOnly("/* toISOString().slice(0, 10) is wrong */"))).toBe(false);
  });

  it("is not spelled by hand anywhere", () => {
    const offenders = Object.entries(SOURCES)
      .filter(([, src]) => BY_HAND.test(codeOnly(src)))
      .map(([path]) => path.replace(/^.*\/modules\//, ""));

    expect(offenders).toEqual([]);
  });
});
