import { TimeIcon } from "../../../../icons";
import type { ActivityRow } from "../../types";
import { eventWord, thingCalled } from "../../../activity/words";
import { formatDateTime } from "./format";
import { EmptyPanel, SectionCard } from "./SectionCard";

/** Audit events are created/updated/deleted; the marker colour carries the verb. */
const MARKER: Record<string, string> = {
  created: "border-success-500 bg-success-50 dark:bg-success-500/20",
  updated: "border-brand-500 bg-brand-50 dark:bg-brand-500/20",
  deleted: "border-error-500 bg-error-50 dark:bg-error-500/20",
};

/**
 * "Staff member · added" — the Activity page's own words, in its own order.
 *
 * This card used to make a sentence out of the trail's raw model name and
 * verb: "updated a tenant", "created a user". See activity/words.
 */
function describe(row: ActivityRow, noun: "shop" | "business"): string {
  return `${thingCalled(row.entity ?? row.subject, noun)} · ${eventWord(row.event ?? row.action)}`;
}

export function ActivityTimeline({ rows, noun = "shop" }: { rows: ActivityRow[]; noun?: "shop" | "business" }) {
  return (
    <SectionCard
      title="Recent activity"
      subtitle="Who changed what, latest first"
      icon={<TimeIcon className="size-5" />}
    >
      {rows.length === 0 ? (
        <EmptyPanel
          message={`Nothing has happened in this ${noun} yet.`}
          hint={noun === "shop" ? "Every sale, edit and deletion lands here as it is made." : "Every entry, edit and deletion lands here as it is made."}
        />
      ) : (
        <ol className="relative space-y-4 pl-7">
          {/* One line behind every marker; the last row's stub is masked by the
              list's own end so the line never dangles past the final entry. */}
          <span className="absolute bottom-3 left-[7px] top-3 w-px bg-gradient-to-b from-gray-200 via-gray-200 to-transparent dark:from-gray-700 dark:via-gray-800 dark:to-transparent" />
          {rows.map((row) => (
            <li key={row.id} className="relative">
              <span
                className={`absolute -left-7 top-0.5 size-4 rounded-full border-2 ${
                  MARKER[row.event ?? row.action ?? ""] ??
                  "border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-white/[0.06]"
                }`}
              />
              <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{describe(row, noun)}</p>
              <p className="mt-0.5 text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">
                {row.actor} · {formatDateTime(row.at)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
