import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "./db/open";
import { putSingleton } from "./db/repo";
import { STORE } from "./db/schema";
import { patchDevice, readDevice } from "./device/deviceRecord";
import { deviceService } from "./device/deviceService";
import { resetTouchClock, TOUCH_EVERY_MS } from "./device/touch";
import { PULL_ON_OPEN_EVERY_MS } from "./sync/pullIsDue";
import * as puller from "./sync/pullNow";
import { useOfflineStore } from "./offlineStore";
import { useAuthStore } from "../../stores/authStore";
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

let pull: ReturnType<typeof vi.spyOn>;

/** A shop that IS one — the plain fixture above has no id, which reads as "nobody's till". */
const inShop = (shop: string) =>
  useAuthStore.setState({ user: { role: "shop_owner", permissions: [], tenant: { id: shop, features: { pos: true } } } } as never);
/** The till already holds this shop's catalogue, and last had all of it `ago` ms back. */
const holdsTheCatalogue = (shop: string, ago: number | null) =>
  putSingleton(STORE.SYNC_META, {
    cursors: { products: "2026-10-03 09:00:00|p1" },
    clockSkewMs: 0,
    lastPullAt: null,
    tenantId: shop,
    pulledAt: ago === null ? null : Date.now() - ago,
  });
/** Long enough for a request that was going to be made to have been. */
const aMoment = () => new Promise((turn) => setTimeout(turn, 120));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
  localStorage.clear();
  reset();
  resetTouchClock();
  // The OWNER, who may read the device roster — and whose boot does not ask
  // for it either. See "the roster is not the till's to ask" below.
  useAuthStore.setState({ user: { role: "shop_owner", permissions: [], tenant: { features: { pos: true } } } } as never);

  vi.spyOn(deviceService, "register").mockResolvedValue(envelope(okDevice));
  vi.spyOn(deviceService, "list").mockResolvedValue(envelope({ devices: [], offline_days: 3 }));
  pull = vi.spyOn(puller, "pullNow" as never).mockResolvedValue(undefined as never);
  checkStorageImpl = async () => ({ state: "persisted", usage: 10, quota: 100, used: 0.1 });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetDbCache();
});

