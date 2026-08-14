import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import StorageWarning from "./StorageWarning";
import { useOfflineStore } from "../offlineStore";
import type { StorageHealth } from "./persist";

/**
 * The warning that arrives while it can still change what somebody does.
 *
 * Its job is narrow and its silence matters as much as its speech: it appears
 * on the shift-open screen, before a day's takings start going into a browser
 * that may throw them away, and it stays quiet in every case where the shop
 * cannot act on it.
 *
 * It must never block. A shop refused its own till because Chrome would not
 * grant durable storage is a shop that cannot trade — a far worse outcome than
 * the risk being warned about.
 */

const health = (over: Partial<StorageHealth> = {}): StorageHealth => ({
  state: "persisted",
  usage: 10,
  quota: 100,
  used: 0.1,
  ...over,
});

/** Pretend the till is (or is not) installed to the home screen. */
function installed(yes: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: yes && query.includes("standalone"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  useOfflineStore.setState({ storage: null });
  // Installed by default, so each test names the case it actually cares about.
  installed(true);
});

describe("silence", () => {
  it("says nothing before the boot has answered", () => {
    const { container } = render(<StorageWarning />);

    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing when storage is durable and roomy", () => {
    useOfflineStore.setState({ storage: health() });

    const { container } = render(<StorageWarning />);

    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing on a browser that cannot report, once the till is installed", () => {
    // Safari never reports. Installed, there is nothing further to do about it,
    // and noise is what teaches people to dismiss the message that matters.
    installed(true);
    useOfflineStore.setState({ storage: health({ state: "unsupported" }) });

    const { container } = render(<StorageWarning />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("speech", () => {
  it("asks an uninstalled iPad to add itself to the home screen", () => {
    // Safari has no persist() at all, so this is every iPad — the platform
    // where the till is blindest, and the one where installing genuinely
    // changes how long its data survives.
    installed(false);
    useOfflineStore.setState({ storage: health({ state: "unsupported" }) });

    render(<StorageWarning />);

    expect(screen.getByRole("status").textContent).toMatch(/home screen/i);
  });

  it("warns when the browser has not promised to keep unsent sales", () => {
    useOfflineStore.setState({ storage: health({ state: "not-persisted" }) });

    render(<StorageWarning />);

    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/permanent storage/i);
    // It has to name the stake and the remedy, or it is decoration.
    expect(text).toMatch(/haven't reached the server/i);
    expect(text).toMatch(/home screen/i);
  });

  it("warns when the device is nearly full", () => {
    useOfflineStore.setState({ storage: health({ used: 0.95 }) });

    render(<StorageWarning />);

    expect(screen.getByRole("status").textContent).toMatch(/almost out of storage/i);
  });
});

describe("it warns, it never blocks", () => {
  it("leaves everything around it usable", () => {
    useOfflineStore.setState({ storage: health({ state: "not-persisted" }) });

    render(
      <>
        <StorageWarning />
        <button type="button">Open shift</button>
      </>,
    );

    // No dialog, nothing disabled. The decision belongs to whoever owns the
    // money, not to the browser's storage policy.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /open shift/i })).toBeEnabled();
  });
});
