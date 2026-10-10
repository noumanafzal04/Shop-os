/**
 * "This did not load" — said out loud, with a way to ask again.
 *
 * The sibling of <NoAccess>. That one is for a list the person may not see;
 * this is for a list that failed to arrive. Neither is "there is nothing
 * here", and a screen that draws its empty state for all three is telling a
 * cashier the shop has no products because one request went wrong.
 *
 * A query that failed on a client error is not retried and nothing refetches
 * it on its own (see queryClient), so without the button the only way out was
 * to reload the till — and a cashier does not know that.
 */
export function CouldNotLoad({
  what,
  why,
  onRetry,
  busy = false,
}: {
  /** What was being fetched, lower case: "the product list". */
  what: string;
  /** What went wrong, in the server's words when it gave any. */
  why?: string | null;
  onRetry: () => void;
  busy?: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-warning-300 bg-warning-50 px-6 py-8 text-center dark:border-warning-500/40 dark:bg-warning-500/10"
    >
      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
        {what.charAt(0).toUpperCase() + what.slice(1)} could not be loaded.
      </p>
      {why && <p className="max-w-sm text-xs text-gray-600 dark:text-gray-300">{why}</p>}
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="mt-1 min-h-11 rounded-lg bg-brand-500 px-4 py-2 text-theme-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
      >
        {busy ? "Trying…" : "Try again"}
      </button>
    </div>
  );
}
