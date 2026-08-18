import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../types/api";

/**
 * ── `networkMode: "always"` is the most important line in this file ──────
 *
 * TanStack Query's default is `networkMode: "online"`, which means:
 *
 *     canFetch = navigator.onLine
 *
 * and anything that cannot fetch is **PAUSED** — not failed, not run, paused,
 * indefinitely, until the browser reports a connection again.
 *
 * On this product that is not a nicety, it is the whole offline capability. A
 * cashier with no line pressed Complete and the button said **"Processing…"
 * for ever**, because the mutation was never called at all. The moment the wifi
 * came back the sale went through — which reads like a slow server and is
 * actually a mutation that had not started. The outbox, the pricing mirror, the
 * refusals worded for the counter: every one of them lives inside a mutation or
 * a query, and none of them was ever reached with the line down.
 *
 * The same trap on the read side, and quieter: a paused query never calls its
 * `queryFn`, so `useCurrentSession` could not fall back to the shift this
 * device remembers. It was tested, it was correct, and offline it did not run.
 *
 * `"always"` hands the decision back to code that knows what offline means
 * here. This app has its own connection model — `connectionStore`, driven by
 * real traffic rather than by `navigator.onLine`, because a till on a shop
 * router with a dead uplink is "online" by the browser's reckoning and can
 * reach nothing. A request that fails then is USEFUL: it marks the server
 * unreachable, and the offline path takes over with a reason a person can act
 * on. A request that never happens teaches nobody anything.
 *
 * The cost is real and much smaller: while offline, requests are attempted and
 * fail instead of waiting. That is the correct trade for a till.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      networkMode: "always",
      retry: (failureCount, error) => {
        // Never retry client errors (401/403/404/422) — only network/5xx.
        if (error instanceof ApiError && error.status > 0 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      networkMode: "always",
      retry: false, // mutations are never auto-retried (no duplicate submits)
    },
  },
});
