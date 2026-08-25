import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";

import { useConnectionStore } from "../../../stores/connectionStore";
import { HEARTBEAT_MS, useKeepInSync } from "./useKeepInSync";
import * as puller from "./pullNow";
import * as repo from "../db/repo";
import { useOfflineStore } from "../offlineStore";

/**
 * Keeping the catalog current while the till is open.
 *
 * Each trigger covers a different way of going stale, and the tests are written
 * per-failure rather than per-function:
 *
 *   reconnecting  — an hour offline is an hour of price changes waiting
 *   heartbeat     — a counter machine left on for a fortnight, never reloaded
 *   tab returns   — a cashier back from lunch, about to ring something up
 *
 * And one rule across all three: a pull that fails is never surfaced. It failed
 * because there is no connection, which the badge already says, and a toast per
 * failed poll on a bad shop wifi is how a cashier learns to ignore toasts.
 */

vi.mock("../db/repo", () => ({ queueTally: vi.fn(async () => ({ owed: 0, refused: 0 })) }));

let pull: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  pull = vi.spyOn(puller, "pullNow").mockResolvedValue({
    applied: {
      products: 0,
      categories: 0,
      promotions: 0,
      tax_groups: 0,
      customer_groups: 0,
      customers: 0,
    },
    rounds: 1,
    truncated: false,
  });
  useConnectionStore.setState({ online: true, reachable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("reconnecting", () => {
  it("pulls the moment the till can reach the server again", async () => {
    useConnectionStore.setState({ reachable: false });
    renderHook(() => useKeepInSync(true));
    pull.mockClear();

    // Asserted straight after `act` rather than through waitFor: fake timers
    // are running, and waitFor polls on the real clock — it would sit there
    // until the test timed out no matter what the hook did.
    await act(async () => {
      useConnectionStore.setState({ reachable: true });
    });

    expect(pull).toHaveBeenCalled();
  });

  it("does not pull while it cannot reach anything", async () => {
    useConnectionStore.setState({ reachable: false });

    renderHook(() => useKeepInSync(true));

    expect(pull).not.toHaveBeenCalled();
  });

  it("treats a browser that thinks it is offline as offline", async () => {
    // `reachable` is driven by real traffic; `online` is the browser's own
    // opinion. Either being false means there is nothing to ask.
    useConnectionStore.setState({ online: false, reachable: true });

    renderHook(() => useKeepInSync(true));

    expect(pull).not.toHaveBeenCalled();
  });
});

describe("the heartbeat", () => {
  it("pulls again after the interval, for a till nobody ever reloads", async () => {
    renderHook(() => useKeepInSync(true));
    pull.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(HEARTBEAT_MS);
    });

    expect(pull).toHaveBeenCalledTimes(1);
  });

  it("keeps beating rather than firing once", async () => {
    renderHook(() => useKeepInSync(true));
    pull.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    });

    expect(pull).toHaveBeenCalledTimes(3);
  });

  it("skips a beat while offline instead of tearing the timer down", async () => {
    // Checked at fire time on purpose. Rebuilding the timer whenever
    // connectivity flickers — which bad shop wifi does constantly — would mean
    // it never survived long enough to fire at all.
    renderHook(() => useKeepInSync(true));
    pull.mockClear();
    act(() => useConnectionStore.setState({ reachable: false }));

    await act(async () => {
      vi.advanceTimersByTime(HEARTBEAT_MS);
    });
    expect(pull).not.toHaveBeenCalled();

    act(() => useConnectionStore.setState({ reachable: true }));
    pull.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(HEARTBEAT_MS);
    });
    expect(pull).toHaveBeenCalled();
  });

  it("stops when the till unmounts", async () => {
    const { unmount } = renderHook(() => useKeepInSync(true));
    unmount();
    pull.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    });

    expect(pull).not.toHaveBeenCalled();
  });
});

