import { beforeEach, describe, expect, it, vi } from "vitest";

import { deviceId, forgetDeviceId, hasDeviceId } from "./deviceId";

/**
 * The till's own identity.
 *
 * Two things must hold, and the second is the one that bites: the id has to be
 * STABLE across reloads, sign-outs and cashier handovers, because it is what
 * ties a queue of unsent sales to the tablet holding them — and it must never
 * be able to crash a boot, because a till that will not open is worse than a
 * till that is merely unrecognised.
 */

const KEY = "shopos-device-id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("minting", () => {
  it("mints a UUID the first time it is asked", () => {
    expect(hasDeviceId()).toBe(false);

    const id = deviceId();

    expect(id).toMatch(UUID);
    expect(hasDeviceId()).toBe(true);
  });

  it("returns the same id on every later call", () => {
    // The whole point. A new id per boot would mean a till's offline history
    // restarts every morning and its unsent sales belong to nobody.
    const first = deviceId();

    expect(deviceId()).toBe(first);
    expect(deviceId()).toBe(first);
  });

  it("survives a reload — the id lives in storage, not in memory", () => {
    const first = deviceId();

    // A reload is exactly this: the module's state is gone, storage is not.
    expect(localStorage.getItem(KEY)).toBe(first);
    expect(deviceId()).toBe(first);
  });
});

describe("a value that is not a UUID is replaced rather than trusted", () => {
  it.each([
    ["empty", ""],
    ["a word", "tablet-1"],
    ["truncated", "0198fbb1-1111-4222-8333"],
    ["a whole JSON blob", '{"id":"0198fbb1-1111-4222-8333-444455556666"}'],
  ])("replaces %s", (_label, corrupt) => {
    localStorage.setItem(KEY, corrupt);

    const id = deviceId();

    expect(id).toMatch(UUID);
    expect(id).not.toBe(corrupt);
    // And the replacement sticks, so the next boot is stable again.
    expect(deviceId()).toBe(id);
  });
});

describe("forgetting", () => {
  it("only happens when a till changes hands, and yields a NEW id", () => {
    const first = deviceId();

    forgetDeviceId();

    expect(hasDeviceId()).toBe(false);
    expect(deviceId()).not.toBe(first);
  });
});

describe("storage that refuses to work", () => {
  it("still returns a usable id when reading throws", () => {
    // Private mode, a locked-down profile, a full quota. An ephemeral id keeps
    // the till working; a thrown error would stop it opening at all.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(deviceId()).toMatch(UUID);
    expect(hasDeviceId()).toBe(false);
  });

  it("still returns a usable id when writing throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(deviceId()).toMatch(UUID);
  });

  it("does not throw when forgetting is impossible", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(() => forgetDeviceId()).not.toThrow();
  });
});
