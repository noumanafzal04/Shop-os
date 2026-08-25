import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import UpdatePrompt from "./UpdatePrompt";
import { useOfflineStore } from "../offlineStore";

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

  it("says what pressing it DOES, and when not to", async () => {
    render(<UpdatePrompt />);
    const text = screen.getByRole("status").textContent ?? "";

    // The card used to say "install it between customers — nothing is lost
    // either way", which told a cashier neither what would happen nor what was
    // at stake: lost WHAT, and which two ways? The one fact worth the space is
    // that pressing it RELOADS the till, because that is the thing you must
    // not do with a customer waiting.
    //
    // Pinned as two facts rather than a sentence, so the wording can be
    // improved without a test standing in the way of it.
    expect(text, "does not say the till reloads").toMatch(/reloads?/i);
    expect(text, "does not say when to do it").toMatch(/finish the sale/i);
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

describe("when the till is holding sales", () => {
  it("says they survive the update, rather than leaving a cashier to guess", async () => {
    // The one fear a cashier has standing over a queue of unsent sales. It is
    // unfounded — the outbox is in IndexedDB and every upgrade step is
    // additive — but an unanswered fear postpones the update for a week.
    useOfflineStore.setState({ pending: 12 });
    needRefresh = true;

    render(<UpdatePrompt />);

    expect(await screen.findByText(/12 sales/)).toBeInTheDocument();
    expect(screen.getByText(/still be here afterwards/)).toBeInTheDocument();
  });

  it("says nothing extra when there is nothing owed", () => {
    useOfflineStore.setState({ pending: 0 });
    needRefresh = true;

    render(<UpdatePrompt />);

    expect(screen.queryByText(/still be here afterwards/)).toBeNull();
  });
});
