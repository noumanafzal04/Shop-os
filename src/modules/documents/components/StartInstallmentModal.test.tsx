import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import StartInstallmentModal from "./StartInstallmentModal";

/**
 * The terms of goods on installments, with the sum shown before the press
 * (F1): "16,000 now + 10 × 5,000 = 66,000", worked out the server's way.
 */

const start = vi.fn();
let shiftWhy: string | null = null;

vi.mock("../hooks/useInstallments", () => ({ useInstallmentMutations: () => ({ start: { mutate: start, isPending: false } }) }));
vi.mock("../../pos/hooks/useCounterShift", () => ({ useCounterShift: () => ({ ready: shiftWhy === null, why: shiftWhy }) }));
vi.mock("../../customers/components/CustomerSuggestions", () => ({ CustomerSuggestions: () => null }));
vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number | string) => `Rs ${Number(n).toLocaleString("en-US")}` }));
vi.mock("../../../common/shopDay", () => ({ shopWallToday: () => "2026-10-16" }));
vi.mock("../../../common/format/date", () => ({ shopDate: (d: string) => d }));
vi.mock("../../../components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("../../../components/form/DateField", () => ({
  default: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => <input id={id} aria-label="First installment due" value={value} onChange={(e) => onChange(e.target.value)} />,
}));

const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

function sheet() {
  render(<MemoryRouter><StartInstallmentModal isOpen onClose={() => {}} lines={[{ product_id: "fridge", quantity: 1 }]} about={60000} onDone={() => {}} /></MemoryRouter>);
}

beforeEach(() => { start.mockReset(); shiftWhy = null; });

describe("selling on installments", () => {
  it("shows the sum before the press — the advance, the months and the bill", () => {
    sheet();
    type("Phone *", "03000124123");
    type("Installment charge %", "10");
    type("Months *", "10");
    type("Advance now", "16000");

    const preview = screen.getByTestId("installment-preview");
    expect(preview).toHaveTextContent("Installment charge (10%)Rs 6,000");
    expect(preview).toHaveTextContent("BillRs 66,000");
    expect(preview).toHaveTextContent("Rs 16,000 now + 10 × Rs 5,000 = Rs 66,000");
    expect(preview).toHaveTextContent("First on 2026-11-16");
  });

  it("names the last month when it differs", () => {
    sheet();
    type("Phone *", "03000124123");
    type("Months *", "3");
    type("Advance now", "50000");

    expect(screen.getByTestId("installment-preview")).toHaveTextContent("Rs 50,000 now + 2 × Rs 3,334 + Rs 3,332 = Rs 60,000");
  });

  it("will not start without a phone, or with an advance that is the whole price", () => {
    sheet();
    const button = () => screen.getByRole("button", { name: "Hand over & start plan" });
    expect(button()).toBeDisabled();
    type("Phone *", "03000124123");
    expect(button()).toBeEnabled();
    type("Advance now", "60000");
    expect(button()).toBeDisabled();
    expect(screen.getByText(/ring it as a sale instead/)).toBeInTheDocument();
  });

  it("holds the plan for want of today's shift whatever the advance is paid by — the goods leave on a counter sale", () => {
    shiftWhy = "Open a shift to send goods home — this shop requires one.";
    sheet();
    type("Phone *", "03000124123");
    type("Advance now", "16000");
    fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: "card" } });
    expect(screen.getByRole("button", { name: "Hand over & start plan" }), "a card advance was let through with no shift; the server refuses it").toBeDisabled();
    expect(screen.getByText(/Open a shift to send goods home/)).toBeInTheDocument();
  });

  it("sends the terms", () => {
    sheet();
    type("Phone *", "03000124123");
    type("Advance now", "16000");
    fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: "card" } });
    fireEvent.click(screen.getByRole("button", { name: "Hand over & start plan" }));
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      customer_phone: "03000124123", months: 6, first_due_on: "2026-11-16",
      advance: { amount: 16000, method: "card", reference: undefined },
      items: [{ product_id: "fridge", quantity: 1 }],
    }), expect.anything());
  });
});
