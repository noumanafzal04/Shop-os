import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ShopSetupPage from "./ShopSetupPage";
import { useAuthStore } from "../../../stores/authStore";

/**
 * B23 (the tester): the city the shop was made with was asked again from
 * nothing, and /tenant/setup opened again after setup was done — on a second
 * device, it stayed open.
 */
vi.mock("../hooks/useShop", () => ({
  useCities: () => ({ data: [{ id: "khi", name: "Karachi" }, { id: "lhr", name: "Lahore" }], isLoading: false }),
  useBusinessTypes: () => ({ data: [] }),
  useCompleteSetup: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useShopCurrencies: () => ({ data: undefined }),
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

afterEach(() => useAuthStore.setState({ user: null, isAuthenticated: false }));

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
});
