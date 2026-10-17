import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import StartInstallmentModal from "./StartInstallmentModal";
import { ApiError } from "../../../common/types/api";
import type { PlanWorthInput } from "../services/installmentService";

/**
 * The terms of goods on installments, with the sum shown before the press
 * (F1): "16,000 now + 10 × 5,000 = 66,000" — and it is the SERVER's sum.
 *
 * Money pass 2026-10-16 ($8): the sheet worked the plan out from the shelf
 * prices before tax and read out a bill Rs 691.75 short of the plan the
 * server wrote. Here the server is a fake that prices the fridge WITH its
 * 17 % tax — 70,200, not the 60,000 on the shelf — so a sheet that does its
 * own arithmetic shows figures these tests never accept.
 */

const start = vi.fn();
const refetch = vi.fn();
let shiftWhy: string | null = null;
let asking = false;

/** What the server answers for these terms: the fridge is 60,000 + 17 % tax. */
function server(ask: PlanWorthInput) {
  const cash = 70200;
  const advance = ask.advance?.amount ?? 0;
  if (advance >= cash) {
    return { error: new ApiError("The advance covers the whole price — there is nothing left to pay in installments. Ring it as a sale.", 422, "NOTHING_TO_FINANCE") };
  }
  const pct = ask.markup_percent ?? 0;
  const markup = Math.round((cash * pct) / 100);
  const total = cash + markup;
  // The server's schedule: the month rounded up to a rupee, the last takes the rest.
  const monthly = Math.ceil((total - advance) / ask.months);
  const last = total - advance - monthly * (ask.months - 1);

  return { data: { cash_price: cash, markup_percent: pct, markup, total, advance, financed: total - advance, months: ask.months, monthly, last_month: last } };
}

vi.mock("../hooks/useInstallments", () => ({
  useInstallmentMutations: () => ({ start: { mutate: start, isPending: false } }),
  useInstallmentWorth: (ask: PlanWorthInput) => {
    const answer = server(ask);

    return asking
      ? { data: undefined, isFetching: true, isError: false, error: null, refetch }
      : { data: answer.data, isFetching: false, isError: !!answer.error, error: answer.error ?? null, refetch };
  },
}));
vi.mock("../../../common/hooks/useDebouncedValue", () => ({ useDebouncedValue: <T,>(v: T) => v }));
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
const button = () => screen.getByRole("button", { name: "Hand over & start plan" });

function sheet() {
  render(<MemoryRouter><StartInstallmentModal isOpen onClose={() => {}} lines={[{ product_id: "fridge", quantity: 1 }]} onDone={() => {}} /></MemoryRouter>);
}

beforeEach(() => { start.mockReset(); shiftWhy = null; asking = false; });

describe("selling on installments", () => {
  it("reads out the plan the server will write — the cash price with its tax, the charge on it, the months", () => {
    sheet();
    type("Phone *", "03000124123");
    type("Installment charge %", "10");
    type("Months *", "10");
    type("Advance now", "16000");

    const preview = screen.getByTestId("installment-preview");
    expect(preview).toHaveTextContent("Cash priceRs 70,200");
    expect(preview).toHaveTextContent("Installment charge (10%)Rs 7,020");
    expect(preview).toHaveTextContent("BillRs 77,220");
    // 61,220 over 10 months: 6,122 each.
    expect(preview).toHaveTextContent("Rs 16,000 now + 10 × Rs 6,122 = Rs 77,220");
    expect(preview, "the sheet worked the bill out from the shelf price").not.toHaveTextContent("66,000");
    expect(preview).toHaveTextContent("First on 2026-11-16");
  });

  it("names the last month when it differs", () => {
    sheet();
    type("Phone *", "03000124123");
    type("Months *", "3");
    type("Advance now", "50000");

    // 20,200 over 3: 6,734 + 6,734 + 6,732.
    expect(screen.getByTestId("installment-preview")).toHaveTextContent("Rs 50,000 now + 2 × Rs 6,734 + Rs 6,732 = Rs 70,200");
  });

  it("shows no figure, and cannot be pressed, while the plan is being worked out", () => {
    asking = true;
    sheet();
    type("Phone *", "03000124123");

    expect(screen.getByTestId("installment-preview")).toHaveTextContent("Working out the plan…");
    expect(button()).toBeDisabled();
  });

  it("will not start without a phone, or with an advance that is the whole price — in the server's words", () => {
    sheet();
    expect(button()).toBeDisabled();
    type("Phone *", "03000124123");
    expect(button()).toBeEnabled();
    type("Advance now", "70200");
    expect(button()).toBeDisabled();
    expect(screen.getAllByText(/Ring it as a sale/).length).toBeGreaterThan(0);
  });

  it("holds the plan for want of today's shift whatever the advance is paid by — the goods leave on a counter sale", () => {
    shiftWhy = "Open a shift to send goods home — this shop requires one.";
    sheet();
    type("Phone *", "03000124123");
    type("Advance now", "16000");
    fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: "card" } });
    expect(button(), "a card advance was let through with no shift; the server refuses it").toBeDisabled();
    expect(screen.getByText(/Open a shift to send goods home/)).toBeInTheDocument();
  });

  it("sends the terms, and the bill it read out", () => {
    sheet();
    type("Phone *", "03000124123");
    type("Advance now", "16000");
    fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: "card" } });
    fireEvent.click(button());
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      customer_phone: "03000124123", months: 6, first_due_on: "2026-11-16",
      advance: { amount: 16000, method: "card", reference: undefined },
      items: [{ product_id: "fridge", quantity: 1 }],
      expected_total: 70200,
    }), expect.anything());
  });
});
