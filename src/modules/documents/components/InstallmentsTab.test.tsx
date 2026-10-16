import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import InstallmentsTab from "./InstallmentsTab";
import InstallmentPlanSheet from "./InstallmentPlanSheet";
import type { InstallmentPlan } from "../services/installmentService";

/**
 * Who is late, who is due this week, who is paid off — at a glance (F1), and
 * one plan month by month with the amount to take already in the box.
 */

const plan = (over: Omit<Partial<InstallmentPlan>, "standing"> & { standing?: Partial<InstallmentPlan["standing"]> }): InstallmentPlan => ({
  id: "p1", number: "INS-000001", customer_id: "c1", customer_name: "Ali Raza", customer_phone: "03000124123",
  sale_id: "s1", sale: { id: "s1", invoice_number: "INV-000020" }, items: [{ name: "Fridge", quantity: 1 }],
  cash_price: "60000.00", markup_percent: "10.00", markup: "6000.00", total: "66000.00", advance: "16000.00", financed: "50000.00",
  months: 10, monthly: "5000.00", last_month: "5000.00", first_due_on: "2026-11-16", status: "running", paid: "0.00",
  next_due_on: "2026-11-16", notes: null, created_at: "2026-10-16T08:00:00Z", paid_off_at: null,
  ...over,
  standing: { paid: 0, left: 50000, late: 0, late_months: 0, due_now: 5000, next_due_on: "2026-11-16", months_paid: 0, ...over.standing },
} as InstallmentPlan);

let rows: InstallmentPlan[] = [];
let one: InstallmentPlan | undefined;
const pay = vi.fn();
const asked: Array<{ status?: string }> = [];

