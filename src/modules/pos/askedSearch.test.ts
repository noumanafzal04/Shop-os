import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEARCH_SETTLES_MS, useAskedSearch } from "./askedSearch";

/**
 * #POS1 — on the 50k garments shop one scan sent thirteen product searches
 * (`7`, `79`, `798` …) ahead of its own lookup, and the line reached the cart
 * 1.2–4.6 s later. The list is asked once the box is still; a scan, which
 * empties the box on Enter, asks it nothing.
 */
describe("the till's list asks once the box is still", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a scan — thirteen digits 6 ms apart, then Enter empties the box — asks the list nothing", () => {
    const { result, rerender } = renderHook(({ box }) => useAskedSearch(box), { initialProps: { box: "" } });
    const asked = new Set<string>([result.current.asked]);
    let box = "";
    for (const digit of "7980000000091") {
      box += digit;
      rerender({ box });
      act(() => { vi.advanceTimersByTime(6); });
      asked.add(result.current.asked);
    }
    rerender({ box: "" }); // Enter: the till empties the box and looks the code up itself
    act(() => { vi.advanceTimersByTime(SEARCH_SETTLES_MS * 4); });
    asked.add(result.current.asked);

    expect([...asked]).toEqual([""]);
  });

  it("a person typing a name is asked about once they stop, and not before", () => {
    const { result, rerender } = renderHook(({ box }) => useAskedSearch(box), { initialProps: { box: "" } });
    rerender({ box: "Pash" });
    act(() => { vi.advanceTimersByTime(SEARCH_SETTLES_MS - 10); });
    expect(result.current).toEqual({ asked: "", settled: false });

    act(() => { vi.advanceTimersByTime(10); });
    expect(result.current).toEqual({ asked: "Pash", settled: true });
  });
});

describe("the till uses it where it matters", () => {
  const till = readFileSync(resolve(__dirname, "pages/PosPage.tsx"), "utf8");

  it("the server is asked for the settled words, not the box", () => {
    expect(till).toMatch(/useProducts\(\{ search: askedSearch \|\| undefined/);
    expect(till).not.toMatch(/useProducts\(\{ search: search \|\| undefined/);
  });

  it("Enter waits while the box holds words the list has not been asked about", () => {
    expect(till).toMatch(/: !searchSettled \|\| products\.isPlaceholderData \|\| products\.isFetching\s*\n\s*\? null/);
  });
});
