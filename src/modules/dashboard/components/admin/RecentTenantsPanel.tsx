import { Link } from "react-router";
import Badge from "../../../../components/ui/badge/Badge";
import type { AdminDashboard } from "../../types";
import { Panel, PanelEmpty } from "./Panel";
import { date, humanize } from "./format";

interface Props {
  tenants?: AdminDashboard["recent_tenants"];
  loading?: boolean;
}

const HEADERS = ["Business", "Type", "Plan", "Status", "Joined"];

export function RecentTenantsPanel({ tenants, loading = false }: Props) {
  return (
    <Panel
      title="Recent Tenants"
      action={{ label: "View All", to: "/admin/tenants" }}
      flush
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-y border-gray-200 text-theme-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
              {HEADERS.map((h) => (
                <th key={h} className="whitespace-nowrap px-5 py-3 font-medium md:px-6">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading || !tenants ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={HEADERS.length} className="px-5 py-4 md:px-6">
                    <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                  </td>
                </tr>
              ))
            ) : tenants.length === 0 ? (
              <tr>
                <td colSpan={HEADERS.length}>
                  <PanelEmpty>No tenants yet — create the first one from Tenants.</PanelEmpty>
                </td>
              </tr>
            ) : (
              tenants.map((t) => (
                <tr key={t.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                  <td className="px-5 py-4 md:px-6">
                    <Link
                      to={`/admin/tenants/${t.id}`}
                      className="font-medium text-gray-800 hover:text-brand-500 dark:text-white/90 dark:hover:text-brand-400"
                    >
                      {t.business_name}
                    </Link>
                    {t.online_shop_enabled && (
                      <span className="mt-1 block text-theme-xs text-brand-500 dark:text-brand-400">
                        Online shop
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 md:px-6">
                    {humanize(t.business_type)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 md:px-6">{t.plan?.name ?? "—"}</td>
                  <td className="px-5 py-4 md:px-6">
                    <Badge size="sm" color={t.status === "active" ? "success" : "error"}>
                      {humanize(t.status)}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 tabular-nums md:px-6">
                    {date(t.created_at)}
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
