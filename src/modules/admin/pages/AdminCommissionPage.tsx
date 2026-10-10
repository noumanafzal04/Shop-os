import { platformToday } from "../../../common/time/platformToday";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { apiGet, apiPost, apiPut } from "../../../common/api/client";
import { ApiError } from "../../../common/types/api";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import TextArea from "../../../components/form/input/TextArea";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useToast } from "../../../components/ui/toast";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import { formatMoney } from "../../../common/format/money";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useUrlFilters } from "../../../common/hooks/useUrlFilters";
import {
  DateRangeFilter,
  FilterBar,
  FilterSelect,
  formatEntryDate,
  formatRange,
  resolveRange,
  type AppliedFilter,
  type DateRange,
} from "../../../components/ui/filters";
import Pager from "../../../components/ui/pager";
import { CheckLineIcon, DollarLineIcon, PieChartIcon, TimeIcon, UserCircleIcon } from "../../../icons";
import { Card, Empty, PageHeader, Person, Pill, StatTile } from "../components/kit";

/**
 * THE PLATFORM'S CUT.
 *
 * ── Why this is not the Billing screen ───────────────────────────────
 *
 * `/admin/payments` is the PLAN ledger — what each shop pays monthly for the
 * software. This is the other debt: a share of what the marketplace actually
 * sold for them. Two reasons, two numbers, two screens. A shop that cannot
 * tell which is which cannot check either, and neither can we.
 *
 * ── What the settings at the top do ──────────────────────────────────
 *
 * The rate here applies to every shop that has not negotiated its own, so
 * changing it moves most of the platform at once. It is capped at 50% on the
 * server as well as here, because a typo in this field bills everybody.
 *
 * Turning commission OFF is kept separate from setting it to zero: a platform
 * pausing billing should not lose the number it agreed with everyone.
 */

type Shop = {
  id: string;
  business_name: string;
  slug: string;
  commission_rate: number | null;
  effective_rate: number;
  /** Earned and not yet asked for: charges on no invoice. */
  outstanding_orders: number;
  outstanding_amount: number;
  /** Asked for and not yet paid: invoices raised and still open. */
  unpaid_invoices: number;
  unpaid_amount: number;
  /** Both piles together — what the list is ordered by. */
  owed: number;
};

/** Counted by the server over the whole platform, never off the page that is open. */
type Summary = {
  shops: number;
  unbilled: { shops: number; orders: number; amount: number };
  invoiced: { shops: number; invoices: number; amount: number };
  clear: { shops: number };
  rates: { own: number; platform: number };
  collected_this_month: { invoices: number; amount: number };
};

const STANDING = [
  { value: "unbilled", label: "Not yet billed" },
  { value: "invoiced", label: "Billed, unpaid" },
  { value: "clear", label: "Owes nothing" },
];

const RATE = [
  { value: "own", label: "On a rate of their own" },
  { value: "platform", label: "On the platform rate" },
];

const SORT = [
  { value: "unbilled", label: "Most not yet billed" },
  { value: "invoiced", label: "Most billed, unpaid" },
  { value: "name", label: "Name, A to Z" },
];

/** What a new invoice may be raised for. Anything else is the custom range. */
const INVOICE_PERIODS = ["this_month", "last_month", "last_30", "this_quarter"] as const;

type Settings = {
  commission_enabled: boolean;
  commission_rate: number;
  commission_base: "goods" | "total";
};

type Charge = {
  id: string;
  order_number: string | null;
  order_total: string | null;
  rate_percent: number;
  base_amount: number;
  amount: number;
  charged_at: string | null;
};

type Invoice = {
  id: string;
  number: string;
  period_start: string | null;
  period_end: string | null;
  orders_count: number;
  amount: number;
  status: "unpaid" | "paid" | "void";
  paid_at: string | null;
  note: string | null;
};

type Detail = {
  shop: { id: string; business_name: string; commission_rate: number | null; effective_rate: number };
  outstanding: { orders: number; base: number; amount: number };
  charges: Charge[];
  invoices: Invoice[];
};

