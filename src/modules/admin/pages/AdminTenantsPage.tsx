import { useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useAdminTenants } from "../hooks/useAdmin";
import type { Tenant } from "../../auth/types";

function expiryBadge(t: Tenant) {
  if (t.deleted_at) return <Badge size="sm" color="light">deleted</Badge>;
  if (t.status === "suspended") return <Badge size="sm" color="error">suspended</Badge>;
  const state = t.subscription_state;
  if (state === "read_only") return <Badge size="sm" color="error">expired</Badge>;
  if (state === "grace") return <Badge size="sm" color="warning">grace</Badge>;
  return <Badge size="sm" color="success">active</Badge>;
}

export default function AdminTenantsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 350);

  const tenants = useAdminTenants({ search: debounced, status, page });
  const rows = tenants.data?.data ?? [];
  const pagination = tenants.data?.meta.pagination;

  return (
    <>
      <PageMeta title="Tenants | ShopOS Admin" description="Manage businesses" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Tenants</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Every business on the platform
          </p>
        </div>
        <Link to="/admin/tenants/new">
          <Button size="sm">+ Create Tenant</Button>
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input placeholder="Search name, email, phone…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Select
          options={[
            { value: "", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "suspended", label: "Suspended" },
          ]}
          placeholder="All statuses"
          onChange={(v) => { setStatus(v); setPage(1); }}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium">Business</th>
                <th className="px-6 py-3 font-medium">Type</th>
                <th className="px-6 py-3 font-medium">City</th>
                <th className="px-6 py-3 font-medium">Plan</th>
                <th className="px-6 py-3 font-medium">Expires</th>
                <th className="px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {tenants.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={6} className="px-6 py-4"><div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">No tenants found.</td></tr>
              ) : (
                rows.map((t) => (
                  <tr key={t.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4">
                      <Link to={`/admin/tenants/${t.id}`} className="font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400">
                        {t.business_name}
                      </Link>
                      {t.email && <div className="text-theme-xs text-gray-400">{t.email}</div>}
                    </td>
                    <td className="px-6 py-4 capitalize">{t.business_type ?? "—"}</td>
                    <td className="px-6 py-4">{t.city?.name ?? "—"}</td>
                    <td className="px-6 py-4">
                      {t.plan?.name ?? "—"}
                      {t.online_shop_enabled && <Badge size="sm" color="info">online</Badge>}
                    </td>
                    <td className="px-6 py-4 text-theme-xs">
                      {t.subscription_ends_at ? new Date(t.subscription_ends_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-6 py-4">{expiryBadge(t)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.last_page > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3 text-sm dark:border-gray-800">
            <span className="text-gray-500 dark:text-gray-400">
              {pagination.total} tenants · page {pagination.current_page} of {pagination.last_page}
            </span>
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
