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

describe("no form mints its key at the press", () => {
  // `idempotency_key: uuid()` written where the request is sent is a new key
  // for every press — a double-click is two records, which is exactly what the
  // key is for. Four were found after B07 was fixed: a layaway's opening
  // advance, "Bill & hand over", Take order and the storefront's checkout.
  const sources = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx"], {
    query: "?raw", import: "default", eager: true,
  }) as Record<string, string>;

  it("finds the files it is about", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(300);
  });

  it("keeps every key from the first press until the thing is saved", () => {
    const minted = Object.entries(sources)
      .filter(([, source]) => /idempotency_?[kK]ey:\s*(uuid|crypto\.randomUUID)\(\)/.test(source))
      .map(([path]) => path);

    expect(minted, "these send a new idempotency key on every press — use useOnceKey").toEqual([]);
  });
});