vi.mock("../hooks/useInstallments", () => ({
  useInstallmentPlans: (params: { status?: string }) => { asked.push(params); return { data: { rows, pagination: undefined }, isLoading: false }; },
  useInstallmentSummary: () => ({ data: { out: 93000, due_this_month: 5000, late: { total: 10000, plans: 1 }, collected_this_month: 7000, counts: { running: 3, due_soon: 1, this_month: 2, late: 1, paid_off: 1, closed: 0, all: 4 } } }),
  useInstallmentPlan: () => ({ data: one }),
  useInstallmentMutations: () => ({ pay: { mutate: pay, isPending: false } }),
}));
vi.mock("../../pos/hooks/useCounterShift", () => ({ useCashNeedsShift: () => null }));
vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number | string) => `Rs ${Number(n).toLocaleString("en-US")}` }));
vi.mock("../../../common/shopDay", () => ({ shopWallToday: () => "2026-11-12" }));
vi.mock("../../../common/format/date", () => ({ shopDate: (d: string) => d.slice(0, 10) }));
vi.mock("../../../components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

describe("the installments list", () => {
  it("colours each plan by what it needs: late red, due this week amber, paid off green", () => {
    rows = [
      plan({ id: "late", number: "INS-000003", standing: { late: 10000, late_months: 2, due_now: 15000, left: 40000, months_paid: 0, next_due_on: "2026-09-16" } }),
      plan({ id: "soon", number: "INS-000002" }),
      plan({ id: "done", number: "INS-000001", status: "paid_off", next_due_on: null, standing: { left: 0, months_paid: 10, paid: 50000, next_due_on: null, due_now: 0 } }),
      plan({ id: "ahead", number: "INS-000004", standing: { left: 35000, months_paid: 3, paid: 15000, next_due_on: "2027-02-16", due_now: 0 } }),
    ];
    render(<MemoryRouter><InstallmentsTab onOpen={() => {}} /></MemoryRouter>);

    const late = screen.getByText("INS-000003").closest("tr")!;
    expect(late).toHaveAttribute("data-state", "late");
    expect(late).toHaveTextContent("Late 2 months · Rs 10,000");
    const soon = screen.getByText("INS-000002").closest("tr")!;
    expect(soon).toHaveAttribute("data-state", "due_soon");
    expect(soon).toHaveTextContent("2026-11-16 · in 4 days");
    expect(soon).toHaveTextContent("0 of 10");
    const done = screen.getByText("INS-000001").closest("tr")!;
    expect(done).toHaveAttribute("data-state", "paid_off");
    expect(done).toHaveTextContent("Paid off");

    // "To collect" — the column read at the counter: what brings each one up to date.
    const collect = (row: HTMLElement) => row.querySelector("[data-testid=to-collect]")!;
    expect(collect(late)).toHaveTextContent("Rs 15,000");
    expect(collect(late).firstElementChild).toHaveClass("text-error-600");
    expect(collect(soon)).toHaveTextContent("Rs 5,000");
    expect(collect(soon).firstElementChild).toHaveClass("text-warning-600");
    expect(collect(done)).toHaveTextContent("—");
    expect(collect(screen.getByText("INS-000004").closest("tr")!), "a customer who paid ahead was shown a sum to take").toHaveTextContent("Up to date");

    expect(screen.getByTestId("installment-filters")).toHaveTextContent("Running3Late1Due this week1Due this month2Paid off1Closed0All plans4");
  });

  it("opens the plans behind each tile's own figure — Due this month is this month's, not this week's", () => {
    rows = [];
    render(<MemoryRouter><InstallmentsTab onOpen={() => {}} /></MemoryRouter>);

    fireEvent.click(screen.getByText("Due this month", { selector: "div" }).closest("button")!);
    expect(asked[asked.length - 1]?.status).toBe("this_month");
    fireEvent.click(screen.getByText("Late", { selector: "div" }).closest("button")!);
    expect(asked[asked.length - 1]?.status).toBe("late");
    expect(screen.getByText("Still to come this month — late not included")).toBeInTheDocument();
  });
});

describe("one plan", () => {
  it("starts the amount at what brings the customer up to date, and refuses more than is left", () => {
    one = plan({ standing: { late: 10000, late_months: 2, due_now: 15000, left: 50000, rows: [
      { n: 1, due_on: "2026-09-16", amount: 5000, paid: 0, state: "late" },
      { n: 2, due_on: "2026-10-16", amount: 5000, paid: 0, state: "late" },
      { n: 3, due_on: "2026-11-16", amount: 5000, paid: 0, state: "due" },
    ] } });
    render(<MemoryRouter><InstallmentPlanSheet planId="p1" onClose={() => {}} /></MemoryRouter>);

    expect(screen.getByRole("alert")).toHaveTextContent("Late 2 months · Rs 10,000");
    expect(screen.getByRole("spinbutton", { name: "Installment amount" })).toHaveValue(15000);
    expect(screen.getByTestId("installment-months")).toHaveTextContent("Late");
    expect(screen.getByRole("link", { name: "INV-000020" })).toHaveAttribute("href", "/tenant/sales?q=INV-000020&open=s1");
  });

  it("fills the amount in one press, says what is left after it, and sends exactly that", () => {
    pay.mockClear();
    one = plan({ standing: { late: 10000, late_months: 2, due_now: 15000, left: 50000, rows: [] } });
    render(<MemoryRouter><InstallmentPlanSheet planId="p1" onClose={() => {}} /></MemoryRouter>);
    const box = screen.getByRole("spinbutton", { name: "Installment amount" });
    const after = screen.getByTestId("installment-after");

    fireEvent.click(screen.getByRole("button", { name: "One month · Rs 5,000" }));
    expect(box).toHaveValue(5000);
    expect(after).toHaveTextContent("After this, Rs 45,000 is left.");

    fireEvent.click(screen.getByRole("button", { name: "All that is left · Rs 50,000" }));
    expect(after).toHaveTextContent("This pays INS-000001 off.");

    fireEvent.change(box, { target: { value: "60000" } });
    expect(after).toHaveTextContent("Only Rs 50,000 is left on this plan");
    expect(screen.getByRole("button", { name: "Take installment" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Up to date · Rs 15,000" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Paid by" }), { target: { value: "bank_transfer" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Reference" }), { target: { value: "TRX-88" } });
    fireEvent.click(screen.getByRole("button", { name: "Take installment" }));
    expect(pay).toHaveBeenCalledTimes(1);
    expect(pay.mock.calls[0][0]).toMatchObject({ id: "p1", amount: 15000, method: "bank_transfer", reference: "TRX-88" });
    expect(pay.mock.calls[0][0].idempotency_key).toBeTruthy();
  });

  it("says what was paid apart from what came off by the goods coming back", () => {
    one = plan({ collected: 10000, returned: 60000, standing: { paid: 70000, left: 30000, rows: [] } });
    render(<MemoryRouter><InstallmentPlanSheet planId="p1" onClose={() => {}} /></MemoryRouter>);

    expect(screen.getByText("Installments paid").nextElementSibling).toHaveTextContent("Rs 10,000");
    expect(screen.getByText("Goods returned").nextElementSibling).toHaveTextContent("Rs 60,000");
  });
});
