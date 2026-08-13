import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import UpdatePrompt from "./UpdatePrompt";

/**
 * The "a new version is ready" strip.
 *
 * The service worker is registered with `prompt`, not `autoUpdate`, and this
 * component is the whole reason. An automatic swap replaces the running app
 * between one sale and the next, with a customer at the counter and a half-rung
 * cart on screen — and once the outbox exists, an update can change the local
 * schema while unsent sales are still queued.
 *
 * So the two things tested hardest are that it NEVER reloads on its own, and
 * that it never blocks the till.
 */

let needRefresh = false;
const setNeedRefresh = vi.fn((v: boolean) => {
  needRefresh = v;
});
const updateServiceWorker = vi.fn();

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  }),
}));

beforeEach(() => {
  needRefresh = false;
  vi.clearAllMocks();
});

describe("when there is nothing to update", () => {
  it("shows nothing at all", () => {
    const { container } = render(<UpdatePrompt />);

    expect(container).toBeEmptyDOMElement();
  });

  it("never updates on its own", () => {
    render(<UpdatePrompt />);

    expect(updateServiceWorker).not.toHaveBeenCalled();
  });
});

describe("when a new version is waiting", () => {
  beforeEach(() => {
    needRefresh = true;
  });

  it("offers it without taking it", async () => {
    render(<UpdatePrompt />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    // The critical assertion: MERELY RENDERING must never reload the app.
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });

  it("says when to do it, and that nothing is at risk either way", async () => {
    render(<UpdatePrompt />);
    const text = screen.getByRole("status").textContent ?? "";

    // A cashier needs to know it can wait, and that waiting costs nothing.
    expect(text).toMatch(/between customers/i);
    expect(text).toMatch(/nothing is lost/i);
  });

  it("updates only when somebody chooses to", async () => {
    render(<UpdatePrompt />);

    await userEvent.click(screen.getByRole("button", { name: /update now/i }));

    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("can be dismissed, and dismissing does NOT reload", async () => {
    render(<UpdatePrompt />);

    await userEvent.click(screen.getByRole("button", { name: /later/i }));

    expect(setNeedRefresh).toHaveBeenCalledWith(false);
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });

  it("is a strip, not a modal — nothing behind it is blocked", () => {
    render(
      <>
        <button type="button">Complete sale</button>
        <UpdatePrompt />
      </>,
    );

    // No dialog role, no aria-modal, and the till's own controls stay reachable.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /complete sale/i })).toBeEnabled();
  });
});
