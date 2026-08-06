import { useState } from "react";
import { Modal } from "../../../components/ui/modal";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import TextArea from "../../../components/form/input/TextArea";
import { AlertIcon, ChevronLeftIcon, CloseIcon } from "../../../icons";
import { ApiError } from "../../../common/types/api";
import { useToast } from "../../../components/ui/toast";
import { useShopSettings } from "../../shop/hooks/useShop";
import { useCashMovementMutation, useSessionReport } from "../hooks/usePos";
import type { CashMovement, ManualMovementType } from "../services/posService";

/**
 * The X-read, in the cashier's words: what this drawer should hold RIGHT NOW,
 * and the five non-sale cash actions that change it.
 *
 * Expected cash is the number the cashier is counted against at close, so the
 * panel shows the whole chain that produced it (float → tenders → change →
 * refunds → movements) rather than the total alone. A cashier who can see the
 * arithmetic can dispute a variance; one handed only a figure cannot.
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** No drawer, no X-read — the panel explains instead of calling the endpoint. */
  hasOpenShift: boolean;
}

/** The counter's vocabulary, not accounting's. System types included — the
 *  drawer shows them even though the till can never post them. */
const MOVEMENT_LABEL: Record<string, string> = {
  paid_in: "Paid in",
  paid_out: "Paid out",
  drop: "Safe drop",
  float_add: "Float added",
  no_sale: "No sale",
  khata_in: "Khata received",
  supplier_out: "Supplier paid",
  expense_out: "Expense paid",
  void_refund: "Void refund",
  deposit_in: "Advance taken",
  deposit_out: "Advance returned",
};

const TENDER_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  credit: "Credit (khata)",
  // An advance settled at collection. Named for what the cashier needs to
  // know — this money is NOT in today's drawer; it arrived weeks ago.
  deposit: "Advance (paid earlier)",
  other: "Other",
};

/** Fallback for a type the server knows and this build doesn't. */
const humanize = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

interface ActionSpec {
  type: ManualMovementType;
  label: string;
  /** What this action means at the counter — the cashier picks by meaning. */
  hint: string;
  direction: "in" | "out" | "none";
  done: string;
}

const ACTIONS: ActionSpec[] = [
  { type: "paid_in", label: "Paid in", direction: "in", done: "Paid in recorded", hint: "Cash put into the till that isn't a sale." },
  { type: "paid_out", label: "Paid out", direction: "out", done: "Paid out recorded", hint: "Cash taken out for a small expense — a delivery, tea, a bill paid at the counter." },
  { type: "drop", label: "Safe drop", direction: "out", done: "Safe drop recorded", hint: "Cash moved from the till to the safe, so the drawer isn't sitting on the day's takings." },
  { type: "float_add", label: "Add float", direction: "in", done: "Float added", hint: "More change put in so the till can break notes." },
  { type: "no_sale", label: "No sale", direction: "none", done: "No sale recorded — drawer opened", hint: "Opens the drawer and records that it was opened without a sale." },
];

