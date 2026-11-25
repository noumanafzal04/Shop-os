import React from "react";
import ReactTestRenderer, { act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * A REFUSED PRESS RE-READS THE ORDER.
 *
 * Accept on an order the customer has just cancelled is refused (409). The
 * partner app re-read the list only on success, so the card kept its Accept
 * button until the next poll. Found by the live three-app run.
 */
const mockAdvance = jest.fn();
const mockCancel = jest.fn();
jest.mock("../src/modules/orders/services/ordersService", () => ({
  ordersService: { advance: (...a: unknown[]) => mockAdvance(...a), cancel: (...a: unknown[]) => mockCancel(...a) },
}));

import { useAdvanceOrder, useCancelOrder } from "../src/modules/orders/hooks/useOrders";

function rereadAfter(press: (qc: QueryClient) => Promise<unknown>) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = jest.spyOn(qc, "invalidateQueries");
  return { qc, spy, run: () => press(qc).catch(() => undefined) };
}
const keys = (spy: jest.SpyInstance) => spy.mock.calls.map(([f]) => JSON.stringify((f as { queryKey: unknown }).queryKey));

async function pressWith<T>(qc: QueryClient, useIt: () => T, go: (h: T) => Promise<unknown>) {
  let hook!: T;
  const Probe = () => { hook = useIt(); return null; };
  await act(async () => { ReactTestRenderer.create(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>); });
  await act(async () => { await go(hook).catch(() => undefined); });
}

const refused = () => Promise.reject(Object.assign(new Error("Cannot move an order from cancelled to confirmed."), { status: 409 }));

test("Accept that the server refuses re-reads the list and the order", async () => {
  mockAdvance.mockImplementation(refused);
  const { qc, spy } = rereadAfter(async () => undefined);
  await pressWith(qc, useAdvanceOrder, (m) => m.mutateAsync({ id: "o1", status: "confirmed" }));
  expect(keys(spy)).toEqual(expect.arrayContaining(['["orders"]', '["order","o1"]']));
});

test("Reject that the server refuses re-reads too", async () => {
  mockCancel.mockImplementation(refused);
  const { qc, spy } = rereadAfter(async () => undefined);
  await pressWith(qc, useCancelOrder, (m) => m.mutateAsync({ id: "o2" }));
  expect(keys(spy)).toEqual(expect.arrayContaining(['["orders"]', '["order","o2"]']));
});
