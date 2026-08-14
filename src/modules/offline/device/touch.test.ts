import { beforeEach, describe, expect, it, vi } from "vitest";

import { deviceService } from "./deviceService";
import { markTouched, resetTouchClock, touchIfDue, TOUCH_EVERY_MS } from "./touch";

/**
 * Saying the till is still here.
 *
 * Registration runs ONCE, on the way in. A POS is not used that way — a counter
 * tablet is opened on Monday and is still on the same tab on Friday, syncing
 * every fifteen minutes — so with only the boot to go on, `last_seen_at`
 * measures time since the browser was reloaded and nothing else. The owner's
 * roster then reads "last reached us 4 days ago" beside a till that is
 * demonstrably reaching us, and the clock the whole offline policy is built on
 * is measuring the wrong thing.
 */

const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });

beforeEach(() => {
  vi.restoreAllMocks();
  resetTouchClock();
});

describe("keeping the clock honest", () => {
  it("touches when nothing has been sent yet", async () => {
    const touch = vi.spyOn(deviceService, "touch").mockResolvedValue(envelope({}) as never);

    expect(await touchIfDue(0)).toBe(true);
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it("does not touch again straight away", async () => {
    // It rides the catalog pull, and a pull fires whenever the tab becomes
    // visible. A cashier moving between tabs would otherwise post every second.
    const touch = vi.spyOn(deviceService, "touch").mockResolvedValue(envelope({}) as never);

    await touchIfDue(0);
    await touchIfDue(60_000);

    expect(touch).toHaveBeenCalledTimes(1);
  });

  it("touches again once the window has passed", async () => {
    const touch = vi.spyOn(deviceService, "touch").mockResolvedValue(envelope({}) as never);

    await touchIfDue(0);
    await touchIfDue(TOUCH_EVERY_MS);

    expect(touch).toHaveBeenCalledTimes(2);
  });

  it("keeps a till open all week from reading as a week out of contact", async () => {
    // The bug this file exists for, stated as the thing an owner would see.
    const touch = vi.spyOn(deviceService, "touch").mockResolvedValue(envelope({}) as never);
    const week = 7 * 24 * 60 * 60 * 1000;

    // A pull every fifteen minutes for a week, on one never-reloaded tab.
    const pulls = week / (15 * 60 * 1000);
    for (let at = 0; at < week; at += 15 * 60 * 1000) await touchIfDue(at);

    // Every pull is past the five-minute window, so every pull says so. The
    // number that matters is the contrast: without this the server would have
    // heard from that tablet exactly ONCE in the whole week.
    expect(touch).toHaveBeenCalledTimes(pulls);
  });
});

describe("when a touch fails", () => {
  it("does not start the clock, so the next pull tries again", async () => {
    // A failed touch told the server nothing. Waiting out the window because of
    // it turns one lost request into five minutes of looking out of contact.
    const touch = vi.spyOn(deviceService, "touch").mockRejectedValue(new Error("offline"));

    expect(await touchIfDue(0)).toBe(false);

    touch.mockResolvedValue(envelope({}) as never);
    expect(await touchIfDue(1_000)).toBe(true);
  });

  it("never throws — the pull it rode in on is not its business", async () => {
    vi.spyOn(deviceService, "touch").mockRejectedValue(new Error("boom"));

    await expect(touchIfDue(0)).resolves.toBe(false);
  });
});

describe("the boot", () => {
  it("can claim the window it just used, so a boot is not two requests", async () => {
    const touch = vi.spyOn(deviceService, "touch").mockResolvedValue(envelope({}) as never);
    markTouched(0);

    await touchIfDue(1_000);

    expect(touch).not.toHaveBeenCalled();
  });
});

describe("when findings have just gone up", () => {
  // The tally and the variances travel by different roads: a finding goes on
  // the catalog pull, the count of checks rides this call. Waiting out the
  // five minutes leaves a shop reading "9 carts priced differently" above
  // "Carts checked: 2" — a screen contradicting itself while somebody reads it.

  it("goes now, rather than waiting out the clock", async () => {
    const touch = vi.spyOn(deviceService, "touch").mockResolvedValue({} as never);

    await touchIfDue(0);
    expect(touch).toHaveBeenCalledTimes(1);

    // Well inside the window, and it still goes.
    await touchIfDue(1_000, { force: true });
    expect(touch).toHaveBeenCalledTimes(2);
  });

  it("still holds the clock back when nothing was found", async () => {
    // A warning that fires on every pull is the noise the rate limit exists
    // to prevent.
    const touch = vi.spyOn(deviceService, "touch").mockResolvedValue({} as never);

    await touchIfDue(0);
    await touchIfDue(1_000, { force: false });

    expect(touch).toHaveBeenCalledTimes(1);
  });

  it("does not move the clock when a forced touch fails", async () => {
    // Same rule as the ordinary path: the clock advances on success only, or
    // one lost request buys five minutes of looking out of contact.
    vi.spyOn(deviceService, "touch").mockRejectedValue(new Error("offline"));

    expect(await touchIfDue(0, { force: true })).toBe(false);

    vi.spyOn(deviceService, "touch").mockResolvedValue({} as never);
    expect(await touchIfDue(1_000)).toBe(true);
  });
});
