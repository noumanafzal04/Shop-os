import { describe, expect, it } from "vitest";

import { ANSWER_MS, syncLabel, type SyncPress } from "./useManualSync";

/**
 * A person pressed a button and is owed an answer.
 *
 * The automatic sync is deliberately silent when there is nothing to send —
 * announcing "Sending 0 of 0" four times an hour teaches a cashier to stop
 * reading the pill. A press is the opposite case: the commonest outcome is the
 * one that shows nothing at all — an empty queue and a 300ms request — and
 * without its own state the control would look broken exactly when everything
 * is fine.
 */
describe("what a press is told", () => {
  it("names the action before it is pressed", () => {
    expect(syncLabel("idle", true)).toBe("Sync now");
  });

  it("says it is working", () => {
    expect(syncLabel("working", true)).toBe("Syncing…");
  });

  it("does not overclaim on success", () => {
    // Not "Synced!" — this round finished, which is not a promise that the
    // shop's whole day has gone up. Overclaiming is how a cashier stops
    // believing the next message.
    expect(syncLabel("done", true)).toBe("Up to date");
  });

  it("tells the two failures apart", () => {
    // The remedies differ, so the sentences must. A failure with a line is
    // something to report; a failure without one is something to wait for.
    expect(syncLabel("failed", true)).toBe("Sync failed");
    expect(syncLabel("failed", false)).toBe("Still no connection");
  });

  it("answers for every state, so none can render blank", () => {
    const states: SyncPress[] = ["idle", "working", "done", "failed"];

    for (const state of states) {
      expect(syncLabel(state, true).length).toBeGreaterThan(0);
      expect(syncLabel(state, false).length).toBeGreaterThan(0);
    }
  });

  it("holds the answer long enough to be read", () => {
    // Long enough to see across a counter, short enough that the pill goes back
    // to reporting the queue — which is the thing it is for.
    expect(ANSWER_MS).toBeGreaterThanOrEqual(2000);
    expect(ANSWER_MS).toBeLessThanOrEqual(5000);
  });
});

describe("a press reports the QUEUE, not the pull", () => {
  /**
   * A shop sold four offline, pressed Sync, and read "Up to date" beside a
   * badge still showing four. Both were drawn by the same screen, one of them
   * was false, and the false one was the reassuring one.
   *
   * The old control reported success whenever `pullNow` resolved — and
   * `pullNow` swallows a flush failure on purpose, so the catalog coming down
   * was being read as the sales having gone up.
   */
  const outcome = (waiting: number, refused = 0) => ({
    sent: 0,
    waiting,
    refused,
    reason: null,
  });

  it("says how many are still held, instead of claiming success", () => {
    expect(syncLabel("stuck", true, outcome(4))).toBe("4 still to send");
  });

  it("counts refused rows in the total that is still here", () => {
    // Both are sales this till is holding. A cashier reading the badge sees
    // one number, so the control must not report a different one.
    expect(syncLabel("stuck", true, outcome(2, 1))).toBe("3 still to send");
  });

  it("says so plainly when pressing again cannot help", () => {
    // Nothing waiting, and the shop refused the rest. Telling somebody to keep
    // pressing a button that cannot work is the failure this state exists for.
    expect(syncLabel("stuck", true, outcome(0, 3))).toMatch(/3 refused/);
  });

  it("still says something when the outcome is missing", () => {
    expect(syncLabel("stuck", true, null).length).toBeGreaterThan(0);
    expect(syncLabel("stuck", true).length).toBeGreaterThan(0);
  });

  it("keeps 'Up to date' for the case where it is true", () => {
    expect(syncLabel("done", true, outcome(0))).toBe("Up to date");
  });
});
