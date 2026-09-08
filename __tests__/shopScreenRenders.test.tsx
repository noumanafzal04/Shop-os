import React from "react";
import { Text } from "react-native";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * THE SCREEN THAT HAS CRASHED TWICE, ACTUALLY MOUNTED.
 *
 * ── Why this file exists ─────────────────────────────────────────────
 *
 * Every existing check on this screen is a SOURCE SCAN. Four test files
 * mention `MarketShopScreen` and not one of them renders it — so the menu was
 * restructured (headings as rows, a contents bar as a row, the product markup
 * lifted into a memoised component) with nothing but greps as evidence.
 *
 * A grep cannot see a component that throws. And this is the screen that
 * produced `addViewAt: failed to insert view … index=50 count=1` on a real
 * device, twice, from two different attempts at making one bar stay put.
 *
 * So: mount it, with a menu that has two categories in it, and assert what a
 * person would see.
 */

// `mock`-prefixed because a jest.mock factory may not reference any other
// out-of-scope variable — the guard against a fixture that is still undefined
// when the factory runs.
const mockShop = {
  slug: "burger-hut",
  business_name: "Burger Hut",
  business_type: "food",
  rating: 4.5,
  reviews_count: 12,
  accepts_orders: true,
  images: [],
  logo_url: null,
  cover_url: null,
  city: "Lahore",
  address: "Main Boulevard",
  phone: "0300 0000000",
  distance_km: 1.2,
  delivery_fee: "50",
  is_open: true,
  fulfillment: { delivery: true, pickup: true },
  features: { delivery: true },
  prep_time_minutes: 25,
  free_delivery_threshold: null,
  min_order_amount: null,
};

const mockProduct = (id: string, name: string, category: string) => ({
  id,
  name,
  type: "product",
  price: "450",
  original_price: null,
  images: [],
  in_stock: true,
  available_now: true,
  requires_prescription: false,
  variants: [],
  modifier_groups: [],
  sold_by: "unit",
  unit: null,
  duration_minutes: null,
  category: { id: `c:${category}`, name: category },
});

/**
 * Two categories, because one is the case that draws no bar at all — and a
 * test that used one would prove nothing about the thing being added.
 */
const mockMenu = [
  mockProduct("p1", "Zinger Burger", "Burgers"),
  mockProduct("p2", "Beef Burger", "Burgers"),
  mockProduct("p3", "Pepsi", "Drinks"),
];

jest.mock("../src/common/api/client", () => ({
  apiGet: jest.fn((url: string) => {
    if (/\/products$/.test(url)) {
      return Promise.resolve({
        data: mockMenu,
        meta: { pagination: { current_page: 1, last_page: 1 } },
      });
    }
    if (/\/marketplace\/shops\//.test(url)) return Promise.resolve({ data: mockShop });
    if (/favorites/.test(url)) return Promise.resolve({ data: [] });

    return Promise.resolve({ data: null });
  }),
  apiPost: jest.fn(() => Promise.resolve({ data: null })),
  apiPut: jest.fn(() => Promise.resolve({ data: null })),
  apiPatch: jest.fn(() => Promise.resolve({ data: null })),
  apiDelete: jest.fn(() => Promise.resolve({ data: null })),
  api: { get: jest.fn(), post: jest.fn() },
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() }),
  useRoute: () => ({ params: { slug: "burger-hut" } }),
  useIsFocused: () => true,
}));

import { MarketShopScreen } from "../src/modules/marketplace/screens/MarketShopScreen";
import { ThemeProvider } from "../src/theme";

const textOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((x): x is string => typeof x === "string")
    .join(" | ");

async function render() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <MarketShopScreen />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
  });
  /**
   * SETTLE UNTIL THE DATA IS THERE, not for a fixed number of ticks.
   *
   * A single `await Promise.resolve()` made this file order-dependent: two
   * queries and an infinite one resolve over several microtasks, so some tests
   * saw the shop and some saw the skeleton, depending on what had run before
   * them. A flaky test is worse than none — it teaches you to re-run.
   */
  for (let i = 0; i < 12; i++) {
    await ReactTestRenderer.act(async () => {
      await new Promise<void>((r) => setImmediate(() => r()));
    });
    if (textOf(tree).includes("Burger Hut")) break;
  }
  return tree;
}

describe("the shop page, mounted", () => {
  it("renders without throwing", async () => {
    // The whole point. `ProductRow` was lifted out of `renderItem` by hand; a
    // mistake in it is a screen that mounts to a red box and passes every
    // source scan in the suite.
    const tree = await render();
    expect(tree.toJSON()).not.toBeNull();
    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("shows the shop and its products", async () => {
    const tree = await render();
    const text = textOf(tree);

    expect(text).toContain("Burger Hut");
    expect(text).toContain("Zinger Burger");

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("draws a heading for each category", async () => {
    // Headings ride in the same flat array as the products, which is what
    // makes a chip able to say "scroll to row fourteen".
    const tree = await render();
    const text = textOf(tree);

    expect(text).toContain("Burgers");
    expect(text).toContain("Drinks");

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("draws the contents bar once, in the list, before it is pinned", async () => {
    /**
     * The bar is drawn twice in the SOURCE — a row and a pinned copy — and
     * exactly once on screen at a time. Nothing has scrolled here, so the
     * pinned copy must not be up: two bars at the top is what a broken
     * hand-off looks like.
     *
     * Counted by the chip label rather than by the component, because that is
     * what a person would see twice.
     */
    const tree = await render();
    const chips = tree.root
      .findAllByType(Text)
      .filter((n) => n.props.children === "Burgers");

    // One chip and one heading — not two chips.
    expect(chips.length).toBe(2);

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("keeps the add button for a guest", async () => {
    // A basket is a list in this phone's memory. The gate belongs at checkout,
    // and this screen had it on the button for a while — a signed-out visitor
    // got no add control at all, on the screen the app funnels into.
    const tree = await render();
    // By its LABEL, not by the component's function name: a name survives
    // being wrapped in `React.memo` or a `forwardRef` in some versions and not
    // others, and the label is what a screen reader and a person actually get.
    const adds = tree.root.findAll(
      (n) => n.props?.accessibilityLabel === "Add Zinger Burger",
    );

    expect(adds.length).toBeGreaterThan(0);

    await ReactTestRenderer.act(() => tree.unmount());
  });
});
