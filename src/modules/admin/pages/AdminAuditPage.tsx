import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import PageMeta from "../../../components/common/PageMeta";
import Badge from "../../../components/ui/badge/Badge";
import Pager from "../../../components/ui/pager";
import { apiGet } from "../../../common/api/client";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import {
  DateRangeFilter,
  EMPTY_RANGE,
  FilterBar,
  FilterSelect,
  formatRange,
  type AppliedFilter,
  type DateRange,
} from "../../../components/ui/filters";

interface AuditLog {
  id: string;
  event: "created" | "updated" | "deleted";
  entity: string;
  entity_id: string;
  actor: { id: string; name: string; email: string | null } | null;
  tenant_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

const EVENT_COLOR = { created: "success", updated: "info", deleted: "error" } as const;

function Changes({ log }: { log: AuditLog }) {
  const keys = Array.from(
    new Set([...Object.keys(log.new_values ?? {}), ...Object.keys(log.old_values ?? {})]),
  ).filter((k) => !["id", "created_by", "updated_by"].includes(k));

  if (keys.length === 0) return <span className="text-theme-xs text-gray-400">—</span>;

  return (
    <div className="space-y-0.5">
      {keys.slice(0, 5).map((k) => (
        <div key={k} className="text-theme-xs">
          <span className="text-gray-500 dark:text-gray-400">{k}: </span>
          {log.event === "updated" ? (
            <span className="text-gray-700 dark:text-gray-300">
              <span className="text-error-500 line-through">{format(log.old_values?.[k])}</span>{" → "}
              <span className="text-success-600">{format(log.new_values?.[k])}</span>
            </span>
          ) : (
            <span className="text-gray-700 dark:text-gray-300">
              {format((log.new_values ?? log.old_values)?.[k])}
            </span>
          )}
        </div>
      ))}
      {keys.length > 5 && <span className="text-theme-xs text-gray-400">+{keys.length - 5} more</span>}
    </div>
  );
}

function format(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const EVENTS = [
  { value: "created", label: "Created" },
  { value: "updated", label: "Updated" },
  { value: "deleted", label: "Deleted" },
];

export default function AdminAuditPage() {
  const [event, setEvent] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<DateRange>(EMPTY_RANGE);
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 350);

  const logs = useQuery({
    queryKey: ["admin", "audit", { event, type, search: debounced, range, page }],
    queryFn: () =>
      apiGet<AuditLog[]>("/admin/audit-logs", {
        params: {
          event: event || undefined,
          type: type || undefined,
          search: debounced || undefined,
          from: range.from ?? undefined,
          to: range.to ?? undefined,
          page,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const rows = logs.data?.data ?? [];
  const pagination = logs.data?.meta.pagination;
  /**
   * The entity types the TRAIL actually holds, counted server-side.
   *
   * This list used to be three names typed in by hand — Tenant, User, Sale —
   * over a trail that records more than three. A list of guesses is worse than
   * no list: it looks like the complete set, so anything filed against a type
   * nobody remembered to add reads as a change that was never recorded.
   */
  const entities = (logs.data?.meta.entities ?? []) as Array<{ value: string; label: string }>;

  const applied: AppliedFilter[] = [
    event && {
      key: "event",
      label: "Event",
      value: EVENTS.find((e) => e.value === event)?.label ?? event,
      onRemove: () => { setEvent(""); setPage(1); },
    },
    type && {
      key: "type",
      label: "Entity",
      value: entities.find((e) => e.value === type)?.label ?? type,
      onRemove: () => { setType(""); setPage(1); },
    },
    (range.from !== null || range.to !== null) && {
      key: "range",
      label: "When",
      value: formatRange(range),
      onRemove: () => { setRange(EMPTY_RANGE); setPage(1); },
    },
  ].filter(Boolean) as AppliedFilter[];

  const clearAll = () => {
    setEvent("");
    setType("");
    setSearch("");
    setRange(EMPTY_RANGE);
    setPage(1);
  };

  return (
    <>
      <PageMeta title="Audit Log | CartZe Admin" description="Sensitive-action trail" />

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Audit Log</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Who changed what, across the platform</p>
      </div>

      <FilterBar
        search={{
          value: search,
          onChange: (value) => { setSearch(value); setPage(1); },
          placeholder: "Search who did it…",
          label: "Search by the person who made the change",
        }}
        applied={applied}
        onClearAll={clearAll}
        results={{ count: pagination?.total, noun: "entries", loading: logs.isLoading }}
      >
        {/* The one question anybody opens an audit log with, and the one it
            could not be asked: what happened on a particular day. */}
        <DateRangeFilter
          label="Any time"
          value={range}
          onChange={(next) => { setRange(next); setPage(1); }}
        />
        <FilterSelect
          label="All events"
          value={event}
          onChange={(value) => { setEvent(value); setPage(1); }}
          options={EVENTS}
        />
        <FilterSelect
          label="All entities"
          value={type}
          onChange={(value) => { setType(value); setPage(1); }}
          options={entities}
        />
      </FilterBar>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium">When</th>
                <th className="px-6 py-3 font-medium">Actor</th>
                <th className="px-6 py-3 font-medium">Event</th>
                <th className="px-6 py-3 font-medium">Entity</th>
                <th className="px-6 py-3 font-medium">Changes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {logs.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={5} className="px-6 py-4"><div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">No audit entries match.</td></tr>
              ) : (
                rows.map((log) => (
                  <tr key={log.id} className="align-top text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4 text-theme-xs whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-800 dark:text-white/90">{log.actor?.name ?? "System"}</div>
                      {log.actor?.email && <div className="text-theme-xs text-gray-400">{log.actor.email}</div>}
                    </td>
                    <td className="px-6 py-4"><Badge size="sm" color={EVENT_COLOR[log.event]}>{log.event}</Badge></td>
                    <td className="px-6 py-4">{log.entity}</td>
                    <td className="px-6 py-4"><Changes log={log} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pager pagination={pagination} onPage={setPage} noun="entries" />
      </div>
    </>
  );
}
