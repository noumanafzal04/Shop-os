import { Link } from "react-router";
import Badge from "../../../../components/ui/badge/Badge";
import { GroupIcon } from "../../../../icons";
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
      subtitle="Newest sign-ups first"
      icon={<GroupIcon className="size-5" />}
      action={{ label: "View All", to: "/admin/tenants" }}
      flush
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-y border-gray-200 bg-gray-50/70 text-theme-xs uppercase tracking-wider text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
              {HEADERS.map((h) => (
                <th key={h} className="whitespace-nowrap px-5 py-3 font-semibold md:px-6">
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
                <td colSpan={HEADERS.length} className="px-5 py-5 md:px-6">
                  <PanelEmpty>No tenants yet — create the first one from Tenants.</PanelEmpty>
                </td>
              </tr>
            ) : (
              tenants.map((t) => (
                <tr
                  key={t.id}
                  className="text-theme-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                >
                  <td className="px-5 py-4 md:px-6">
                    <Link
                      to={`/admin/tenants/${t.id}`}
                      className="font-medium text-gray-800 transition-colors hover:text-brand-600 dark:text-white/90 dark:hover:text-brand-400"
                    >
                      {t.business_name}
                    </Link>
                    {t.online_shop_enabled && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-theme-xs font-medium text-brand-600 ring-1 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:ring-brand-500/25">
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
