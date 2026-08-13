import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "./db/open";
import { deviceService } from "./device/deviceService";
import { useOfflineStore } from "./offlineStore";
import { useOfflineBoot } from "./useOfflineBoot";
import type { StorageHealth } from "./storage/persist";

// checkStorage is a plain function export, and an ESM binding cannot be spied
// on — the module is mocked and steered through this handle instead.
let checkStorageImpl: () => Promise<StorageHealth>;
vi.mock("./storage/persist", () => ({
  checkStorage: () => checkStorageImpl(),
}));

/**
 * What the till does on the way in.
 *
 * One property matters more than every other and most of this file is about it:
 * **no failure in the boot may stop the till opening.** A boot that crashes on
 * a storage query, a missing database or a refused registration is a till that
 * will not open, and a till that will not open is worse in every way than one
 * that opens knowing less. So each step is tested failing on its own, and the
 * assertion is always that the others still happened.
 *
 * The order is load-bearing too: the only step that needs a network is LAST, so
 * a till with no line still knows who it is, whether its storage is safe, and
 * how many sales it is holding — which is exactly what a cashier needs at the
 * moment the internet is the thing that is broken.
 */

const reset = () => {
  useOfflineStore.setState({
    deviceId: null,
    registered: false,
    offlineDays: null,
    hoursOffline: null,
    storage: null,
    pending: 0,
  });
};

const okDevice = {
  id: "d1",
  name: null,
  platform: "web" as const,
  branch: null,
  register: null,
  last_seen_at: null,
  days_offline: 0,
  revoked: false,
  revoked_at: null,
};

const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
  localStorage.clear();
  reset();

  vi.spyOn(deviceService, "register").mockResolvedValue(envelope(okDevice));
  vi.spyOn(deviceService, "list").mockResolvedValue(envelope({ devices: [], offline_days: 3 }));
  checkStorageImpl = async () => ({ state: "persisted", usage: 10, quota: 100, used: 0.1 });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetDbCache();
});

describe("a normal boot", () => {
  it("learns who it is, whether storage is safe, what is waiting, and the shop's window", async () => {
    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(useOfflineStore.getState().registered).toBe(true));

    const state = useOfflineStore.getState();
    expect(state.deviceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(state.storage?.state).toBe("persisted");
    expect(state.pending).toBe(0);
    expect(state.offlineDays).toBe(3);
  });

  it("announces the SAME id every time, not a new one per boot", async () => {
    const { unmount } = renderHook(() => useOfflineBoot(true));
    await waitFor(() => expect(useOfflineStore.getState().registered).toBe(true));
    const first = useOfflineStore.getState().deviceId;
    unmount();

    reset();
    renderHook(() => useOfflineBoot(true));
    await waitFor(() => expect(useOfflineStore.getState().registered).toBe(true));

    expect(useOfflineStore.getState().deviceId).toBe(first);
  });

  it("registers ONCE under StrictMode, which runs every effect twice", async () => {
    // The app mounts inside StrictMode, so in development React runs each
    // effect, tears it down, and runs it again. Without a guard that is two
    // registrations for every boot — and, once Phase 3 lands, two of whatever
    // else the boot decides to do. The dependency array alone does not stop it;
    // only the ref does. Testing this without StrictMode passes either way,
    // which is a test that guards nothing.
    renderHook(() => useOfflineBoot(true), { wrapper: StrictMode });

    await waitFor(() => expect(useOfflineStore.getState().registered).toBe(true));

    expect(deviceService.register).toHaveBeenCalledTimes(1);
  });

  it("does not re-register on a plain re-render either", async () => {
    // A round trip per re-render is a request per keystroke on a slow line.
    const { rerender } = renderHook(() => useOfflineBoot(true));
    await waitFor(() => expect(useOfflineStore.getState().registered).toBe(true));

    rerender();
    rerender();
    rerender();

    expect(deviceService.register).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all until it is switched on", async () => {
    renderHook(() => useOfflineBoot(false));

    await new Promise((r) => setTimeout(r, 10));

    expect(deviceService.register).not.toHaveBeenCalled();
    expect(useOfflineStore.getState().deviceId).toBeNull();
  });
});

describe("no step may take the boot down with it", () => {
  it("keeps going when the storage check throws", async () => {
    checkStorageImpl = async () => {
      throw new Error("blocked");
    };

    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(useOfflineStore.getState().registered).toBe(true));
    expect(useOfflineStore.getState().deviceId).not.toBeNull();
    expect(useOfflineStore.getState().offlineDays).toBe(3);
  });

  it("keeps going when there is no local database at all", async () => {
    // Safari private mode, a locked-down profile.
    const real = globalThis.indexedDB;
    // @ts-expect-error removing it on purpose
    delete globalThis.indexedDB;
    resetDbCache();

    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(useOfflineStore.getState().registered).toBe(true));
    expect(useOfflineStore.getState().deviceId).not.toBeNull();

    globalThis.indexedDB = real;
  });

  it("keeps going when the shop has no line — registration is an announcement, not a permission", async () => {
    vi.spyOn(deviceService, "register").mockRejectedValue(new Error("Network Error"));

    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(useOfflineStore.getState().deviceId).not.toBeNull());
    // Everything that does not need the network still landed.
    await waitFor(() => expect(useOfflineStore.getState().storage?.state).toBe("persisted"));
    expect(useOfflineStore.getState().registered).toBe(false);

    // And — the part a missing catch would silently break — the boot CARRIES
    // ON. An unhandled rejection here would abandon every later step, so the
    // shop's window would never be read and the till would degrade against a
    // number it never learned.
    await waitFor(() => expect(useOfflineStore.getState().offlineDays).toBe(3));
    expect(deviceService.list).toHaveBeenCalled();
  });

  it("keeps going when the cashier may not read the shop's window", async () => {
    // The roster needs a permission a cashier does not hold. Not knowing the
    // number is fine; failing to open the till over it is not.
    vi.spyOn(deviceService, "list").mockRejectedValue(new Error("Forbidden"));

    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(useOfflineStore.getState().registered).toBe(true));
    expect(useOfflineStore.getState().offlineDays).toBeNull();
  });

  it("survives every step failing at once", async () => {
    checkStorageImpl = async () => {
      throw new Error("x");
    };
    vi.spyOn(deviceService, "register").mockRejectedValue(new Error("x"));
    vi.spyOn(deviceService, "list").mockRejectedValue(new Error("x"));
    const real = globalThis.indexedDB;
    // @ts-expect-error removing it on purpose
    delete globalThis.indexedDB;
    resetDbCache();

    expect(() => renderHook(() => useOfflineBoot(true))).not.toThrow();

    // The one thing that cannot fail still worked: the till knows what it is.
    await waitFor(() => expect(useOfflineStore.getState().deviceId).not.toBeNull());

    globalThis.indexedDB = real;
  });
});

describe("the order the steps run in", () => {
  it("does the network step LAST, so a line-less till still learns everything else", async () => {
    const order: string[] = [];
    checkStorageImpl = async () => {
      order.push("storage");
      return { state: "persisted", usage: 1, quota: 2, used: 0.5 };
    };
    vi.spyOn(deviceService, "register").mockImplementation(async () => {
      order.push("register");
      return envelope(okDevice);
    });

    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(useOfflineStore.getState().registered).toBe(true));
    expect(order).toEqual(["storage", "register"]);
  });
});
