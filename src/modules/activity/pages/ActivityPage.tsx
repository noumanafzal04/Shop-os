import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import PageMeta from "../../../components/common/PageMeta";
import Badge from "../../../components/ui/badge/Badge";
import Pager from "../../../components/ui/pager";
import Select from "../../../components/form/Select";
import Input from "../../../components/form/input/InputField";
import { apiGet } from "../../../common/api/client";

/**
 * The shop's own record of who changed what.
 *
 * The trail existed for the platform and not for the shop it is about: the way
 * in was an admin-only screen, so an owner saw eight rows on their dashboard
 * and could ask nothing of them.
 *
 * Everything here is written in shop words. `TaxGroup` is a model name; "Tax
 * rate" is the thing that changed, and a shopkeeper looking for who moved the
 * rate from 17% to 5% is not searching for a class.
 */

interface AuditLog {
  id: string;
  event: "created" | "updated" | "deleted";
  entity: string;
  entity_id: string;
  actor: { id: string; name: string; email: string | null } | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

const EVENT_COLOR = { created: "success", updated: "info", deleted: "error" } as const;
const EVENT_WORD = { created: "added", updated: "changed", deleted: "removed" } as const;

/** Model name → what a shopkeeper calls it. Anything unlisted keeps its own name. */
const THING: Record<string, string> = {
  Tenant: "Shop settings",
  User: "Staff member",
  Customer: "Customer credit limit",
  CustomerGroup: "Customer group",
  TaxGroup: "Tax rate",
  Coupon: "Coupon",
  Sale: "Sale",
  SaleDocument: "Quotation / layaway",
  StockDisposal: "Stock written off",
  StockCount: "Stocktake",
  BusinessDay: "Trading day",
  BankDeposit: "Banking",
  RecurringExpense: "Recurring expense",
  RecurringIncome: "Recurring income",
  ExpenseBudget: "Budget",
  FuelTank: "Fuel tank",
  FuelPump: "Fuel pump",
  FuelNozzle: "Nozzle",
  FuelDelivery: "Fuel delivery",
  ForecourtShift: "Forecourt shift",
};

/** Column name → what it is called on the screen it was changed on. */
const FIELD: Record<string, string> = {
  credit_limit: "Credit limit",
  discount_percent: "Members' discount",
  rate: "Tax rate",
  permissions: "Permissions",
  status: "Status",
  settings: "Settings",
  max_discount_percent: "Discount ceiling",
  value: "Value",
  code: "Code",
  is_active: "Active",
  name: "Name",
};

function label(key: string): string {
  return FIELD[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function format(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Changes({ log }: { log: AuditLog }) {
  const keys = Array.from(
    new Set([...Object.keys(log.new_values ?? {}), ...Object.keys(log.old_values ?? {})]),
  ).filter((k) => !["id", "tenant_id", "created_by", "updated_by"].includes(k));

  if (keys.length === 0) return <span className="text-theme-xs text-gray-400">—</span>;

  return (
    <div className="space-y-0.5">
      {keys.slice(0, 5).map((k) => (
        <div key={k} className="text-theme-xs">
          <span className="text-gray-500 dark:text-gray-400">{label(k)}: </span>
          {log.event === "updated" ? (
            <span className="text-gray-700 dark:text-gray-300">
              <span className="text-error-500 line-through">{format(log.old_values?.[k])}</span>
              {" → "}
              <span className="text-success-600">{format(log.new_values?.[k])}</span>
            </span>
          ) : (
            <span className="text-gray-700 dark:text-gray-300">
              {format((log.new_values ?? log.old_values)?.[k])}
            </span>
          )}
        </div>
      ))}
      {keys.length > 5 && (
        <span className="text-theme-xs text-gray-400">+{keys.length - 5} more</span>
      )}
    </div>
  );
}

export default function ActivityPage() {
  const [event, setEvent] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const logs = useQuery({
    queryKey: ["activity", { event, type, from, to, page }],
    queryFn: () =>
      apiGet<AuditLog[]>("/audit-logs", {
        params: {
          event: event || undefined,
          type: type || undefined,
          from: from || undefined,
          to: to || undefined,
          page,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const rows = logs.data?.data ?? [];
  const pagination = logs.data?.meta.pagination;
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };

  return (
    <>
      <PageMeta title="Activity | ShopOS" description="Who changed what in your shop" />

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Activity</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Who changed what, and when. Kept whether or not anyone ever asks.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          options={[
            { value: "", label: "Everything" },
            /* Shop words. Somebody looking for who raised a limit is not
               looking for "Customer" — they are looking for the limit. */
            { value: "Customer", label: "Credit limits" },
            { value: "TaxGroup", label: "Tax rates" },
            { value: "CustomerGroup", label: "Customer groups" },
            { value: "Coupon", label: "Coupons" },
            { value: "User", label: "Staff & permissions" },
            { value: "Tenant", label: "Shop settings" },
            { value: "Sale", label: "Sales" },
            { value: "StockDisposal", label: "Stock written off" },
            { value: "BankDeposit", label: "Banking" },
          ]}
          placeholder="Everything"
          onChange={reset(setType)}
        />
        <Select
          options={[
            { value: "", label: "Added, changed & removed" },
            { value: "created", label: "Added" },
            { value: "updated", label: "Changed" },
            { value: "deleted", label: "Removed" },
          ]}
          placeholder="Added, changed & removed"
          onChange={reset(setEvent)}
        />
        <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium whitespace-nowrap">When</th>
                <th className="px-6 py-3 font-medium">Who</th>
                <th className="px-6 py-3 font-medium">What</th>
                <th className="px-6 py-3 font-medium">Changed to</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {logs.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={4} className="px-6 py-4">
                      <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    Nothing here for that. Try a wider date range, or Everything.
                  </td>
                </tr>
              ) : (
                rows.map((log) => (
                  <tr key={log.id} className="align-top text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4 text-theme-xs whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      {/* "System" is honest: a scheduled job posting a
                          recurring expense has no person behind it. */}
                      <div className="font-medium text-gray-800 dark:text-white/90">
                        {log.actor?.name ?? "System"}
                      </div>
                      {log.actor?.email && (
                        <div className="text-theme-xs text-gray-400">{log.actor.email}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="mr-2">{THING[log.entity] ?? log.entity}</span>
                      <Badge size="sm" color={EVENT_COLOR[log.event]}>{EVENT_WORD[log.event]}</Badge>
                    </td>
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
