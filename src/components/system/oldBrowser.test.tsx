import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import OldBrowserNotice, { browserCanPaintThisApp } from "./OldBrowserNotice";

/**
 * The notice has one job and one failure mode, and they are opposites:
 *
 *   - a browser that CAN paint this app must never see it (it would be a
 *     permanent scare banner on every screen in the shop);
 *   - a browser that cannot must see it, because the alternative is a page
 *     that looks broken and explains nothing.
 *
 * jsdom has no real CSS engine, so `CSS.supports` is stubbed here rather than
 * trusted. That is the honest way round: the question is what the component
 * does WITH the answer, not what jsdom's answer happens to be.
 */
function supports(answer: boolean) {
  vi.stubGlobal("CSS", { supports: () => answer });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("the old-browser notice", () => {
  it("says nothing on a browser that can paint this app", () => {
    supports(true);
    expect(browserCanPaintThisApp()).toBe(true);

    render(<OldBrowserNotice />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("speaks up on a browser that cannot, and names the version to update to", () => {
    supports(false);
    expect(browserCanPaintThisApp()).toBe(false);

    render(<OldBrowserNotice />);
    const notice = screen.getByRole("status");

    // Not "unsupported browser". A shop needs to know what to DO.
    expect(notice.textContent).toMatch(/16\.4/);
    expect(notice.textContent).toMatch(/nothing is at risk/i);
  });

  it("treats a browser with no CSS.supports at all as one that cannot", () => {
    vi.stubGlobal("CSS", undefined);
    expect(browserCanPaintThisApp()).toBe(false);
  });

  it("stays dismissed", () => {
    supports(false);
    localStorage.setItem("cartze-old-browser-dismissed", "1");

    render(<OldBrowserNotice />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
