import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import TextArea from "../../../components/form/input/TextArea";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useAuthStore } from "../../../stores/authStore";
import { useMoney } from "../../shop/hooks/useShop";
import {
  useCurrentDay,
  useDayDetail,
  useDayHistory,
  useDayMutations,
  useDeposits,
} from "../hooks/useDay";
import { signerName, type BusinessDay, type DayShift } from "../services/dayService";

type Tab = "today" | "history" | "banking";

const TENDER_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  wallet: "Wallet",
  credit: "On account",
  loyalty: "Points",
  trade_in: "Traded in",
};

const dayDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

const clock = (t: string | null) =>
  t ? new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—";

/** Over and short are both problems; only zero is the good colour. */
function VarianceText({ value, money }: { value: number; money: (n: number) => string }) {
  if (Math.abs(value) < 0.005) {
    return <span className="tabular-nums text-success-600 dark:text-success-400">Balanced</span>;
  }
  const over = value > 0;
  return (
    <span className={`tabular-nums ${over ? "text-warning-600 dark:text-warning-400" : "text-error-600 dark:text-error-400"}`}>
      {over ? "+" : "−"}
      {money(Math.abs(value))} {over ? "over" : "short"}
    </span>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "plain" | "accent" }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <p className="text-theme-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === "accent" ? "text-brand-600 dark:text-brand-400" : "text-gray-800 dark:text-white/90"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-theme-xs text-gray-400">{hint}</p>}
    </div>
  );
}

/**
 * The trading day, and what left for the bank.
 *
 * A shift answers "did this cashier's drawer balance". Neither it nor any
 * number of them answers what an owner actually asks at 10pm — what did the
 * shop take today, and how much of it is going to the bank — because that spans
 * three drawers plus the safe. This is the screen for that question.
 */
