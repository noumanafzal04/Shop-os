import { describe, expect, it } from "vitest";

/**
 * Does the button that DESTROYS something look like it?
 *
 * A shop reported the bank screen as "white white" — blank-looking. It isn't
 * blank. One card carried five buttons (Add offer, Edit, Remove, and Edit /
 * Remove again per campaign) in the identical grey `outline`, of which one
 * deletes a bank. Undifferentiated reads as blank, and it is worse than blank:
 * nothing is emphasised, so nothing is warned about either.
 *
 * The cause was not the screen. `Button` shipped with `primary` and `outline`
 * and no way at all to say "this one removes something", so every screen that
 * needed a Remove reached for the grey one. It was never going to be fixed
 * screen by screen while the vocabulary was missing.
 *
 * This is the rule that keeps it fixed: a button whose label is Remove or
 * Delete carries `variant="danger"`. It reads source text rather than
 * rendering — a lint rule wearing a test's clothes — so it can only prove the
 * variant is asked for, never that the result looks right. Every exemption is
 * written down with a reason, so "I forgot" cannot pass as "it needs none".
 *
 * Uses import.meta.glob rather than node:fs so it typechecks under the app's
 * browser tsconfig, which has no Node types.
 */

const SOURCES = import.meta.glob("../../../modules/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Labels that mean "this press takes something away".
 *
 * `Withdraw` and `Revoke` earned their place the honest way: this rule flagged
 * a Withdraw button that was already coloured as danger, which is the rule
 * asking whether the VOCABULARY was short rather than the button wrong. Taking
 * offline selling back off a shop that trades through outages is exactly as
 * consequential as deleting a row, so it belongs here.
 */
const DESTRUCTIVE = /^(Remove|Delete|Discard|Void|Withdraw|Revoke|Cancel shift)\b/i;

/**
 * What a person actually reads, out of a label that may be an expression.
 *
 * A button with a pending state writes its label as a ternary —
 * `{busy ? "Removing…" : "Remove review"}` — and the raw chunk therefore starts
 * with `{busy`, which no anchored word list will ever match. That was a hole in
 * BOTH directions: a destructive button with a spinner could stay grey
 * unnoticed, and a correctly-tinted one was reported as a screen whose primary
 * action destroys something.
 *
 * Any branch counts. A button that reads "Remove review" while idle is a remove
 * button, whatever it says mid-flight.
 */
const spoken = (label: string): string[] => {
  const literals = [...label.matchAll(/"([^"]+)"|'([^']+)'/g)].map((m) => m[1] ?? m[2]);

  return literals.length > 0 ? literals : [label];
};

const readsDestructive = (label: string): boolean =>
  spoken(label).some((text) => DESTRUCTIVE.test(text));

/**
 * Buttons whose label reads destructive but whose press is not, with why.
 * Keyed by `file::label`.
 */
const NOT_ACTUALLY_DESTRUCTIVE: Record<string, string> = {
  // A PIN pad's backspace. It deletes a digit you have not submitted, on a
  // lock screen with no records anywhere near it. Colouring it as a warning
  // would teach the one gesture every user makes constantly to read as danger,
  // which is how a warning colour stops being one.
  "pos/components/TillLock.tsx::Delete": "keypad backspace, not a record",
};

interface Found {
  file: string;
  label: string;
  /** The shared component's variant, or null for a hand-rolled `<button>`. */
  variant: string | null;
  /** Whether anything about it is coloured as an error. */
  warns: boolean;
}

/**
 * Every button in the app, shared component and hand-rolled alike.
 *
 * Both are counted because the shop cannot tell them apart, and neither can
 * the eye they were reported by. Roughly half the buttons here are raw
 * `<button className="…">`, which is how a rule stated only on the shared
 * component would have passed while the screens stayed grey.
 *
 * The opening tag ends at the LAST `>` before the children, which survives the
 * `=>` inside an onClick — an arrow's `>` is always followed by more attribute
 * text and then the real one. Safe here because a destructive button's
 * children are a bare word.
 */
const buttons = (): Found[] => {
  const out: Found[] = [];

  for (const [path, src] of Object.entries(SOURCES)) {
    const file = path.replace(/^.*\/modules\//, "");

    for (const tag of ["<Button", "<button"] as const) {
      const end = `</${tag.slice(1)}>`;
      let from = 0;

      for (;;) {
        const open = src.indexOf(tag, from);
        if (open === -1) break;
        from = open + tag.length;
        // `<Button` also matches inside `<ButtonGroup`; a following letter
        // means this is a different component.
        if (/[A-Za-z]/.test(src[open + tag.length] ?? "")) continue;
        const close = src.indexOf(end, open);
        if (close === -1) continue;

        const chunk = src.slice(open, close);
        const label = chunk.slice(chunk.lastIndexOf(">") + 1).trim();
        if (!label) continue;

        const variant = chunk.match(/variant="([a-z]+)"/)?.[1] ?? null;
        out.push({
          file,
          label,
          variant,
          warns:
            variant === "danger" ||
            // The shared row-action class list. Table rows carry the tint
            // through a constant rather than a literal, and a rule that only
            // recognised literals would have marked the swept screens as
            // regressions the moment they were fixed.
            chunk.includes("ROW_ACTION_DANGER") ||
            /\b(?:text|bg|ring|border)-error-/.test(chunk),
        });
      }
    }
  }

  return out;
};

describe("a button that takes something away says so", () => {
  it("finds buttons at all, so a silent zero cannot pass as a clean sweep", () => {
    // The denominator. Without it, a broken parser reports perfection.
    expect(buttons().length).toBeGreaterThan(40);
  });

  it("every Remove / Delete is coloured as one", () => {
    const wrong = buttons()
      .filter((b) => readsDestructive(b.label))
      .filter((b) => !b.warns)
      .filter((b) => !(`${b.file}::${b.label}` in NOT_ACTUALLY_DESTRUCTIVE))
      .map((b) => `${b.file} → "${b.label}" is ${b.variant ?? "hand-rolled"}`);

    expect(wrong).toEqual([]);
  });

  it("danger is never the primary action of a screen", () => {
    // `danger` is a row action. A screen whose main button destroys something
    // is a screen that has misunderstood what it is for.
    const loud = buttons().filter((b) => b.variant === "danger" && !readsDestructive(b.label));

    expect(loud.map((b) => `${b.file} → "${b.label}"`)).toEqual([]);
  });

  it("reads the label out of a button that has a pending state", () => {
    // Pins the hole this had. Without `spoken`, the first of these is invisible
    // to both rules above — it starts with `{busy`, and the word list is
    // anchored.
    expect(readsDestructive('{busy ? "Removing…" : "Remove review"}')).toBe(true);
    expect(readsDestructive('{busy ? "Saving…" : "Save changes"}')).toBe(false);
    expect(readsDestructive("Remove")).toBe(true);
    // Only the START of a branch counts, so a sentence that merely mentions the
    // word is not a destructive button.
    expect(readsDestructive('{"Undo remove"}')).toBe(false);
  });
});
