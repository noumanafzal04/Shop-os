import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const asked = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../../common/api/client", () => ({
  apiGet: vi.fn(async () => {
    asked.count++;

    return { success: true, message: "OK", data: [], errors: {}, meta: {} };
  }),
  apiPost: vi.fn(),
}));

import { BELL_EVERY, useNotifications } from "./useNotifications";
import { useAuthStore } from "../../../stores/authStore";

/**
 * #AZ2 (and the whole of #OF2): offline for 5½ minutes, the bell dialled out
 * eleven times — every 30 seconds — failed eleven times and wrote eleven
 * console errors. A watcher with no offline path waits for the line.
 */
function wrapper({ children }: { children: ReactNode }) {
  // The app's own default: every query runs whatever the browser says.
  const client = new QueryClient({ defaultOptions: { queries: { networkMode: "always", retry: false } } });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("the bell with the line down", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    asked.count = 0;
    useAuthStore.setState({ isAuthenticated: true, user: { id: "u1", tenant: { id: "t1" } } } as never);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });

  it("asks nothing for five and a half minutes offline, then once when the line is back", async () => {
    onlineManager.setOnline(false);
    renderHook(() => useNotifications(), { wrapper });

    await act(async () => { await vi.advanceTimersByTimeAsync(11 * BELL_EVERY); });
    expect(asked.count).toBe(0);

    await act(async () => { onlineManager.setOnline(true); await vi.advanceTimersByTimeAsync(10); });
    expect(asked.count).toBe(1);
  });

  it("online, it still asks every half minute", async () => {
    renderHook(() => useNotifications(), { wrapper });

    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const first = asked.count;
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * BELL_EVERY + 10); });

    expect(first).toBe(1);
    expect(asked.count).toBe(3);
  });

  it("the menu's order count is a watcher too", () => {
    const orders = readFileSync(resolve(__dirname, "../../orders/hooks/useOrders.ts"), "utf8");
    const waiting = orders.slice(orders.indexOf("export function useOrdersWaiting"));

    expect(waiting.slice(0, waiting.indexOf("});"))).toMatch(/networkMode: WATCHER_NETWORK_MODE/);
  });
});
