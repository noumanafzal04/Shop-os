import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * WHAT KIND OF ORDER THE CHECKOUT PLACES WHEN NOBODY TOUCHES THE TOGGLE.
 *
 * ── Why this file exists ─────────────────────────────────────────────
 *
 * "Rider side no order coming, koi rider assign ni ho raha" survived three
 * other fixes — a permission bug, a pool flag with no switch, a board that
 * could not say why it was empty — and none of them was the cause. This was:
 * the checkout defaulted to **pickup**, and `RiderService::beginOffering` only
 * runs for a DELIVERY order. Every test order was a pickup order, and was
 * correctly never offered to anybody.
 *
 * A source scan would not have caught it either way round, because
 * `useState("pickup")` is not wrong on its face. So the screen is mounted and
 * asked what it would SEND.
 */
const mockShop = {
  slug: "burger-hut",
  business_name: "Burger Hut",
  business_type: "food",
  accepts_orders: true,
  is_open_now: true,
  images: [],
  logo_url: null,
  cover_url: null,
  city: "Lahore",
  address: "Main Boulevard",
  delivery_fee: "50",
  fulfillment: { delivery: true, pickup: true },
  features: { delivery: true },
  prep_time_minutes: 25,
  free_delivery_threshold: null,
  min_order_amount: null,
};

/**
 * `mock`-prefixed so the jest.mock factory below may reference it — the babel
 * plugin forbids any other out-of-scope name, and a self-require to work
 * around that is how a mock ends up reading a half-initialised module.
 */
let mockShopPayload: unknown = mockShop;

