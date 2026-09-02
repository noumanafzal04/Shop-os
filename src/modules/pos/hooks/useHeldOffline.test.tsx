import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { localHeld } from "../heldLocal";
import { posService } from "../services/posService";
import { useAuthStore } from "../../../stores/authStore";
import { useHeldMutations } from "./usePos";

/**
 * Parking a ticket when the till already knows it has no line.
 *
 * The hook has always fallen back to a local park when the request fails with
 * `status 0`. That covers the till that BELIEVED it was connected — but a till
 * showing an offline pill would still spend a 20-second request timeout
 * discovering what it was already displaying, with a customer waiting and a
 * queue behind them. So the page says so, and the network is not touched at
 * all.
 *
 * jsdom cannot go offline (`navigator.onLine` is true no matter what), which is
 * exactly why this asks the question a different way: not "is the app offline"
 * but "was the server asked". The browser half of this is proven in
 * `e2e/offline-shift.spec.ts`, which is the only thing here that can really
 * pull the plug.
 */

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ticket = { label: "Milk run", cart: { items: [] }, total_estimate: 990 };

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  useAuthStore.setState({ user: { tenant: { id: "shop-a" } } } as never);
});

describe("a ticket parked by a till that knows it is offline", () => {
  it("never asks the server", async () => {
    const hold = vi.spyOn(posService, "hold");

    const { result } = renderHook(() => useHeldMutations(), { wrapper });
    result.current.hold.mutate({ ...ticket, offline: true });

    await waitFor(() => expect(result.current.hold.isSuccess).toBe(true));

    // The whole point. A request that is going to fail is still twenty seconds
    // of a cashier standing at a counter.
    expect(hold).not.toHaveBeenCalled();
    expect(localHeld("shop-a")).toHaveLength(1);
  });

  it("still goes to the server when the till believes it is connected", async () => {
    const hold = vi.spyOn(posService, "hold").mockResolvedValue({ data: { id: "srv-1" } } as never);

    const { result } = renderHook(() => useHeldMutations(), { wrapper });
    result.current.hold.mutate(ticket);

    await waitFor(() => expect(result.current.hold.isSuccess).toBe(true));

    expect(hold).toHaveBeenCalledTimes(1);
    // And it did NOT also park a copy here. Two rows for one basket is the
    // defect the shared claim exists to prevent, arriving by the back door.
    expect(localHeld("shop-a")).toHaveLength(0);
  });

  it("does not send the till's own flag to the server", async () => {
    // `offline` is a message to this hook, not a field the API knows. Passing
    // it through would be a 422 on the one press that must not fail.
    const hold = vi.spyOn(posService, "hold").mockResolvedValue({ data: { id: "srv-1" } } as never);

    const { result } = renderHook(() => useHeldMutations(), { wrapper });
    result.current.hold.mutate({ ...ticket, offline: false });

    await waitFor(() => expect(result.current.hold.isSuccess).toBe(true));

    expect(hold.mock.calls[0][0]).not.toHaveProperty("offline");
  });
});
