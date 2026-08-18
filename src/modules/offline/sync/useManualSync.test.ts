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
