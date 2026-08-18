import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import type { ReactNode } from "react";

import { ApiError } from "../../../common/types/api";
import { resetDbCache } from "../../offline/db/open";
import { mirrorShift } from "../../offline/shift/shiftMirror";
import { useAuthStore } from "../../../stores/authStore";
import type { CashSession } from "../services/posService";
import { useCurrentSession } from "./usePos";

/**
 * The gate in front of the whole offline module.
 *
 * `PosPage` disables Tender/Pay without an open shift. Before this, the shift
 * came from a live query with nothing behind it — so a till that RELOADED while
 * offline could not sell at all, however complete the offline module was.
 *
 * What is tested here is the discrimination, because the fallback is only safe
 * if it is narrow: silence gives back the remembered shift, and every real HTTP
 * answer does not.
 */

let currentSessionImpl: () => Promise<{ data: unknown }>;
vi.mock("../services/posService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/posService")>();
  return { ...actual, posService: { ...actual.posService, currentSession: () => currentSessionImpl() } };
});

const SHOP = "shop-a";

const session: CashSession = {
  id: "sess-1",
  status: "open",
  opening_float: 3000,
  cash_sales: 0,
  expected_cash: 3000,
  counted_cash: null,
  variance: null,
  sales_count: 0,
  sales_total: 0,
  opened_at: "2026-08-18T09:00:00+05:00",
  closed_at: null,
  register_id: "lane-1",
};

const wrapper = ({ children }: { children: ReactNode }) => {
  // retry off: a test asserting a failure should not wait out three backoffs.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
  useAuthStore.setState({ user: { tenant: { id: SHOP } } } as never);
});

describe("the shift survives a reload with no server", () => {
  it("remembers what the server said", async () => {
    currentSessionImpl = () => Promise.resolve({ data: session });

    const { result } = renderHook(() => useCurrentSession(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());

    // A fresh query client is a reloaded page: nothing in memory.
    currentSessionImpl = () => Promise.reject(new ApiError("You're offline", 0, "NETWORK"));

    const after = renderHook(() => useCurrentSession(), { wrapper });
    await waitFor(() => expect(after.result.current.data).toBeTruthy());
    expect((after.result.current.data as CashSession).id).toBe("sess-1");
  });

  it("does not invent one when the till has never seen a shift", async () => {
    currentSessionImpl = () => Promise.reject(new ApiError("You're offline", 0, "NETWORK"));

    const { result } = renderHook(() => useCurrentSession(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("only silence falls back", () => {
  it("refuses to hand a drawer to a signed-out till", async () => {
    await mirrorShift(session, SHOP);
    // A 401 reached the server. Answering it from the device would put a
    // cashier who has been signed out back in front of an open drawer.
    currentSessionImpl = () => Promise.reject(new ApiError("Unauthenticated", 401));

    const { result } = renderHook(() => useCurrentSession(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("still fails loudly when the shop's server is broken", async () => {
    await mirrorShift(session, SHOP);
    // A 500 is a broken server, not a dead line. Papering over it with a
    // remembered shift would hide an outage the shop needs to hear about.
    currentSessionImpl = () => Promise.reject(new ApiError("Server error", 500));

    const { result } = renderHook(() => useCurrentSession(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("keeps one shop's drawer away from another", async () => {
    await mirrorShift(session, "shop-b");
    currentSessionImpl = () => Promise.reject(new ApiError("You're offline", 0, "NETWORK"));

    const { result } = renderHook(() => useCurrentSession(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
