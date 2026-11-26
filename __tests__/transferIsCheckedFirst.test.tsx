import React from "react";
import { Text } from "react-native";
import ReactTestRenderer, { act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@cartze/core/theme/ThemeProvider";

/**
 * A TRANSFER IS CHECKED FIRST.
 *
 * A customer may pay by transfer to the shop's own account and type the
 * reference. The server refuses to accept such an order until the shop says
 * the money arrived — so the card says "check your account", and the
 * order's one big button is "Payment received", not Accept.
 */
const mockReceived = jest.fn();
jest.mock("../src/modules/orders/services/ordersService", () => ({
  ...jest.requireActual("../src/modules/orders/services/ordersService"),
  ordersService: { paymentReceived: (...a: unknown[]) => mockReceived(...a) },
}));

import { awaitsTransfer, usePaymentReceived } from "../src/modules/orders/hooks/useOrders";
import { OrderCard } from "../src/modules/orders/components/OrderCard";

const order = (over: Record<string, unknown> = {}) => ({
  id: "o1", order_number: "ORD-000050", status: "pending", fulfillment_type: "delivery",
  payment_method: "transfer", payment_status: "unpaid", payment_reference: "TX998877", payment_verified_at: null,
  customer_name: "Ayesha", customer_phone: null, delivery_address: "Gulberg", subtotal: 900, delivery_fee: 120, total: 1020,
  notes: null, cancel_reason: null, placed_at: new Date().toISOString(), items: [], rider_id: null,
  ...over,
}) as never;

test("only an unchecked transfer that is still waiting needs checking", () => {
  expect(awaitsTransfer(order())).toBe(true);
  expect(awaitsTransfer(order({ payment_verified_at: "2026-11-26T10:00:00Z" }))).toBe(false);
  expect(awaitsTransfer(order({ payment_method: "cod" }))).toBe(false);
  expect(awaitsTransfer(order({ status: "cancelled" }))).toBe(false);
});

test("the card names the reference to look for", async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider><OrderCard order={order()} onPress={() => {}} /></ThemeProvider>);
  });
  const said = tree.root.findAllByType(Text).map((t) => [].concat(t.props.children as never).join("")).join(" | ");
  expect(said).toContain("check your account for ref TX998877");
});

test("Payment received re-reads the order even when the server refuses", async () => {
  mockReceived.mockImplementation(() => Promise.reject(Object.assign(new Error("This order is closed."), { status: 409 })));
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = jest.spyOn(qc, "invalidateQueries");
  let hook!: ReturnType<typeof usePaymentReceived>;
  const Probe = () => { hook = usePaymentReceived(); return null; };
  await act(async () => { ReactTestRenderer.create(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>); });
  await act(async () => { await hook.mutateAsync("o1").catch(() => undefined); });
  const keys = spy.mock.calls.map(([f]) => JSON.stringify((f as { queryKey: unknown }).queryKey));
  expect(keys).toEqual(expect.arrayContaining(['["orders"]', '["order","o1"]']));
});
