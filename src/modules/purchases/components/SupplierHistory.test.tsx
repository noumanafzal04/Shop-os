import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { SupplierHistory } from "./SupplierHistory";

/**
 * A supplier's account: each payment says which orders it paid — or, from
 * before payments said so, the order it named, or "On account". Never "paid
 * ahead" for money that settled an order.
 */

vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number | string) => `Rs ${Number(n).toLocaleString("en-US")}` }));
vi.mock("../../../common/format/date", () => ({ shopDate: (d: string) => d.slice(0, 10) }));
vi.mock("../hooks/usePurchases", () => ({
  useSupplier: () => ({
    isLoading: false,
    data: {
      id: "s1", name: "Faisalabad Mills", outstanding: 8000, advance: 0,
      purchase_orders: [{ id: "po2", po_number: "PO-000002", order_date: "2026-10-13", status: "partially_received", received_total: 20500, amount_paid: 16500 }],
      payments: [
        { id: "new", amount: 3000, method: "bank_transfer", reference: "QA-HIST-1", paid_at: "2026-10-15", purchase_order: null,
          allocations: [{ id: "a1", amount: 2000, purchase_order: { id: "po1", po_number: "PO-000001" } }] },
        { id: "named", amount: 1500, method: "cash", reference: null, paid_at: "2026-10-13", purchase_order: { id: "po2", po_number: "PO-000002" }, allocations: [] },
        { id: "account", amount: 900, method: "cash", reference: null, paid_at: "2026-10-12", purchase_order: null, allocations: [] },
      ],
    },
  }),
}));

describe("a supplier's account", () => {
  it("says what each payment paid", () => {
    render(<SupplierHistory supplierId="s1" />);
    const rows = screen.getAllByRole("row").map((r) => r.textContent ?? "");

    expect(rows[1]).toBe("2026-10-15Bank transferQA-HIST-1PO-000001 · Rs 2,000Paid ahead · Rs 1,000Rs 3,000");
    expect(rows[2], "a payment that settled an order was called paid ahead").toBe("2026-10-13CashPO-000002Rs 1,500");
    expect(rows[3]).toBe("2026-10-12CashOn accountRs 900");
    expect(screen.getByTestId("supplier-history")).toHaveTextContent("PO-0000022026-10-13 · partially receivedRs 20,500Rs 16,500Rs 4,000");
  });
});
