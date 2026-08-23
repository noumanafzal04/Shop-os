import { useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Pager from "../../../components/ui/pager";
import Input from "../../../components/form/input/InputField";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useAdminTenants } from "../hooks/useAdmin";
import type { PaymentCounts } from "../services/adminService";
import type { PaymentStatus, Tenant } from "../../auth/types";

/**
 * The four buckets, in the order an admin reads them: who is fine, who needs a
 * call today, who is overdue, who is switched off. They are mutually exclusive
 * server-side, so the counts add up and a shop is never chased twice.
 */
const BUCKETS: Array<{ value: PaymentStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "grace", label: "In grace" },
  { value: "unpaid", label: "Unpaid" },
  { value: "suspended", label: "Suspended" },
];

const CHIP: Record<PaymentStatus, { label: string; color: "success" | "warning" | "error" | "light" }> = {
  paid: { label: "paid", color: "success" },
  grace: { label: "in grace", color: "warning" },
  unpaid: { label: "unpaid", color: "error" },
  suspended: { label: "suspended", color: "light" },
};

function paymentBadge(t: Tenant) {
  // A deleted business has no payment state worth showing — it is not being
  // chased, and the row exists only so an admin can restore it.
  if (t.deleted_at) return <Badge size="sm" color="light">deleted</Badge>;

  const chip = t.payment_status ? CHIP[t.payment_status] : null;
  if (!chip) return <Badge size="sm" color="light">—</Badge>;

  return <Badge size="sm" color={chip.color}>{chip.label}</Badge>;
}

/**
 * How much longer this shop has, in the words someone chasing it would use.
 * A date alone makes the reader do the arithmetic; "4 days ago" is the thing
 * they were going to work out anyway.
 */
function dueLabel(t: Tenant): string {
  if (!t.subscription_ends_at) return "—";

  const ends = new Date(t.subscription_ends_at);
  const days = Math.round((ends.getTime() - Date.now()) / 86_400_000);
  const date = ends.toLocaleDateString();

  if (days === 0) return `${date} · today`;
  if (days > 0) return `${date} · in ${days}d`;
  return `${date} · ${Math.abs(days)}d ago`;
}

export default function AdminTenantsPage() {
  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState<PaymentStatus | "">("");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 350);

  const tenants = useAdminTenants({ search: debounced, payment_status: bucket, page });
  const rows = tenants.data?.data ?? [];
  const pagination = tenants.data?.meta.pagination;
  const counts = tenants.data?.meta.payment_counts as PaymentCounts | undefined;

  // Every count comes from the server, computed against the same search but
  // WITHOUT the bucket filter. The paginator's total cannot stand in for "All"
  // — once a bucket is selected it counts that bucket.
  const countFor = (value: PaymentStatus | ""): number | undefined =>
    counts?.[value === "" ? "all" : value];

  const select = (value: PaymentStatus | "") => {
    setBucket(value);
    setPage(1);
  };

  return (
    <>
      <PageMeta title="Tenants | CartZe Admin" description="Manage businesses" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Tenants</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Every business on the platform</p>
        </div>
        <Link to="/admin/tenants/new">
          <Button size="sm">+ Create Tenant</Button>
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {BUCKETS.map((b) => {
          const active = bucket === b.value;
          const count = countFor(b.value);
          return (
            <button
              key={b.value || "all"}
              type="button"
              onClick={() => select(b.value)}
              aria-pressed={active}
              className={`rounded-lg border px-3 py-1.5 text-theme-sm font-medium transition-colors ${
                active
                  ? "border-brand-500 bg-brand-50 text-brand-600 dark:border-brand-400 dark:bg-brand-500/10 dark:text-brand-400"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400 dark:hover:bg-white/[0.06]"
              }`}
            >
              {b.label}
              {count !== undefined && (
                <span className="ml-1.5 tabular-nums text-theme-xs opacity-70">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mb-4">
        <Input
          placeholder="Search name, email, phone…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
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
                <th className="px-6 py-3 font-medium">Renews</th>
                <th className="px-6 py-3 font-medium">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {tenants.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-6 py-4">
                      <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    {bucket === "unpaid"
                      ? "Nobody is overdue."
                      : bucket === "grace"
                        ? "Nobody is inside their grace period."
                        : "No tenants found."}
                  </td>
                </tr>
              ) : (
                rows.map((t) => (
                  <tr key={t.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4">
                      <Link
                        to={`/admin/tenants/${t.id}`}
                        className="font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400"
                      >
                        {t.business_name}
                      </Link>
                      {t.email && <div className="text-theme-xs text-gray-400">{t.email}</div>}
                    </td>
                    <td className="px-6 py-4 capitalize">{t.business_type ?? "—"}</td>
                    <td className="px-6 py-4">{t.city?.name ?? "—"}</td>
                    <td className="px-6 py-4">
                      {t.plan?.name ?? "—"}
                      {t.online_shop_enabled && (
                        <Badge size="sm" color="info">
                          online
                        </Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 text-theme-xs tabular-nums">{dueLabel(t)}</td>
                    <td className="px-6 py-4">{paymentBadge(t)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pager pagination={pagination} onPage={setPage} noun="tenants" />
      </div>
    </>
  );
}
