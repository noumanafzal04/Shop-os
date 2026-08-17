import { describe, expect, it } from "vitest";

/**
 * Nothing asks the shop a question in the browser's own voice.
 *
 * Twelve places still called `window.confirm()` — the grey operating-system
 * box with OK and Cancel. It cannot be styled, it cannot say what the press
 * actually does, its buttons are in the platform's order rather than ours, and
 * on a tablet it lands in the middle of the screen looking like a fault. Beside
 * the product's own dialog it reads as a different application.
 *
 * It also cannot warn. `tone: "danger"` is what makes a delete look like one,
 * and a native confirm has no tone at all — so the twelve loudest moments in
 * the app were the twelve with no colour in them.
 *
 * `useConfirm` has existed the whole time. This is the rule that stops the
 * thirteenth: a question to the merchant is asked by the product.
 *
 * Reads source text rather than rendering — a lint rule wearing a test's
 * clothes. Uses import.meta.glob rather than node:fs so it typechecks under
 * the app's browser tsconfig, which has no Node types.
 */

const SOURCES = import.meta.glob("../../../modules/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * A call to the GLOBAL confirm/alert/prompt.
 *
 * The distinguishing mark is the argument: the shared hook is also called
 * `confirm` and always takes an options OBJECT, so `confirm({` is ours and
 * `confirm("…` is the browser's. `window.`-prefixed is unambiguous either way.
 */
const NATIVE = /\bwindow\.(confirm|alert|prompt)\s*\(|(?<!\.)\b(confirm|alert|prompt)\s*\(\s*[`'"]/;

/**
 * Comments out, code in — a file that EXPLAINS the mistake it stopped making
 * is not making it. `DisposeBatchModal` opens by saying "removing a batch used
 * to be `confirm("Remove this batch?")`", which is exactly the sentence worth
 * keeping and exactly what a naive scan flags.
 *
 * `//` is only honoured at the start of a line, so the `xmlns="http://…"` on
 * every inline SVG keeps the code on its line.
 */
const stripComments = (src: string): string =>
  src
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

const offenders = (): string[] =>
  Object.entries(SOURCES)
    .filter(([, src]) => NATIVE.test(stripComments(src)))
    .map(([path]) => path.replace(/^.*\/modules\//, ""));

describe("the product asks its own questions", () => {
  it("scans the modules at all, so a silent zero cannot pass as a clean sweep", () => {
    // The denominator. Without it, a glob that resolved to nothing reports
    // perfection.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
  });

  it("catches a native confirm when there is one", () => {
    // Proves the pattern bites, rather than trusting an empty result.
    expect(NATIVE.test('if (confirm("Delete this?")) go();')).toBe(true);
    expect(NATIVE.test("if (window.confirm(`Remove ${x}?`)) go();")).toBe(true);
    expect(NATIVE.test('alert("saved");')).toBe(true);
  });

  it("does not catch the shared hook, which is also called confirm", () => {
    expect(NATIVE.test('if (await confirm({ title: "Delete?" })) go();')).toBe(false);
    // A method named confirm on something else is not the global.
    expect(NATIVE.test('page.confirm("x")')).toBe(false);
  });

  it("no screen uses one", () => {
    expect(offenders()).toEqual([]);
  });
});
