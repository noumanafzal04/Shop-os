import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ShopSetupPage from "./ShopSetupPage";
import { useAuthStore } from "../../../stores/authStore";

/**
 * B23 (the tester): the city the shop was made with was asked again from
 * nothing, and /tenant/setup opened again after setup was done — on a second
 * device, it stayed open.
 */
// Cities come from the shared country → province → city lists now.
vi.mock("../../../common/geo/places", async (actual) => ({
  ...(await actual<typeof import("../../../common/geo/places")>()),
  useCities: () => ({
    data: [
      { id: "khi", name: "Karachi", province_id: 3175, country_id: 167, latitude: null, longitude: null },
      { id: "lhr", name: "Lahore", province_id: 3176, country_id: 167, latitude: null, longitude: null },
    ],
    isLoading: false,
  }),
  useProvinces: () => ({ data: [{ id: 3175, country_id: 167, name: "Sindh", type: null }, { id: 3176, country_id: 167, name: "Punjab", type: null }] }),
  useCountries: () => ({ data: [{ id: 167, name: "Pakistan", iso2: "PK", phone_code: "92", currency: "PKR" }] }),
}));
const finished = vi.fn();
const saved = vi.fn(async () => ({ data: {} }));
vi.mock("../hooks/useShop", () => ({
  useBusinessTypes: () => ({ data: [] }),
  useCompleteSetup: () => ({ mutate: finished, isPending: false, error: null }),
  useShopCurrencies: () => ({ data: undefined }),
  useShopTimezones: () => ({ data: { current: "Asia/Karachi", locked: false, why: null, suggested: ["Asia/Karachi"], options: [{ id: "Asia/Karachi", label: "(UTC+05:00) Asia/Karachi" }, { id: "Asia/Dubai", label: "(UTC+04:00) Asia/Dubai" }] } }),
  useShopSettings: () => ({ data: { default_tax_rate: 0, tax_inclusive: false, pos_auto_print: false, pos_require_shift: false, pos_default_payment: "cash", receipt_width: "standard", pickup_enabled: true, delivery_enabled: true, min_order_amount: null, invoice_footer: null, invoice_ntn: null, invoice_strn: null } }),
  useUpdateShopSettings: () => ({ mutateAsync: saved, isPending: false, error: null }),
}));
vi.mock("../../../components/maps/MapPicker", () => ({ default: () => null }));
vi.mock("../../../components/common/PageMeta", () => ({ default: () => null }));

function open(tenant: Record<string, unknown>) {
  useAuthStore.setState({
    user: { id: "u1", name: "Sana", role: "shop_owner", permissions: [], tenant: { features: { pos: true }, ...tenant } } as never,
    isAuthenticated: true,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/tenant/setup"]}>
        <Routes>
          <Route path="/tenant/setup" element={<ShopSetupPage />} />
          <Route path="/tenant" element={<div>dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false });
  finished.mockClear();
  saved.mockClear();
});

describe("setting up a shop", () => {
  it("starts from the city and address the shop was made with", () => {
    open({ setup_completed: false, city: { id: "lhr", name: "Lahore" }, address: "12 Mall Road" });

    expect(screen.getByRole("combobox", { name: "City" })).toHaveValue("lhr");
    expect(screen.getByDisplayValue("12 Mall Road")).toBeInTheDocument();
  });

  it("is left for the dashboard once the shop is set up", () => {
    open({ setup_completed: true, city: { id: "lhr", name: "Lahore" } });

    expect(screen.getByText("dashboard")).toBeInTheDocument();
  });

  it("finishes straight from the first step with the usual settings — nothing else is saved", async () => {
    open({ setup_completed: false, city: { id: "lhr", name: "Lahore" }, features: { pos: true, marketplace: true, delivery: true } });

    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(finished).toHaveBeenCalledTimes(1));
    expect(saved).not.toHaveBeenCalled();
    expect(finished.mock.calls[0][0]).toMatchObject({ city_id: "lhr" });
    expect(finished.mock.calls[0][0]).not.toHaveProperty("timezone");
  });

  it("walks Next and Back through every step this shop has, and saves what was answered", async () => {
    open({ setup_completed: false, city: { id: "lhr", name: "Lahore" }, features: { pos: true, marketplace: true, delivery: true } });

    fireEvent.click(screen.getByRole("button", { name: "Next: Money & tax" }));
    fireEvent.change(screen.getByLabelText("Tax on your prices (%)"), { target: { value: "17" } });
    fireEvent.click(screen.getByRole("button", { name: "Next: Counter & receipt" }));
    fireEvent.click(screen.getByRole("switch", { name: /Print the receipt after every sale/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    // Back keeps what was typed.
    expect(screen.getByLabelText("Tax on your prices (%)")).toHaveValue(17);
    fireEvent.click(screen.getByRole("button", { name: "Next: Counter & receipt" }));
    fireEvent.click(screen.getByRole("button", { name: "Next: Hours & online orders" }));
    fireEvent.change(screen.getByLabelText("Delivery charge"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(finished).toHaveBeenCalledTimes(1));
    expect(saved).toHaveBeenCalledWith({ default_tax_rate: 17, pos_auto_print: true });
    expect(finished.mock.calls[0][0]).toMatchObject({ city_id: "lhr", delivery_fee: 150 });
  });

  it("a skipped step changes nothing, even what was typed on it", async () => {
    open({ setup_completed: false, city: { id: "lhr", name: "Lahore" }, features: { pos: true } });

    fireEvent.click(screen.getByRole("button", { name: "Next: Money & tax" }));
    fireEvent.change(screen.getByLabelText("Tax on your prices (%)"), { target: { value: "17" } });
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    // The last step, skipped: that finishes.
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));

    await waitFor(() => expect(finished).toHaveBeenCalledTimes(1));
    expect(saved).not.toHaveBeenCalled();
    expect(finished.mock.calls[0][0].currency).toBeUndefined();
  });

  it("asks a business with no counter and no online shop two steps, and never calls it a shop", () => {
    open({ setup_completed: false, city: { id: "lhr", name: "Lahore" }, features: { expenses: true } });

    const steps = screen.getByRole("list", { name: "Setup steps" });
    expect(steps.querySelectorAll("li")).toHaveLength(2);
    expect(screen.queryByText(/your shop|shop location|shop address/i)).toBeNull();
  });

  it("will not take an online shop that customers have no way to get an order from", () => {
    open({ setup_completed: false, city: { id: "lhr", name: "Lahore" }, features: { marketplace: true, delivery: true } });

    fireEvent.click(screen.getByRole("button", { name: "Next: Money & tax" }));
    fireEvent.click(screen.getByRole("button", { name: "Next: Hours & online orders" }));
    fireEvent.click(screen.getByRole("switch", { name: /collect from the shop/ }));
    fireEvent.click(screen.getByRole("switch", { name: /We deliver/ }));

    expect(screen.getByRole("alert")).toHaveTextContent("keep collecting or delivery on");
    expect(screen.getByRole("button", { name: "Finish setup" })).toBeDisabled();
  });
});
