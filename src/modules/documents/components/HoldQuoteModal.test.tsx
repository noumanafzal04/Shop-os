import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { HoldQuoteModal } from "./HoldQuoteModal";
import type { SaleDocument } from "../services/documentService";

/**
 * GOODS HELD FROM A QUOTATION (B65) — the quote's own lines at the quote's own
 * price, the server's figure and floor, and the quote named, not re-typed.
 */

const create = vi.fn();
const asked: unknown[] = [];

vi.mock("../hooks/useDocuments", () => ({
  useDocumentMutations: () => ({ create: { mutate: create, isPending: false } }),
  useDocumentWorth: (ask: unknown) => {
    asked.push(ask);
    return {
      data: { subtotal: 16000, discount: 0, tax: 0, tax_inclusive: false, total: 16000, min_deposit_percent: 20, minimum_deposit: 3200 },
      isFetching: false, isError: false, error: null,
    };
  },
}));
vi.mock("../../shop/hooks/useShop", async (original) => ({
  ...(await original<typeof import("../../shop/hooks/useShop")>()),
  useMoney: () => (n: number | string) => `Rs ${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
}));
vi.mock("../../pos/hooks/useCounterShift", () => ({ useCashNeedsShift: () => null }));
vi.mock("../../../components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const quote = (over: Partial<SaleDocument> = {}) => ({
  id: "q1", number: "QUO-000005", kind: "quotation", status: "open",
  customer_name: "Ahmed", customer_phone: "03001234567", total: "16000.00",
  ...over,
}) as SaleDocument;

function sheet(q = quote()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HoldQuoteModal isOpen onClose={() => {}} quote={q} onHeld={() => {}} />
    </QueryClientProvider>,
  );
}

const hold = () => screen.getByRole("button", { name: "Hold the goods" });
const advance = (v: string) => fireEvent.change(screen.getByPlaceholderText("3200"), { target: { value: v } });

beforeEach(() => { create.mockReset(); asked.length = 0; });

describe("holding a quotation's goods on advance", () => {
  it("asks the server about THIS quote, and sends the quote — never its lines", () => {
    sheet();
    expect(asked[asked.length - 1]).toEqual({ kind: "layaway", from_document_id: "q1" });

    advance("3200");
    fireEvent.click(hold());

    const sent = create.mock.calls[0][0];
    expect(sent).toMatchObject({ kind: "layaway", from_document_id: "q1", customer_phone: "03001234567", deposit: { amount: 3200, method: "cash" } });
    // Lines sent beside the quote would be a second price — the server refuses them.
    expect(sent.items).toBeUndefined();
    expect(sent.idempotency_key).toBeTruthy();
  });

  it("states the server's total and floor, and refuses an advance under it", () => {
    sheet();
    expect(screen.getByTestId("hold-worth")).toHaveTextContent("Rs 16,000");
    expect(screen.getByTestId("hold-worth")).toHaveTextContent("QUO-000005");
    expect(screen.getByTestId("hold-floor")).toHaveTextContent("At least 20% down — Rs 3,200.");

    advance("3199");
    expect(hold()).toBeDisabled();
    advance("3200");
    expect(hold()).toBeEnabled();
  });

  it("asks for a phone when the quote named nobody", () => {
    sheet(quote({ customer_name: null, customer_phone: null }));
    advance("3200");
    expect(hold(), "goods held for nobody").toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("03xx-xxxxxxx"), { target: { value: "03111111111" } });
    expect(hold()).toBeEnabled();
  });
});
