import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OwnerOrder } from "../services/ordersService";
import { OrderBoard } from "./OrderBoard";

/**
 * A TRANSFER IS CHECKED FIRST. The server refuses to accept a transfer order
 * the shop has not confirmed, so the card's one button must be "Payment
 * received" — a card offering "Confirm" would only ever be refused.
 */
const order = (over: Partial<OwnerOrder> = {}): OwnerOrder => ({
  id: "o1", order_number: "ORD-000050", status: "pending", fulfillment_type: "delivery", channel: "online",
  payment_method: "transfer", payment_status: "unpaid", payment_reference: "TX998877", payment_verified_at: null,
  customer_name: "Ayesha", placed_at: new Date().toISOString(), subtotal: "900.00", total: "1020.00", items: [],
  ...over,
} as unknown as OwnerOrder);

const board = (o: OwnerOrder, onAdvance = vi.fn(), onPaymentReceived = vi.fn()) => {
  render(<OrderBoard orders={[o]} money={(n) => `Rs ${n}`} busy={false} onOpen={() => {}} onAdvance={onAdvance} onPaymentReceived={onPaymentReceived} />);
  return { onAdvance, onPaymentReceived };
};

describe("a transfer order on the board", () => {
  it("asks for the payment first and names the reference", () => {
    const { onAdvance, onPaymentReceived } = board(order());
    expect(screen.getByText("TX998877")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Payment received" }));
    expect(onPaymentReceived).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("once received, is accepted like any other", () => {
    board(order({ payment_verified_at: "2026-11-26T10:00:00Z", payment_status: "paid" }));
    expect(screen.queryByRole("button", { name: "Payment received" })).toBeNull();
    expect(screen.getByText("Transfer received")).toBeTruthy();
  });

  it("a cash order never shows it", () => {
    board(order({ payment_method: "cod", payment_reference: null }));
    expect(screen.queryByRole("button", { name: "Payment received" })).toBeNull();
  });
});
