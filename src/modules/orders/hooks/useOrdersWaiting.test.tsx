import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../../../stores/authStore";
import { ordersService } from "../services/ordersService";
import { useWaitingStore } from "../waitingStore";
import { useOrdersWaiting, useTellTheMenu } from "./useOrders";

/**
 * THE COUNT BESIDE "ORDERS" — when the server is asked, and when it is not.
 *
 * It was asked on every load and every half minute. Each test here is one of
 * the moments in `waitingCount.ts`, and what is counted is the REQUESTS:
 * a count that is right and was asked for five times is the fault this fixes.
 */

// The bell, as the header's own hook would hand it over.
let bell: Array<{ id: string; type: string }> | undefined;
vi.mock("../../notifications/hooks/useNotifications", () => ({
  useNotifications: () => ({ data: bell === undefined ? undefined : { data: bell } }),
}));

let asked: ReturnType<typeof vi.spyOn>;
let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const says = (waiting: { new: number; being_worked: number }) => asked.mockResolvedValue({ data: waiting } as never);
const signedIn = (shop: string, user: string) => useAuthStore.setState({ user: { id: user, tenant: { id: shop } } as never, isAuthenticated: true });
/** Long enough for a request that was going to be made to have been. */
const aMoment = () => act(async () => { await new Promise((turn) => setTimeout(turn, 60)); });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  asked = vi.spyOn(ordersService, "waiting");
  says({ new: 1, being_worked: 4 });
  bell = undefined;
  useWaitingStore.setState({ kept: null });
  signedIn("t1", "u1");
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

describe("with nothing kept", () => {
  it("asks once, and keeps the answer for this person in this shop", async () => {
    const { result } = renderHook(() => useOrdersWaiting(true), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ new: 1, being_worked: 4 }));
    await aMoment();

    expect(asked).toHaveBeenCalledTimes(1);
    expect(useWaitingStore.getState().kept).toMatchObject({ owner: "t1:u1", count: { new: 1, being_worked: 4 } });
  });

  it("asks nothing at all for a menu with no Orders row", async () => {
    const { result } = renderHook(() => useOrdersWaiting(false), { wrapper });
    await aMoment();

    expect(asked).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});

describe("opened again — a reload", () => {
  it("shows what was kept and asks NOTHING, inside two minutes", async () => {
    useWaitingStore.setState({ kept: { owner: "t1:u1", count: { new: 2, being_worked: 5, at: Date.now() - 30_000 } } });

    const { result } = renderHook(() => useOrdersWaiting(true), { wrapper });
    await aMoment();

    expect(result.current.data, "the kept count was not what the menu opened with").toEqual({ new: 2, being_worked: 5 });
    expect(asked, "a reload asked for a count it already had").not.toHaveBeenCalled();
  });

  it("shows what was kept and asks, once it is older than that", async () => {
    useWaitingStore.setState({ kept: { owner: "t1:u1", count: { new: 2, being_worked: 5, at: Date.now() - 3 * 60_000 } } });

    const { result } = renderHook(() => useOrdersWaiting(true), { wrapper });
    // At once, before any answer: the old figure, not a blank.
    expect(result.current.data).toEqual({ new: 2, being_worked: 5 });

    await waitFor(() => expect(result.current.data).toEqual({ new: 1, being_worked: 4 }));
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("never shows a count kept for another shop — it asks for its own", async () => {
    useWaitingStore.setState({ kept: { owner: "t2:u1", count: { new: 9, being_worked: 9, at: Date.now() } } });

    const { result } = renderHook(() => useOrdersWaiting(true), { wrapper });
    expect(result.current.data, "another shop's count was on the menu").toBeUndefined();

    await waitFor(() => expect(result.current.data).toEqual({ new: 1, being_worked: 4 }));
    expect(useWaitingStore.getState().kept?.owner).toBe("t1:u1");
  });
});

describe("the bell", () => {
  beforeEach(() => {
    useWaitingStore.setState({ kept: { owner: "t1:u1", count: { new: 0, being_worked: 3, at: Date.now() } } });
  });

  it("heard for the first time, is noted and nothing is asked", async () => {
    bell = [{ id: "n1", type: "order.placed" }];
    renderHook(() => useOrdersWaiting(true), { wrapper });
    await aMoment();

    expect(asked).not.toHaveBeenCalled();
    expect(useWaitingStore.getState().kept?.heard).toBe("n1");
  });

  it("saying a new order has come, asks ONCE — and not again while it says the same", async () => {
    bell = [{ id: "n1", type: "order.placed" }];
    const { result, rerender } = renderHook(() => useOrdersWaiting(true), { wrapper });
    await aMoment();
    expect(asked).not.toHaveBeenCalled();

    // An order taken on another device: the bell's next answer has it.
    bell = [{ id: "n2", type: "order.placed" }, { id: "n1", type: "order.placed" }];
    rerender();
    await waitFor(() => expect(result.current.data, "a new order on the bell did not reach the menu").toEqual({ new: 1, being_worked: 4 }));
    expect(asked).toHaveBeenCalledTimes(1);

    // The bell is asked again every half minute and says the same thing.
    rerender();
    rerender();
    await aMoment();
    expect(asked, "the same news was acted on twice").toHaveBeenCalledTimes(1);
  });

  it("ringing about something that is not an order asks nothing", async () => {
    bell = [{ id: "n1", type: "order.placed" }];
    const { rerender } = renderHook(() => useOrdersWaiting(true), { wrapper });
    await aMoment();

    bell = [{ id: "n5", type: "stock.low" }, { id: "n1", type: "order.placed" }];
    rerender();
    await aMoment();

    expect(asked).not.toHaveBeenCalled();
  });

  it("is news on the next load too: what it said while the app was shut is acted on", async () => {
    useWaitingStore.setState({ kept: { owner: "t1:u1", count: { new: 0, being_worked: 3, at: Date.now() }, heard: "n1" } });
    bell = [{ id: "n2", type: "order.placed" }];

    const { result } = renderHook(() => useOrdersWaiting(true), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ new: 1, being_worked: 4 }));
    expect(asked).toHaveBeenCalledTimes(1);
  });
});

