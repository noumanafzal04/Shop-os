import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";

import { ANSWER_MS, syncDetail, syncLabel, useManualSync, type SyncPress } from "./useManualSync";
import * as outbox from "../outbox/outbox";
import * as puller from "./pullNow";
import { useAuthStore } from "../../../stores/authStore";

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
  const outcome = (waiting: number, refused = 0, stranded = 0) => ({
    sent: 0,
    waiting,
    refused,
    stranded,
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

  it("says STUCK, not 'still to send', when the fence is holding them", () => {
    // A stranded row names another shop, or names none. Sync will never move
    // it, however many times it is pressed — and a shop watched "7 still to
    // send" for days before anything on the screen said so.
    expect(syncLabel("stuck", true, outcome(7, 0, 7))).toMatch(/stuck/i);
    expect(syncLabel("stuck", true, outcome(7, 0, 7))).not.toMatch(/still to send/i);
  });

  it("keeps 'still to send' for the ordinary case of a bad line", () => {
    expect(syncLabel("stuck", true, outcome(7, 0, 0))).toBe("7 still to send");
  });

});


/**
 * WHAT THE PRESS ACTUALLY COUNTED.
 *
 * `syncLabel` above is a pure function and was thoroughly tested; the hook that
 * feeds it was not, and that is where the two real numbers are assembled. A
 * till holding seven drawer events read "7 still to send" through press after
 * press, because `sent` came off the sale queue alone and `stranded` was asked
 * of the sale queue alone — both true statements about half a till.
 */
describe("the two numbers under the button", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: { tenant: { id: "shop-a" } } } as never);
  });

  const pullResolving = (flushedAcked: number, shiftAcked: number) =>
    vi.spyOn(puller, "pullNow").mockResolvedValue({
      applied: {} as never,
      rounds: 1,
      truncated: false,
      flushed: { sent: flushedAcked, acked: flushedAcked, failed: 0, skipped: false },
      shifts: { sent: shiftAcked, acked: shiftAcked, failed: 0 },
    });

  it("counts drawer events as sent, not only sales", async () => {
    pullResolving(0, 4);
    vi.spyOn(outbox, "queueSummary").mockResolvedValue({
      waiting: 0, failed: 0, stranded: 0, lastError: null,
    });

    const { result } = renderHook(() => useManualSync());
    act(() => result.current.sync());

    await waitFor(() => expect(result.current.outcome).not.toBeNull());
    // THE BUG: this was 0 while `waiting` had just dropped by four, so one
    // sentence on one bar contradicted itself while the sync was working.
    expect(result.current.outcome?.sent).toBe(4);
  });

  it("says STUCK rather than 'still to send' when the fence is the reason", async () => {
    pullResolving(0, 0);
    vi.spyOn(outbox, "queueSummary").mockResolvedValue({
      waiting: 7, failed: 0, stranded: 7, lastError: null,
    });

    const { result } = renderHook(() => useManualSync());
    act(() => result.current.sync());

    await waitFor(() => expect(result.current.state).toBe("stuck"));
    expect(syncLabel("stuck", true, result.current.outcome)).toBe("7 stuck — needs attention");
  });

  it("still says 'still to send' for the ordinary bad line", async () => {
    // The denominator. Without this the test above passes against a control
    // that has simply started calling everything stuck.
    pullResolving(0, 0);
    vi.spyOn(outbox, "queueSummary").mockResolvedValue({
      waiting: 7, failed: 0, stranded: 0, lastError: "Could not reach the server",
    });

    const { result } = renderHook(() => useManualSync());
    act(() => result.current.sync());

    await waitFor(() => expect(result.current.state).toBe("stuck"));
    expect(syncLabel("stuck", true, result.current.outcome)).toBe("7 still to send");
  });

  it("says up to date only when the till is holding nothing", async () => {
    pullResolving(3, 1);
    vi.spyOn(outbox, "queueSummary").mockResolvedValue({
      waiting: 0, failed: 0, stranded: 0, lastError: null,
    });

    const { result } = renderHook(() => useManualSync());
    act(() => result.current.sync());

    await waitFor(() => expect(result.current.state).toBe("done"));
    expect(result.current.outcome?.sent).toBe(4);
  });
});


/** A count with no reason beside it is what sends somebody to a phone call. */
describe("why it is stuck", () => {
  const outcome = (over = {}) => ({
    sent: 0, waiting: 7, refused: 0, stranded: 0, reason: null, ...over,
  });

  it("says nothing at all while the press is going well", () => {
    expect(syncDetail("working", outcome())).toBeNull();
    expect(syncDetail("done", outcome({ waiting: 0 }))).toBeNull();
  });

  it("repeats what the server or the line actually said", () => {
    expect(syncDetail("stuck", outcome({ reason: "Could not reach the server" })))
      .toBe("Could not reach the server");
  });

  it("does not tell anybody to keep pressing when the fence is holding them", () => {
    // The one case where "try again" is actively wrong: no number of presses
    // moves these, and the recovery is on another screen.
    const detail = syncDetail("stuck", outcome({ stranded: 7, reason: "Could not reach the server" }));

    expect(detail).toContain("will not send them");
    expect(detail).toContain("Settings");
    expect(detail).not.toContain("Could not reach the server");
  });

  it("has nothing to add when the till was told nothing", () => {
    expect(syncDetail("stuck", outcome())).toBeNull();
  });
});


/**
 * AN ANSWER THAT OUTLASTS A GLANCE.
 *
 * Measured on the deployed build: the stranded answer appeared 505ms after the
 * press and was gone 2,500ms later, leaving the badge reading "1 still to
 * send" again — the exact sentence the whole change exists to stop telling. A
 * cashier who presses Sync and looks up at a customer misses it entirely.
 */
describe("how long the answer stays up", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    useAuthStore.setState({ user: { tenant: { id: "shop-a" } } } as never);
  });

  const press = async (summary: { waiting: number; failed: number; stranded: number }) => {
    vi.spyOn(puller, "pullNow").mockResolvedValue({
      applied: {} as never, rounds: 1, truncated: false,
      flushed: { sent: 0, acked: 0, failed: 0, skipped: false },
      shifts: { sent: 0, acked: 0, failed: 0 },
    });
    vi.spyOn(outbox, "queueSummary").mockResolvedValue({ ...summary, lastError: null });

    const { result } = renderHook(() => useManualSync());
    act(() => result.current.sync());
    await waitFor(() => expect(result.current.state).toBe("stuck"));
    return result;
  };

  it("holds a stranded answer up, because pressing again cannot help", async () => {
    const result = await press({ waiting: 1, failed: 0, stranded: 1 });

    await new Promise((r) => setTimeout(r, ANSWER_MS + 400));
    expect(result.current.state, "the answer expired and the badge went back to lying").toBe("stuck");
  });

  it("still lets an ordinary bad line expire", async () => {
    // The denominator. Holding EVERY answer would pin the badge on its last
    // result and stop it reporting the connection at all.
    const result = await press({ waiting: 1, failed: 0, stranded: 0 });

    await new Promise((r) => setTimeout(r, ANSWER_MS + 400));
    expect(result.current.state).toBe("idle");
  });
});
