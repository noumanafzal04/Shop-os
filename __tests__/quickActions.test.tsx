import React from "react";
import { Text } from "react-native";
import ReactTestRenderer from "react-test-renderer";
import { ThemeProvider } from "@cartze/core/theme/ThemeProvider";
import { useAuthStore } from "../src/stores/authStore";
import { tabsFor } from "../src/navigation/tabsFor";
import type { SessionUser } from "../src/types/session";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
let mockWaiting = 0;
jest.mock("../src/modules/orders/hooks/useOrders", () => ({
  useOrders: () => ({ data: { orders: Array.from({ length: mockWaiting }, (_, i) => ({ id: String(i) })) } }),
}));

import { QuickActions } from "../src/modules/dashboard/components/QuickActions";

/**
 * HOME TAKES THE SHOPKEEPER TO THE WORK — orders (with the waiting count),
 * add a product, sales, opening hours — one tap each, only where allowed.
 */

const owner = {
  id: "u1",
  name: "Imran",
  email: null,
  phone: null,
  role: "shop_owner",
  status: "active",
  permissions: [],
  tenant: {
    id: "t1",
    business_name: "Lahori Karahi House",
    business_type: "food",
    business_type_primary: "food",
    online_shop_enabled: true,
    setup_completed: true,
    status: "active",
    images_enabled: true,
    features: { products: true, orders: true, delivery: true, online_shop: true, reports: true, pos: true },
  },
} as unknown as SessionUser;

async function render() {
  let t!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    t = ReactTestRenderer.create(
      <ThemeProvider>
        <QuickActions />
      </ThemeProvider>,
    );
  });
  return t;
}

const words = (t: ReactTestRenderer.ReactTestRenderer) => t.root.findAllByType(Text).map((n) => n.props.children);

beforeEach(() => {
  mockNavigate.mockReset();
  mockWaiting = 0;
  useAuthStore.setState({ user: owner });
});

describe("home's quick actions", () => {
  it("offers the owner every one of its tabs' shortcuts", async () => {
    const t = await render();
    const expected = [
      tabsFor(owner).includes("Orders") && "Orders",
      tabsFor(owner).includes("Menu") && "Add product",
      tabsFor(owner).includes("Money") && "Sales",
      tabsFor(owner).includes("Account") && "Hours",
    ].filter(Boolean);
    expect(expected.length).toBeGreaterThanOrEqual(3);
    expect(words(t)).toEqual(expected);
  });

  it("puts the waiting count on Orders and opens the queue", async () => {
    mockWaiting = 2;
    const t = await render();
    expect(words(t)).toContain("2 waiting");
    const tile = t.root.findAll((n) => n.props.accessibilityLabel === "2 waiting" && typeof n.props.onPress === "function")[0];
    await ReactTestRenderer.act(() => tile.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith("Orders", { screen: "OrdersQueue" });
  });

  it("shows nothing to somebody who may do none of it", async () => {
    useAuthStore.setState({ user: { ...owner, role: "staff", permissions: [] } as SessionUser });
    const t = await render();
    expect(words(t).filter((w) => w !== "Hours")).toEqual([]);
  });
});
