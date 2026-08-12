import { describe, expect, it } from "vitest";

/**
 * Does a screen that CHANGES something ever say so?
 *
 * QA found this on the Staff screen — "nothing happens when we click suspend",
 * "no success/failure message when you update and create staff". The backend
 * was fine both times. The screen simply had no way to speak: its only error
 * surface was inside the form modal, and Suspend is a button on the row behind
 * it, so a failed suspend went nowhere at all. From the outside, a silent
 * failure and a silent success are the same thing.
 *
 * It was never one screen. This test is what stops the next one: a component
 * that calls `.mutate(` must also contain something that can report the
 * outcome — a toast, a rendered error state, or an ApiError it surfaces.
 *
 * It reads source text rather than rendering, which makes it a lint rule
 * wearing a test's clothes. That is the trade: it cannot prove the feedback is
 * GOOD, only that a route to the user exists at all. Every exemption below is
 * written down with a reason, so "I forgot" cannot pass as "it needs none".
 *
 * Uses import.meta.glob rather than node:fs so it typechecks under the app's
 * browser tsconfig, which has no Node types.
 */

const SOURCES = import.meta.glob("../../modules/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Files that mutate and legitimately report nothing, with why. */
const NO_FEEDBACK_NEEDED: Record<string, string> = {
  // Fire-and-forget telemetry. The visitor did not ask for it and cannot act
  // on a failure.
  "marketplace/pages/MarketShopPage.tsx": "records a storefront view, not a user action",
};

/** Anything that can put an outcome in front of the user. */
function canSpeak(source: string): boolean {
  return (
    source.includes("useToast") ||
    // A rendered error state: setError(...) / setShiftError(...). Written to
    // match `setError` itself, which a `set[A-Z]\w*Error` pattern cannot — it
    // consumes the E and then looks for "Error" again.
    /set\w*[Ee]rror\w*\s*\(/.test(source) ||
    /\.error\s+instanceof\s+ApiError/.test(source) ||
    /errorFor\s*\(/.test(source) ||
    source.includes("window.alert")
  );
}

const relative = (path: string) => path.replace(/^.*\/modules\//, "");

describe("a screen that changes something says so", () => {
  const mutating = Object.entries(SOURCES).filter(
    ([path, src]) =>
      !path.endsWith(".test.tsx") && (src.includes(".mutate(") || src.includes(".mutateAsync(")),
  );

  it("gives every mutating screen a way to report the outcome", () => {
    const offenders = mutating
      .map(([path, src]) => [relative(path), src] as const)
      .filter(([rel]) => !(rel in NO_FEEDBACK_NEEDED))
      .filter(([, src]) => !canSpeak(src))
      .map(([rel]) => rel);

    expect(
      offenders,
      `these change something and can tell the user nothing: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("is actually looking at files", () => {
    // A glob that silently matched nothing would make the test above pass
    // forever while checking not one screen — the same defect this file
    // exists to catch, one level up.
    expect(mutating.length).toBeGreaterThan(20);
  });
});
