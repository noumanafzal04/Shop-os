import { useEffect, useState } from "react";
import { Link } from "react-router";

import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useUrlFilters } from "../../../common/hooks/useUrlFilters";
import PageMeta from "../../../components/common/PageMeta";
import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import {
  FilterBar,
  FilterChips,
  FilterOption,
  FilterPopover,
  FilterSelect,
  type AppliedFilter,
} from "../../../components/ui/filters";
import Pager from "../../../components/ui/pager";
import { useBusinessTypes, useCities } from "../../shop/hooks/useShop";
import { useAdminTenants, usePlans } from "../hooks/useAdmin";
import type { OriginCounts, PaymentCounts, TenantOrigin } from "../services/adminService";
import type { PaymentStatus, Tenant } from "../../auth/types";

/**
 * The four buckets, in the order an admin reads them: who is fine, who needs a
 * call today, who is overdue, who is switched off. They are mutually exclusive
 * server-side, so the counts add up and a shop is never chased twice.
 */
const BUCKETS: ReadonlyArray<{ value: PaymentStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "grace", label: "In grace" },
  { value: "unpaid", label: "Unpaid" },
  { value: "suspended", label: "Suspended" },
];

/**
 * The three doors onto this platform, and what each one means to whoever is
 * reading the list.
 */
const ORIGINS: ReadonlyArray<{ value: TenantOrigin; label: string; hint: string }> = [
  { value: "converted", label: "Kept their shop", hint: "tried a demo and stayed" },
  { value: "demo", label: "Trying a demo", hint: "temporary" },
  { value: "direct", label: "Opened by hand", hint: "created here" },
];

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name A–Z" },
  { value: "renewal", label: "Renews soonest" },
  { value: "converted", label: "Newest owner" },
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

/**
 * EVERY BUSINESS ON THE PLATFORM — and, at last, a way to find one.
 *
 * The server has accepted filters for status, city, plan, trade and online-only
 * since this list was written. The screen sent a search term and a payment
 * bucket. So an admin with four hundred shops looking for "the pharmacies in
 * Lahore on the basic plan" had a text box and their own memory.
 *
 * ── The filter state lives in the URL ──────────────────────────────────
 *
 * Not in useState. A filtered list is a thing people send each other — "look
 * at these four" — and a screen whose state cannot leave the tab cannot be
 * sent, bookmarked, or returned to with the back button. It also means the
 * browser's back button walks the filters rather than leaving the page, which
 * is what everybody expects it to do and what none of these screens did.
 */
