import { Link } from "react-router";

/** Why this counter screen will not take money yet, and where to fix it. */
export function ShiftNeeded({ why }: { why: string | null }) {
  if (why === null) return null;

  return (
    <div data-testid="shift-needed" role="alert" className="rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-theme-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
      {why}{" "}
      <Link to="/tenant/pos" className="font-semibold underline">Open the till</Link>
    </div>
  );
}

/** Cash about to be taken with no drawer open — allowed, and said (#SV1). */
export function NoDrawerNote({ note }: { note: string | null }) {
  if (note === null) return null;

  return (
    <div data-testid="no-drawer-note" className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-theme-sm text-warning-800 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
      {note}{" "}
      <Link to="/tenant/pos" className="font-semibold underline">Open the till</Link>
    </div>
  );
}
