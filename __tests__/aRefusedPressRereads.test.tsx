import React from "react";
import ReactTestRenderer, { act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * A REFUSED PRESS RE-READS — rider and customer.
 *
 *  rider     Accept on a job another rider took first is refused; the board
 *            was re-read only on success, so the dead offer stayed up.
 *  customer  Cancel after the shop accepted is refused; only the list was
 *            re-read, never the order's own screen (["orders","one",id]).
 *
 * Found by the live three-app run.
 */
const mockRider = { accept: jest.fn(), decline: jest.fn(), pickUp: jest.fn(), deliver: jest.fn() };
jest.mock("../src/modules/rider/services/riderService", () => ({ riderService: mockRider }));
const mockPost = jest.fn();
jest.mock("../src/common/api/client", () => ({
  configureAuth: jest.fn(), configureApi: jest.fn(),
  apiGet: jest.fn(() => Promise.resolve({ data: null })),
  apiPost: (...a: unknown[]) => mockPost(...a),
  apiPut: jest.fn(), apiDelete: jest.fn(),
}));

import { useRiderActions } from "../src/modules/rider/hooks/useRider";
import { useCancelMyOrder } from "../src/modules/orders/hooks/useOrders";

const refused = () => Promise.reject(Object.assign(new Error("Someone else took this job."), { status: 409 }));

async function press<T>(useIt: () => T, go: (h: T) => Promise<unknown>) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = jest.spyOn(qc, "invalidateQueries");
  let hook!: T;
  const Probe = () => { hook = useIt(); return null; };
  await act(async () => { ReactTestRenderer.create(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>); });
  await act(async () => { await go(hook).catch(() => undefined); });
  return spy.mock.calls.map(([f]) => JSON.stringify((f as { queryKey: unknown }).queryKey));
}

test.each([
  ["accept", (a: ReturnType<typeof useRiderActions>) => a.accept.mutateAsync("j1")],
  ["decline", (a: ReturnType<typeof useRiderActions>) => a.decline.mutateAsync("j1")],
  ["pickUp", (a: ReturnType<typeof useRiderActions>) => a.pickUp.mutateAsync("j1")],
  ["deliver", (a: ReturnType<typeof useRiderActions>) => a.deliver.mutateAsync({ id: "j1", code: "0000" })],
] as const)("the rider's %s, refused, re-reads the board", async (name, go) => {
  mockRider[name].mockImplementation(refused);
  expect(await press(useRiderActions, go)).toContain('["rider"]');
});

test("the customer's Cancel, refused, re-reads every order key — the order's own screen too", async () => {
  mockPost.mockImplementation(refused);
  // ["orders"] covers ["orders","one",id]; ["orders","mine"] did not.
  expect(await press(useCancelMyOrder, (m) => m.mutateAsync("o1"))).toContain('["orders"]');
});
