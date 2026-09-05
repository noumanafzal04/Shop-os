import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
