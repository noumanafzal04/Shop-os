import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ParkAsDocumentModal from "./ParkAsDocumentModal";

/**
 * GOODS HELD ON ADVANCE — the floor on the sheet is the floor the server takes.
 *
 * Money pass 2026-10-16 ($7): Rice ×2, goods 5,999.98 + tax 1,020.00 = 7,019.98.
 * The sheet took 20 % of the shelf figure before tax — "at least Rs 1,200" —
 * and enabled "Hold the goods" at 1,200; the server refused it for the
 * Rs 1,404 it takes. The figures here come from a fake server that prices WITH
 * the tax, so a sheet doing its own arithmetic fails them.
 */

const create = vi.fn();
let asking = false;
const asked: unknown[] = [];

vi.mock("../hooks/useDocuments", () => ({
  useDocumentMutations: () => ({ create: { mutate: create, isPending: false } }),
  useDocumentWorth: (ask: unknown) => {
    asked.push(ask);

    return asking
      ? { data: undefined, isFetching: true, isError: false, error: null }
      : {
        data: { subtotal: 5999.98, discount: 0, tax: 1020, tax_inclusive: false, total: 7019.98, min_deposit_percent: 20, minimum_deposit: 1404 },
        isFetching: false, isError: false, error: null,
      };
  },
}));
vi.mock("../../../common/hooks/useDebouncedValue", () => ({ useDebouncedValue: <T,>(v: T) => v }));
vi.mock("../../shop/hooks/useShop", async (original) => ({
  ...(await original<typeof import("../../shop/hooks/useShop")>()),
  useMoney: () => (n: number | string) => `Rs ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
  // The shop's setting says 20 % — the sheet must not work the floor out from it.
  useShopSettings: () => ({ data: { layaway_enabled: true, quotations_enabled: true, layaway_min_deposit_percent: 20 } }),
}));
vi.mock("../../pos/hooks/useCounterShift", () => ({ useCashNeedsShift: () => null }));
vi.mock("../../customers/components/CustomerSuggestions", () => ({ CustomerSuggestions: () => null }));
vi.mock("../../../components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const hold = () => screen.getByRole("button", { name: "Hold the goods" });
const advance = (v: string) => fireEvent.change(screen.getByPlaceholderText("1404"), { target: { value: v } });

function sheet() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ParkAsDocumentModal
        isOpen onClose={() => {}} startAs="layaway"
        lines={[{ product_id: "rice", quantity: 2 }]} discount={0}
        customerName="Sana" customerPhone="03001234567" onDone={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => { create.mockReset(); asking = false; asked.length = 0; });

describe("holding goods on advance", () => {
  it("states the server's total and floor, and refuses an advance under it", () => {
    sheet();

    expect(screen.getByTestId("document-worth")).toHaveTextContent("Rs 7,019.98");
    expect(screen.getByTestId("deposit-floor")).toHaveTextContent("At least 20% down — Rs 1,404.");

    advance("1200");
    expect(hold(), "1,200 was let through — the server refuses anything under 1,404").toBeDisabled();
    advance("1404");
    expect(hold()).toBeEnabled();
  });

  it("asks about these lines, this discount and this customer", () => {
    sheet();

    expect(asked[asked.length - 1]).toEqual({ kind: "layaway", items: [{ product_id: "rice", quantity: 2 }], discount: undefined, customer_phone: "03001234567" });
  });

  it("cannot be pressed while the figure is being worked out", () => {
    asking = true;
    sheet();

    expect(screen.getByTestId("document-worth")).toHaveTextContent("Working out the total…");
    expect(hold()).toBeDisabled();
  });
});
