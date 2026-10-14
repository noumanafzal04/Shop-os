import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useOnceKey } from "./onceKey";

describe("one key for one thing being recorded (pass 1, B07)", () => {
  it("is the same for every press until the thing is saved, then a new one", () => {
    const { result, rerender } = renderHook(() => useOnceKey());
    const first = result.current.key;

    rerender();
    expect(result.current.key, "a second press of the same form sent another key").toBe(first);

    act(() => result.current.renew());
    expect(result.current.key, "the next payment reused the last one's key and would be answered as it").not.toBe(first);
  });
});
