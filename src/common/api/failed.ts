import { ApiError } from "../types/api";

/** The half of `useToast()` this needs. Narrow on purpose — nothing here draws. */
interface CanComplain {
  error: (message: string) => void;
}

/**
 * A SAVE THAT FAILS HAS TO SAY SO.
 *
 * Measured across the panel: of 220 places that call `.mutate()`, **66 handled
 * failure nowhere at all** — not on the call, not on the declaration, not by
 * rendering `.error`. They pass an `onSuccess` that shows a toast and nothing
 * for the other outcome, so a save that fails looks exactly like one that
 * worked: the toast simply never appears, and the shopkeeper walks away
 * believing it saved.
 *
 * `TaxGroupsManager` was the sharpest of them. It said "Tax group saved" on
 * success and had no error path anywhere in the file — so a shop changing its
 * GST rate could be told nothing at all and go on selling at the old one.
 *
 * ── Why this is not a global handler ────────────────────────────────────
 *
 * React Query runs three error callbacks in order: the cache's, the mutation's,
 * then the one passed to `mutate()` itself. The cache's runs FIRST and the
 * per-call one lives in a private field on the observer, so a global handler
 * cannot tell whether anything after it will report — and 102 of these call
 * sites already do. A global toast would double up on every one of them.
 *
 * So the handler is local, and this is the one sentence of it worth sharing:
 * prefer the server's own field error, fall back to its message, and only then
 * to the caller's own words.
 *
 * @param say      the toast API — `useToast()`
 * @param fallback what to say when the server said nothing useful
 */
export function failed(say: CanComplain, fallback: string): { onError: (e: unknown) => void } {
  return {
    onError: (e: unknown) => {
      const named = e instanceof ApiError ? e.firstFieldError() ?? e.message : null;
      say.error(named && named.trim() !== "" ? named : fallback);
    },
  };
}
