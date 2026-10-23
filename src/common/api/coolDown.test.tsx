import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ApiError } from "../types/api";
import { useCoolDown } from "./coolDown";

/** Next rounds #31: Complete was pressable at once after a 429 that said wait 30 s. */
describe("a throttled write waits the time it was given", () => {
  it("counts the server's seconds down to nought, and nothing else waits", () => {
    vi.useFakeTimers();
    const throttled = new ApiError("Too many tries…", 429, "TOO_MANY_ATTEMPTS", {}, { retry_after: 3 });
    const { result, rerender } = renderHook(({ error }) => useCoolDown(error), { initialProps: { error: throttled as unknown } });

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(3);
    act(() => void vi.advanceTimersByTime(2000));
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(0);

    rerender({ error: new ApiError("Server broke", 500) });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(0);
    vi.useRealTimers();
  });
});
