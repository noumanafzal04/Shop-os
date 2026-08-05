import { Link } from "react-router";
import Badge from "../../../../components/ui/badge/Badge";
import type { AdminDashboard } from "../../types";
import { Panel, PanelEmpty } from "./Panel";
import { dateTime, humanize, money } from "./format";

interface Props {
  payments?: AdminDashboard["recent_payments"];
  loading?: boolean;
}

const HEADERS = ["Tenant", "Plan", "Paid", "Method", "Status", "Amount"];

export function RecentPaymentsPanel({ payments, loading = false }: Props) {
  return (
    <Panel title="Recent Payments" action={{ label: "View All", to: "/admin/payments" }} flush>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-y border-gray-200 text-theme-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
              {HEADERS.map((h) => (
                <th
                  key={h}
                  className={`whitespace-nowrap px-5 py-3 font-medium md:px-6 ${
                    h === "Amount" ? "text-right" : ""
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading || !payments ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={HEADERS.length} className="px-5 py-4 md:px-6">
                    <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                  </td>
                </tr>
              ))
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan={HEADERS.length}>
                  <PanelEmpty>No subscription payments recorded yet.</PanelEmpty>
                </td>
              </tr>
            ) : (
              payments.map((p) => (
                <tr key={p.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                  <td className="px-5 py-4 md:px-6">
                    {p.tenant_id && p.tenant ? (
                      <Link
                        to={`/admin/tenants/${p.tenant_id}`}
                        className="font-medium text-gray-800 hover:text-brand-500 dark:text-white/90 dark:hover:text-brand-400"
                      >
                        {p.tenant}
                      </Link>
                    ) : (
                      <span className="font-medium text-gray-800 dark:text-white/90">
                        {p.tenant ?? "—"}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 md:px-6">{p.plan_name ?? "—"}</td>
                  <td className="whitespace-nowrap px-5 py-4 tabular-nums md:px-6">
                    {dateTime(p.paid_at)}
                  </td>
                  <td className="px-5 py-4 md:px-6">
                    {p.method ? (
                      <Badge size="sm" color="light">
                        {humanize(p.method)}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-4 md:px-6">
                    <Badge size="sm" color={p.status === "paid" ? "success" : "warning"}>
                      {humanize(p.status)}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right font-medium tabular-nums text-gray-800 dark:text-white/90 md:px-6">
                    {money(p.amount, p.currency)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
