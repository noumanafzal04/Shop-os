import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";

import { useConnectionStore } from "../../../stores/connectionStore";
import { HEARTBEAT_MS, useKeepInSync } from "./useKeepInSync";
import * as puller from "./pullNow";

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

vi.mock("../db/repo", () => ({ pendingCount: async () => 0 }));

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
