import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHECK_EVERY_MS, watchForUpdates } from "./updateWatch";

/**
 * The till that never navigates.
 *
 * A browser looks for a new service worker when the page is navigated, and the
 * POS is opened once and left. Without this the update strip could not appear
 * at all on the screen it matters most on.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a long-lived till still hears about a new version", () => {
  it("asks again every hour", async () => {
    const update = vi.fn().mockResolvedValue(undefined);

    watchForUpdates({ update });

    expect(update, "asked before an hour had passed").not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3);
    expect(update).toHaveBeenCalledTimes(3);
  });

  it("does not ask while the shop has no line", async () => {
    const update = vi.fn().mockResolvedValue(undefined);

    watchForUpdates({ update }, { isOnline: () => false });
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);

    expect(update, "a till with no network was made to ask anyway").not.toHaveBeenCalled();
  });

  it("survives a check that fails", async () => {
    const update = vi.fn().mockRejectedValue(new Error("offline"));

    watchForUpdates({ update }, { every: 10 });
    await vi.advanceTimersByTimeAsync(35);

    // Still asking. A rejected check must not kill the watch — that would mean
    // one bad minute costs every later offer.
    expect(update.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("stops when told to, and asks for nothing when there is no worker", async () => {
    const update = vi.fn().mockResolvedValue(undefined);

    const stop = watchForUpdates({ update }, { every: 10 });
    await vi.advanceTimersByTimeAsync(25);
    stop();
    await vi.advanceTimersByTimeAsync(100);

    expect(update).toHaveBeenCalledTimes(2);
    expect(() => watchForUpdates(undefined)()).not.toThrow();
  });
});