// Direction is carried by shape AND text, never colour alone: a colour-blind
// cashier and a greyscale end-of-shift printout both have to read it.
const InGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M8 3v8m0 0l-3-3m3 3l3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const OutGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M8 13V5m0 0L5 8m3-3l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const EventGlyph = ({ className = "h-3.5 w-3.5" }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
    <rect x="2.5" y="5.5" width="11" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6.5 8.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const DirectionPill = ({ direction }: { direction: CashMovement["direction"] }) => {
  const spec =
    direction === "in"
      ? { glyph: <InGlyph />, word: "In", cls: "border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400" }
      : direction === "out"
        ? { glyph: <OutGlyph />, word: "Out", cls: "border-error-200 bg-error-50 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400" }
        : { glyph: <EventGlyph />, word: "Event", cls: "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-white/5 dark:text-gray-300" };
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-theme-xs font-medium ${spec.cls}`}>
      {spec.glyph}
      {spec.word}
    </span>
  );
};

export default function CashDrawerPanel({ isOpen, onClose, hasOpenShift }: Props) {
  const settings = useShopSettings();
  const cur = settings.data?.currency_symbol ?? "Rs";
  // Cash is counted to the paisa here — a drawer read that rounds is a variance
  // waiting to happen, unlike the ticket totals elsewhere in the POS.
  const money = (n: string | number) => {
    const v = Number(n);
    return `${cur} ${(Number.isFinite(v) ? v : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const when = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  const report = useSessionReport(isOpen && hasOpenShift);
  const record = useCashMovementMutation();
  const toast = useToast();

  // The panel is one modal in two states: the read, or the form for one action.
  // A second stacked modal would fight the first for the escape key.
  const [action, setAction] = useState<ActionSpec | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);

  const backToRead = () => {
    setAction(null);
    setAmount("");
    setReason("");
    setNote("");
    setError(null);
  };
  const dismiss = () => {
    backToRead();
    onClose();
  };

  const drawer = report.data?.drawer;
  const session = report.data?.session;
  const movements = report.data?.movements ?? [];

  const submit = () => {
    if (!action) return;
    const needsAmount = action.direction !== "none";
    const amt = Number(amount);
    if (needsAmount && !(amt > 0)) {
      setError({ message: "Enter an amount greater than zero." });
      return;
    }
    setError(null);
    record.mutate(
      {
        type: action.type,
        ...(needsAmount ? { amount: amt } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success(action.done);
          backToRead();
        },
        onError: (e) =>
          setError(
            e instanceof ApiError
              ? { message: e.message, code: e.errorCode }
              : { message: "Could not record the movement." },
          ),
      },
    );
  };

  const noShift =
    !hasOpenShift ||
    (report.error instanceof ApiError && (report.error.errorCode === "SHIFT_NOT_OPEN" || report.error.errorCode === "SHIFT_REQUIRED"));

  return (
    <Modal isOpen={isOpen} onClose={dismiss} className="max-w-2xl p-0" showCloseButton={false}>
      <div className="max-h-[90vh] overflow-y-auto p-5 sm:p-6">
        {/* Header — the read's own title, or the action being recorded. */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* If the shift vanished mid-form, the body drops back to the
                explainer — the header must not still promise the action. */}
            {action && !noShift ? (
              <>
                <button
                  type="button"
                  onClick={backToRead}
                  className="mb-1 flex items-center gap-1 text-theme-xs font-medium text-brand-500 hover:text-brand-600"
                >
                  <ChevronLeftIcon className="h-3.5 w-3.5" /> Drawer
                </button>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">{action.label}</h3>
                <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">{action.hint}</p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Drawer</h3>
                <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">
                  What this till should hold right now
                  {session?.register?.name ? ` · ${session.register.name}` : ""}
                  {session?.opened_at ? ` · open since ${when(session.opened_at)}` : ""}
                </p>
              </>
            )}
          </div>
          <button onClick={dismiss} className="shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Close">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* ── No drawer to read ─────────────────────────────────────── */}
        {noShift ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center dark:border-gray-800 dark:bg-white/[0.03]">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-400 dark:bg-gray-800">
              <EventGlyph className="h-5 w-5" />
            </div>
            <p className="text-theme-sm font-medium text-gray-700 dark:text-gray-200">No open shift</p>
            <p className="mx-auto mt-1 max-w-sm text-theme-sm text-gray-500 dark:text-gray-400">
              A drawer read belongs to a shift. Open one with its cash float and this panel will track what the till
              should hold — and let you record paid-ins, pay-outs and safe drops against it.
            </p>
          </div>
        ) : report.isPending ? (
          // Skeleton in the shape of the read, so nothing jumps when it lands.
          <div className="animate-pulse space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <div className="h-24 rounded-xl bg-gray-100 dark:bg-white/5" />
                <div className="h-44 rounded-xl bg-gray-100 dark:bg-white/5" />
              </div>
              <div className="space-y-3">
                <div className="h-32 rounded-xl bg-gray-100 dark:bg-white/5" />
                <div className="h-32 rounded-xl bg-gray-100 dark:bg-white/5" />
              </div>
            </div>
            <div className="h-10 rounded-xl bg-gray-100 dark:bg-white/5" />
            <div className="h-28 rounded-xl bg-gray-100 dark:bg-white/5" />
          </div>
        ) : report.isError || !drawer || !session ? (
          <div className="rounded-xl border border-error-200 bg-error-50 p-4 dark:border-error-500/30 dark:bg-error-500/10">
            <div className="flex items-start gap-2 text-theme-sm text-error-700 dark:text-error-400">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {report.error instanceof ApiError ? report.error.message : "Could not load the drawer read."}
            </div>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => report.refetch()}>
              Try again
            </Button>
          </div>
        ) : action ? (
          /* ── Record a movement ─────────────────────────────────── */
          <div className="space-y-4">
            {action.direction !== "none" && (
              <div>
                <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">
                  Amount <span className="font-normal text-gray-400">({cur})</span>
                </label>
                <Input type="number" min="0" step={0.01} placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                {action.direction === "out" && (
                  <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
                    {drawer.expected_cash === undefined
                      ? "Counted blind — the expected figure is shown after you close."
                      : <>The drawer holds <span className="font-medium tabular-nums">{money(drawer.expected_cash)}</span> right now.</>}
                  </p>
                )}
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">
                Reason {action.direction === "none" ? "" : <span className="font-normal text-gray-400">— what the cash was for</span>}
              </label>
              <Input placeholder={action.direction === "none" ? "Why the drawer was opened" : "e.g. courier charges"} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">
                Note <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <TextArea rows={2} placeholder="Anything the manager should see at close" value={note} onChange={setNote} />
            </div>

            {error && (
              <div className="rounded-lg border border-error-200 bg-error-50 p-3 text-theme-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400">
                <div className="flex items-start gap-1.5">
                  <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error.message}</span>
                </div>
                {/* The server's message names the amount the till actually holds
                    — say what to do about it. */}
                {error.code === "INSUFFICIENT_DRAWER_CASH" && (
                  <p className="mt-1.5 pl-6 text-theme-xs">
                    Take out less than the drawer holds, or add a float first.
                  </p>
                )}
                {error.code === "SHIFT_REQUIRED" && (
                  <p className="mt-1.5 pl-6 text-theme-xs">Open a shift, then record this again.</p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
              <Button size="sm" variant="outline" onClick={backToRead}>Cancel</Button>
              <Button size="sm" onClick={submit} disabled={record.isPending}>
                {record.isPending ? "Recording…" : action.direction === "none" ? "Open drawer" : `Record ${action.label.toLowerCase()}`}
              </Button>
            </div>
          </div>
        ) : (
          /* ── The X-read ────────────────────────────────────────── */
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-4">
                {/* The headline: the figure the cashier is counted against. */}
                {/* Under blind close there is no headline figure to show: a
                    till that tells you what it expects gets a count of exactly
                    that. Everything the cashier DID stays below. */}
                {drawer.expected_cash === undefined ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-white/[0.04]">
                    <p className="text-theme-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Blind count</p>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      Count the drawer as it is. The expected figure appears once the shift is closed.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-brand-500 bg-brand-50 p-4 dark:bg-brand-500/10">
                    <p className="text-theme-xs font-medium uppercase tracking-wide text-brand-600 dark:text-brand-400">Expected in drawer</p>
                    <p className="mt-1 text-3xl font-bold text-brand-600 tabular-nums dark:text-brand-400">{money(drawer.expected_cash)}</p>
                    <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
                      Count this at close — the difference is recorded as the shift's variance.
                    </p>
                  </div>
                )}

                {/* Every step that produced it, in the order the server's own
                    maths runs, so the column a cashier adds up by hand lands on
                    the same figure. Signs carry the direction. */}
                <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
                  <p className="mb-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400">How it adds up</p>
                  <dl className="space-y-1.5 text-theme-sm">
                    {[
                      { sign: "+", label: "Cash tendered", value: drawer.cash_tendered },
                      { sign: "−", label: "Change given", value: drawer.change_given },
                      { sign: "−", label: "Cash refunds", value: drawer.cash_refunds },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center justify-between gap-3">
                        <dt className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                          <span className="w-3 text-center font-medium tabular-nums">{r.sign}</span>
                          {r.label}
                        </dt>
                        <dd className="font-medium text-gray-700 tabular-nums dark:text-gray-200">{money(r.value)}</dd>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-1.5 dark:border-gray-800">
                      <dt className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                        <span className="w-3 text-center font-medium">=</span>
                        Cash sales
                      </dt>
                      <dd className="font-semibold text-gray-800 tabular-nums dark:text-white/90">
                        {drawer.cash_sales === undefined ? "—" : money(drawer.cash_sales)}
                      </dd>
                    </div>
                    {[
                      { sign: "+", label: "Opening float", value: session.opening_float },
                      { sign: "+", label: "Cash in (paid in, float)", value: drawer.cash_in },
                      { sign: "−", label: "Cash out (pay-outs, drops)", value: drawer.cash_out },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center justify-between gap-3">
                        <dt className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                          <span className="w-3 text-center font-medium tabular-nums">{r.sign}</span>
                          {r.label}
                        </dt>
                        <dd className="font-medium text-gray-700 tabular-nums dark:text-gray-200">{money(r.value)}</dd>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-1.5 dark:border-gray-800">
                      <dt className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-white/90">
                        <span className="w-3 text-center">=</span>
                        Expected cash
                      </dt>
                      <dd className="font-bold text-brand-600 tabular-nums dark:text-brand-400">
                        {drawer.expected_cash === undefined ? "—" : money(drawer.expected_cash)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="space-y-4">
                {/* Shift so far — the totals a manager asks about mid-day. */}
                <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
                  <p className="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">Shift so far</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                    {[
                      { label: "Sales", value: String(drawer.sales_count) },
                      { label: "Sales total", value: money(drawer.sales_total) },
                      { label: "Discounts", value: money(drawer.discounts) },
                      { label: "Tax", value: money(drawer.tax) },
                      { label: "Voids", value: String(drawer.voids) },
                      { label: "Refunds", value: String(drawer.refunds) },
                    ].map((s) => (
                      <div key={s.label}>
                        <p className="text-theme-xs text-gray-400">{s.label}</p>
                        <p className="text-theme-sm font-semibold text-gray-800 tabular-nums dark:text-white/90">{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tender mix — how the sales total was actually paid. */}
                <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
                  <p className="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">Tender mix</p>
                  {(() => {
                    const mix = Object.entries(drawer.tender_mix);
                    if (mix.length === 0) {
                      return <p className="text-theme-sm text-gray-400">No sales rung on this shift yet.</p>;
                    }
                    const sum = mix.reduce((t, [, v]) => t + Number(v), 0);
                    return (
                      <div className="space-y-2.5">
                        {mix.map(([method, value]) => {
                          const share = sum > 0 ? (Number(value) / sum) * 100 : 0;
                          return (
                            <div key={method}>
                              <div className="mb-1 flex items-baseline justify-between gap-3 text-theme-sm">
                                <span className="text-gray-500 dark:text-gray-400">{TENDER_LABEL[method] ?? humanize(method)}</span>
                                <span className="font-medium text-gray-800 tabular-nums dark:text-white/90">{money(value)}</span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                                <div className="h-full rounded-full bg-brand-500" style={{ width: `${share}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* The five things a cashier may do to the drawer. */}
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
              <p className="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">Record cash movement</p>
              <div className="flex flex-wrap gap-2">
                {ACTIONS.map((a) => (
                  <button
                    key={a.type}
                    type="button"
                    onClick={() => { setError(null); setAction(a); }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-theme-sm font-medium text-gray-700 transition hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:text-gray-200 dark:hover:border-brand-500/40 dark:hover:text-brand-400"
                  >
                    {a.direction === "in" ? <InGlyph /> : a.direction === "out" ? <OutGlyph /> : <EventGlyph />}
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Who moved cash, why, and when — the audit trail for the close. */}
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
              <p className="mb-3 text-theme-xs font-medium uppercase tracking-wide text-gray-400">
                Movements {movements.length > 0 && <span className="text-gray-400">({movements.length})</span>}
              </p>
              {movements.length === 0 ? (
                <p className="text-theme-sm text-gray-400">No cash movements on this shift.</p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {movements.map((m) => (
                    <li key={m.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
                            {MOVEMENT_LABEL[m.type] ?? humanize(m.type)}
                          </span>
                          <DirectionPill direction={m.direction} />
                        </div>
                        {(m.reason || m.note) && (
                          <p className="mt-0.5 truncate text-theme-xs text-gray-500 dark:text-gray-400">
                            {[m.reason, m.note].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        <p className="mt-0.5 text-theme-xs text-gray-400">
                          {m.user?.name ?? "Unknown"} · {when(m.created_at)}
                        </p>
                      </div>
                      {/* Sign first, so the direction survives greyscale. */}
                      <span
                        className={`shrink-0 text-theme-sm font-semibold tabular-nums ${
                          m.direction === "in"
                            ? "text-success-600 dark:text-success-400"
                            : m.direction === "out"
                              ? "text-error-600 dark:text-error-400"
                              : "text-gray-400"
                        }`}
                      >
                        {m.direction === "none" ? "—" : `${m.direction === "in" ? "+" : "−"} ${money(m.amount)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
