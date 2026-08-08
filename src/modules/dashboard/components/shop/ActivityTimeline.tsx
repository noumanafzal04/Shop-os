import { TimeIcon } from "../../../../icons";
import type { ActivityRow } from "../../types";
import { formatDateTime, humanizeEntity } from "./format";
import { EmptyPanel, SectionCard } from "./SectionCard";

/** Audit events are created/updated/deleted; the marker colour carries the verb. */
const MARKER: Record<string, string> = {
  created: "border-success-500 bg-success-50 dark:bg-success-500/20",
  updated: "border-brand-500 bg-brand-50 dark:bg-brand-500/20",
  deleted: "border-error-500 bg-error-50 dark:bg-error-500/20",
};

function describe(row: ActivityRow): string {
  const verb = row.event ?? row.action ?? "changed";
  const entity = humanizeEntity(row.entity ?? row.subject);

  return `${verb} a ${entity}`;
}

export function ActivityTimeline({ rows }: { rows: ActivityRow[] }) {
  return (
    <SectionCard
      title="Recent activity"
      subtitle="Who changed what, latest first"
      icon={<TimeIcon className="size-5" />}
    >
      {rows.length === 0 ? (
        <EmptyPanel
          message="Nothing has happened in this shop yet."
          hint="Every sale, edit and deletion lands here as it is made."
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
              <p className="text-theme-sm text-gray-800 dark:text-white/90">
                <span className="font-medium">{row.actor}</span>{" "}
                <span className="text-gray-600 dark:text-gray-300">{describe(row)}</span>
              </p>
              <p className="mt-0.5 text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">
                {formatDateTime(row.at)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
