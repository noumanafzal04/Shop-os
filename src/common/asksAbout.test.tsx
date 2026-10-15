import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOrderWorth } from "../modules/orders/hooks/useOrders";
import { ordersService } from "../modules/orders/services/ordersService";
import { useSaleWorth } from "../modules/sales/hooks/useSales";
import { salesService } from "../modules/sales/services/salesService";
import { asksAbout } from "./asksAbout";

/**
 * AN EMPTY BILL IS NOT ASKED ABOUT.
 *
 * Tester pass 4 (B52): every exchange sent `{"items": []}` to /sales/worth the
 * moment its first replacement was picked — 422 and a console error — because
 * the sheet switched the question on from the bill now and sent the bill of a
 * moment ago. Take order did the same on opening (B27).
 */

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const aMoment = () => act(async () => { await new Promise((turn) => setTimeout(turn, 30)); });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

describe("asksAbout", () => {
  it("is a question only with a line in it", () => {
    expect(asksAbout(JSON.stringify({ channel: "pos", items: [] }))).toBe(false);
    expect(asksAbout(JSON.stringify({ channel: "pos" }))).toBe(false);
    expect(asksAbout("not json")).toBe(false);
    expect(asksAbout(JSON.stringify({ items: [{ product_id: "p", quantity: 1 }] }))).toBe(true);
  });
});

describe("the sheets that ask what a bill comes to", () => {
  it("a sale: the empty bill of a moment ago is not sent, the first line is", async () => {
    const worth = vi.spyOn(salesService, "worth").mockResolvedValue({ data: { total: 100 } } as never);

    // Switched on (a line is on screen) while the settled bill is still empty.
    renderHook(() => useSaleWorth(JSON.stringify({ channel: "pos", items: [], payment_method: "cash", amount_paid: 0 }), true), { wrapper });
    await aMoment();
    expect(worth).not.toHaveBeenCalled();

    renderHook(() => useSaleWorth(JSON.stringify({ channel: "pos", items: [{ product_id: "p", quantity: 1 }] }), true), { wrapper });
    await aMoment();
    expect(worth).toHaveBeenCalledTimes(1);
  });

  it("an order: the same", async () => {
    const worth = vi.spyOn(ordersService, "worth").mockResolvedValue({ data: { total: 100 } } as never);

    renderHook(() => useOrderWorth(JSON.stringify({ channel: "phone", items: [] }), true), { wrapper });
    await aMoment();
    expect(worth).not.toHaveBeenCalled();

    renderHook(() => useOrderWorth(JSON.stringify({ channel: "phone", items: [{ product_id: "p", quantity: 1 }] }), true), { wrapper });
    await aMoment();
    expect(worth).toHaveBeenCalledTimes(1);
  });
});