describe("a normal boot", () => {
  it("learns who it is, whether storage is safe and what is waiting — and brings the catalogue in", async () => {
    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(useOfflineStore.getState().registered).toBe(true));

    const state = useOfflineStore.getState();
    expect(state.deviceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(state.storage?.state).toBe("persisted");
    expect(state.pending).toBe(0);
    // A till that holds nothing yet: the first load is the one pull nobody may skip.
    await waitFor(() => expect(pull).toHaveBeenCalledTimes(1));
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
    await waitFor(() => expect(pull).toHaveBeenCalled());
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
    // catalogue would never be tried for and a till that got its line back a
    // second later would sit there holding nothing.
    await waitFor(() => expect(pull).toHaveBeenCalled());
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

describe("the roster is not the till's to ask", () => {
  /**
   * The boot asked "who are this shop's tills" on every load, for one number
   * in the answer — the offline window — that no screen on the till read. For
   * a cashier it was a 403 on every screen; for an owner it was a request a
   * load. The window that matters reaches every till inside its catalogue.
   * The roster is asked by the screen that shows it (Settings → Tills).
   */
  it("is not asked for an owner", async () => {
    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(deviceService.register).toHaveBeenCalled());
    await waitFor(() => expect(pull).toHaveBeenCalled());
    await aMoment();

    expect(deviceService.list, "the boot asked for the roster, and nothing reads the answer").not.toHaveBeenCalled();
  });

  it("is not asked for a cashier", async () => {
    useAuthStore.setState({ user: { role: "tenant_staff", permissions: ["sales.manage"], tenant: { features: { pos: true } } } } as never);

    renderHook(() => useOfflineBoot(true));

    // The rest of the boot still runs — the device is still announced.
    await waitFor(() => expect(deviceService.register).toHaveBeenCalled());
    await aMoment();
    expect(deviceService.list).not.toHaveBeenCalled();
  });
});

describe("opened again a moment later — a reload", () => {
  /**
   * Every reload of every screen is a boot. It announced the till and pulled
   * the catalogue each time, a moment after the load before had. What a boot
   * does now depends on what the DEVICE remembers, so each case below sets
   * that memory first — the database is the same one a real reload would find.
   */
  it("does not announce a till the server heard from a minute ago", async () => {
    inShop("t1");
    await patchDevice({ code: "K7QX", announced: { shop: "t1", at: Date.now() - 60_000 } });
    await holdsTheCatalogue("t1", 60_000);

    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(useOfflineStore.getState().registered).toBe(true));
    await aMoment();
    expect(deviceService.register, "a reload announced a till that had just announced itself").not.toHaveBeenCalled();
    // …and what it learned the first time is still there.
    expect((await readDevice()).code).toBe("K7QX");
  });

  it("announces it once five minutes have passed", async () => {
    inShop("t1");
    await patchDevice({ announced: { shop: "t1", at: Date.now() - TOUCH_EVERY_MS - 1_000 } });

    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(deviceService.register).toHaveBeenCalledTimes(1));
    // And writes down that it has, for the load after this one.
    await waitFor(async () => expect(Date.now() - ((await readDevice()).announced?.at ?? 0)).toBeLessThan(5_000));
  });

  it("announces a till that was handed to ANOTHER shop, however recently the last one heard from it", async () => {
    // The new shop has heard nothing — and may refuse this device, which is
    // only learned by asking.
    await patchDevice({ announced: { shop: "t1", at: Date.now() - 1_000 } });
    inShop("t2");

    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(deviceService.register).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect((await readDevice()).announced?.shop).toBe("t2"));
  });

  it("asks again after a REFUSAL — being turned away is not being heard", async () => {
    inShop("t1");
    vi.spyOn(deviceService, "register").mockRejectedValue(new Error("Network Error"));
    const first = renderHook(() => useOfflineBoot(true));
    await waitFor(() => expect(deviceService.register).toHaveBeenCalledTimes(1));
    await aMoment();
    first.unmount();
    expect((await readDevice()).announced, "a failed announcement was written down as made").toBeUndefined();

    vi.spyOn(deviceService, "register").mockResolvedValue(envelope(okDevice));
    resetTouchClock();
    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(deviceService.register).toHaveBeenCalledTimes(1));
  });

  it("keeps the slip code when it writes down the announcement, and the announcement when it learns the code", async () => {
    inShop("t1");
    vi.spyOn(deviceService, "register").mockResolvedValue(envelope({ ...okDevice, code: "K7QX" }));

    renderHook(() => useOfflineBoot(true));

    await waitFor(async () => expect((await readDevice()).announced?.shop).toBe("t1"));
    expect((await readDevice()).code, "writing one fact about the device blanked the other").toBe("K7QX");
  });

  it("does not pull a catalogue it had all of a minute ago", async () => {
    inShop("t1");
    await holdsTheCatalogue("t1", 60_000);

    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(useOfflineStore.getState().registered).toBe(true));
    await aMoment();
    expect(pull, "a reload pulled a catalogue that was a minute old").not.toHaveBeenCalled();
  });

  it("pulls once five minutes have passed", async () => {
    inShop("t1");
    await holdsTheCatalogue("t1", PULL_ON_OPEN_EVERY_MS + 1_000);

    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(pull).toHaveBeenCalledTimes(1));
  });

  it("pulls when the last pull stopped part-way, however recent", async () => {
    inShop("t1");
    await holdsTheCatalogue("t1", null);

    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(pull).toHaveBeenCalledTimes(1));
  });

  it("pulls at once when a sale is waiting to be sent, however recent the catalogue", async () => {
    inShop("t1");
    await holdsTheCatalogue("t1", 1_000);
    const { enqueue, newRow } = await import("./outbox/outbox");
    await enqueue(newRow("op-1", new Date().toISOString(), "OFF-K7QX-0001", { items: [] }, null, { tenantId: "t1" }));

    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(pull, "a queued sale waited behind a fresh catalogue").toHaveBeenCalledTimes(1));
  });

  it("pulls for a till handed to another shop — the catalogue on it is not this shop's", async () => {
    await holdsTheCatalogue("t1", 1_000);
    inShop("t2");

    renderHook(() => useOfflineBoot(true));

    await waitFor(() => expect(pull).toHaveBeenCalledTimes(1));
  });
});
