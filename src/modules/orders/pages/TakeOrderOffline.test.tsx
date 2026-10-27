import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

/**
 * TAKING AN ORDER WITH THE LINE DOWN (the user, 2026-10-27).
 *
 * An order lives on the server — that is how it reaches the kitchen. Offline
 * the menu sat loading and nothing said why; the page now says so at the top,
 * before anything is typed, and points at the till, which works offline.
 */
vi.mock("../../../components/common/PageMeta", () => ({ default: () => null }));
vi.mock("../../../components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
// One object, as react-query hands back: a fresh one per render is a new
// answer per render, and the page's shelf effect would never settle.
const noProducts = { data: { data: [], meta: {} }, isLoading: false, isFetching: false, error: null };
const noSections = { data: [] };
vi.mock("../../catalog/hooks/useCatalog", () => ({
  useCategories: () => noSections,
  useProducts: () => noProducts,
}));
vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number | string) => String(n), useShopSettings: () => ({ data: {} }) }));
vi.mock("../hooks/useOrders", () => ({
  useOrderWorth: () => ({ data: undefined, isFetching: false, error: null }),
  useTakeOrder: () => ({ mutate: vi.fn(), isPending: false }),
}));

import TakeOrderPage from "./TakeOrderPage";
import { useConnectionStore } from "../../../stores/connectionStore";

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TakeOrderPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => useConnectionStore.setState({ online: true, reachable: true }));

describe("taking an order", () => {
  it("says at the top that it needs the internet, and where to sell instead", () => {
    useConnectionStore.setState({ online: false, reachable: true });
    show();

    expect(screen.getByRole("alert")).toHaveTextContent("An order needs the internet to reach the kitchen");
    expect(screen.getByRole("alert")).toHaveTextContent("Sell at the till");
  });

  it("a shop wifi with a dead uplink is offline too", () => {
    useConnectionStore.setState({ online: true, reachable: false });
    show();

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("says nothing while the line is up", () => {
    show();

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
