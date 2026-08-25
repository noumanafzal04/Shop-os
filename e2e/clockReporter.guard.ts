import type { TestCase, TestResult } from "@playwright/test/reporter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ClockReporter from "./clockReporter";

/**
 * The two things this reporter claims, and the two it must NOT claim.
 *
 * A detector that only ever speaks is worth nothing — the codebase has met
 * three of those. So every case here has its opposite beside it: a run that
 * merely took a while is not a run that slept, and a login that is fifty-nine
 * minutes old is still a login.
 *
 * `.guard.ts` and not `.test.ts`: Playwright's testDir is `e2e` and its default
 * match takes any `.test.ts`, so a file importing vitest takes the browser run
 * down while it is still enumerating. See vitest.config.ts.
 */

const MINUTE = 60_000;

const aTest = (title: string, timeout: number): TestCase =>
  ({ timeout, titlePath: () => ["", title] }) as unknown as TestCase;

const ranFor = (duration: number): TestResult =>
  ({ duration, status: "passed" }) as unknown as TestResult;

let said: string[] = [];

/** Minted "just now" unless a case says otherwise. */
let mintedAt = Date.now();

vi.mock("node:fs", () => ({
  default: { statSync: () => ({ mtimeMs: mintedAt }) },
}));

beforeEach(() => {
  said = [];
  mintedAt = Date.now();
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    said.push(a.join(" "));
  });
});

afterEach(() => vi.restoreAllMocks());

const run = (fill: (r: ClockReporter) => void): string => {
  const reporter = new ClockReporter();
  reporter.onBegin();
  fill(reporter);
  reporter.onEnd();

  return said.join("\n");
};

describe("a test that outlasted its own deadline", () => {
  it("is reported as the clock moving, not as a slow screen", () => {
    const out = run((r) =>
      r.onTestEnd(aTest("reviews — nothing covered", 5 * MINUTE), ranFor(41 * MINUTE)),
    );

    expect(out).toMatch(/THE CLOCK MOVED/);
    expect(out).toContain("reviews — nothing covered");
    expect(out, "must point at where the answer actually is").toMatch(/pmset/);
  });

  it("says nothing about a test that merely took a long time", () => {
    const out = run((r) =>
      r.onTestEnd(aTest("the a11y walk", 3 * MINUTE), ranFor(2.9 * MINUTE)),
    );

    expect(out).not.toMatch(/CLOCK MOVED/);
  });

  it("says nothing about a test killed AT its deadline, teardown and all", () => {
    // The case that would make this reporter cry wolf on every red run: a test
    // that genuinely times out is charged for zipping its own trace afterwards.
    const out = run((r) =>
      r.onTestEnd(aTest("a real timeout", 5 * MINUTE), ranFor(5 * MINUTE + 40_000)),
    );

    expect(out).not.toMatch(/CLOCK MOVED/);
  });
});

describe("a run that outlived its login", () => {
  it("says so, and says the failures are not evidence", () => {
    mintedAt = Date.now() - 95 * MINUTE;

    const out = run(() => {});

    expect(out).toMatch(/OUTLIVED ITS OWN LOGIN/);
    expect(out).toMatch(/not evidence/);
  });

  it("stays quiet at fifty-nine minutes", () => {
    mintedAt = Date.now() - 59 * MINUTE;

    const out = run(() => {});

    expect(out).not.toMatch(/OUTLIVED/);
  });
});
