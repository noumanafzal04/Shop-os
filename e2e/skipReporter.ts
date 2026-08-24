import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

/**
 * WHICH CHECKS DID NOT RUN.
 *
 * A run ends "109 passed · 30 skipped" and nobody knows what the thirty were.
 * Most are honest — a flow test declining to repeat itself at four screen
 * sizes. But some are a check that skipped ITSELF out of existence: the
 * fixture shop is a mart, so a recipe spec asks for a food dish, is refused,
 * and skips. Forever. It prints as a line in a green run and covers nothing.
 *
 * The sweep learned this first and its summary now names the shops each phase
 * actually spoke about. Same rule, same reason:
 *
 *     Checks that did not happen do not appear in a list of checks that did.
 *
 * Per-project skips are counted and not listed — a flow test declining three
 * of four screen sizes is the suite working. What gets NAMED is a skip whose
 * reason came from the shop or the server, because that is the kind that can
 * quietly last for months.
 */
export default class SkipReporter implements Reporter {
  private byProject = 0;

  private conditional: Array<{ title: string; reason: string }> = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "skipped") return;

    const reason = test.annotations.find((a) => a.type === "skip")?.description ?? "";

    // The suite's own shape: one flow, proven once, not re-proven at every
    // width. chrome.spec is what walks the sizes.
    if (/screen size|layout one|a flow test/i.test(reason)) {
      this.byProject += 1;

      return;
    }

    this.conditional.push({ title: test.titlePath().slice(1).join(" › "), reason: reason || "no reason given" });
  }

  onEnd(): void {
    if (this.byProject > 0) {
        console.log(`\n${this.byProject} skipped by project — a flow proven once, not re-proven at four widths.`);
    }

    if (this.conditional.length === 0) {
        console.log("Every other check ran. No spec talked itself out of existence.\n");

      return;
    }

    console.log(`\nDID NOT RUN — ${this.conditional.length} check(s) skipped on what the SHOP or SERVER said:`);
    for (const s of this.conditional) {
        console.log(`  · ${s.title}\n      ${s.reason}`);
    }
    console.log("  These cover nothing today. A skip that never lifts is a check that was deleted quietly.\n");
  }
}
