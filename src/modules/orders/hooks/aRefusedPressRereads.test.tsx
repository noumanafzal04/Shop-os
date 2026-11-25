import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ordersService } from "../services/ordersService";
import { ORDER_QUEUE_POLL_MS, useOrderActions } from "./useOrders";

/**
 * A REFUSED PRESS RE-READS THE QUEUE.
 *
 * The live three-app run: a customer cancelled, the shop's open Orders screen
 * still showed the card, the shop pressed Confirm, the server said 409 — and
 * the card stayed, still offering Confirm, under its own "Blocked" message.
 * The queue was re-read only on success. A refusal is exactly when the screen
 * is known to be old.
 */
let client: QueryClient;
let reread: { mock: { calls: unknown[][] } };
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const refused = () => Promise.reject(Object.assign(new Error("Cannot move an order from cancelled to confirmed."), { status: 409 }));
const ordersReread = () => reread.mock.calls.some(([f]) => JSON.stringify((f as { queryKey?: unknown })?.queryKey) === '["orders"]');

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  reread = vi.spyOn(client, "invalidateQueries");
});
afterEach(() => { client.clear(); vi.restoreAllMocks(); });

describe("the shop's order buttons", () => {
  it.each([
    ["Confirm (advance)", "advance", (a: ReturnType<typeof useOrderActions>) => a.advance.mutateAsync({ id: "o1", status: "confirmed" })],
    ["Cancel", "cancel", (a: ReturnType<typeof useOrderActions>) => a.cancel.mutateAsync({ id: "o1" })],
    ["Give to a rider", "assignRider", (a: ReturnType<typeof useOrderActions>) => a.assignRider.mutateAsync({ id: "o1", riderId: "r1" })],
  ] as const)("%s re-reads the queue when the server refuses", async (_n, method, press) => {
    vi.spyOn(ordersService, method).mockImplementation(refused as never);
    const { result } = renderHook(() => useOrderActions(), { wrapper });

    await act(async () => { await press(result.current).catch(() => undefined); });

    expect(ordersReread()).toBe(true);
  });

  it("and still re-reads when it agrees", async () => {
    vi.spyOn(ordersService, "advance").mockResolvedValue({ data: {} } as never);
    const { result } = renderHook(() => useOrderActions(), { wrapper });
    await act(async () => { await result.current.advance.mutateAsync({ id: "o1", status: "confirmed" }); });
    expect(ordersReread()).toBe(true);
  });
});

it("an open Orders screen asks for news as often as the partner app (15 s, it was 30)", () => {
  expect(ORDER_QUEUE_POLL_MS).toBe(15_000);
});
