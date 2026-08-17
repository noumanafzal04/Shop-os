import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

import InstallPrompt from "./InstallPrompt";

/**
 * The offer to put the till on the home screen.
 *
 * An installed till opens from an icon, fills the screen, and keeps its own
 * service worker and storage — which is the whole difference between a shop
 * that sells through a dropped line and one that does not. A shop running the
 * counter from a browser tab is one accidental close away from hunting for a
 * URL with a customer waiting.
 *
 * The load-bearing case is **Safari**, because it fires no event at all: an
 * iPad can only be installed by a person tapping Share → Add to Home Screen.
 * A counter tablet is very often an iPad, so the device the shop most wants
 * this on is the one no code can ask — and a component that only handled the
 * Chromium path would be silent on exactly the hardware it was written for.
 */

const DISMISSED = "shopos-install-dismissed";

/** The Chromium event, which the DOM lib does not describe. */
const installEvent = () => {
  const e = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  };
  e.prompt = vi.fn().mockResolvedValue(undefined);
  e.userChoice = Promise.resolve({ outcome: "accepted" as const });

  return e;
};

const show = (path = "/tenant") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <InstallPrompt />
    </MemoryRouter>,
  );

/**
 * Pretend to be an iPad, standing on its head about it exactly as iPadOS does.
 *
 * `defineProperty` rather than `vi.spyOn`: jsdom's navigator has no
 * `maxTouchPoints` at all, and you cannot spy on a getter that does not exist.
 * Which is itself the point — the property this detection turns on is one a
 * test environment does not hand you by default.
 */
const setNavigator = (platform: string, touchPoints: number) => {
  Object.defineProperty(navigator, "platform", { value: platform, configurable: true });
  Object.defineProperty(navigator, "maxTouchPoints", { value: touchPoints, configurable: true });
};

const beAnIpad = () => setNavigator("MacIntel", 5);

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  // jsdom answers `false` to every media query by default, which is what we
  // want: not installed. A plain desktop otherwise.
  setNavigator("Win32", 0);
});

describe("a browser that hands over the event", () => {
  it("says nothing until it does", () => {
    show();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("takes the browser's banner away and offers its own", async () => {
    show();
    const e = installEvent();
    const prevented = vi.spyOn(e, "preventDefault");

    window.dispatchEvent(e);

    // Refusing Chrome's own banner is the point of catching it: it appears
    // whenever Chrome feels like it, says nothing about why a shop would want
    // this, and cannot be brought back once dismissed.
    expect(prevented).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /install/i })).toBeInTheDocument();
  });

  it("says what installing is FOR, not that it is possible", async () => {
    show();
    window.dispatchEvent(installEvent());

    const text = (await screen.findByRole("status")).textContent ?? "";

    expect(text).toMatch(/opens from an icon/i);
    expect(text).toMatch(/when the line drops/i);
  });

  it("asks only when somebody presses it", async () => {
    show();
    const e = installEvent();
    window.dispatchEvent(e);

    expect(e.prompt).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole("button", { name: /install/i }));

    expect(e.prompt).toHaveBeenCalled();
  });

  it("stops offering once the app is installed", async () => {
    show();
    window.dispatchEvent(installEvent());
    await userEvent.click(await screen.findByRole("button", { name: /install/i }));

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});

describe("an iPad, which is told nothing by Safari", () => {
  it("is recognised even though iPadOS claims to be a Mac", async () => {
    // Not paranoia: iPadOS 13+ reports `MacIntel`. A plain user-agent check
    // misses precisely the device this feature exists for.
    beAnIpad();

    show();

    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("says where to tap, because no code can start the sheet", async () => {
    beAnIpad();

    show();
    const text = (await screen.findByRole("status")).textContent ?? "";

    expect(text).toMatch(/Share/);
    expect(text).toMatch(/Add to Home Screen/i);
  });

  it("offers no Install button it could not honour", async () => {
    beAnIpad();

    show();
    await screen.findByRole("status");

    // A button that cannot work is worse than a sentence that explains.
    expect(screen.queryByRole("button", { name: /^install$/i })).toBeNull();
  });
});

describe("a desktop browser with no install path", () => {
  it("is left alone", () => {
    show();

    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("not on the till", () => {
  it("never appears over the POS", async () => {
    // The POS is full-bleed with its action bar along the bottom edge, which
    // is exactly where this strip lives — and nobody installs an app with a
    // customer at the counter.
    beAnIpad();

    show("/tenant/pos");

    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("dismissing", () => {
  it("is remembered, so it does not return every morning", async () => {
    beAnIpad();
    show();

    await userEvent.click(await screen.findByRole("button", { name: /not now/i }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(localStorage.getItem(DISMISSED)).toBe("1");
  });

  it("keeps a device that already said no quiet on the next load", () => {
    localStorage.setItem(DISMISSED, "1");
    beAnIpad();

    show();

    expect(screen.queryByRole("status")).toBeNull();
  });
});
