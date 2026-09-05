import { MutationCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "../types/api";
import { toast } from "../ui/toast";

/**
 * What the app does when a request fails.
 *
 * ── Why the mutation handler is here and not on each mutation ──────────
 *
 * Eleven mutations had no `onError` between them. Toggling a favourite, saving
 * an address, cancelling an order — all of them failed in silence. A person
 * taps, nothing happens, and the only thing the app has told them is that their
 * tap did not register, so they tap again.
 *
 * Eleven hand-written handlers would have been eleven chances to forget the
 * twelfth. This is one place, and a new mutation is covered the day it is
 * written.
 *
 * A mutation whose screen reports failure ITSELF — a sign-in form with an error
 * box under the password field — opts out with `meta: { silent: true }`, or the
 * person gets told twice in two different shapes.
 */

/** What to put in front of somebody, given whatever the layer below threw. */
function messageFor(error: unknown): { message: string; detail?: string } {
  if (error instanceof ApiError) {
    // A validation failure names the field that is wrong; that sentence is
    // more useful than anything this function could invent.
    const field = error.firstFieldError();
    if (field) return { message: field };

    // 5xx bodies are for logs. "SQLSTATE[42S02]" is not a thing to hand a
    // customer, and it is not something they can act on.
    if (error.status >= 500) {
      return {
        message: "Something went wrong at our end",
        detail: "Please try again in a moment.",
      };
    }

    if (error.status === 0) {
      return { message: "No connection", detail: "Check your internet and try again." };
    }

    return { message: error.message };
  }

  return { message: "Something went wrong", detail: "Please try again." };
}

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.silent) return;

      const { message, detail } = messageFor(error);
      toast.error(message, { detail });
    },
  }),

  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Never retry client errors (401/403/404/422) — only network/5xx.
        if (error instanceof ApiError && error.status > 0 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false, // no auto-retried mutations → no accidental duplicates
    },
  },
});
