import type { ActivityRow } from "../../types";
import { formatDateTime, humanizeEntity } from "./format";
import { EmptyPanel, SectionCard } from "./SectionCard";

/** Audit events are created/updated/deleted; the ring colour carries the verb. */
const RING: Record<string, string> = {
  created: "border-success-500",
  updated: "border-brand-500",
  deleted: "border-error-500",
};

function describe(row: ActivityRow): string {
  const verb = row.event ?? row.action ?? "changed";
  const entity = humanizeEntity(row.entity ?? row.subject);

  return `${verb} a ${entity}`;
}

export function ActivityTimeline({ rows }: { rows: ActivityRow[] }) {
  return (
    <SectionCard title="Recent activity" subtitle="Who changed what, latest first">
      {rows.length === 0 ? (
        <EmptyPanel message="Nothing has happened in this shop yet." />
      ) : (
        <ol className="relative space-y-5 pl-6">
          {/* One line behind every marker; the last row's stub is masked by the
              list's own end so the line never dangles past the final entry. */}
          <span className="absolute bottom-3 left-[5px] top-3 w-px bg-gray-200 dark:bg-gray-800" />
          {rows.map((row) => (
            <li key={row.id} className="relative">
              <span
                className={`absolute -left-6 top-1 size-2.5 rounded-full border-2 bg-white dark:bg-gray-900 ${
                  RING[row.event ?? row.action ?? ""] ?? "border-gray-300 dark:border-gray-600"
                }`}
              />
              <p className="text-theme-sm text-gray-800 dark:text-white/90">
                <span className="font-medium">{row.actor}</span>{" "}
                <span className="text-gray-500 dark:text-gray-400">{describe(row)}</span>
              </p>
              <p className="mt-0.5 text-theme-xs text-gray-400 dark:text-gray-500">
                {formatDateTime(row.at)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
