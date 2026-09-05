import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";
import { usePullToRefresh } from "../src/common/hooks/usePullToRefresh";

/**
 * The spinner is feedback for a gesture, and only for a gesture.
 *
 * Six screens bound it to React Query's `isRefetching`, which is true for any
 * refetch at all — a screen regaining focus, a query whose parameters changed,
 * the home feed re-asking once the phone worked out where it was. The spinner
 * appeared with nobody pulling, and on a scrolled list it appeared over a card
 * in the middle of the screen, which reads as a fault.
 */

/**
 * A probe rather than a testing-library `renderHook`: that package is not a
 * dependency here, and a hook this small does not justify adding one.
 */
function probe(refetch: () => Promise<unknown>) {
  const seen: { refreshing: boolean; onRefresh: () => void }[] = [];

  function Probe() {
    seen.push(usePullToRefresh(refetch));
    return null;
  }

  return { seen, Probe };
}

const latest = <T,>(a: T[]) => a[a.length - 1];

describe("usePullToRefresh", () => {
  it("is not spinning until somebody pulls", async () => {
    const { seen, Probe } = probe(() => Promise.resolve());

    await ReactTestRenderer.act(() => {
      ReactTestRenderer.create(<Probe />);
    });

    expect(latest(seen).refreshing).toBe(false);
  });

  it("spins for the pull, and stops when the data lands", async () => {
    let settle!: () => void;
    const refetch = jest.fn(() => new Promise<void>((r) => (settle = r)));
    const { seen, Probe } = probe(refetch);

    await ReactTestRenderer.act(() => {
      ReactTestRenderer.create(<Probe />);
    });

    await ReactTestRenderer.act(async () => {
      latest(seen).onRefresh();
    });
    expect(latest(seen).refreshing).toBe(true);
    expect(refetch).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      settle();
    });
    expect(latest(seen).refreshing).toBe(false);
  });

  it("stops spinning when the refetch fails", async () => {
    // A spinner left turning is the app claiming to still be trying. The
    // failure belongs to the screen's error state, not to the gesture.
    const { seen, Probe } = probe(() => Promise.reject(new Error("offline")));

    await ReactTestRenderer.act(() => {
      ReactTestRenderer.create(<Probe />);
    });

    await ReactTestRenderer.act(async () => {
      latest(seen).onRefresh();
      // Let the rejection and its handlers settle before asking.
      await Promise.resolve();
    });

    expect(latest(seen).refreshing).toBe(false);
  });
});

describe("no screen shows the spinner for a refetch nobody asked for", () => {
  it("has no RefreshControl bound to isRefetching", () => {
    const files = sourceFiles(path.join(PROJECT_ROOT, "src"));
    expect(files.length).toBeGreaterThan(30);

    const offenders = files
      .flatMap((f) =>
        fs
          .readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /refreshing=\{[\w.]*\.isRefetching\}/.test(line))
          .map(([n, line]) => `  ${path.relative(PROJECT_ROOT, f)}:${n}  ${line.trim()}`),
      );

    expect(offenders.join("\n")).toBe("");
  });
});