describe("the Orders screen", () => {
  it("tells the menu its own figure — the menu shows it, keeps it, and asks nobody", async () => {
    useWaitingStore.setState({ kept: { owner: "t1:u1", count: { new: 0, being_worked: 3, at: Date.now() } } });
    const { result } = renderHook(() => ({ waiting: useOrdersWaiting(true), tell: useTellTheMenu() }), { wrapper });

    act(() => result.current.tell({ new: 2, being_worked: 6 }));

    await waitFor(() => expect(result.current.waiting.data).toEqual({ new: 2, being_worked: 6 }));
    await aMoment();
    expect(asked).not.toHaveBeenCalled();
    expect(useWaitingStore.getState().kept?.count).toMatchObject({ new: 2, being_worked: 6 });
  });
});

describe("two answers in one millisecond", () => {
  it("keeps the second — the clock alone cannot tell them apart", async () => {
    // The Orders screen tells the menu its figure in the same millisecond the
    // kept one was heard. Judged by the time, that looked like nothing new:
    // the menu showed 2 and the device went on holding 0 for the next load.
    const at = Date.now();
    useWaitingStore.setState({ kept: { owner: "t1:u1", count: { new: 0, being_worked: 3, at } } });
    const { result } = renderHook(() => useOrdersWaiting(true), { wrapper });

    act(() => { client.setQueryData(["orders", "shop", "waiting"], { new: 2, being_worked: 6 }, { updatedAt: at }); });

    await waitFor(() => expect(result.current.data).toEqual({ new: 2, being_worked: 6 }));
    expect(useWaitingStore.getState().kept?.count, "the menu shows one count and the device keeps another").toMatchObject({ new: 2, being_worked: 6 });
  });
});

describe("this device's own work", () => {
  it("asks again when an order is taken, confirmed or cancelled here — they all invalidate the orders key", async () => {
    useWaitingStore.setState({ kept: { owner: "t1:u1", count: { new: 0, being_worked: 3, at: Date.now() } } });
    const { result } = renderHook(() => useOrdersWaiting(true), { wrapper });
    await aMoment();
    expect(asked).not.toHaveBeenCalled();

    await act(async () => { await client.invalidateQueries({ queryKey: ["orders"] }); });

    await waitFor(() => expect(result.current.data).toEqual({ new: 1, being_worked: 4 }));
    expect(asked).toHaveBeenCalledTimes(1);
  });
});
