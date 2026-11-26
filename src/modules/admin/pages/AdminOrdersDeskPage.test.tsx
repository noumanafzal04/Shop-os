import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../../components/ui/toast";

// The page's <title> needs a Helmet provider; what it says is not this test's question.
vi.mock("../../../components/common/PageMeta", () => ({ default: () => null }));
import { ordersDeskService, type DeliveryRules, type LiveBoard, type OrderIssue } from "../services/ordersDeskService";
import AdminOrdersDeskPage, { LIVE_POLL_MS } from "./AdminOrdersDeskPage";

/**
 * THE ORDERS DESK — asked of the mounted screen.
 *
 *  - the live board sends what the desk typed and picked, and says what is stuck
 *  - a problem cannot be answered with nothing to say
 *  - the delivery rules send an emptied box as "none", not as zero
 */

const RULES: DeliveryRules = {
  default_min_order: 200, below_minimum: "fee", delivery_fee_per_km: null, delivery_fee_base_km: 3,
  service_fee: 0, rush_fee: 0, rush_fee_on: false, accept_within_minutes: 10, rider_cash_limit: 15000,
};
const BOARD: LiveBoard = {
  orders: [{
    id: "o1", order_number: "ORD-000042", status: "pending", fulfillment_type: "delivery", payment_method: "cod", total: "1200.00",
    customer_name: "Ayesha", customer_phone: "03001234567", delivery_address: "Gulberg", placed_at: null, minutes: 7,
    shop: { id: "s1", business_name: "Lahori Karahi", slug: "lk", phone: null }, rider: null, flags: ["shop_slow"],
  }],
  shops: [{ id: "s1", name: "Lahori Karahi" }],
  counts: { open: 1, shop_slow: 1, no_rider: 0, transfer_unchecked: 0, late: 0 },
  as_of: "",
};
const ISSUE: OrderIssue = {
  id: "i1", kind: "missing_item", kind_label: "Something was missing", note: "No raita", status: "open", outcome: null, amount: null,
  voucher_code: null, answer: null, reported_at: null, resolved_at: null,
  order: { id: "o9", order_number: "ORD-000009", customer_name: "Ayesha", customer_phone: null, total: "900.00", status: "completed", payment_method: "cod", placed_at: null },
  shop: { id: "s1", business_name: "Lahori Karahi", slug: "lk", takes_vouchers: false },
};

const envelope = <T,>(data: T, meta: Record<string, unknown> = {}) => ({ success: true, message: "OK", data, errors: {}, meta }) as never;

let client: QueryClient;
const mount = (path: string) =>
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}><AdminOrdersDeskPage /></MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(ordersDeskService, "live").mockResolvedValue(envelope(BOARD));
  vi.spyOn(ordersDeskService, "rules").mockResolvedValue(envelope(RULES));
  vi.spyOn(ordersDeskService, "issues").mockResolvedValue(envelope([ISSUE], { open: 1, total: 1 }));
});
afterEach(() => { client.clear(); vi.restoreAllMocks(); });

describe("live orders", () => {
  it("flags what is stuck and sends what the desk typed", async () => {
    mount("/admin/orders");
    expect(await screen.findByText("ORD-000042")).toBeTruthy();
    expect(screen.getAllByText("Shop not answering").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Search live orders"), { target: { value: "Ayesha" } });
    await waitFor(() => expect(ordersDeskService.live).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Ayesha" })), { timeout: 2000 });
  });

  it("asks again every 15 seconds, as the shop's own queue does", () => {
    expect(LIVE_POLL_MS).toBe(15_000);
  });
});

describe("problems", () => {
  it("cannot be answered with nothing to say, and offers no voucher where the shop takes none", async () => {
    mount("/admin/orders?tab=problems");
    expect(await screen.findByText("“No raita”")).toBeTruthy();

    const send = screen.getByRole("button", { name: "Send answer" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect((screen.getByRole("option", { name: /Voucher at the shop/ }) as HTMLOptionElement).disabled).toBe(true);
  });
});

describe("delivery & fees", () => {
  it("sends an emptied box as none, not as zero", async () => {
    const save = vi.spyOn(ordersDeskService, "saveRules").mockResolvedValue(envelope(RULES));
    mount("/admin/orders?tab=rules");

    const minimum = (await screen.findByLabelText("Minimum order for delivery")) as HTMLInputElement;
    expect(minimum.value).toBe("200");
    fireEvent.change(minimum, { target: { value: "" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save rules" })); });

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ default_min_order: null, rider_cash_limit: 15000, below_minimum: "fee" }));
  });
});