export default function DayPage() {
  const money = useMoney();
  const toast = useToast();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission("settings.manage");

  const [tab, setTab] = useState<Tab>("today");

  const day = useCurrentDay();
  const { close, deposit } = useDayMutations();

  // ── Banking a deposit ────────────────────────────────────────────
  const depositModal = useModal();
  const blankDeposit = { amount: "", bank_name: "", account_label: "", slip_number: "", notes: "" };
  const [depositForm, setDepositForm] = useState({ ...blankDeposit });
  const setD = (k: string, v: string) => setDepositForm((f) => ({ ...f, [k]: v }));
  const depositError = deposit.error instanceof ApiError ? deposit.error : null;

  const openDeposit = () => {
    setDepositForm({ ...blankDeposit });
    deposit.reset();
    depositModal.openModal();
  };

  const submitDeposit = () => {
    const text = (v: string) => v.trim() || null;
    deposit.mutate(
      {
        amount: Number(depositForm.amount),
        bank_name: text(depositForm.bank_name),
        account_label: text(depositForm.account_label),
        slip_number: text(depositForm.slip_number),
        notes: text(depositForm.notes),
      },
      {
        onSuccess: () => {
          toast.success(`${money(Number(depositForm.amount))} recorded as banked`);
          depositModal.closeModal();
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't record it."),
      },
    );
  };

  // ── Closing the day off ──────────────────────────────────────────
  const [closeNotes, setCloseNotes] = useState("");
  const closeModal = useModal();

  const submitClose = () => {
    const id = day.data?.day.id;
    if (!id) return;
    close.mutate(
      { id, notes: closeNotes.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("Day closed off");
          setCloseNotes("");
          closeModal.closeModal();
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't close the day."),
      },
    );
  };

  // ── History ──────────────────────────────────────────────────────
  const [range, setRange] = useState({ from: "", to: "" });
  const [page, setPage] = useState(1);
  // Narrowing the range while on page 4 would otherwise land on an empty table.
  const setRangeField = (k: "from" | "to", v: string) => {
    setRange((r) => ({ ...r, [k]: v }));
    setPage(1);
  };
  const listParams = { from: range.from || undefined, to: range.to || undefined, page };
  const history = useDayHistory(listParams);
  const deposits = useDeposits(listParams);
  const pagination = (tab === "history" ? history.data : deposits.data)?.meta.pagination;

  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useDayDetail(detailId);
  const detailModal = useModal();

  const openDetail = (d: BusinessDay) => {
    setDetailId(d.id);
    detailModal.openModal();
  };

  const view = day.data;
  const running = view?.running;

  const shiftFigure = (s: DayShift, key: "sales_total" | "cash_sales" | "expected_cash") =>
    Number(s.live?.[key] ?? s[key] ?? 0);

  return (
    <>
      <PageMeta title="Day & Banking | ShopOS" description="What the shop took today, and what went to the bank" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Day &amp; banking</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            What the shop took today, across every drawer — and how much of it went to the bank.
          </p>
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={openDeposit}>
            Record a deposit
          </Button>
        )}
      </div>

      <div className="mb-5 flex gap-1 rounded-xl border border-gray-200 p-1 dark:border-gray-800 sm:w-fit">
        {([
          ["today", "Today"],
          ["history", "Past days"],
          ["banking", "Banking"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setPage(1); }}
            className={`flex-1 rounded-lg px-4 py-2 text-theme-sm font-medium transition sm:flex-none ${
              tab === key
                ? "bg-brand-500 text-white"
                : "text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/[0.03]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Today ──────────────────────────────────────────────────── */}
      {tab === "today" && (
        <div className="space-y-5">
          {day.isLoading ? (
            <div className="h-40 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
          ) : !view ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No day open yet.
              </p>
              <p className="mt-1 text-theme-xs text-gray-400">
                The day starts by itself when the first cashier opens a drawer — nobody has to remember to start it.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                        {dayDate(view.day.trading_date)}
                      </h3>
                      <Badge size="sm" color="success">Open</Badge>
                    </div>
                    <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
                      {view.day.branch?.name ?? "Main"} · opened {clock(view.day.opened_at)}
                      {signerName(view.day.opened_by) && ` by ${signerName(view.day.opened_by)}`}
                    </p>
                  </div>
                  {canManage && (
                    <Button size="sm" onClick={() => closeModal.openModal()} disabled={close.isPending}>
                      Close off day
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
                  <Stat
                    label="Rung up"
                    value={money(running!.sales_total)}
                    hint={`${running!.sales_count} sale${running!.sales_count === 1 ? "" : "s"}`}
                    tone="accent"
                  />
                  <Stat label="Cash takings" value={money(running!.cash_sales)} hint="Excludes card and account" />
                  <Stat
                    label="In the drawers"
                    value={money(running!.expected_cash)}
                    hint="What every till should hold now"
                  />
                  <Stat label="Banked" value={money(view.banked)} hint={`${view.deposits.length} deposit${view.deposits.length === 1 ? "" : "s"}`} />
                  <Stat label="Still in the shop" value={money(view.unbanked)} hint="Takings not yet banked" />
                  <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                    <p className="text-theme-xs uppercase tracking-wide text-gray-400">Counted so far</p>
                    <p className="mt-1 text-lg font-semibold">
                      <VarianceText value={running!.variance} money={money} />
                    </p>
                    <p className="mt-0.5 text-theme-xs text-gray-400">
                      {running!.shifts - running!.open_shifts} of {running!.shifts} shift
                      {running!.shifts === 1 ? "" : "s"} counted
                    </p>
                  </div>
                </div>
              </div>

              {/* Shifts ───────────────────────────────────────────── */}
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
                <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                  <h4 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">Shifts</h4>
                  <p className="text-theme-xs text-gray-400">
                    An open drawer's figures are live; a closed one shows what it was signed off on.
                  </p>
                </div>
                {view.sessions.length === 0 ? (
                  <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">No shifts yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-theme-sm">
                      <thead className="border-b border-gray-100 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                        <tr>
                          <th className="px-5 py-3">Cashier</th>
                          <th className="px-5 py-3">Lane</th>
                          <th className="px-5 py-3">Hours</th>
                          <th className="px-5 py-3 text-right">Rung up</th>
                          <th className="px-5 py-3 text-right">Expected</th>
                          <th className="px-5 py-3 text-right">Counted</th>
                          <th className="px-5 py-3 text-right">Variance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.sessions.map((s) => (
                          <tr key={s.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                            <td className="px-5 py-3">
                              <span className="text-gray-800 dark:text-white/90">{s.user?.name ?? "—"}</span>
                              {s.status === "open" && (
                                <span className="ml-2">
                                  <Badge size="sm" color="success">on till</Badge>
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{s.register?.name ?? "—"}</td>
                            <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                              {clock(s.opened_at)} – {s.closed_at ? clock(s.closed_at) : "now"}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-gray-800 dark:text-white/90">
                              {money(shiftFigure(s, "sales_total"))}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                              {money(shiftFigure(s, "expected_cash"))}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                              {s.status === "open" ? <span className="text-gray-400">not counted</span> : money(Number(s.counted_cash ?? 0))}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {s.status === "open" ? (
                                <span className="text-gray-400">—</span>
                              ) : (
                                <VarianceText value={Number(s.variance ?? 0)} money={money} />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Today's deposits ─────────────────────────────────── */}
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
                <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                  <h4 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">Gone to the bank today</h4>
                  <p className="text-theme-xs text-gray-400">
                    The safe-to-bank leg. It never touches a drawer — that money left the till hours earlier.
                  </p>
                </div>
                {view.deposits.length === 0 ? (
                  <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                    Nothing banked yet today.
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-50 dark:divide-gray-800/60">
                    {view.deposits.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
                        <span className="text-theme-sm text-gray-700 dark:text-gray-300">
                          {d.bank_name ?? "Bank"}
                          {d.account_label && <span className="text-gray-400"> · {d.account_label}</span>}
                          {d.slip_number && <span className="ml-2 font-mono text-theme-xs text-gray-400">#{d.slip_number}</span>}
                        </span>
                        <span className="text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">
                          {money(d.amount)}
                          <span className="ml-2 text-theme-xs font-normal text-gray-400">
                            {clock(d.deposited_at)}
                            {signerName(d.deposited_by) && ` · ${signerName(d.deposited_by)}`}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Past days / Banking share a date filter ─────────────────── */}
      {tab !== "today" && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <Label>From</Label>
            <Input type="date" value={range.from} onChange={(e) => setRangeField("from", e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={range.to} onChange={(e) => setRangeField("to", e.target.value)} />
          </div>
          {(range.from || range.to) && (
            <Button size="sm" variant="outline" onClick={() => { setRange({ from: "", to: "" }); setPage(1); }}>
              Clear
            </Button>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          {history.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
              ))}
            </div>
          ) : (history.data?.data ?? []).length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">No days in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-theme-sm">
                <thead className="border-b border-gray-100 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                  <tr>
                    <th className="px-5 py-3">Day</th>
                    <th className="px-5 py-3">Branch</th>
                    <th className="px-5 py-3 text-right">Shifts</th>
                    <th className="px-5 py-3 text-right">Rung up</th>
                    <th className="px-5 py-3 text-right">Counted</th>
                    <th className="px-5 py-3 text-right">Banked</th>
                    <th className="px-5 py-3 text-right">Variance</th>
                    <th className="px-5 py-3">Signed off</th>
                  </tr>
                </thead>
                <tbody>
                  {(history.data?.data ?? []).map((d) => (
                    <tr key={d.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                      <td className="px-5 py-3">
                        <button
                          onClick={() => openDetail(d)}
                          className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                        >
                          {dayDate(d.trading_date)}
                        </button>
                        {d.status === "open" && (
                          <span className="ml-2">
                            <Badge size="sm" color="success">open</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{d.branch?.name ?? "Main"}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                        {d.shifts_count ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-gray-800 dark:text-white/90">
                        {d.status === "closed" ? money(Number(d.sales_total ?? 0)) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                        {d.status === "closed" ? money(Number(d.counted_cash ?? 0)) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                        {d.status === "closed" ? money(Number(d.banked_amount ?? 0)) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {d.status === "closed" ? (
                          <VarianceText value={Number(d.variance ?? 0)} money={money} />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                        {signerName(d.closed_by) ?? <span className="text-gray-400">still open</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "banking" && (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          {deposits.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
              ))}
            </div>
          ) : (deposits.data?.data ?? []).length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
              Nothing banked in this range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-theme-sm">
                <thead className="border-b border-gray-100 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                  <tr>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Bank</th>
                    <th className="px-5 py-3">Slip</th>
                    <th className="px-5 py-3">Trading day</th>
                    <th className="px-5 py-3">Taken by</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(deposits.data?.data ?? []).map((d) => (
                    <tr key={d.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                      <td className="px-5 py-3 text-gray-700 dark:text-gray-300">
                        {new Date(d.deposited_at).toLocaleDateString()}
                        <span className="ml-2 text-theme-xs text-gray-400">{clock(d.deposited_at)}</span>
                      </td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                        {d.bank_name ?? "—"}
                        {d.account_label && <span className="text-gray-400"> · {d.account_label}</span>}
                      </td>
                      <td className="px-5 py-3 font-mono text-theme-xs text-gray-500 dark:text-gray-400">
                        {d.slip_number ?? <span className="font-sans text-gray-400">no slip</span>}
                      </td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                        {d.business_day ? new Date(d.business_day.trading_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{signerName(d.deposited_by) ?? "—"}</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-gray-800 dark:text-white/90">
                        {money(d.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab !== "today" && pagination && pagination.last_page > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-theme-xs text-gray-400">
            {pagination.total} {tab === "history" ? "days" : "deposits"} · page {pagination.current_page} of{" "}
            {pagination.last_page}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={pagination.current_page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pagination.current_page >= pagination.last_page}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Record a deposit ───────────────────────────────────────────── */}
      <Modal isOpen={depositModal.isOpen} onClose={depositModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Record a deposit</h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          Cash physically taken to the bank. No drawer moves — that money left the till hours ago.
        </p>

        <div className="space-y-4">
          <div>
            <Label>Amount <span className="text-error-500">*</span></Label>
            <Input
              type="number"
              min="0"
              step={0.01}
              value={depositForm.amount}
              onChange={(e) => setD("amount", e.target.value)}
              placeholder="40000"
            />
            {depositError?.errors.amount?.[0] && (
              <p className="mt-1 text-theme-xs text-error-500">{depositError.errors.amount[0]}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Bank</Label>
              <Input value={depositForm.bank_name} onChange={(e) => setD("bank_name", e.target.value)} placeholder="Meezan" />
            </div>
            <div>
              <Label>Account</Label>
              <Input
                value={depositForm.account_label}
                onChange={(e) => setD("account_label", e.target.value)}
                placeholder="Current — 0123"
              />
            </div>
          </div>
          <div>
            <Label>Slip number</Label>
            <Input value={depositForm.slip_number} onChange={(e) => setD("slip_number", e.target.value)} placeholder="DEP-99213" />
            <p className="mt-1 text-theme-xs text-gray-400">
              Without it the record is a claim. With it, it's provable against a statement weeks later.
            </p>
          </div>
          <div>
            <Label>Notes</Label>
            <TextArea rows={2} value={depositForm.notes} onChange={(v) => setD("notes", v)} />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={depositModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={submitDeposit} disabled={deposit.isPending || !(Number(depositForm.amount) > 0)}>
            {deposit.isPending ? "Recording…" : "Record deposit"}
          </Button>
        </div>
      </Modal>

      {/* Close off the day ──────────────────────────────────────────── */}
      <Modal isOpen={closeModal.isOpen} onClose={closeModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Close off the day</h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          Your signature on every cashier's variance. The figures freeze here and never move again.
        </p>

        {(running?.open_shifts ?? 0) > 0 && (
          <div className="mb-4 rounded-xl border border-warning-200 bg-warning-50 p-3 text-theme-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-400">
            {running!.open_shifts === 1
              ? "A shift is still open. It has to be counted out first — a running drawer has no figure to roll up."
              : `${running!.open_shifts} shifts are still open. They have to be counted out first.`}
          </div>
        )}

        <div className="space-y-2">
          <Label>Notes</Label>
          <TextArea
            rows={3}
            value={closeNotes}
            onChange={setCloseNotes}
            placeholder="e.g. lane 2 short 200 — Sana counted twice, accepted"
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={closeModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={submitClose} disabled={close.isPending || (running?.open_shifts ?? 0) > 0}>
            {close.isPending ? "Closing…" : "Close off day"}
          </Button>
        </div>
      </Modal>

      {/* A past day ─────────────────────────────────────────────────── */}
      <Modal isOpen={detailModal.isOpen} onClose={detailModal.closeModal} className="max-w-2xl p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          {detail.data ? dayDate(detail.data.trading_date) : "…"}
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          {detail.data
            ? `${detail.data.branch?.name ?? "Main"} · ${detail.data.shifts_count ?? 0} shift${detail.data.shifts_count === 1 ? "" : "s"}`
              + (signerName(detail.data.closed_by) ? ` · signed off by ${signerName(detail.data.closed_by)}` : " · still open")
            : "Loading…"}
        </p>

        {detail.isLoading ? (
          <div className="h-32 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
        ) : detail.data ? (
          <div className="max-h-[65vh] space-y-5 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Rung up" value={money(Number(detail.data.sales_total ?? 0))} tone="accent" />
              <Stat label="Expected" value={money(Number(detail.data.expected_cash ?? 0))} />
              <Stat label="Counted" value={money(Number(detail.data.counted_cash ?? 0))} />
              <Stat label="Banked" value={money(Number(detail.data.banked_amount ?? 0))} />
            </div>

            {detail.data.tender_mix && Object.keys(detail.data.tender_mix).length > 0 && (
              <div>
                <h4 className="mb-2 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                  What it was paid with
                </h4>
                <ul className="space-y-1 text-theme-sm">
                  {Object.entries(detail.data.tender_mix).map(([method, amount]) => (
                    <li key={method} className="flex justify-between gap-3 text-gray-600 dark:text-gray-400">
                      <span>{TENDER_LABELS[method] ?? method}</span>
                      <span className="tabular-nums">{money(amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h4 className="mb-2 text-theme-sm font-semibold text-gray-800 dark:text-white/90">Shifts</h4>
              <ul className="space-y-2">
                {(detail.data.sessions ?? []).map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-700"
                  >
                    <span className="text-theme-sm text-gray-700 dark:text-gray-300">
                      {s.user?.name ?? "—"}
                      <span className="ml-2 text-theme-xs text-gray-400">
                        {s.register?.name ?? "counter"} · {clock(s.opened_at)}–{clock(s.closed_at)}
                      </span>
                    </span>
                    <span className="text-theme-sm tabular-nums text-gray-800 dark:text-white/90">
                      {money(Number(s.sales_total ?? 0))}
                      <span className="ml-3 text-theme-xs font-normal">
                        <VarianceText value={Number(s.variance ?? 0)} money={money} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {(detail.data.deposits ?? []).length > 0 && (
              <div>
                <h4 className="mb-2 text-theme-sm font-semibold text-gray-800 dark:text-white/90">Banked</h4>
                <ul className="space-y-1 text-theme-sm">
                  {detail.data.deposits.map((d) => (
                    <li key={d.id} className="flex justify-between gap-3 text-gray-600 dark:text-gray-400">
                      <span>
                        {d.bank_name ?? "Bank"}
                        {d.slip_number && <span className="ml-2 font-mono text-theme-xs">#{d.slip_number}</span>}
                      </span>
                      <span className="tabular-nums">{money(d.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.data.notes && (
              <p className="rounded-xl bg-gray-50 p-3 text-theme-sm text-gray-600 dark:bg-white/[0.03] dark:text-gray-400">
                {detail.data.notes}
              </p>
            )}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
