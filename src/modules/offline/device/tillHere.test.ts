import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { useAuthStore } from "../../../stores/authStore";
import { resetDbCache } from "../db/open";
import { putSingleton } from "../db/repo";
import { STORE } from "../db/schema";
import { enqueue, newRow } from "../outbox/outbox";
import { markTillHere, useTillIsHere } from "./tillHere";

/**
 * IS THIS COMPUTER A TILL? (L3, 2026-10-17)
 *
 * Only a device the till was opened on keeps the till's copy of the shelf —
 * and every device that already was a till still is.
 */

const holdsShelfOf = (shop: string) =>
  putSingleton(STORE.SYNC_META, { cursors: { products: "2026-10-03 09:00:00|p1" }, clockSkewMs: 0, lastPullAt: null, pulledAt: Date.now(), tenantId: shop });

/** Long enough for the device to have looked in its own storage. */
const looked = () => new Promise((r) => setTimeout(r, 150));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
  localStorage.clear();
  useAuthStore.setState({ user: { id: "u1", tenant: { id: "t1" } } } as never);
});

describe("a device that is not a till", () => {
  it("is not one until the till is opened on it", async () => {
    const { result } = renderHook(() => useTillIsHere("t1"));
    await looked();
    expect(result.current).toBe(false);

    act(() => markTillHere("t1"));

    expect(result.current).toBe(true);
    // …and stays one on the next load.
    expect(renderHook(() => useTillIsHere("t1")).result.current).toBe(true);
  });

  it("is one shop's till, not the next shop's", async () => {
    markTillHere("t2");

    const { result } = renderHook(() => useTillIsHere("t1"));
    await looked();

    expect(result.current).toBe(false);
  });

  it("with nobody signed in yet is nobody's", async () => {
    markTillHere(null);

    const { result } = renderHook(() => useTillIsHere(null));
    await looked();

    expect(result.current).toBe(false);
  });

  it("hears a till opened in another tab of the same browser", async () => {
    const { result } = renderHook(() => useTillIsHere("t1"));
    await looked();

    act(() => {
      localStorage.setItem("shopos-till-here", "t1");
      window.dispatchEvent(new StorageEvent("storage", { key: "shopos-till-here", newValue: "t1" }));
    });

    expect(result.current).toBe(true);
  });
});

describe("a till from before this rule", () => {
  it("holding this shop's shelf is still a till", async () => {
    await holdsShelfOf("t1");

    const { result } = renderHook(() => useTillIsHere("t1"));

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("owing the server a sale is still a till, shelf or not", async () => {
    await enqueue(newRow("op-1", new Date().toISOString(), "OFF-K7QX-0001", { items: [] }, null, { tenantId: "t1" }));

    const { result } = renderHook(() => useTillIsHere("t1"));

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("holding ANOTHER shop's shelf is not this shop's till", async () => {
    await holdsShelfOf("t2");

    const { result } = renderHook(() => useTillIsHere("t1"));
    await looked();

    expect(result.current).toBe(false);
  });
});
