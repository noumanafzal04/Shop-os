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

  it("strips the shopos:// scheme", () => {
    resolveDeepLink("shopos://orders/xyz");
    expect(mockNavigate).toHaveBeenCalledWith("Order", { id: "xyz" });
  });

  it("routes announcements to notifications", () => {
    resolveDeepLink("announcements/n1");
    expect(mockNavigate).toHaveBeenCalledWith("Notifications", undefined);
  });

  it("routes shop/{slug} to the shop screen", () => {
    resolveDeepLink("shop/cheesy-slice");
    expect(mockNavigate).toHaveBeenCalledWith("MarketShop", { slug: "cheesy-slice" });
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
