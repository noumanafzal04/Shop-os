import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PROJECT_ROOT, fs, path } from "./support/node";

/**
 * An order has to belong to somebody.
 *
 * The app browses without an account on purpose — shops, menus, prices, a
 * basket. Checkout is one of exactly two places that asks for one, and it is
 * the place where getting it wrong is expensive in both directions: a wall too
 * early loses the sale, and no wall at all means an order nobody can be
 * delivered to, followed, or refunded.
 *
 * A mutation that deleted the gate changed no test until this file existed.
 */

jest.mock("../src/common/api/client", () => ({
  apiGet: jest.fn(() => new Promise(() => {})),
  apiPost: jest.fn(() => new Promise(() => {})),
  apiPut: jest.fn(() => new Promise(() => {})),
  apiPatch: jest.fn(() => new Promise(() => {})),
  apiDelete: jest.fn(() => new Promise(() => {})),
  api: { get: jest.fn(), post: jest.fn() },
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { slug: "burger-hut" } }),
}));

import { CheckoutScreen } from "../src/modules/orders/screens/CheckoutScreen";
import { SignInWall } from "../src/modules/auth/components/SignInWall";
import { ThemeProvider } from "../src/theme";
import { useAuthStore } from "../src/stores/authStore";
import { useCartStore } from "../src/stores/cartStore";

async function renderCheckout() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider>
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <CheckoutScreen />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  useCartStore.getState().clear();
  useCartStore.getState().add("burger-hut", {
    product_id: "p1",
    variant_id: null,
    name: "Burger",
    unit_price: 450,
  });
});

afterEach(() => {
  useAuthStore.setState({ status: "guest", user: null });
  useCartStore.getState().clear();
});

it("asks a guest to sign in before placing an order", async () => {
  useAuthStore.setState({ status: "guest", user: null });

  const tree = await renderCheckout();

  expect(tree.root.findAllByType(SignInWall)).toHaveLength(1);

  await ReactTestRenderer.act(() => tree.unmount());
});

it("does not ask a signed-in customer", async () => {
  useAuthStore.setState({
    status: "authenticated",
    user: { id: "u1", role: "customer", name: "Ayesha", permissions: [] } as never,
  });

  const tree = await renderCheckout();

  // The other half of the rule. A wall shown to someone already signed in is
  // the same bug wearing the opposite face, and only one of the two is ever
  // reported.
  expect(tree.root.findAllByType(SignInWall)).toHaveLength(0);

  await ReactTestRenderer.act(() => tree.unmount());
});

it("keeps the guest's basket while asking", async () => {
  useAuthStore.setState({ status: "guest", user: null });

  const tree = await renderCheckout();

  // The reason the wall is a panel and not a redirect: whatever they built is
  // still there when they come back. A basket emptied by a login prompt is a
  // basket nobody rebuilds.
  expect(useCartStore.getState().lines).toHaveLength(1);
  expect(useCartStore.getState().shopSlug).toBe("burger-hut");

  await ReactTestRenderer.act(() => tree.unmount());
});

/**
 * A BASKET IS OPEN. AN ACCOUNT IS ASKED FOR ONCE.
 *
 * ── The bug ──────────────────────────────────────────────────────────
 *
 * The shop page gated its add button on `isCustomer` — which is
 * `user?.role === "customer"`, false for a guest — so a signed-out visitor got
 * no add button at all. Not disabled, not explained: absent, on the screen the
 * whole app funnels into.
 *
 * The aisle never had that gate, so the app disagreed with itself. You could
 * fill a basket from Browse and not from the shop the items belong to, which
 * reads as the shop being broken rather than as a rule.
 *
 * ── The rule, stated once ────────────────────────────────────────────
 *
 * Nothing that only touches THIS PHONE needs an account. The basket is a list
 * in memory — nothing sent, nothing held, nobody's stock touched. A
 * reservation is the opposite: it reaches the server the moment it is pressed
 * and holds an item against somebody's name.
 *
 * So: browse, price, and fill a basket as a guest; sign in at checkout, where
 * it is asked properly and the basket survives the asking.
 */
describe("what a guest may do", () => {
  const read = (rel: string) =>
    fs
      .readFileSync(path.join(PROJECT_ROOT, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

  const shop = read("src/modules/marketplace/screens/MarketShopScreen.tsx");

  it("may fill a basket on a shop page", () => {
    expect(shop).toMatch(/const acceptsOrders = shop\.data\?\.accepts_orders \?\? false;/);
    expect(shop).not.toMatch(/const acceptsOrders = isCustomer/);
  });

  it("may fill a basket in the aisle, which is where the app already agreed", () => {
    // The denominator: the two screens have to answer the same way, and the
    // aisle is the one that was already right.
    const aisle = read("src/modules/marketplace/screens/BrowseScreen.tsx");
    expect(aisle).toMatch(/<AddButton/);
    expect(aisle).not.toMatch(/isCustomer &&[\s\S]{0,40}<AddButton/);
  });

  it("may NOT reserve, because that reaches the server and holds stock", () => {
    expect(shop).toMatch(/const canReserve = isCustomer &&/);
  });

  it("is asked to sign in at checkout, and keeps the basket while asked", () => {
    const checkout = read("src/modules/orders/screens/CheckoutScreen.tsx");
    expect(checkout).toMatch(/if \(status !== "authenticated"\)/);
    expect(checkout).toMatch(/<SignInWall/);
    // A PANEL, not a redirect — see `SignInWall`. Somebody sent to a login
    // screen loses where they were and arrives somewhere that is not their
    // basket.
    expect(checkout).not.toMatch(/navigation\.(navigate|replace)\("SignIn"\)/);
  });
});