describe("the tab coming back", () => {
  it("pulls when the screen is looked at again", async () => {
    renderHook(() => useKeepInSync(true));
    pull.mockClear();

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // jsdom reports "visible" by default, which is the case being tested.
    expect(pull).toHaveBeenCalled();
  });

  it("stops listening when the till unmounts", async () => {
    const { unmount } = renderHook(() => useKeepInSync(true));
    unmount();
    pull.mockClear();

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(pull).not.toHaveBeenCalled();
  });
});

describe("silence", () => {
  it("does nothing at all until it is switched on", async () => {
    renderHook(() => useKeepInSync(false));

    await act(async () => {
      vi.advanceTimersByTime(HEARTBEAT_MS);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(pull).not.toHaveBeenCalled();
  });

  it("swallows a failed pull rather than making it the cashier's problem", async () => {
    // It failed because there is no connection, which the badge already says.
    pull.mockRejectedValue(new Error("Network Error"));

    expect(() => renderHook(() => useKeepInSync(true))).not.toThrow();

    await act(async () => {
      vi.advanceTimersByTime(HEARTBEAT_MS);
    });
  });
});


describe("the number on the badge", () => {
  /**
   * A shop's own report, reproduced in a browser: the line comes back, the pill
   * says "Sending 1 of 1", the sale is acked by the server with an invoice
   * number eight seconds later — and the pill settles on **"1 still to send"**
   * and stays there.
   *
   * The count was read on `[enabled, connected]`. Neither of those moves when a
   * flush finishes; the till was already connected, which is why the flush ran
   * at all. So the last number read was the one from BEFORE the sales went, and
   * the badge kept reporting a queue that was empty — at the one moment it
   * exists for.
   */
  it("is read again when a flush finishes, not only when the line changes", async () => {
    const counted = vi.mocked(repo.queueTally);
    counted.mockResolvedValue({ owed: 1, refused: 0 });
    useOfflineStore.setState({ pending: 0, syncing: null });

    renderHook(() => useKeepInSync(true));
    await act(async () => {});
    expect(useOfflineStore.getState().pending, "the queued sale was never counted").toBe(1);

    // The flush runs. `pullNow` narrates it, then clears `syncing` in its
    // `finally` — by which point the rows are marked acked and owe nothing.
    counted.mockResolvedValue({ owed: 0, refused: 0 });
    await act(async () => {
      useOfflineStore.getState().setSyncing({ sent: 0, total: 1 });
    });
    await act(async () => {
      useOfflineStore.getState().setSyncing(null);
    });

    expect(
      useOfflineStore.getState().pending,
      "the queue drained and the badge still says sales are waiting",
    ).toBe(0);
  });

  it("carries the refused count through the same read, not a second one", async () => {
    /**
     * The count of REFUSED sales rides on the same read as the owed count, and
     * this is what stops the two drifting.
     *
     * Three places ask the queue how it is doing — boot, this heartbeat, and
     * the till the moment a sale is queued — and before `queueTally` each was
     * its own copy of one wiring. A refusal surfaced in two of them and not the
     * third is a till that shows "Online" on the one screen a cashier is
     * actually looking at.
     */
    const counted = vi.mocked(repo.queueTally);
    counted.mockResolvedValue({ owed: 2, refused: 1 });
    useOfflineStore.setState({ pending: 0, refused: 0, syncing: null });

    renderHook(() => useKeepInSync(true));
    await act(async () => {});

    expect(useOfflineStore.getState().pending).toBe(2);
    expect(
      useOfflineStore.getState().refused,
      "the refusal never reached the store — the till would say nothing about money it took",
    ).toBe(1);
  });

  it("does not re-read on a quiet heartbeat", async () => {
    // A flush with nothing owed never sets `syncing`, so an idle till must not
    // go back to IndexedDB every quarter hour for an answer that cannot have
    // changed.
    const counted = vi.mocked(repo.queueTally);
    counted.mockResolvedValue({ owed: 0, refused: 0 });
    useOfflineStore.setState({ pending: 0, syncing: null });

    renderHook(() => useKeepInSync(true));
    await act(async () => {});
    counted.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(HEARTBEAT_MS + 1000);
    });

    expect(counted, "the badge re-read the queue for no reason").not.toHaveBeenCalled();
  });
});
