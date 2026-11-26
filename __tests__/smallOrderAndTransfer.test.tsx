import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * A TWENTY-RUPEE BASKET, AND PAYING BY TRANSFER — the checkout, mounted.
 *
 *  - below the shop's minimum is a small-order fee (foodpanda's way), said
 *    before the bill, and the order can still be placed; only a shop that
 *    refuses such baskets stops the button
 *  - a shop that gave an account offers a transfer: its account is shown,
 *    and the order is not sent without the transaction id
 *  - "order mein masla": the report sheet sends nothing until it knows what
 *    happened, and "something else" needs words
 *  - a rider over the cash limit is told what to do, not "nothing offered"
 */

let mockShop: Record<string, unknown> = {};
const mockPost = jest.fn((url: string, _body?: unknown) =>
  url.endsWith("/worth")
    ? Promise.resolve({ data: { subtotal: 80, discount: 0, delivery_fee: 120, small_order_fee: 720, service_fee: 0, tax: 0, total: 920, lines: [] } })
    : Promise.resolve({ data: { id: "i1", kind: "missing_item", status: "open" } }),
);

jest.mock("../src/common/api/client", () => ({
  configureAuth: jest.fn(),
  configureApi: jest.fn(),
  apiGet: jest.fn((url: string) => {
    if (url.includes("/marketplace/shops/")) return Promise.resolve({ data: mockShop });
    if (url.includes("/customer/addresses")) {
      return Promise.resolve({ data: [{ id: "a1", label: "Home", address: "House 1, Gulberg", latitude: 31.5, longitude: 74.3, is_default: true }] });
    }
    return new Promise(() => {});
  }),
  apiPost: (url: string, body?: unknown) => mockPost(url, body),
  apiPut: jest.fn(() => new Promise(() => {})),
  apiPatch: jest.fn(() => new Promise(() => {})),
  apiDelete: jest.fn(() => new Promise(() => {})),
  api: { get: jest.fn(), post: jest.fn() },
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { slug: "karahi" } }),
}));

import { CheckoutScreen } from "../src/modules/orders/screens/CheckoutScreen";
import { ReportIssueSheet } from "../src/modules/orders/components/ReportIssueSheet";
import { BLOCK_TITLES } from "../src/modules/rider/screens/RiderHomeScreen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider } from "../src/theme";
import { useAuthStore } from "../src/stores/authStore";
import { useCartStore } from "../src/stores/cartStore";

const flush = () => ReactTestRenderer.act(async () => { await new Promise<void>((r) => setTimeout(r, 600)); });

async function mount(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <GestureHandlerRootView>
        <SafeAreaProvider>
          <QueryClientProvider client={client}><ThemeProvider>{node}</ThemeProvider></QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>,
    );
  });
  // The total is asked once the typing stops (400 ms), then answered.
  await flush();
  await flush();
  return tree;
}

const texts = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map((t) => [].concat(t.props.children as never).join("")).join(" | ");
const placeButton = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => typeof n.props.title === "string" && typeof n.props.onPress === "function"
    && /^(Place order|Add the|Working out|Placing)/.test(n.props.title))[0];

beforeEach(() => {
  mockPost.mockClear();
  useAuthStore.setState({ status: "authenticated", user: { id: "u1", role: "customer", name: "Ayesha", permissions: [] } as never });
  useCartStore.getState().clear();
  useCartStore.getState().add("karahi", { product_id: "p1", variant_id: null, name: "Roghni Naan", unit_price: 80 });
  mockShop = {
    slug: "karahi", business_name: "Lahori Karahi", delivery_fee: 120, min_order_amount: 800, below_minimum: "fee",
    fulfillment: { delivery: true, pickup: true }, is_open_now: true, takes_transfer: true, transfer_details: "JazzCash 0300 1234567 (Ali)",
  };
});

afterEach(() => {
  useAuthStore.setState({ status: "guest", user: null });
  useCartStore.getState().clear();
});

it("a basket below the minimum is told the small order fee and can still be placed", async () => {
  const tree = await mount(<CheckoutScreen />);
  expect(texts(tree)).toContain("small order fee is added");
  expect(texts(tree)).toContain("Small order fee");
  expect(placeButton(tree).props.disabled).toBe(false);
  await ReactTestRenderer.act(() => tree.unmount());
});

it("a shop that refuses small baskets stops the button", async () => {
  mockShop.below_minimum = "refuse";
  const tree = await mount(<CheckoutScreen />);
  expect(texts(tree)).toContain("Minimum order for delivery is");
  expect(placeButton(tree).props.disabled).toBe(true);
  await ReactTestRenderer.act(() => tree.unmount());
});

it("a transfer shows the shop's account and is not sent without the transaction id", async () => {
  const tree = await mount(<CheckoutScreen />);
  const transfer = tree.root.findAll((n) => n.props.accessibilityRole === "radio" && typeof n.props.onPress === "function"
    && JSON.stringify(n.props.accessibilityState) === JSON.stringify({ checked: false }))[0];
  await ReactTestRenderer.act(() => transfer.props.onPress());

  expect(texts(tree)).toContain("JazzCash 0300 1234567 (Ali)");
  expect(placeButton(tree).props.title).toBe("Add the transaction ID");
  expect(placeButton(tree).props.disabled).toBe(true);
  await ReactTestRenderer.act(() => tree.unmount());
});

it("a shop that gave no account offers cash only", async () => {
  mockShop.takes_transfer = false;
  const tree = await mount(<CheckoutScreen />);
  expect(texts(tree)).not.toContain("JazzCash / Easypaisa");
  await ReactTestRenderer.act(() => tree.unmount());
});

it("the problem sheet sends nothing until it knows what happened, and 'something else' needs words", async () => {
  const tree = await mount(<ReportIssueSheet visible onClose={() => {}} orderId="o1" orderNumber="ORD-000009" />);
  const send = () => tree.root.findAll((n) => n.props.title === "Send" && typeof n.props.onPress === "function")[0];
  expect(send().props.disabled).toBe(true);

  const choose = (label: string) => tree.root.findAll((n) => n.props.accessibilityRole === "radio" && typeof n.props.onPress === "function"
    && texts({ root: n } as never).includes(label))[0];
  await ReactTestRenderer.act(() => choose("Something else").props.onPress());
  expect(send().props.disabled).toBe(true);

  await ReactTestRenderer.act(() => choose("Something was missing").props.onPress());
  expect(send().props.disabled).toBe(false);
  await ReactTestRenderer.act(async () => { send().props.onPress(); });
  expect(mockPost).toHaveBeenCalledWith("/customer/orders/o1/issue", { kind: "missing_item", note: undefined });
  await ReactTestRenderer.act(() => tree.unmount());
});

it("a rider over the cash limit is told to hand it in", () => {
  expect(BLOCK_TITLES.cash_limit).toBe("Hand in your cash first");
});