jest.mock("../src/common/api/client", () => ({
  apiGet: jest.fn((url: string) => {
    if (/addresses/.test(url)) {
      // One saved address, because delivery is not placeable without one and
      // a test that cannot press the button proves nothing about the payload.
      return Promise.resolve({
        data: [
          {
            id: "a1",
            label: "Home",
            address: "House 12, Street 4, Johar Town",
            latitude: 31.47,
            longitude: 74.27,
            is_default: true,
          },
        ],
      });
    }
    if (/\/marketplace\/shops\//.test(url)) return Promise.resolve({ data: mockShopPayload });

    return Promise.resolve({ data: null });
  }),
  apiPost: jest.fn(() => Promise.resolve({ data: { id: "o1" } })),
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

import { CheckoutScreen, preferredFulfillment } from "../src/modules/orders/screens/CheckoutScreen";
import { ThemeProvider } from "../src/theme";
import { useCartStore } from "../src/stores/cartStore";
import { useAuthStore } from "../src/stores/authStore";

/**
 * WHAT THE SCREEN WOULD SEND.
 *
 * My first version read `accessibilityState.selected` off the segments, which
 * is chrome: with a pickup-only shop the Delivery segment is not drawn at all,
 * so "nothing is selected" and "pickup is selected" looked identical and the
 * test reported an empty string.
 *
 * The bug was never about which pill is highlighted. It was about the
 * `fulfillment_type` in the request — so that is what is asserted, by pressing
 * the button a person presses.
 */
async function placedOrder(tree: ReactTestRenderer.ReactTestRenderer) {
  // Found by its TITLE: `AppButton` has no accessibility label of its own,
  // and the title is the words on the button a person reads.
  const button = tree.root.findAll(
    (n) => typeof n.type !== "string" && /^Place order/.test(String(n.props?.title ?? "")),
  )[0];
  expect(button).toBeDefined();

  await ReactTestRenderer.act(async () => {
    (button.props.onPress as () => void)();
    await new Promise<void>((r) => setImmediate(() => r()));
  });

  const post = jest.requireMock("../src/common/api/client").apiPost as jest.Mock;
  const call = post.mock.calls.find(([url]) => /customer\/orders/.test(String(url)));

  return call?.[1] as { fulfillment_type?: string } | undefined;
}

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
            <CheckoutScreen />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
  });

  /**
   * TWELVE FLUSHES, NO EARLY EXIT.
   *
   * The early exit was `text.includes("Delivery")`, which matches the "Delivery
   * fee" row of the order summary — and that renders on the FIRST tick, before
   * the shop or the addresses have arrived. So the pickup case measured a
   * screen that had loaded nothing and reported a bug in the effect that
   * corrects the mode.
   *
   * There is no single string that means "everything this screen waits on has
   * landed" (a shop, a list of addresses, a cart), and inventing one is how
   * that mistake happens again. Twelve microtask flushes always is cheaper
   * than the guess and cannot settle less.
   */
  for (let i = 0; i < 12; i++) {
    await ReactTestRenderer.act(async () => {
      await new Promise<void>((r) => setImmediate(() => r()));
    });
  }

  return tree;
}

describe("the checkout's default fulfillment", () => {
  beforeEach(() => {
    /**
     * CLEARED, or the second case reads the first case's request.
     *
     * `placedOrder` searches `apiPost.mock.calls` for the order POST. Without
     * this the pickup case found the DELIVERY call left by the case before it
     * and reported a bug in the screen that was really a bug in this file —
     * the mock is module-level and jest does not reset it between tests.
     */
    (jest.requireMock("../src/common/api/client").apiPost as jest.Mock).mockClear();
    mockShopPayload = mockShop;
    /**
     * SIGNED IN, because the checkout is a sign-in wall otherwise.
     *
     * My first version of this file asserted against that wall and reported
     * "Received string: ''" — a test that had never reached the screen it was
     * named after.
     */
    useAuthStore.setState({
      status: "authenticated",
      user: { id: "u1", name: "Farhan", role: "customer" } as never,
      accessToken: "t",
    });
    useCartStore.setState({
      shopSlug: "burger-hut",
      lines: [
        {
          product_id: "p1",
          name: "Zinger Burger",
          price: 450,
          quantity: 1,
          sold_by: "unit",
        } as never,
      ],
    });
  });

  it("is delivery where the shop delivers", async () => {
    /**
     * The whole bug. A marketplace that delivers must not ask everybody to opt
     * in to the thing it is for — and the cost of the wrong default was not a
     * tap, it was every order silently bypassing the rider half of the
     * product.
     */
    const tree = await render();

    expect((await placedOrder(tree))?.fulfillment_type).toBe("delivery");

    await ReactTestRenderer.act(() => tree.unmount());
  });

});

/**
 * THE RULE ON ITS OWN.
 *
 * The mounted test above proves the wiring for the case that matters — a
 * deliverable shop sends `delivery` — and it is the expensive way to ask this
 * question: the screen needs a signed-in store, a cart, a shop, a saved
 * address and a settled query client before it will POST anything, and every
 * one of those is a way for the test to measure something other than the rule.
 *
 * My first attempt at the pickup-only case read `accessibilityState.selected`
 * off the segments, which cannot tell "pickup is selected" from "the delivery
 * segment was not drawn"; the second read a stale `apiPost` call left by the
 * test before it; the third settled on a string that renders before any data
 * arrives. Three failures, none of them about fulfillment.
 *
 * So the rule is a pure function and is asked directly.
 */
describe("which way an order goes when nobody has said", () => {
  const rule = (o: Partial<Parameters<typeof preferredFulfillment>[0]>) =>
    preferredFulfillment({
      current: "delivery",
      canDeliver: true,
      canPickup: true,
      chosen: false,
      ...o,
    });

  it("prefers delivery where the shop delivers", () => {
    // The bug: `useState("pickup")` meant every untouched order bypassed the
    // rider half of the product.
    expect(rule({ current: "pickup" })).toBe("delivery");
    expect(rule({ current: "delivery" })).toBe("delivery");
  });

  it("never offers a mode the shop cannot honour", () => {
    // The server would refuse it, and the refusal would arrive at the last
    // step of the last screen.
    expect(rule({ canDeliver: false })).toBe("pickup");
    expect(rule({ current: "pickup", canPickup: false })).toBe("delivery");
  });

  it("leaves a person's own choice alone", () => {
    // The shop arrives after the screen mounts, so this runs in an effect —
    // and an effect that re-ran on a refetch would quietly undo somebody who
    // had deliberately picked Pickup.
    expect(rule({ current: "pickup", chosen: true })).toBe("pickup");
    expect(rule({ current: "delivery", chosen: true })).toBe("delivery");
  });

  it("still corrects a chosen mode the shop stops offering", () => {
    // A choice cannot outlive the shop's ability to honour it — a shop that
    // switches delivery off mid-basket must not leave a delivery order.
    expect(rule({ current: "delivery", chosen: true, canDeliver: false })).toBe("pickup");
  });
});
