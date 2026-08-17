import { describe, expect, it } from "vitest";

/**
 * A tablet held sideways is not a phone.
 *
 * Eleven screens split their layout at `xl` and nowhere else. `xl` is 1280.
 * A tablet in landscape is 1024–1194 — every iPad ever made — so all eleven
 * handed it the single-column phone stack: the dashboard's charts one under
 * another, the label sheet scrolled away from the preview it controls, four
 * stat tiles taking two rows on a screen with room for one.
 *
 * Nothing was broken, which is why it survived. The page rendered, every
 * figure was right, and it simply used half the glass.
 *
 * The rule: a layout that splits at `xl` also says what it does at `lg`. Going
 * 1 → 2 → 4 across the breakpoints is fine and common; what is not fine is
 * jumping from one column straight to four and leaving the widest device most
 * shops own on the low side of it.
 *
 * Reads source text rather than rendering — a lint rule wearing a test's
 * clothes. It proves an `lg` step was considered, never that the result is
 * comfortable at 1024. Uses import.meta.glob rather than node:fs so it
 * typechecks under the app's browser tsconfig, which has no Node types.
 */

const SOURCES = {
  ...(import.meta.glob("../modules/**/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob("../pages/**/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
};

/** Screens that genuinely need 1280 before they split, with why. */
const NEEDS_THE_WIDTH: Record<string, string> = {};

/** Splits the layout at `xl`: columns, or a row/column flip. */
const SPLITS_AT = (bp: string) =>
  new RegExp(`\\b${bp}:(?:grid-cols-[2-9]|grid-cols-1[0-2]|flex-row)`);

const gaps = (): string[] =>
  Object.entries(SOURCES)
    .filter(([, src]) => SPLITS_AT("xl").test(src) && !SPLITS_AT("lg").test(src))
    .map(([path]) => path.replace(/^\.\.\//, ""))
    .filter((file) => !(file in NEEDS_THE_WIDTH))
    .filter((file) => !file.endsWith(".test.tsx"));

describe("a layout that splits at xl says what it does at lg", () => {
  it("reads the screens at all, so a silent zero cannot pass as a clean sweep", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
  });

  it("catches the shape it exists for", () => {
    // Proves the pattern bites rather than trusting an empty result.
    expect(SPLITS_AT("xl").test('className="grid grid-cols-1 xl:grid-cols-3"')).toBe(true);
    expect(SPLITS_AT("lg").test('className="grid grid-cols-1 xl:grid-cols-3"')).toBe(false);
    // A one-column `xl` rule is not a split; it is a screen narrowing on
    // purpose, and it has nothing to answer for.
    expect(SPLITS_AT("xl").test('className="xl:grid-cols-1"')).toBe(false);
  });

  it("no screen jumps from one column straight past a tablet", () => {
    expect(gaps()).toEqual([]);
  });
});
