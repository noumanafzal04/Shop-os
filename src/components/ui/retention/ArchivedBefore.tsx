import { Link } from "react-router";

import type { RetentionNotice } from "../../../common/types/api";

/**
 * WHY THIS LIST STOPS WHERE IT STOPS.
 *
 * A plan sells a window of online history. When a shopkeeper scrolls to the
 * bottom of two years and finds nothing older, there are exactly two things
 * they can conclude, and only one of them is true:
 *
 *   "my plan keeps two years"        — correct, and a sales conversation
 *   "my records have been deleted"   — wrong, and a support call, a bad
 *                                      review and quite possibly a refund
 *
 * Nothing on the screen distinguishes those two readings. This line does, and
 * it is the entire reason the window could be enforced at all.
 *
 * ── Why it shows even when nothing was cut off ──────────────────────────
 *
 * A notice that appears for the first time at the moment history runs out
 * arrives too late to be information. Shown quietly all the time, it is a
 * fact about the plan; shown only at the wall, it is an error message.
 *
 * `reached` — this request actually asked for something older — is what
 * changes the volume, not whether the line exists.
 */
export function ArchivedBefore({ notice, what = "Records" }: {
  notice: RetentionNotice | undefined;
  /** What this particular list is made of: "Sales", "Bills", "Entries". */
  what?: string;
}) {
  if (notice === undefined) return null;

  const from = new Date(notice.from).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
  const years = notice.months % 12 === 0 ? notice.months / 12 : null;
  const window = years !== null ? `${years} year${years === 1 ? "" : "s"}` : `${notice.months} months`;

  if (!notice.reached) {
    return (
      <p className="text-theme-xs text-gray-400">
        {what} from {from} onwards. Your plan keeps {window} online.
      </p>
    );
  }

  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 text-theme-xs dark:bg-white/[0.04]">
      <p className="font-medium text-gray-700 dark:text-gray-200">
        You asked for older than {from}.
      </p>
      {/* THE SENTENCE THAT PREVENTS THE PHONE CALL. Said plainly, in the
          first line they will read, and not softened into "archived" alone —
          "archived" is a word a worried shopkeeper reads as "gone". */}
      <p className="mt-0.5 text-gray-500 dark:text-gray-400">
        Your plan keeps {window} online. Nothing has been deleted — the older records are archived and come
        straight back if you move up a plan.{" "}
        <Link to="/tenant/subscription" className="font-medium text-brand-500 hover:underline">
          See your plan
        </Link>
      </p>
    </div>
  );
}
