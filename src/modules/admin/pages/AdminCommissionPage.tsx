import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { apiGet, apiPost, apiPut } from "../../../common/api/client";
import { ApiError } from "../../../common/types/api";
import PageMeta from "../../../components/common/PageMeta";
import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useToast } from "../../../components/ui/toast";
import { ROW_ACTION } from "../../../components/ui/table/rowAction";
import { formatMoney } from "../../../common/format/money";
import { toIsoDate } from "../../../components/ui/filters/dateRanges";

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
  outstanding_orders: number;
  outstanding_amount: number;
  unpaid_invoices: number;
};

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
 * TODAY IS THE DAY IT IS HERE.
 *
 * `toISOString().slice(0, 10)` is the obvious spelling and it is wrong east of
 * Greenwich: in Karachi every moment before 05:00 local is still yesterday in
 * UTC, so an invoice raised early in the morning would bill a window that
 * started on the last day of the previous month. `toIsoDate` reads the LOCAL
 * calendar, and is the one answer this codebase keeps to.
 */
const today = () => toIsoDate(new Date());
const monthStart = () => {
  const d = new Date();
  return toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1));
};

export default function AdminCommissionPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [owingOnly, setOwingOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState("");
  const [shopRate, setShopRate] = useState("");

  const settings = useQuery({
    queryKey: ["admin", "commission", "settings"],
    queryFn: async () => (await apiGet<{ settings: Settings; max_rate: number }>("/admin/commission/settings")).data,
  });

  const shops = useQuery({
    queryKey: ["admin", "commission", search, owingOnly],
    queryFn: async () =>
      (
        await apiGet<{ shops: Shop[]; total_outstanding: number }>("/admin/commission", {
          params: { search: search.trim() || undefined, owing: owingOnly ? 1 : undefined },
        })
      ).data,
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

  const list = shops.data?.shops ?? [];
  const owed = shops.data?.total_outstanding ?? 0;

  return (
    <>
      <PageMeta title="Commission | CartZe" description="What the marketplace earns, and who owes it" />

      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Commission</h1>
        <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
          A share of what the marketplace sells for each shop. Separate from their plan, which is
          what they pay for the software — the two are billed apart so either can be questioned.
        </p>
      </div>

      {/* ── The rate everybody follows ───────────────────────────────── */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
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

            {!s.commission_enabled && (
              <p className="mb-4 rounded-xl bg-warning-50 px-4 py-3 text-theme-sm text-warning-700 dark:bg-warning-500/10 dark:text-warning-400">
                Commission is off. Completed online orders are recording nothing, and no shop is
                being charged.
              </p>
            )}

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

      {/* ── Who owes what ────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-gray-800 dark:text-white/90">{money(owed)}</span>
          <span className="text-theme-sm text-gray-500 dark:text-gray-400">outstanding across all shops</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            className={`rounded-xl border px-3 py-2 text-theme-sm ${
              owingOnly
                ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10"
                : "border-gray-200 text-gray-600 dark:border-gray-800 dark:text-gray-300"
            }`}
            onClick={() => setOwingOnly((v) => !v)}
          >
            Only shops that owe
          </button>
          <div className="w-56">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Shop name" />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        {shops.isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : list.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {owingOnly ? "Nobody owes anything." : "No shops."}
          </p>
        ) : (
          <table className="w-full min-w-[44rem] text-left text-theme-sm">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-5 py-3 font-medium">Shop</th>
                <th className="px-5 py-3 font-medium">Rate</th>
                <th className="px-5 py-3 font-medium">Unbilled orders</th>
                <th className="px-5 py-3 font-medium">Outstanding</th>
                <th className="px-5 py-3 font-medium">Invoices</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {list.map((shop) => (
                <tr key={shop.id} className="text-gray-700 dark:text-gray-300">
                  <td className="px-5 py-3 font-medium text-gray-800 dark:text-white/90">
                    {shop.business_name}
                  </td>
                  <td className="px-5 py-3">
                    {shop.effective_rate}%
                    {/*
                      Null means "follows the platform". Saying so beats
                      printing the resolved number as though the shop had
                      chosen it — the difference matters the moment the
                      platform rate moves.
                    */}
                    {shop.commission_rate === null && (
                      <span className="ml-1 text-theme-xs text-gray-400">platform</span>
                    )}
                  </td>
                  <td className="px-5 py-3">{shop.outstanding_orders || "—"}</td>
                  <td className="px-5 py-3">
                    {shop.outstanding_amount > 0 ? (
                      <span className="font-medium text-warning-600 dark:text-warning-400">
                        {money(shop.outstanding_amount)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {shop.unpaid_invoices > 0 ? (
                      <Badge color="warning">{shop.unpaid_invoices} unpaid</Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button className={ROW_ACTION} onClick={() => setOpen(shop.id)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── One shop ─────────────────────────────────────────────────── */}
      <Modal isOpen={open !== null} onClose={() => setOpen(null)} className="max-w-3xl">
        <ModalForm
          title={detail.data?.shop.business_name ?? "Commission"}
          description={
            detail.data
              ? `${detail.data.shop.effective_rate}% · ${money(detail.data.outstanding.amount)} outstanding across ${detail.data.outstanding.orders} order${detail.data.outstanding.orders === 1 ? "" : "s"}`
              : undefined
          }
          footer={
            <>
              <Button variant="outline" onClick={() => setOpen(null)}>
                Close
              </Button>
              <Button
                disabled={raise.isPending || (detail.data?.outstanding.orders ?? 0) === 0}
                onClick={() =>
                  open && raise.mutate({ id: open, from: monthStart(), to: today() })
                }
              >
                Raise invoice for this month
              </Button>
            </>
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
                <h4 className="mb-2 text-sm font-semibold text-gray-800 dark:text-white/90">
                  Unbilled orders
                </h4>
                <div className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {detail.data.charges.length === 0 && (
                    <p className="px-4 py-6 text-center text-theme-sm text-gray-400">
                      Nothing outstanding.
                    </p>
                  )}
                  {detail.data.charges.map((ch) => (
                    <div key={ch.id} className="flex items-center gap-3 px-4 py-2 text-theme-sm">
                      <span className="flex-1 text-gray-700 dark:text-gray-300">{ch.order_number}</span>
                      <span className="text-gray-400">
                        {money(ch.base_amount)} × {ch.rate_percent}%
                      </span>
                      <span className="w-20 text-right font-medium text-gray-800 dark:text-white/90">
                        {money(ch.amount)}
                      </span>
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
                          {inv.period_start} → {inv.period_end} · {inv.orders_count} orders
                        </div>
                      </div>
                      <span className="font-medium text-gray-800 dark:text-white/90">
                        {money(inv.amount)}
                      </span>
                      <Badge
                        color={
                          inv.status === "paid" ? "success" : inv.status === "void" ? "light" : "warning"
                        }
                      >
                        {inv.status}
                      </Badge>
                      {inv.status === "unpaid" && (
                        <button
                          className={ROW_ACTION}
                          disabled={markPaid.isPending}
                          onClick={() => markPaid.mutate(inv.id)}
                        >
                          Mark paid
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </ModalForm>
      </Modal>
    </>
  );
}
