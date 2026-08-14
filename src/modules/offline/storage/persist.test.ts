import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkStorage,
  isInstalled,
  isNearlyFull,
  NEARLY_FULL,
  requestPersistentStorage,
  storageApiAvailable,
  storageEstimate,
  storageWarning,
  type StorageHealth,
} from "./persist";

/**
 * Whether the browser will hold onto the till's sales.
 *
 * A browser evicts non-persistent origins under storage pressure without asking
 * and without an event. For a till holding unsent sales that is money gone with
 * no record, so the answer has to be known BEFORE a shift opens rather than
 * discovered afterwards. Every path here therefore reports; none throws, since
 * a boot that crashes on a storage query is a till that will not open.
 */

const realNavigator = globalThis.navigator;

function withStorage(storage: Partial<StorageManager> | undefined): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: storage === undefined ? {} : { storage },
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: realNavigator });
  vi.restoreAllMocks();
});

describe("asking for durable storage", () => {
  it("reports unsupported when the browser has no such API", async () => {
    withStorage(undefined);

    expect(storageApiAvailable()).toBe(false);
    expect(await requestPersistentStorage()).toBe("unsupported");
  });

  it("does not re-ask when the origin already has it", async () => {
    // Re-asking is how a user gets prompted twice for something they already
    // granted, which is how they learn to say no.
    const persist = vi.fn().mockResolvedValue(true);
    withStorage({ persisted: vi.fn().mockResolvedValue(true), persist });

    expect(await requestPersistentStorage()).toBe("persisted");
    expect(persist).not.toHaveBeenCalled();
  });

  it("asks once when the origin does not have it, and reports a grant", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    withStorage({ persisted: vi.fn().mockResolvedValue(false), persist });

    expect(await requestPersistentStorage()).toBe("persisted");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("treats a refusal as an answer, not a failure", async () => {
    withStorage({
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(false),
    });

    expect(await requestPersistentStorage()).toBe("not-persisted");
  });

  it("does not throw when the browser throws instead of answering", async () => {
    withStorage({
      persisted: vi.fn().mockRejectedValue(new Error("blocked")),
      persist: vi.fn(),
    });

    expect(await requestPersistentStorage()).toBe("unsupported");
  });
});

describe("how much room is left", () => {
  it("reports usage, quota and the fraction in use", async () => {
    withStorage({ estimate: vi.fn().mockResolvedValue({ usage: 25_000_000, quota: 100_000_000 }) });

    expect(await storageEstimate()).toEqual({ usage: 25_000_000, quota: 100_000_000, used: 0.25 });
  });

  it("says it does not know rather than guessing, when the browser will not say", async () => {
    withStorage({ estimate: vi.fn().mockResolvedValue({}) });

    expect(await storageEstimate()).toEqual({ usage: null, quota: null, used: null });
  });

  it("says it does not know rather than dividing by zero", async () => {
    withStorage({ estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 0 }) });

    expect(await storageEstimate()).toEqual({ usage: null, quota: null, used: null });
  });

  it("does not throw when estimating throws", async () => {
    withStorage({ estimate: vi.fn().mockRejectedValue(new Error("nope")) });

    expect(await storageEstimate()).toEqual({ usage: null, quota: null, used: null });
  });

  it("does not throw when there is no estimate API at all", async () => {
    withStorage(undefined);

    expect(await storageEstimate()).toEqual({ usage: null, quota: null, used: null });
  });
});

describe("the one call the boot sequence makes", () => {
  it("returns both answers together", async () => {
    withStorage({
      persisted: vi.fn().mockResolvedValue(true),
      persist: vi.fn(),
      estimate: vi.fn().mockResolvedValue({ usage: 10, quota: 100 }),
    });

    expect(await checkStorage()).toEqual({
      state: "persisted",
      usage: 10,
      quota: 100,
      used: 0.1,
    });
  });
});

describe("is this an installed till or a browser tab", () => {
  it("reads Safari's own standalone flag", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { standalone: true },
    });

    expect(isInstalled()).toBe(true);
  });

  it("reads the display-mode media query everywhere else", () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("standalone") })) as typeof window.matchMedia;

    expect(isInstalled()).toBe(true);

    window.matchMedia = original;
  });
});

describe("what the shop is told", () => {
  const health = (over: Partial<StorageHealth>): StorageHealth => ({
    state: "persisted",
    usage: 10,
    quota: 100,
    used: 0.1,
    ...over,
  });

  it("says nothing when storage is durable and roomy", () => {
    expect(storageWarning(health({}), true)).toBeNull();
  });

  it("warns plainly when the browser has NOT promised to keep the data", () => {
    const message = storageWarning(health({ state: "not-persisted" }), true);

    expect(message).toMatch(/permanent storage/i);
    // It has to say what is at stake and what to do — a warning that names
    // neither gets dismissed.
    expect(message).toMatch(/haven't reached the server/i);
    expect(message).toMatch(/home screen/i);
  });

  it("warns when the device is nearly full", () => {
    expect(storageWarning(health({ used: NEARLY_FULL }), true)).toMatch(/almost out of storage/i);
    expect(storageWarning(health({ used: 0.99 }), true)).toMatch(/almost out of storage/i);
  });

  it("stays quiet just below the line", () => {
    expect(storageWarning(health({ used: NEARLY_FULL - 0.01 }), true)).toBeNull();
  });

  it("tells an UNINSTALLED Safari till to install itself", () => {
    // Not a rare old browser — this branch is every iPad and iPhone. Safari has
    // no persist() at all, so it is the platform where we are blindest, and
    // silence would leave exactly the tills that need the advice most without
    // any. Installing is what changes Safari's behaviour, so that is the ask.
    const message = storageWarning(health({ state: "unsupported" }), false);

    expect(message).toMatch(/home screen/i);
    expect(message).toMatch(/won't promise to keep/i);
  });

  it("stops asking once the till IS installed", () => {
    // The advice has been taken. Repeating it is the noise that teaches people
    // to dismiss the message that matters.
    expect(storageWarning(health({ state: "unsupported" }), true)).toBeNull();
    expect(storageWarning(health({ state: "unsupported", used: null }), true)).toBeNull();
  });

  it("puts durability ahead of installing when the browser DID answer", () => {
    // "not-persisted" is a real refusal and outranks the Safari advice.
    expect(storageWarning(health({ state: "not-persisted" }), false)).toMatch(/permanent storage/i);
  });

  it("puts durability ahead of fullness when both are wrong", () => {
    // Losing everything beats running out of room.
    expect(storageWarning(health({ state: "not-persisted", used: 0.99 }), true)).toMatch(
      /permanent storage/i,
    );
  });

  it("does not claim fullness when the browser never said how full it is", () => {
    expect(isNearlyFull(health({ used: null }))).toBe(false);
    expect(storageWarning(health({ used: null }), true)).toBeNull();
  });
});
