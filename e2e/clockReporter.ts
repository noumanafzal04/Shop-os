import fs from "node:fs";

import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

/**
 * A RUN THAT OUTLIVED ITS OWN LOGIN.
 *
 * This suite signs in once, at the start, and every project afterwards reuses
 * that storage state. The token in it is good for an hour — sixty minutes,
 * stamped per token when it is minted, NOT the `null` that `config/sanctum.php`
 * appears to say. So a run that takes longer than an hour spends its last leg
 * holding a dead credential, and every spec that needs the API fails inside a
 * second or two with something that reads exactly like a broken feature.
 *
 * It has now cost a day twice. The API sweep lost 97 "bugs" to one expired
 * token. Then this suite lost eighteen: a laptop lid closed at 10:34 with the
 * battery on 4%, the machine slept for forty-seven minutes, and the run came
 * back to find its login had expired while nothing was executing at all. The
 * report read as a screen that hangs and six flows that had stopped selling.
 *
 * None of it was true, and none of it was cheap to disprove — the answer was
 * in `pmset -g log`, which is not somewhere anybody looks when a till appears
 * to have stopped taking cash.
 *
 * So the run says it itself, in the place the failures are printed.
 */

/**
 * `IssueTokensAction::ACCESS_TTL_MINUTES` in the backend. Duplicated because
 * a browser suite cannot read a PHP constant — kept honest by the fact that
 * being WRONG here is harmless in the direction that matters: too low and the
 * note appears early, too high and it appears late, and it never fails a test.
 */
const LOGIN_GOOD_FOR_MS = 60 * 60 * 1000;

/** Written by `auth.setup.ts`; its mtime is when the token was minted. */
const OWNER_STATE = "e2e/.auth/owner.json";

/**
 * Slack on the timeout comparison. A test is torn down after its deadline —
 * a trace is zipped, a screenshot is taken, a context is closed — and that is
 * charged to the test's duration. Seconds of it, never minutes.
 */
const TEARDOWN_SLACK_MS = 60_000;

export default class ClockReporter implements Reporter {
  private startedAt = 0;

  /**
   * Tests that ran longer than they were ALLOWED to.
   *
   * This is the sharp half, and the reason this reporter is worth having.
   * Playwright kills a test at its timeout, so no amount of slow code can
   * produce a duration past it — a slow page gets 300s and a failure, not 310.
   * A duration of forty-one MINUTES against a five-minute deadline is therefore
   * not a measurement of anything the test did. It is the wall clock moving
   * while the test stood still, which on a laptop means one thing.
   *
   * No false positives from slowness, then: slowness is capped by definition.
   */
  private clockJumped: Array<{ title: string; ran: number; allowed: number }> = [];

  onBegin(): void {
    this.startedAt = Date.now();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (test.timeout <= 0) return;
    if (result.duration <= test.timeout + TEARDOWN_SLACK_MS) return;

    this.clockJumped.push({
      title: test.titlePath().slice(1).join(" › "),
      ran: result.duration,
      allowed: test.timeout,
    });
  }

  onEnd(): void {
    const minutes = (ms: number): string => `${Math.round(ms / 60_000)}m`;

    if (this.clockJumped.length > 0) {
      console.log(
        "\n⏱  THE CLOCK MOVED WHILE THE RUN DID NOT — these are not measurements:",
      );
      for (const t of this.clockJumped) {
        console.log(`     ${t.title}\n       ran ${minutes(t.ran)} against a ${minutes(t.allowed)} deadline`);
      }
      console.log(
        "     A test cannot outlast its own timeout, so nothing here was executing.\n" +
        "     The machine slept. Check `pmset -g log | grep -E \"Sleep|Wake\"`, and\n" +
        "     re-run on mains with `caffeinate -i npx playwright test`.",
      );
    }

    // How old the login was by the time the last test read it. Measured from
    // the file the setup wrote rather than from the start of the run, because
    // the setup itself can spend three minutes waiting out `throttle:auth`.
    let mintedAt = this.startedAt;
    try {
      mintedAt = fs.statSync(OWNER_STATE).mtimeMs;
    } catch {
      // No state file — the run never got as far as signing in, and the
      // failures will say so plainly enough on their own.
    }

    const age = Date.now() - mintedAt;
    if (age > LOGIN_GOOD_FOR_MS) {
      console.log(
        `\n🔑  THIS RUN OUTLIVED ITS OWN LOGIN — signed in ${minutes(age)} ago, ` +
        `token good for ${minutes(LOGIN_GOOD_FOR_MS)}.\n` +
        "     Anything that failed in the last leg failed on a dead credential,\n" +
        "     in about a second, and is not evidence about the feature it names.",
      );
    }
  }
}
