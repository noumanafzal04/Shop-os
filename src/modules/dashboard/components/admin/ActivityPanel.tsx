import { TimeIcon } from "../../../../icons";
import type { ActivityRow } from "../../types";
import { Panel, PanelEmpty, Pulse } from "./Panel";
import { dateTime, humanize } from "./format";

interface Props {
  activity?: ActivityRow[];
  loading?: boolean;
}

/** The platform feed writes `action`/`subject`; the tenant feed `event`/`entity`. */
function verb(row: ActivityRow): string {
  return (row.action ?? row.event ?? "").replace(/[_-]+/g, " ").trim();
}

function subject(row: ActivityRow): string {
  return row.subject ?? row.entity ?? "";
}

/** Marker colour follows the event itself, and the word beside it says the same. */
function marker(row: ActivityRow): string {
  const v = verb(row).toLowerCase();
  if (v.includes("creat")) return "border-success-500 bg-success-50 dark:bg-success-500/20";
  if (v.includes("delet")) return "border-error-500 bg-error-50 dark:bg-error-500/20";
  if (v.includes("updat")) return "border-brand-500 bg-brand-50 dark:bg-brand-500/20";

  return "border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-white/[0.06]";
}

export function ActivityPanel({ activity, loading = false }: Props) {
  return (
    <Panel
      title="Recent Activity"
      subtitle="Across every tenant"
      icon={<TimeIcon className="size-5" />}
      action={{ label: "View All", to: "/admin/audit-logs" }}
    >
      {loading || !activity ? (
        <div className="space-y-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Pulse className="mt-1 h-3.5 w-3.5 rounded-full" />
              <div className="flex-1 space-y-2">
                <Pulse className="h-3.5 w-3/4" />
                <Pulse className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : activity.length === 0 ? (
        <PanelEmpty>Nothing has happened on the platform yet.</PanelEmpty>
      ) : (
        <div className="relative">
          {/* The connecting line sits behind the markers. */}
          <span
            aria-hidden="true"
            className="absolute bottom-3 left-[7px] top-3 w-px bg-gradient-to-b from-gray-200 via-gray-200 to-transparent dark:from-gray-700 dark:via-gray-800 dark:to-transparent"
          />
          <ol>
            {activity.map((row) => (
              <li key={row.id} className="relative flex gap-3 pb-5 last:pb-0">
                <span
                  className={`relative z-10 mt-0.5 size-4 shrink-0 rounded-full border-2 ${marker(row)}`}
                />
                <div className="min-w-0">
                  <p className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <span className="font-medium text-gray-800 dark:text-white/90">
                      {row.actor}
                    </span>
                    {verb(row) && <> {verb(row)}</>}
                    {subject(row) && (
                      <>
                        {" "}
                        <span className="text-gray-800 dark:text-white/90">
                          {humanize(subject(row))}
                        </span>
                      </>
                    )}
                  </p>
                  <p className="mt-0.5 text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">
                    {dateTime(row.at)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}
