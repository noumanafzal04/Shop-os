import React from "react";
import { Text } from "react-native";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * THE CATEGORIES PAGE, ACTUALLY MOUNTED.
 *
 * ── Why this file exists ─────────────────────────────────────────────
 *
 * The screen shipped once already and nobody could open it: its only entry
 * point was a home tile drawn under `business_types.length > tradeTiles.length`
 * and live returned exactly four trades for a grid of four. Every check on it
 * was a source scan, and a source scan cannot see a page that is never
 * reached — or one that mounts to a red box.
 *
 * It has also changed shape since: two levels now (trade, then the categories
 * inside it) and one rule deciding what may be pressed. Both are things a
 * person sees, so both are asserted against a rendered tree.
 */
const mockTrades = [
  {
    type: "retail",
    label: "Retail Store",
    shops_count: 3,
    categories: [
      { value: "garments", label: "Garments & Clothing", shops_count: 2 },
      { value: "electronics", label: "Electronics", shops_count: 1 },
      // The one nobody has joined — drawn, and inert.
      { value: "toys", label: "Toys", shops_count: 0 },
    ],
  },
  {
    type: "mart",
    label: "Mart & Grocery",
    shops_count: 1,
    categories: [{ value: "grocery", label: "Grocery Store", shops_count: 1 }],
  },
  // A whole trade nobody has joined. The home feed could not say this existed.
  {
    type: "pharmacy",
    label: "Pharmacy & Medical",
    shops_count: 0,
    categories: [{ value: "medical_store", label: "Medical Store", shops_count: 0 }],
  },
];

jest.mock("../src/common/api/client", () => ({
  apiGet: jest.fn((url: string) => {
    if (/\/marketplace\/categories/.test(url)) {
      return Promise.resolve({ data: { business_types: mockTrades } });
    }

    return Promise.resolve({ data: null });
  }),
  apiPost: jest.fn(() => Promise.resolve({ data: null })),
  apiPut: jest.fn(() => Promise.resolve({ data: null })),
  apiPatch: jest.fn(() => Promise.resolve({ data: null })),
  apiDelete: jest.fn(() => Promise.resolve({ data: null })),
  api: { get: jest.fn(), post: jest.fn() },
}));

const mockNavigate = jest.fn();

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), setOptions: jest.fn() }),
  useRoute: () => ({ params: {} }),
  useIsFocused: () => true,
}));

import { CategoriesScreen } from "../src/modules/marketplace/screens/CategoriesScreen";
import { ThemeProvider } from "../src/theme";

const textOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
    .filter((x): x is string => typeof x === "string")
    .join(" | ");

/** The pressable carrying an accessibility label — how a person finds a row. */
const control = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (n) => typeof n.type !== "string" && n.props?.accessibilityLabel === label,
  )[0];

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
            <CategoriesScreen />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
  });

  // Settle until the data is there rather than for a fixed number of ticks —
  // a fixed count is what made the shop-page file order-dependent.
  for (let i = 0; i < 12; i++) {
    await ReactTestRenderer.act(async () => {
      await new Promise<void>((r) => setImmediate(() => r()));
    });
    if (textOf(tree).includes("Retail Store")) break;
  }

  return tree;
}

describe("the categories page, mounted", () => {
  beforeEach(() => mockNavigate.mockClear());

  it("renders without throwing", async () => {
    const tree = await render();
    expect(tree.toJSON()).not.toBeNull();
    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("names the finer trades, which is the whole reason for the page", async () => {
    /**
     * Garments, Electronics and Grocery are `business_category` values inside
     * two trades. A page that stopped at the trade offered somebody looking
     * for clothes a row labelled "Retail Store" and no way to say what they
     * meant — the state this screen shipped in.
     */
    const tree = await render();
    const text = textOf(tree);

    expect(text).toContain("Retail Store");
    expect(text).toContain("Garments & Clothing");
    expect(text).toContain("Electronics");
    expect(text).toContain("Grocery Store");

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("shows a trade nobody has joined, and says so", async () => {
    // The home feed only carries trades that HAVE shops, so this row could not
    // exist on the old screen. It is what makes the page the platform's
    // breadth rather than a second copy of the home grid.
    const tree = await render();
    const text = textOf(tree);

    expect(text).toContain("Pharmacy & Medical");
    expect(text).toContain("Coming soon");

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("sends a category tap to the shop list with BOTH the trade and the category", async () => {
    const tree = await render();

    await ReactTestRenderer.act(async () => {
      control(tree, "Garments & Clothing, 2 shops").props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith("ShopList", {
      business_type: "retail",
      business_category: "garments",
      title: "Garments & Clothing",
    });

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("sends a trade tap to the same screen the home tile does", async () => {
    const tree = await render();

    await ReactTestRenderer.act(async () => {
      control(tree, "Retail Store, 3 shops").props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith("ShopList", {
      business_type: "retail",
      title: "Retail Store",
    });

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("offers no press on a category with nothing in it", async () => {
    /**
     * Toys is drawn — the platform sells it — and pressing it would open an
     * empty list, which is the shape this codebase keeps finding: offered, and
     * not doable. `onPress` is undefined, not a handler behind a grey style.
     */
    const tree = await render();
    const toys = control(tree, "Toys, no shops yet");

    expect(toys).toBeDefined();
    expect(toys.props.onPress).toBeUndefined();
    expect(toys.props.disabled).toBe(true);

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("offers no press on a whole trade with nothing in it", async () => {
    const tree = await render();
    const pharmacy = control(tree, "Pharmacy & Medical, no shops yet");

    expect(pharmacy).toBeDefined();
    expect(pharmacy.props.onPress).toBeUndefined();

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("keeps the empty trade's chips off the page", async () => {
    // Under a trade with no shops every chip reads zero, so they say nothing
    // "Coming soon" has not — and nine trades of them would scroll like
    // ninety.
    const tree = await render();

    expect(textOf(tree)).not.toContain("Medical Store");

    await ReactTestRenderer.act(() => tree.unmount());
  });
});
