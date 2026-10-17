import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { OrderLinesTable } from "./OrderLinesTable";
import { SupplierItemsTable } from "./SupplierItemsTable";
import { fromReorderItem, type DraftLine } from "../orderDraft";
import type { SupplierItem } from "../types";

/**
 * THE NEW ORDER, AS THE USER ASKED FOR IT (2026-10-17): the supplier's own
 * items listed to tick — some, a page, or all of them — and every box on the
 * order named, with one quantity for every line or one per line.
 */

const item = (name: string, over: Partial<SupplierItem> = {}): SupplierItem => ({
  key: `p-${name}:`, product_id: `p-${name}`, variant_id: null, name, sku: null, units: [],
  track_inventory: true, in_stock: 4, low_stock_threshold: null, times_ordered: 2,
  last: { po_number: "PO-000007", ordered_on: "2026-10-08", quantity: 20, product_unit_id: null, unit_name: null, unit_cost: 110 },
  ...over,
});

const page = [item("Rice"), item("Sugar")];
const everything = [...page, item("Ghee")];
const supplierItems = vi.fn();

const loaded = {
  data: { data: page, meta: { pagination: { current_page: 1, last_page: 2, per_page: 2, total: 3 } } },
  isPending: false, isError: false, isFetching: false, error: null, refetch: vi.fn(),
};
let itemsAnswer: Record<string, unknown> = loaded;
vi.mock("../hooks/usePurchases", () => ({ useSupplierItems: () => itemsAnswer }));
vi.mock("../services/purchasesService", () => ({ purchasesService: { supplierItems: (...a: unknown[]) => supplierItems(...a) } }));
vi.mock("../../shop/hooks/useShop", async (original) => ({
  ...(await original<typeof import("../../shop/hooks/useShop")>()),
  useMoney: () => (n: number | string) => `Rs ${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
}));
vi.mock("../../../common/hooks/useDebouncedValue", () => ({ useDebouncedValue: <T,>(v: T) => v }));

beforeEach(() => {
  supplierItems.mockReset();
  itemsAnswer = loaded;
});

describe("the supplier's own items", () => {
  const show = (onOrder = new Set<string>()) => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(<SupplierItemsTable supplier={{ id: "s1", name: "Faisalabad Mills" }} onOrder={onOrder} onAdd={onAdd} onRemove={onRemove} />);
    return { onAdd, onRemove };
  };

  it("lists them with last time, and a tick orders one at last time's quantity and cost", () => {
    const { onAdd } = show();

    expect(screen.getAllByTestId("supplier-item")).toHaveLength(2);
    expect(screen.getAllByTestId("supplier-item")[0]).toHaveTextContent("20 at Rs 110");
    fireEvent.click(screen.getByRole("checkbox", { name: "Order Rice" }));

    expect(onAdd).toHaveBeenCalledWith([expect.objectContaining({ key: "p-Rice:", quantity: 20, unit_cost: 110 })]);
  });

  it("ticks a whole page, and untick takes an item off", () => {
    const { onAdd, onRemove } = show(new Set(["p-Rice:"]));

    fireEvent.click(screen.getByRole("checkbox", { name: "Order Rice" }));
    expect(onRemove).toHaveBeenCalledWith("p-Rice:");

    fireEvent.click(screen.getByRole("checkbox", { name: "Tick every item on this page" }));
    expect(onAdd).toHaveBeenCalledWith([expect.objectContaining({ key: "p-Rice:" }), expect.objectContaining({ key: "p-Sugar:" })]);
  });

  it("a list that could not be read says so — it is not \"nothing ordered from them yet\"", () => {
    itemsAnswer = { data: undefined, isPending: false, isError: true, isFetching: false, error: new Error("Network down"), refetch: vi.fn() };
    show();

    expect(screen.queryByText(/Nothing has been ordered/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("adds every one of them, not just the page showing", async () => {
    supplierItems.mockResolvedValue({ data: everything });
    const { onAdd } = show();

    fireEvent.click(screen.getByRole("button", { name: "Add all 3" }));

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(supplierItems).toHaveBeenCalledWith("s1", expect.objectContaining({ page: 1, per_page: 500 }));
    expect(onAdd.mock.calls[0][0].map((l: DraftLine) => l.key)).toEqual(["p-Rice:", "p-Sugar:", "p-Ghee:"]);
  });
});

describe("the order's own table", () => {
  const lines: DraftLine[] = [
    { ...fromReorderItem({ id: "rice", name: "Rice", cost: 110 }), quantity: 20 },
    { ...fromReorderItem({ id: "sugar", name: "Sugar", cost: 50 }), quantity: 5 },
  ];

  it("names every column and every box, and adds each line up", () => {
    render(<OrderLinesTable lines={lines} onChange={() => {}} />);

    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(expect.arrayContaining(["Item", "Unit", "Quantity", "Cost each", "Amount"]));
    expect(screen.getByRole("spinbutton", { name: "Quantity of Rice" })).toHaveValue(20);
    expect(screen.getByRole("spinbutton", { name: "Cost each for Rice" })).toHaveValue(110);
    expect(within(screen.getAllByTestId("order-line")[0]).getByText("Rs 2,200")).toBeInTheDocument();
    expect(screen.getByTestId("order-total")).toHaveTextContent("Rs 2,450");
  });

  it("gives every line one quantity, and each line its own", () => {
    const onChange = vi.fn();
    render(<OrderLinesTable lines={lines} onChange={onChange} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity for every line" }), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange.mock.calls[0][0].map((l: DraftLine) => l.quantity)).toEqual([12, 12]);

    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity of Sugar" }), { target: { value: "7" } });
    expect(onChange.mock.calls[1][0].map((l: DraftLine) => l.quantity)).toEqual([20, 7]);
  });

  // The walk on a phone (2026-10-17): the table scrolled sideways and the
  // cost box sat off the screen. A hand gets one card per line instead.
  it("on a phone, each line is a card with every box named on it", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width"), media: query, addEventListener: () => {}, removeEventListener: () => {},
    }));
    try {
      render(<OrderLinesTable lines={[{ ...lines[0], units: [{ id: "ctn", name: "Carton", factor: "12" }] }, lines[1]]} onChange={() => {}} />);

      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      const [rice, sugar] = screen.getAllByTestId("order-line");
      expect(within(rice).getByText("Unit")).toBeInTheDocument();
      expect(within(rice).getByText("Quantity")).toBeInTheDocument();
      expect(within(rice).getByText("Cost each")).toBeInTheDocument();
      expect(within(rice).getByRole("spinbutton", { name: "Cost each for Rice" })).toHaveValue(110);
      expect(within(rice).getByText("Rs 2,200")).toBeInTheDocument();
      // No packs, no unit box to choose from.
      expect(within(sugar).queryByText("Unit")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
