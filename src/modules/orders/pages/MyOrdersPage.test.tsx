import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../../components/ui/toast";
import { ConfirmProvider } from "../../../components/ui/confirm";
import { ordersService, type CustomerOrder } from "../services/ordersService";

vi.mock("../../../components/common/PageMeta", () => ({ default: () => null }));
vi.mock("../../marketplace/components/MarketHeader", () => ({ MarketHeader: () => null }));
vi.mock("../../marketplace/components/MyReservations", () => ({ MyReservations: () => null }));

import MyOrdersPage from "./MyOrdersPage";

/**
 * MY ORDERS ON THE WEB — the customer's half of the new rules.
 *
 *  - Cancel is offered only while the shop has not answered (the server
 *    refuses it after; offering it was offering a refusal)
 *  - a transfer says whether the shop has seen the money
 *  - "Problem with this order?" sends nothing until it knows what happened,
 *    and the answer reads on the order
 */
const base = {
  shop: { slug: "lk", business_name: "Lahori Karahi" }, fulfillment_type: "delivery", payment_status: "unpaid",
  delivery_address: "Gulberg", subtotal: "900.00", delivery_fee: "120.00", total: "1020.00", items: [], placed_at: "2026-11-26T08:00:00Z",
};
const ORDERS = [
  { ...base, id: "o1", order_number: "ORD-000001", status: "confirmed", payment_method: "cod", can_report_issue: false },
  { ...base, id: "o2", order_number: "ORD-000002", status: "pending", payment_method: "transfer", payment_reference: "TX55", payment_received: false, can_report_issue: false },
  { ...base, id: "o3", order_number: "ORD-000003", status: "completed", payment_method: "cod", can_report_issue: true },
  { ...base, id: "o4", order_number: "ORD-000004", status: "completed", payment_method: "cod", can_report_issue: false,
    issue: { id: "i1", kind: "missing_item", kind_label: "Something was missing", note: null, status: "resolved", outcome: "voucher", amount: "200.00", voucher_code: "SORRY-AB12CD", answer: "Have the next one on us." } },
] as unknown as CustomerOrder[];

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(ordersService, "myOrders").mockResolvedValue({ success: true, message: "OK", data: ORDERS, errors: {}, meta: {} } as never);
});
afterEach(() => { client.clear(); vi.restoreAllMocks(); });

const mount = () =>
  render(
    <QueryClientProvider client={client}>
      <ToastProvider><ConfirmProvider><MemoryRouter><MyOrdersPage /></MemoryRouter></ConfirmProvider></ToastProvider>
    </QueryClientProvider>,
  );

describe("my orders", () => {
  it("offers Cancel only before the shop has answered", async () => {
    mount();
    await screen.findByText("ORD-000001");
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1); // the pending one only
  });

  it("says whether the shop has seen a transfer", async () => {
    mount();
    expect(await screen.findByText(/Waiting for the shop to check your transfer \(ref TX55\)/)).toBeTruthy();
  });

  it("reports a problem once it knows what happened, and reads the answer", async () => {
    const report = vi.spyOn(ordersService, "reportIssue").mockResolvedValue({ success: true, message: "OK", data: {}, errors: {}, meta: {} } as never);
    mount();
    expect(await screen.findByText("Voucher SORRY-AB12CD · Rs 200")).toBeTruthy();
    expect(screen.getByText("Have the next one on us.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Problem with this order?" }));
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What happened"), { target: { value: "other" } });
    expect(send.disabled).toBe(true); // "something else" needs words
    fireEvent.change(screen.getByLabelText("Tell us more"), { target: { value: "Cold food" } });
    fireEvent.click(send);
    await waitFor(() => expect(report).toHaveBeenCalledWith("o3", { kind: "other", note: "Cold food" }));
  });
});
