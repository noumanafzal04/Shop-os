import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Select from "../../../components/form/Select";
import { apiGet } from "../../../common/api/client";

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

export default function AdminAuditPage() {
  const [event, setEvent] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);

  const logs = useQuery({
    queryKey: ["admin", "audit", { event, type, page }],
    queryFn: () =>
      apiGet<AuditLog[]>("/admin/audit-logs", {
        params: { event: event || undefined, type: type || undefined, page },
      }),
    placeholderData: keepPreviousData,
  });

  const rows = logs.data?.data ?? [];
  const pagination = logs.data?.meta.pagination;

  return (
    <>
      <PageMeta title="Audit Log | ShopOS Admin" description="Sensitive-action trail" />

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Audit Log</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Who changed what, across the platform</p>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select
          options={[
            { value: "", label: "All events" },
            { value: "created", label: "Created" },
            { value: "updated", label: "Updated" },
            { value: "deleted", label: "Deleted" },
          ]}
          placeholder="All events"
          onChange={(v) => { setEvent(v); setPage(1); }}
        />
        <Select
          options={[
            { value: "", label: "All entities" },
            { value: "Tenant", label: "Tenants" },
            { value: "User", label: "Users / staff" },
            { value: "Sale", label: "Sales" },
          ]}
          placeholder="All entities"
          onChange={(v) => { setType(v); setPage(1); }}
        />
      </div>

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

        {pagination && pagination.last_page > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3 text-sm dark:border-gray-800">
            <span className="text-gray-500 dark:text-gray-400">{pagination.total} entries · page {pagination.current_page} of {pagination.last_page}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pagination.current_page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={pagination.current_page >= pagination.last_page} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
