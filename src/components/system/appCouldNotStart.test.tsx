import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AppCouldNotStart, reloadOnceForAFreshCopy } from "./AppCouldNotStart";

/**
 * NO WHITE PAGE — the live "blank page" family. A crash outside any layout,
 * or a deploy that took away the file a tab still asked for, left a white
 * page with nothing to press.
 */
function Throws({ message }: { message: string }): never {
  throw new Error(message);
}

describe("a crash nothing else caught", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("says so, with a Reload button, instead of a white page", () => {
    const reload = vi.fn();
    render(<AppCouldNotStart reload={reload}><Throws message="Cannot read properties of undefined" /></AppCouldNotStart>);

    expect(screen.getByRole("alert")).toHaveTextContent("could not open this page");
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a file the last deploy took away mends itself with one reload", () => {
    const reload = vi.fn();
    render(<AppCouldNotStart reload={reload}><Throws message="Failed to fetch dynamically imported module: /assets/PosPage-abc.js" /></AppCouldNotStart>);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("was updated");
  });

  it("reloads at most once in five minutes, and never offline", () => {
    const reload = vi.fn();
    expect(reloadOnceForAFreshCopy(reload, 1_000_000)).toBe(true);
    expect(reloadOnceForAFreshCopy(reload, 1_000_000 + 60_000)).toBe(false);
    expect(reloadOnceForAFreshCopy(reload, 1_000_000 + 6 * 60_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);

    window.sessionStorage.clear();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(reloadOnceForAFreshCopy(reload, 9_000_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("wraps the whole app, and a failed preload is mended the same way", () => {
    const main = readFileSync(resolve(__dirname, "../../main.tsx"), "utf8");

    expect(main).toMatch(/<StrictMode>\s*<AppCouldNotStart>\s*<QueryClientProvider/);
    expect(main).toMatch(/window\.addEventListener\("vite:preloadError", \(event\) => \{\s*if \(reloadOnceForAFreshCopy\(\)\) event\.preventDefault\(\);/);
  });
});
