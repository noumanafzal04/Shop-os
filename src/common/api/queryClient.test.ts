import { describe, expect, it } from "vitest";

import { queryClient } from "./queryClient";
import { ApiError } from "../types/api";
import { useConnectionStore } from "../../stores/connectionStore";

/**
 * The till must be allowed to try.
 *
 * TanStack Query's default `networkMode: "online"` PAUSES every query and
 * mutation while `navigator.onLine` is false — it does not fail them, it never
 * calls them. On a POS built around an outbox that is not a default, it is a
 * silent veto over the entire offline capability: Complete said "Processing…"
 * for ever and the sale went through the moment the wifi returned, because the
 * mutation had never started.
 *
 * This is a one-line setting that no screen would show as missing, so it is
 * pinned here.
 */
describe("offline work is allowed to run", () => {
  it("never pauses a mutation because the browser thinks it is offline", () => {
    // The sale, the shift, the drawer count. Every one is a mutation, and a
    // paused one is a cashier watching a spinner with a customer waiting.
    expect(queryClient.getDefaultOptions().mutations?.networkMode).toBe("always");
  });

  it("never pauses a query either", () => {
    // Quieter, and it was hiding a fix that tested green: a paused query never
    // calls its `queryFn`, so the till could not fall back to the shift it
    // remembers.
    expect(queryClient.getDefaultOptions().queries?.networkMode).toBe("always");
  });

  it("still refuses to auto-retry a mutation", () => {
    // Unchanged and load-bearing: a retried sale is a double submit.
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });
});

describe("a call to a server the app knows is gone is not tried again (#OF5)", () => {
  const retry = queryClient.getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
  const silence = new ApiError("You're offline", 0, "NETWORK");

  it("is not retried once the app has seen the line is down", () => {
    useConnectionStore.getState().setOnline(false);
    expect(retry(0, silence), "an offline till retried a call that cannot reach anything").toBe(false);
  });

  it("is still retried while the app believes it is online — the failure is how it learns", () => {
    useConnectionStore.getState().setOnline(true);
    expect(retry(0, silence)).toBe(true);
    expect(retry(2, silence)).toBe(false);
  });

  it("a broken server is retried, a refusal never is", () => {
    useConnectionStore.getState().setOnline(true);
    expect(retry(0, new ApiError("Server error", 500))).toBe(true);
    expect(retry(0, new ApiError("Nope", 422))).toBe(false);
  });
});