const money = (n: number) => formatMoney("Rs", n);

/**
 * Which day a charge was earned on, AS THE SERVER FILES IT.
 *
 * An invoice bills the charges whose date falls in its period, and the server
 * reads that date in UTC. `charged_at` arrives as an instant with its offset,
 * so its first ten characters are that same UTC date — and the count shown
 * before "Raise invoice" is pressed is the count the invoice will have.
 */
const chargedOn = (charge: Charge): string => (charge.charged_at ?? "").slice(0, 10);

export default function AdminCommissionPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  // WHAT THE LIST IS NARROWED TO lives in the address, like every filter on
  // this platform: "look at the ones we have billed and not been paid by" is
  // a thing people send each other.
  const { params, get, patch, goToPage, clearAll } = useUrlFilters();
  const standing = get("standing");
  const rate = get("rate");
  const sort = get("sort");
  const page = Number(params.get("page") ?? 1);
  // The box types faster than the server answers: local input, debounced
  // query, and no history entry per keystroke.
  const [search, setSearch] = useState(get("search"));
  const debounced = useDebouncedValue(search, 350);
  useEffect(() => {
    const term = debounced.trim();
    // Nothing changed, so touch nothing — or opening ?page=2 from a link
    // would land on page one.
    if (term === (params.get("search") ?? "")) return;
    patch({ search: term });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const [open, setOpen] = useState<string | null>(null);
  // The window a new invoice is raised over. This month, until somebody says otherwise.
  // The server's month, not the laptop's: charges are dated on its calendar.
  const [period, setPeriod] = useState<DateRange>(() => resolveRange("this_month", platformToday()));
  const [rateDraft, setRateDraft] = useState("");
  const [shopRate, setShopRate] = useState("");

  const settings = useQuery({
    queryKey: ["admin", "commission", "settings"],
    queryFn: async () => (await apiGet<{ settings: Settings; max_rate: number }>("/admin/commission/settings")).data,
  });

  const shops = useQuery({
    queryKey: ["admin", "commission", "list", debounced.trim(), standing, rate, sort, page],
    queryFn: () =>
      apiGet<Shop[]>("/admin/commission", {
        params: {
          search: debounced.trim() || undefined,
          standing: standing || undefined,
          rate: rate || undefined,
          sort: sort || undefined,
          page,
        },
      }),
  });

  const detail = useQuery({
    queryKey: ["admin", "commission", "one", open],
    queryFn: async () => (await apiGet<Detail>(`/admin/commission/${open}`)).data,
    enabled: open !== null,
  });

  const failed = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : "That did not go through.");
  const done = (m: string) => {
    toast.success(m);
    void queryClient.invalidateQueries({ queryKey: ["admin", "commission"] });
  };

  const saveSettings = useMutation({
    mutationFn: (body: Partial<Settings>) => apiPut<Settings>("/admin/commission/settings", body),
    onSuccess: () => done("Settings saved"),
    onError: failed,
  });

  const setRate = useMutation({
    mutationFn: (v: { id: string; rate: number | null }) =>
      apiPut<unknown>(`/admin/commission/${v.id}/rate`, { commission_rate: v.rate }),
    onSuccess: ({ message }) => done(message ?? "Rate saved"),
    onError: failed,
  });

  const raise = useMutation({
    mutationFn: (v: { id: string; from: string; to: string }) =>
      apiPost<unknown>(`/admin/commission/${v.id}/invoices`, { from: v.from, to: v.to }),
    onSuccess: ({ message }) => done(message ?? "Invoice raised"),
    onError: failed,
  });

  /**
   * MONEY GOING THE OTHER WAY, which had no door at all.
   *
   * `waive` (write off one charge) and `voidInvoice` (withdraw a whole
   * invoice) were written, tested and reachable by nothing: the only thing
   * this screen could do to an invoice was mark it paid. So a shop disputing a
   * charge — a refunded order, an invoice raised over the wrong window — could
   * be collected from or ignored, and nothing else.
   *
   * Both REQUIRE a reason on the server, and rightly: a charge written off
   * without one is money the books cannot explain, and an invoice withdrawn
   * without one is a number a shop saw and can never be told the fate of. So
   * one prompt, and the action is not sent until it has been typed.
   */
  const [asking, setAsking] = useState<{ kind: "waive" | "void"; id: string; what: string } | null>(null);
  const [reason, setReason] = useState("");

  const waive = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      apiPost<unknown>(`/admin/commission-charges/${v.id}/waive`, { reason: v.reason }),
    onSuccess: () => { setAsking(null); setReason(""); done("Charge written off"); },
    onError: failed,
  });

  const voidInvoice = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      apiPost<unknown>(`/admin/commission-invoices/${v.id}/void`, { reason: v.reason }),
    onSuccess: () => { setAsking(null); setReason(""); done("Invoice withdrawn"); },
    onError: failed,
  });

  const markPaid = useMutation({
    mutationFn: (id: string) => apiPost<unknown>(`/admin/commission-invoices/${id}/paid`),
    onSuccess: () => done("Marked paid"),
    onError: failed,
  });

  const s = settings.data?.settings;

  // Seed each draft ONCE from the server's answer. Writing them on every
  // render would fight whoever is typing.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || s == null) return;
    seeded.current = true;
    setRateDraft(String(s.commission_rate));
  }, [s]);

  const seededShop = useRef<string | null>(null);
  useEffect(() => {
    const d = detail.data;
    if (d == null || seededShop.current === d.shop.id) return;
    seededShop.current = d.shop.id;
    setShopRate(d.shop.commission_rate === null ? "" : String(d.shop.commission_rate));
  }, [detail.data]);

  const list = shops.data?.data ?? [];
  const pagination = shops.data?.meta?.pagination;
  const summary = shops.data?.meta?.summary as Summary | undefined;
  const loadingFigures = shops.isLoading || summary === undefined;

  // What this shop has been asked for and has not paid, and which of its
  // unbilled orders the period chosen would put on an invoice.
  const unpaidHere = (detail.data?.invoices ?? []).filter((i) => i.status === "unpaid").reduce((sum, i) => sum + i.amount, 0);
  const inPeriod = (ch: Charge): boolean =>
    period.from !== null && period.to !== null && chargedOn(ch) >= period.from && chargedOn(ch) <= period.to;
  const toBill = (detail.data?.charges ?? []).filter(inPeriod);

  const labelOf = (options: Array<{ value: string; label: string }>, value: string) =>
    options.find((o) => o.value === value)?.label ?? value;

  const applied: AppliedFilter[] = [
    ...(standing ? [{ key: "standing", label: "Standing", value: labelOf(STANDING, standing), onRemove: () => patch({ standing: null }) }] : []),
    ...(rate ? [{ key: "rate", label: "Rate", value: labelOf(RATE, rate), onRemove: () => patch({ rate: null }) }] : []),
  ];
  const narrowed = applied.length > 0 || debounced.trim() !== "";

  return (
    <>
      <PageMeta title="Commission" description="What the marketplace earns, and who owes it" />

      <PageHeader
        icon={<PieChartIcon />}
        tone="orange"
        title="Commission"
        subtitle="A share of what the marketplace sells for each shop — billed apart from their plan, so either can be questioned."
      />

      {/* OFF is said at the top of the page, not inside a settings card
          somebody has to scroll to: while it is off nothing below is growing. */}
      {s && !s.commission_enabled && (
        <p role="status" className="mb-5 rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3 text-theme-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-400">
          Commission is off. Completed online orders are recording nothing, and no shop is being charged.
        </p>
      )}

      {/* ── What is owed, in the two piles it is owed in ─────────────────
          Counted by the server over every shop — never off the page that is
          open. Two of them are also the fastest way to the shops they count. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="commission-figures">
        <StatTile
          label="Not yet billed"
          tone={summary && summary.unbilled.amount > 0 ? "amber" : "slate"}
          icon={<TimeIcon />}
          loading={loadingFigures}
          value={money(summary?.unbilled.amount ?? 0)}
          hint={summary ? `${summary.unbilled.orders} ${summary.unbilled.orders === 1 ? "order" : "orders"} · ${summary.unbilled.shops} ${summary.unbilled.shops === 1 ? "shop" : "shops"}` : undefined}
          onPress={() => patch({ standing: standing === "unbilled" ? null : "unbilled" })}
          pressed={standing === "unbilled"}
        />
        <StatTile
          label="Billed, unpaid"
          tone={summary && summary.invoiced.amount > 0 ? "red" : "slate"}
          icon={<DollarLineIcon />}
          loading={loadingFigures}
          value={money(summary?.invoiced.amount ?? 0)}
          hint={summary ? `${summary.invoiced.invoices} ${summary.invoiced.invoices === 1 ? "invoice" : "invoices"} · ${summary.invoiced.shops} ${summary.invoiced.shops === 1 ? "shop" : "shops"}` : undefined}
          onPress={() => patch({ standing: standing === "invoiced" ? null : "invoiced" })}
          pressed={standing === "invoiced"}
        />
        <StatTile
          label="Collected this month"
          tone="green"
          // Drawn in the chip's own ink. The circled tick carries a green of
          // its own, and on a green chip it is a blank square.
          icon={<CheckLineIcon />}
          loading={loadingFigures}
          value={money(summary?.collected_this_month.amount ?? 0)}
          hint={summary ? `${summary.collected_this_month.invoices} ${summary.collected_this_month.invoices === 1 ? "invoice" : "invoices"} paid` : undefined}
        />
        <StatTile
          label="On a rate of their own"
          tone="brand"
          icon={<UserCircleIcon />}
          loading={loadingFigures}
          value={summary?.rates.own ?? 0}
          hint={summary ? `${summary.rates.platform} follow the platform's ${s ? `${s.commission_rate}%` : "rate"}` : undefined}
          onPress={() => patch({ rate: rate === "own" ? null : "own" })}
          pressed={rate === "own"}
        />
      </div>

      {/* ── Who owes what ────────────────────────────────────────────── */}
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Search a shop's name…", label: "Search shops" }}
        applied={applied}
        onClearAll={() => {
          setSearch("");
          // The order is not a filter; clearing what the list is narrowed to
          // should not also reshuffle it.
          clearAll(["sort"]);
        }}
        results={{ count: pagination?.total, noun: "shops", loading: shops.isLoading }}
      >
        <FilterSelect label="Any standing" value={standing} onChange={(v) => patch({ standing: v || null })} options={STANDING} />
        <FilterSelect label="Any rate" value={rate} onChange={(v) => patch({ rate: v || null })} options={RATE} />
        <FilterSelect label="Most owed first" value={sort} onChange={(v) => patch({ sort: v || null })} options={SORT} />
      </FilterBar>

      <Card>
        {shops.isError ? (
          <Empty icon={<PieChartIcon />} title="The list could not be loaded" hint="Try again in a moment." action={<Button size="sm" variant="outline" onClick={() => shops.refetch()}>Try again</Button>} />
        ) : !shops.isLoading && list.length === 0 ? (
          narrowed
            ? <Empty icon={<PieChartIcon />} title="No shop matches" hint="Try fewer words, or clear the filters." />
            : <Empty icon={<PieChartIcon />} title="No shops yet" hint="A shop appears here the day it is opened, and owes something the day an online order is completed." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-theme-sm" data-testid="commission-table">
              <thead>
                <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-5 py-3 font-medium">Shop</th>
                  <th className="px-5 py-3 font-medium">Rate</th>
                  <th className="px-5 py-3 font-medium">Not yet billed</th>
                  <th className="px-5 py-3 font-medium">Billed, unpaid</th>
                  <th className="px-5 py-3 font-medium">Owes in all</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {shops.isLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={6} className="px-5 py-4">
                          <div className="h-9 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                        </td>
                      </tr>
                    ))
                  : list.map((shop) => (
                      <tr key={shop.id} data-shop={shop.business_name} className="text-gray-700 dark:text-gray-300">
                        <td className="px-5 py-3">
                          <Person name={shop.business_name} />
                        </td>
                        <td className="px-5 py-3">
                          {/* Null means "follows the platform". Saying so beats
                              printing the resolved number as though the shop
                              had chosen it — the difference matters the moment
                              the platform rate moves. */}
                          <Pill tone={shop.commission_rate === null ? "slate" : "purple"}>
                            {shop.effective_rate}% · {shop.commission_rate === null ? "platform" : "own"}
                          </Pill>
                        </td>
                        <td className="px-5 py-3">
                          {shop.outstanding_amount > 0 ? (
                            <>
                              <p className="font-medium tabular-nums text-warning-600 dark:text-warning-400">{money(shop.outstanding_amount)}</p>
                              <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                                {shop.outstanding_orders} {shop.outstanding_orders === 1 ? "order" : "orders"}
                              </p>
                            </>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {shop.unpaid_amount > 0 ? (
                            <>
                              <p className="font-medium tabular-nums text-error-600 dark:text-error-400">{money(shop.unpaid_amount)}</p>
                              <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                                {shop.unpaid_invoices} {shop.unpaid_invoices === 1 ? "invoice" : "invoices"}
                              </p>
                            </>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {shop.owed > 0
                            ? <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{money(shop.owed)}</span>
                            : <span className="text-gray-400">Nothing</span>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button className={ROW_ACTION} onClick={() => setOpen(shop.id)} aria-label={`Open ${shop.business_name}`}>
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Pager pagination={pagination} onPage={goToPage} noun="shops" />

      {/* ── The rate everybody follows ───────────────────────────────── */}
      {/* Under the list, not above it: this is changed once a year and the
          list is read every week. */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]" data-testid="commission-settings">
        {settings.isLoading || !s ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
                  Platform rate
                </h3>
                <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                  Applies to every shop that has not been given its own.
                </p>
              </div>
              {/*
                OFF is not the same as a rate of zero. Pausing billing must not
                cost the platform the number it agreed with everybody.
              */}
              <Button
                variant={s.commission_enabled ? "outline" : "primary"}
                disabled={saveSettings.isPending}
                onClick={() => saveSettings.mutate({ commission_enabled: !s.commission_enabled })}
              >
                {s.commission_enabled ? "Pause commission" : "Turn commission on"}
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
              <div>
                <Label>Rate (%)</Label>
                {/*
                  SAVED BY A BUTTON, never by leaving the field. A rate typed
                  here charges every shop that has not negotiated its own, and
                  a stray blur — tabbing away, clicking a heading — is not
                  somebody deciding to change what the whole platform bills.
                */}
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step={0.5}
                    value={rateDraft}
                    onChange={(e) => setRateDraft(e.target.value)}
                  />
                  <Button
                    disabled={saveSettings.isPending || rateDraft.trim() === "" || Number(rateDraft) === s.commission_rate}
                    onClick={() => saveSettings.mutate({ commission_rate: Number(rateDraft) })}
                  >
                    Save
                  </Button>
                </div>
              </div>
              <div>
                <Label>Charged on</Label>
                <div className="flex gap-2">
                  {(["goods", "total"] as const).map((base) => (
                    <button
                      key={base}
                      className={`rounded-xl border px-3 py-2 text-theme-sm ${
                        s.commission_base === base
                          ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10"
                          : "border-gray-200 text-gray-600 dark:border-gray-800 dark:text-gray-300"
                      }`}
                      onClick={() => saveSettings.mutate({ commission_base: base })}
                    >
                      {base === "goods" ? "Goods only" : "Goods + delivery"}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-theme-xs text-gray-500 dark:text-gray-400 sm:pb-2">
                {/*
                  The delivery fee is the rider's money, not the shop's.
                  Including it makes a shop that delivers pay more for an
                  identical basket, which is a decision somebody should take
                  deliberately rather than inherit.
                */}
                Goods only leaves the delivery fee out — it is the rider's, not the shop's.
              </p>
            </div>
          </>
        )}
      </div>


      {/* ── One shop ─────────────────────────────────────────────────── */}
      <Modal isOpen={open !== null} onClose={() => setOpen(null)} className="max-w-3xl">
        <ModalForm
          title={detail.data?.shop.business_name ?? "Commission"}
          description={
            detail.data
              ? `${detail.data.shop.effective_rate}% · ${money(detail.data.outstanding.amount)} not yet billed across ${detail.data.outstanding.orders} order${detail.data.outstanding.orders === 1 ? "" : "s"}${unpaidHere > 0 ? ` · ${money(unpaidHere)} billed and unpaid` : ""}`
              : undefined
          }
          footer={
            <Button variant="outline" onClick={() => setOpen(null)}>
              Close
            </Button>
          }
        >
          {detail.isLoading || !detail.data ? (
            <p className="py-8 text-center text-sm text-gray-400">Loading…</p>
          ) : (
            <>
              <div>
                <Label>This shop&apos;s own rate (blank = follow the platform)</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step={0.5}
                    value={shopRate}
                    onChange={(e) => setShopRate(e.target.value)}
                    placeholder={`${settings.data?.settings.commission_rate ?? 0} (platform)`}
                  />
                  <Button
                    disabled={setRate.isPending}
                    onClick={() => {
                      const raw = shopRate.trim();
                      // Blank clears it, which is NOT zero: blank follows the
                      // platform for ever after, and zero is a promise that
                      // this shop pays nothing whatever the default becomes.
                      if (raw !== "" && Number.isNaN(Number(raw))) return;
                      if (open) setRate.mutate({ id: open, rate: raw === "" ? null : Number(raw) });
                    }}
                  >
                    Save
                  </Button>
                </div>
              </div>

              <div>
                {/* THE PERIOD IS CHOSEN, AND WHAT IT WOULD BILL IS SAID FIRST.
                    This was one button — "Raise invoice for this month" — so
                    last month's orders could only be billed by waiting for
                    them to be this month's, and nobody was told how much the
                    invoice would be for until it existed. */}
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-gray-800 dark:text-white/90">Not yet billed</h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <DateRangeFilter
                      label="Period"
                      today={platformToday()}
                      value={period}
                      onChange={setPeriod}
                      presets={INVOICE_PERIODS}
                      // An invoice is for a period. "All time" is not one.
                      allowAll={false}
                      align="right"
                    />
                    <Button
                      size="sm"
                      disabled={raise.isPending || toBill.length === 0}
                      onClick={() => open && period.from && period.to && raise.mutate({ id: open, from: period.from, to: period.to })}
                    >
                      Raise invoice
                    </Button>
                  </div>
                </div>
                <p className="mb-2 text-theme-xs text-gray-500 dark:text-gray-400" data-testid="invoice-would-bill">
                  {detail.data.charges.length === 0
                    ? "Nothing has been earned that is not already on an invoice."
                    : toBill.length === 0
                      ? `Nothing was earned in ${formatRange(period, platformToday())}. Pick the period the orders below fall in.`
                      : `${toBill.length} of ${detail.data.charges.length} ${detail.data.charges.length === 1 ? "order" : "orders"} fall in ${formatRange(period)} — an invoice for ${money(toBill.reduce((sum, ch) => sum + ch.amount, 0))}.`}
                </p>
                <div className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {detail.data.charges.length === 0 && (
                    <p className="px-4 py-6 text-center text-theme-sm text-gray-400">
                      Nothing outstanding.
                    </p>
                  )}
                  {detail.data.charges.map((ch) => (
                    // Dimmed when the period above would leave it out — so the
                    // list itself shows what the invoice will and will not take.
                    <div key={ch.id} className={`flex items-center gap-3 px-4 py-2 text-theme-sm ${inPeriod(ch) ? "" : "opacity-45"}`}>
                      <span className="flex-1 text-gray-700 dark:text-gray-300">
                        {ch.order_number}
                        <span className="ml-2 text-theme-xs text-gray-400">{formatEntryDate(chargedOn(ch))}</span>
                      </span>
                      <span className="text-gray-400">
                        {money(ch.base_amount)} × {ch.rate_percent}%
                      </span>
                      <span className="w-20 text-right font-medium text-gray-800 dark:text-white/90">
                        {money(ch.amount)}
                      </span>
                      <button
                        className={ROW_ACTION_DANGER}
                        onClick={() =>
                          setAsking({ kind: "waive", id: ch.id, what: ch.order_number ?? "this charge" })
                        }
                      >
                        Write off
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-gray-800 dark:text-white/90">Invoices</h4>
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {detail.data.invoices.length === 0 && (
                    <p className="px-4 py-6 text-center text-theme-sm text-gray-400">
                      None raised yet.
                    </p>
                  )}
                  {detail.data.invoices.map((inv) => (
                    <div key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-theme-sm">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-800 dark:text-white/90">{inv.number}</div>
                        <div className="text-theme-xs text-gray-400">
                          {formatRange({ from: inv.period_start, to: inv.period_end })} · {inv.orders_count} {inv.orders_count === 1 ? "order" : "orders"}
                          {inv.status === "paid" && inv.paid_at ? ` · paid ${formatEntryDate(inv.paid_at)}` : ""}
                        </div>
                      </div>
                      <span className="font-medium text-gray-800 dark:text-white/90">
                        {money(inv.amount)}
                      </span>
                      <Pill tone={inv.status === "paid" ? "green" : inv.status === "void" ? "slate" : "amber"}>
                        {inv.status === "void" ? "withdrawn" : inv.status}
                      </Pill>
                      {inv.status === "unpaid" && (
                        <>
                          <button
                            className={ROW_ACTION}
                            disabled={markPaid.isPending}
                            onClick={() => markPaid.mutate(inv.id)}
                          >
                            Mark paid
                          </button>
                          <button
                            className={ROW_ACTION_DANGER}
                            onClick={() => setAsking({ kind: "void", id: inv.id, what: inv.number })}
                          >
                            Withdraw
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </ModalForm>
      </Modal>

      {/*
        ── WHY, BEFORE THE MONEY MOVES ──────────────────────────────

        The server requires a reason on both of these and the screen asks for
        it rather than inventing one. Two different sentences, because they are
        two different events: a charge written off is money the platform has
        decided not to collect, and an invoice withdrawn puts its charges back
        on the outstanding pile — the shop will see them again.
      */}
      <Modal isOpen={asking !== null} onClose={() => { setAsking(null); setReason(""); }} className="max-w-md">
        <ModalForm
          title={asking?.kind === "waive" ? "Write off this charge" : "Withdraw this invoice"}
          description={
            asking?.kind === "waive"
              ? `${asking.what} — the platform will not collect this commission.`
              : asking
                ? `${asking.what} — its charges become outstanding again and can be billed in a later invoice.`
                : undefined
          }
          footer={
            <>
              <Button size="sm" variant="outline" onClick={() => { setAsking(null); setReason(""); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={reason.trim().length === 0 || waive.isPending || voidInvoice.isPending}
                onClick={() => {
                  if (asking === null) return;
                  const v = { id: asking.id, reason: reason.trim() };
                  if (asking.kind === "waive") waive.mutate(v);
                  else voidInvoice.mutate(v);
                }}
              >
                {waive.isPending || voidInvoice.isPending ? "Saving…" : "Confirm"}
              </Button>
            </>
          }
        >
          <div>
            <Label>Reason</Label>
            <TextArea
              rows={3}
              value={reason}
              onChange={(v) => setReason(v)}
              placeholder="Order was refunded in full"
            />
            {/* Not a nag — the button is disabled until this is typed, and a
                disabled button with no explanation is the thing being avoided. */}
            <p className="mt-1.5 text-theme-xs text-gray-400">
              Recorded against this shop's commission history. Required.
            </p>
          </div>
        </ModalForm>
      </Modal>
    </>
  );
}
