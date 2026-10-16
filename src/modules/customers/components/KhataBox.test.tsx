import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import KhataBox from "./KhataBox";
import type { Customer } from "../services/customersService";

/**
 * Ali Raza owed 4,227.30 and paid 4,250 by transfer; the screen could not
 * record it (L13). The box now asks first, and says an advance as an advance.
 */

vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number | string) => `Rs ${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}` }));
vi.mock("../../../common/format/date", () => ({ shopDate: (d: string) => d.slice(0, 10) }));

const ali = (over: Partial<Customer> = {}): Customer => ({
  id: "c1", name: "Ali Raza", phone: "030001241234", email: null, address: null, notes: null, last_seen_at: null,
  credit_balance: "4227.30", credit_limit: "10000",
  ledger: [{ id: "l1", type: "charge", amount: "4227.30", balance_after: "4227.30", method: null, reference: null, note: null, created_at: "2026-10-15T10:00:00Z", sale: { id: "s1", invoice_number: "INV-000005" } }],
  ...over,
});

function box(customer: Customer) {
  const onPay = vi.fn();
  render(<MemoryRouter><KhataBox customer={customer} pending={false} onPay={onPay} /></MemoryRouter>);

  return onPay;
}

const typeAmount = (v: string) => fireEvent.change(screen.getByRole("spinbutton", { name: "Payment amount" }), { target: { value: v } });

describe("a khata payment", () => {
  it("asks before taking more than is owed, and keeps the extra only when told", () => {
    const onPay = box(ali());
    typeAmount("4250");
    fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: "bank_transfer" } });
    fireEvent.click(screen.getByRole("button", { name: "Take payment" }));

    expect(onPay, "an overpayment was sent without asking").not.toHaveBeenCalled();
    expect(screen.getByTestId("khata-overpay")).toHaveTextContent("Ali Raza owes Rs 4,227.3. You entered Rs 4,250 — Rs 22.7 more.");

    fireEvent.click(screen.getByRole("button", { name: "Keep Rs 22.7 as advance" }));
    expect(onPay).toHaveBeenCalledWith({ amount: 4250, method: "bank_transfer", allow_advance: true }, expect.any(Function));
  });

  it("can take only what is owed instead", () => {
    const onPay = box(ali());
    typeAmount("4250");
    fireEvent.click(screen.getByRole("button", { name: "Take payment" }));
    fireEvent.click(screen.getByRole("button", { name: "Take Rs 4,227.3 only" }));

    expect(onPay).toHaveBeenCalledWith({ amount: 4227.3, method: "cash" }, expect.any(Function));
  });

  it("sends a payment that fits straight away", () => {
    const onPay = box(ali());
    typeAmount("1000");
    fireEvent.click(screen.getByRole("button", { name: "Take payment" }));

    expect(screen.queryByTestId("khata-overpay")).toBeNull();
    expect(onPay).toHaveBeenCalledWith({ amount: 1000, method: "cash" }, expect.any(Function));
  });

  it("says an advance as an advance, never as a negative amount owed", () => {
    box(ali({ credit_balance: "-22.70", ledger: [] }));

    expect(screen.getByTestId("khata-standing")).toHaveTextContent("Advance Rs 22.7");
    expect(screen.getByTestId("khata-standing")).not.toHaveTextContent("−");
    expect(screen.getByTestId("khata-standing")).not.toHaveTextContent("-");
  });

  it("names the bill a credit sale was, and opens it", () => {
    box(ali());

    const link = screen.getByRole("link", { name: "INV-000005" });
    expect(link).toHaveAttribute("href", "/tenant/sales?q=INV-000005&open=s1");
    expect(screen.getByTestId("khata-statement")).toHaveTextContent("2026-10-15 · Credit sale · INV-000005");
  });

  it("asks whether money from a customer on installments is an installment — and puts it on the plan when it is", () => {
    const onPay = vi.fn();
    const onInstallment = vi.fn();
    const plans = [{ id: "p1", number: "INS-000001", left: 45000, due_now: 5000 }];
    render(<MemoryRouter><KhataBox customer={ali({ credit_balance: "45000" })} pending={false} onPay={onPay} plans={plans} onInstallment={onInstallment} /></MemoryRouter>);

    typeAmount("5000");
    fireEvent.click(screen.getByRole("button", { name: "Take payment" }));
    expect(onPay, "money from an installment customer went on the khata without asking").not.toHaveBeenCalled();
    expect(screen.getByTestId("khata-installment")).toHaveTextContent("Ali Raza is paying for goods on installments. Is this Rs 5,000 an installment?");
    expect(screen.getByTestId("khata-installment")).toHaveTextContent("INS-000001: Rs 5,000 to bring up to date · Rs 45,000 left");

    fireEvent.click(screen.getByRole("button", { name: "Yes — on INS-000001" }));
    expect(onInstallment).toHaveBeenCalledWith("p1", { amount: 5000, method: "cash" }, expect.any(Function));
    expect(onPay).not.toHaveBeenCalled();
  });

  it("still takes it on the khata when told it is not an installment, and will not put more on a plan than is left", () => {
    const onPay = vi.fn();
    const onInstallment = vi.fn();
    const plans = [{ id: "p1", number: "INS-000001", left: 3000, due_now: 3000 }];
    render(<MemoryRouter><KhataBox customer={ali({ credit_balance: "8000" })} pending={false} onPay={onPay} plans={plans} onInstallment={onInstallment} /></MemoryRouter>);

    typeAmount("4000");
    fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: "card" } });
    fireEvent.click(screen.getByRole("button", { name: "Take payment" }));
    expect(screen.getByRole("button", { name: "INS-000001: only Rs 3,000 left" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "No — on the khata" }));
    expect(onPay).toHaveBeenCalledWith({ amount: 4000, method: "card" }, expect.any(Function));
    expect(onInstallment).not.toHaveBeenCalled();
  });

  it("asks nothing about installments of a customer with none running", () => {
    const onPay = vi.fn();
    render(<MemoryRouter><KhataBox customer={ali()} pending={false} onPay={onPay} plans={[]} onInstallment={vi.fn()} /></MemoryRouter>);

    typeAmount("1000");
    fireEvent.click(screen.getByRole("button", { name: "Take payment" }));
    expect(screen.queryByTestId("khata-installment")).toBeNull();
    expect(onPay).toHaveBeenCalledWith({ amount: 1000, method: "cash" }, expect.any(Function));
  });
});
