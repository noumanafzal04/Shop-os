/**
 * data.link → screen mapping. This is the contract between backend
 * notifications and the app — a broken mapping means dead push taps.
 */
const mockNavigate = jest.fn();
const mockState = { ready: true };

jest.mock("@react-navigation/native", () => ({
  createNavigationContainerRef: () => ({
    isReady: () => mockState.ready,
    // Lazy dereference — the module under test is imported before the
    // const above initializes (jest.mock hoisting).
    navigate: (...args: unknown[]) => mockNavigate(...args),
  }),
}));

import { flushPendingDeepLink, resolveDeepLink } from "../src/navigation/deepLinks";

describe("resolveDeepLink", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockState.ready = true;
  });

  it("routes orders/{id} to the tracking screen", () => {
    resolveDeepLink("orders/abc-123");
    expect(mockNavigate).toHaveBeenCalledWith("Order", { id: "abc-123" });
  });

  // Any scheme, not one spelling. The app's own scheme follows the product's
  // name, and links already sent to a phone keep the name they were sent with —
  // so a resolver that knows only the current one goes deaf on a rename.
  it.each([
    "shopos://orders/xyz",
    "cartze://orders/xyz",
    "https://cartze.shop/orders/xyz",
  ])(
    "strips the scheme from %s",
    (link) => {
      resolveDeepLink(link);
      expect(mockNavigate).toHaveBeenCalledWith("Order", { id: "xyz" });
    },
  );

  it("routes announcements to notifications", () => {
    resolveDeepLink("announcements/n1");
    expect(mockNavigate).toHaveBeenCalledWith("Notifications", undefined);
  });

  it("routes shop/{slug} to the shop screen", () => {
    resolveDeepLink("shop/cheesy-slice");
    expect(mockNavigate).toHaveBeenCalledWith("MarketShop", {
      slug: "cheesy-slice",
      productId: undefined,
    });
  });

  // The one a web link gets wrong if the host is mistaken for the route: strip
  // "up to the first slash" and `cartze://shop/x` loses the word `shop`.
  it.each([
    ["https://cartze.shop/shop/cheesy-slice", "web link"],
    ["cartze://shop/cheesy-slice", "app scheme"],
    ["shop/cheesy-slice", "bare path"],
  ])("%s (%s) reaches the same shop", (link) => {
    resolveDeepLink(link);
    expect(mockNavigate).toHaveBeenCalledWith("MarketShop", {
      slug: "cheesy-slice",
      productId: undefined,
    });
  });

  it("routes shop/{slug}/product/{id} to that item's sheet", () => {
    resolveDeepLink("https://cartze.shop/shop/cheesy-slice/product/p-7");
    expect(mockNavigate).toHaveBeenCalledWith("MarketShop", {
      slug: "cheesy-slice",
      productId: "p-7",
    });
  });

  // A link pasted into a chat app comes back with its own baggage.
  it("ignores tracking params a chat app appends", () => {
    resolveDeepLink("https://cartze.shop/shop/cheesy-slice?utm_source=whatsapp#top");
    expect(mockNavigate).toHaveBeenCalledWith("MarketShop", {
      slug: "cheesy-slice",
      productId: undefined,
    });
  });

  it.each(["wishlist", "favorites"])("routes %s to saved items", (word) => {
    resolveDeepLink(word);
    expect(mockNavigate).toHaveBeenCalledWith("Favorites", undefined);
  });

  it("ignores unknown links without crashing", () => {
    resolveDeepLink("mystery/route");
    resolveDeepLink(null);
    resolveDeepLink(undefined);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("queues a link that arrives before navigation is ready, then replays it", () => {
    mockState.ready = false;
    resolveDeepLink("orders/early");
    expect(mockNavigate).not.toHaveBeenCalled();

    mockState.ready = true;
    flushPendingDeepLink();
    expect(mockNavigate).toHaveBeenCalledWith("Order", { id: "early" });
  });
});
