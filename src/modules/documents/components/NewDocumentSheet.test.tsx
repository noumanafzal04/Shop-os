import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * A DISTRIBUTOR QUOTES FIFTEEN CARTONS (wholesale #W4).
 *
 * The sheet offered only − 1 +, and never the pack the document carries.
 */
const oil = {
  id: "oil", name: "Cooking Oil 1L", type: "product", price: 545, discount_price: null,
  track_inventory: false, variants: [],
  units: [{ id: "c24", name: "Carton 24", factor: 24, price: 12600 }],
};
vi.mock("../../catalog/hooks/useCatalog", () => ({
  useProducts: () => ({ data: { data: [oil] }, isFetching: false, error: null }),
}));
vi.mock("../../../common/hooks/useDebouncedValue", () => ({ useDebouncedValue: (v: string) => v }));
vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number) => `M${n}` }));
const parked = vi.fn();
vi.mock("./ParkAsDocumentModal", () => ({
  default: (props: { isOpen: boolean; lines: unknown[] }) => {
    if (props.isOpen) parked(props.lines);
    return null;
  },
}));
vi.mock("./StartInstallmentModal", () => ({ default: () => null }));
vi.mock("../../../components/ui/modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));

import NewDocumentSheet from "./NewDocumentSheet";

describe("a new quotation", () => {
  it("takes a typed quantity in cartons and asks the server for that pack", () => {
    render(<NewDocumentSheet isOpen onClose={() => {}} startAs="quotation" onSaved={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText("Search products…"), { target: { value: "oil" } });
    fireEvent.click(screen.getByRole("button", { name: /Cooking Oil 1L/ }));

    fireEvent.change(screen.getByLabelText("Quantity of Cooking Oil 1L"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Pack for Cooking Oil 1L"), { target: { value: "c24" } });

    // 15 × 12,600 — the carton's own price.
    expect(screen.getAllByText("M189000").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(parked).toHaveBeenLastCalledWith([
      { product_id: "oil", variant_id: null, quantity: 15, product_unit_id: "c24" },
    ]);
  });

  it("will not go on while a quantity box is empty", () => {
    render(<NewDocumentSheet isOpen onClose={() => {}} startAs="quotation" onSaved={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Search products…"), { target: { value: "oil" } });
    fireEvent.click(screen.getByRole("button", { name: /Cooking Oil 1L/ }));

    fireEvent.change(screen.getByLabelText("Quantity of Cooking Oil 1L"), { target: { value: "" } });

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
