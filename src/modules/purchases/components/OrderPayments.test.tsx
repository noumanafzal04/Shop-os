import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { OrderPayments } from "./OrderPayments";
import type { PurchaseOrder, SupplierPayment } from "../types";

/**
 * A part payment's date, amount and method are on the order (the user,
 * 2026-10-15), and the lines add up to what the order shows as paid.
 */

vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number | string) => `Rs ${Number(n).toLocaleString("en-US")}` }));
vi.mock("../../../common/format/date", () => ({ shopDate: (d: string) => d.slice(0, 10) }));

const order = (over: Partial<PurchaseOrder>): PurchaseOrder => ({
  id: "po1", po_number: "PO-000001", supplier_id: "s1", status: "received", order_date: "2026-10-10",
  total: 3000, received_total: 3000, amount_paid: 0, items: [], ...over,
} as unknown as PurchaseOrder);

const pay = (id: string, amount: number, share: number, method: SupplierPayment["method"], paid_at: string, reference: string | null = null) => ({
  id: `a-${id}`, amount: share, payment: { id, amount, method, reference, paid_at, notes: null },
});

describe("an order's payments", () => {
  it("says when, how much and how each part was paid, and what is left", () => {
    render(<OrderPayments order={order({ amount_paid: 2500, allocations: [
      pay("p1", 1000, 1000, "cash", "2026-10-11"),
      pay("p2", 3500, 1500, "bank_transfer", "2026-10-14", "IBFT 7781"),
    ] })} />);
    const panel = screen.getByTestId("order-payments");

    expect(within(panel).getByText("Left to pay").nextSibling).toHaveTextContent("Rs 500");
    expect(panel).toHaveTextContent("2026-10-11 · Cash");
    expect(panel).toHaveTextContent("2026-10-14 · Bank transfer · IBFT 7781 · part of a Rs 3,500 payment");
    expect(panel).toHaveTextContent("Rs 1,500");
    expect(panel).not.toHaveTextContent("before payments were itemised");
  });

  it("says what was paid before payments said which orders they paid", () => {
    render(<OrderPayments order={order({ amount_paid: 3000, allocations: [pay("p1", 1000, 1000, "cash", "2026-10-11")] })} />);

    expect(screen.getByTestId("order-payments")).toHaveTextContent("Paid on account earlier (before payments were itemised)Rs 2,000");
  });

  it("lists a payment that named this order before payments said what they paid — once", () => {
    render(<OrderPayments order={order({
      amount_paid: 2500,
      payments: [
        { id: "old", supplier_id: "s1", purchase_order_id: "po1", amount: 1500, method: "cheque", reference: "CHQ 41", paid_at: "2026-10-09", notes: null },
        { id: "p1", supplier_id: "s1", purchase_order_id: "po1", amount: 1000, method: "cash", reference: null, paid_at: "2026-10-11", notes: null },
      ],
      allocations: [pay("p1", 1000, 1000, "cash", "2026-10-11")],
    })} />);
    const panel = screen.getByTestId("order-payments");

    expect(panel).toHaveTextContent("2026-10-09 · Cheque · CHQ 41Rs 1,500");
    expect(panel.querySelectorAll("li")).toHaveLength(2);
    expect(panel).not.toHaveTextContent("before payments were itemised");
  });

  it("owes nothing for what has not arrived", () => {
    render(<OrderPayments order={order({ status: "ordered", received_total: 0, allocations: [] })} />);

    expect(screen.getByTestId("order-payments")).toHaveTextContent("Nothing has arrived yet, so nothing is owed.");
    expect(within(screen.getByTestId("order-payments")).getByText("Left to pay").nextSibling).toHaveTextContent("Rs 0");
  });
});