export default function AdminTenantsPage() {
  const { params, get, patch, goToPage, clearAll: clearParams } = useUrlFilters();

  const bucket = get("payment_status") as PaymentStatus | "";
  const origin = get("origin") as TenantOrigin | "";
  const page = Number(params.get("page") ?? 1);

  // The box types faster than the server can answer, so the input is local and
  // the QUERY is debounced. Reading it straight off the URL would put a
  // history entry on every keystroke.
  const [search, setSearch] = useState(get("search"));
  const debounced = useDebouncedValue(search, 350);

  useEffect(() => {
    const term = debounced.trim();
    // NOTHING CHANGED, so touch nothing. Without this the effect fires on
    // mount and resets the page — so opening /admin/tenants?page=3 from a link
    // or the back button landed on page one.
    if (term === (params.get("search") ?? "")) return;

    patch({ search: term });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const cities = useCities();
  const plans = usePlans();
  const trades = useBusinessTypes();

  const tenants = useAdminTenants({
    search: debounced,
    payment_status: bucket,
    origin,
    business_type: get("business_type"),
    city_id: get("city_id"),
    plan_id: get("plan_id"),
    setup: (get("setup") || "") as "pending" | "done" | "",
    online_only: get("online") === "1",
    sort: get("sort"),
    page,
  });

  const rows = tenants.data?.data ?? [];
  const pagination = tenants.data?.meta.pagination;
  const counts = tenants.data?.meta.payment_counts as PaymentCounts | undefined;
  const originCounts = tenants.data?.meta.origin_counts as OriginCounts | undefined;

  const cityName = (id: string) => cities.data?.find((c) => c.id === id)?.name ?? id;
  const planName = (id: string) =>
    id === "none" ? "Not priced yet" : (plans.data?.find((p) => p.id === id)?.name ?? id);
  const tradeName = (code: string) => trades.data?.find((t) => t.code === code)?.label ?? code;

  /**
   * What is in force, as pills. The payment buckets are deliberately absent —
   * they sit in a segmented row directly above, always visible, so a pill for
   * them would say the same thing twice in the same eyeful.
   */
  const applied: AppliedFilter[] = [
    origin && {
      key: "origin",
      label: "Origin",
      value: ORIGINS.find((o) => o.value === origin)?.label ?? origin,
      onRemove: () => patch({ origin: "" }),
    },
    get("business_type") && {
      key: "business_type",
      label: "Trade",
      value: tradeName(get("business_type")),
      onRemove: () => patch({ business_type: "" }),
    },
    get("city_id") && {
      key: "city_id",
      label: "City",
      value: cityName(get("city_id")),
      onRemove: () => patch({ city_id: "" }),
    },
    get("plan_id") && {
      key: "plan_id",
      label: "Plan",
      value: planName(get("plan_id")),
      onRemove: () => patch({ plan_id: "" }),
    },
    get("setup") && {
      key: "setup",
      label: "Setup",
      value: get("setup") === "pending" ? "Not finished" : "Finished",
      onRemove: () => patch({ setup: "" }),
    },
    get("online") === "1" && {
      key: "online",
      label: "",
      value: "Sells online",
      onRemove: () => patch({ online: "" }),
    },
  ].filter(Boolean) as AppliedFilter[];

  const clearAll = () => {
    setSearch("");
    clearParams();
  };

  // The one number this screen exists to surface: owners who kept the shop
  // they were trying and have not finished naming it yet.
  const newOwners = originCounts?.converted ?? 0;
  const showNewOwnerCall = newOwners > 0 && origin !== "converted";

  return (
    <>
      <PageMeta title="Tenants | CartZe Admin" description="Manage businesses" />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Tenants</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Every business on the platform</p>
        </div>
        <Link to="/admin/tenants/new">
          <Button size="sm">+ Create Tenant</Button>
        </Link>
      </div>

      {showNewOwnerCall && (
        // Not a badge buried in a row — a shop that was just kept has an owner
        // who has never spoken to anybody and is sitting in the setup wizard
        // with a generated name. It is the most valuable row in this table and
        // it used to look exactly like a shop opened by hand a year ago.
        <button
          type="button"
          onClick={() => patch({ origin: "converted", sort: "converted" })}
          className="mb-4 flex w-full flex-wrap items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-left transition hover:border-brand-300 dark:border-brand-500/30 dark:bg-brand-500/10"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-500 text-sm font-bold text-white">
            {newOwners}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-theme-sm font-semibold text-brand-800 dark:text-brand-200">
              {newOwners === 1 ? "One shop was kept by its owner" : `${newOwners} shops were kept by their owners`}
            </span>
            <span className="block text-theme-xs text-brand-700/80 dark:text-brand-300/80">
              They tried a demo and stayed. Give them a plan and check they finished setting up.
            </span>
          </span>
          <span className="text-theme-sm font-semibold text-brand-600 dark:text-brand-300">Show them →</span>
        </button>
      )}

      <div className="mb-4">
        <FilterChips
          options={BUCKETS}
          value={bucket}
          counts={counts}
          ariaLabel="Payment status"
          onChange={(value) => patch({ payment_status: value })}
        />
      </div>

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search name, email, phone…",
          label: "Search tenants",
        }}
        applied={applied}
        onClearAll={clearAll}
        results={{ count: pagination?.total, noun: "tenants", loading: tenants.isLoading }}
      >
        <FilterPopover
          label="Origin"
          value={ORIGINS.find((o) => o.value === origin)?.label}
          active={origin !== ""}
          panelClassName="w-72"
        >
          {(close) => (
            <div role="listbox" aria-label="Origin">
              <FilterOption
                selected={origin === ""}
                hint={originCounts?.all}
                onPick={() => {
                  patch({ origin: "" });
                  close();
                }}
              >
                Any origin
              </FilterOption>
              {ORIGINS.map((option) => (
                <FilterOption
                  key={option.value}
                  selected={origin === option.value}
                  hint={originCounts?.[option.value]}
                  onPick={() => {
                    patch({ origin: option.value });
                    close();
                  }}
                >
                  {option.label}
                  <span className="block text-theme-xs font-normal text-gray-400">{option.hint}</span>
                </FilterOption>
              ))}
            </div>
          )}
        </FilterPopover>

        <FilterSelect
          label="Any trade"
          value={get("business_type")}
          onChange={(value) => patch({ business_type: value })}
          options={(trades.data ?? []).map((t) => ({ value: t.code, label: t.label }))}
        />

        <FilterSelect
          label="Any city"
          value={get("city_id")}
          onChange={(value) => patch({ city_id: value })}
          options={(cities.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />

        <FilterSelect
          label="Any plan"
          value={get("plan_id")}
          onChange={(value) => patch({ plan_id: value })}
          options={[
            // Every converted demo starts here, so it has to be askable. It is
            // spelled "none" rather than an empty value, which is how the
            // panel says "no filter at all".
            { value: "none", label: "Not priced yet" },
            ...(plans.data ?? []).map((p) => ({ value: p.id, label: p.name })),
          ]}
        />

        <FilterSelect
          label="Setup"
          value={get("setup")}
          onChange={(value) => patch({ setup: value })}
          options={[
            { value: "pending", label: "Not finished" },
            { value: "done", label: "Finished" },
          ]}
        />

        <label className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-3.5 text-theme-sm font-medium text-gray-600 transition hover:border-gray-300 dark:border-gray-800 dark:text-gray-300">
          <input
            type="checkbox"
            checked={get("online") === "1"}
            onChange={(event) => patch({ online: event.target.checked ? "1" : "" })}
            className="size-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
          />
          Sells online
        </label>

        <FilterSelect
          label="Newest first"
          value={get("sort")}
          onChange={(value) => patch({ sort: value })}
          options={SORTS}
        />
      </FilterBar>

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
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {bucket === "unpaid"
                        ? "Nobody is overdue."
                        : bucket === "grace"
                          ? "Nobody is inside their grace period."
                          : applied.length > 0 || debounced
                            ? "No business matches these filters."
                            : "No tenants found."}
                    </p>
                    {/* An empty table under a filter reads as "there is nothing
                        here" unless the way out is offered beside it. */}
                    {(applied.length > 0 || debounced || bucket) && (
                      <button
                        type="button"
                        onClick={clearAll}
                        className="mt-3 inline-flex min-h-9 items-center rounded-lg px-3 py-1.5 text-theme-sm font-semibold text-brand-500 transition hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-500/10"
                      >
                        Clear the filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((t) => (
                  <tr key={t.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/admin/tenants/${t.id}`}
                          className="font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400"
                        >
                          {t.business_name}
                        </Link>
                        <OriginBadge tenant={t} />
                      </div>
                      {t.email && <div className="text-theme-xs text-gray-400">{t.email}</div>}
                    </td>
                    <td className="px-6 py-4 capitalize">{t.business_type ?? "—"}</td>
                    <td className="px-6 py-4">{t.city?.name ?? "—"}</td>
                    <td className="px-6 py-4">
                      {t.plan?.name ?? <span className="text-gray-400">no plan</span>}
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

        <Pager pagination={pagination} onPage={goToPage} noun="tenants" />
      </div>
    </>
  );
}

/**
 * WHICH DOOR THIS SHOP CAME IN THROUGH, said on the row.
 *
 * "New owner" only while the shop has not finished setting itself up. After
 * that the fact stops being actionable — a business that named itself, picked
 * its city and dropped its pin is just a business — and a badge that never
 * expires is a badge everybody stops reading.
 */
function OriginBadge({ tenant }: { tenant: Tenant }) {
  if (tenant.is_demo) return <Badge size="sm" color="light">demo</Badge>;

  if (tenant.origin === "converted") {
    return tenant.setup_completed ? (
      <Badge size="sm" color="success">kept their shop</Badge>
    ) : (
      <Badge size="sm" color="warning">new owner · setting up</Badge>
    );
  }

  if (!tenant.setup_completed) return <Badge size="sm" color="light">setup unfinished</Badge>;

  return null;
}
