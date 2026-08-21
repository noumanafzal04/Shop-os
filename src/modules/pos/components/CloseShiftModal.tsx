import { useMemo, useState } from "react";
import { Modal } from "../../../components/ui/modal";
import Button from "../../../components/ui/button/Button";
import { useMoney } from "../../shop/hooks/useShop";
import { useSessionReport } from "../hooks/usePos";
import { tillFlag, useTillSettings } from "../../offline/tillSettings";
import { useConnectionStore } from "../../../stores/connectionStore";
import { useOfflineStore } from "../../offline/offlineStore";

/** Tenders a cashier may be asked to declare. Cash is counted, not declared. */
const DECLARABLE = [
  { key: "card", label: "Card" },
  { key: "bank_transfer", label: "Bank / wallet" },
  { key: "other", label: "Other" },
] as const;

/**
 * Counting the drawer out.
 *
 * The old close was one box: type a total. That is where cash control quietly
 * fails — a cashier who types a total has already done the arithmetic in their
 * head, and the drawer's real composition, the only thing another person could
 * re-check, is gone.
 *
 * Counting by note and coin derives the total instead. Under blind close the
 * expected figure is never shown: a till that says "expected 47,320" gets a
 * count of 47,320, often not dishonestly — a human who knows the answer stops
 * counting when they reach it.
 */
export default function CloseShiftModal({
  isOpen,
  onClose,
  onSubmit,
  busy,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    counted: number;
    denominations?: Record<string, number>;
    declared?: Record<string, number>;
    notes?: string;
  }) => void;
  busy: boolean;
}) {
  const money = useMoney();
  const report = useSessionReport(isOpen);

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState("");
  const [declared, setDeclared] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  // With no server the report never arrives, and this screen used to fall back
  // to hardcoded defaults — so a shop that counts by total got the note grid,
  // and a shop that must declare its card takings was never asked, losing that
  // shift's declaration. The shop's own answers ride down with the catalog;
  // they were simply never read. Server first, device second, defaults last.
  const cached = useTillSettings(isOpen);
  const byNote = report.data?.denomination_count ?? tillFlag(cached, "pos_denomination_count", true);
  const blind = report.data?.blind_close ?? tillFlag(cached, "pos_blind_close", false);
  const askTenders = report.data?.declare_tenders ?? tillFlag(cached, "pos_declare_tenders", false);

  // Counting out with work still on the device.
  //
  // The plan always said the Z-read is PROVISIONAL offline, and the till never
  // said it to anybody. Every figure this shift is measured against — expected
  // cash, the variance, the Z — is the server's arithmetic over what the server
  // holds, and it does not yet hold the sales sitting in this device's queue.
  // The order of the flush is what makes it come right (`open`, then the sales,
  // then `close`), but a cashier handing over now deserves to know the number
  // they are about to be judged on is not final yet.
  const connected = useConnectionStore((c) => c.online && c.reachable);
  const owed = useOfflineStore((o) => o.pending);
  const provisional = !connected || owed > 0;
  const denominations = report.data?.denominations ?? [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];
  const expected = report.data?.drawer?.expected_cash;

  const countedTotal = useMemo(() => {
    if (!byNote) return Number(typed) || 0;
    return denominations.reduce((sum, d) => sum + d * (Number(counts[String(d)]) || 0), 0);
  }, [byNote, typed, counts, denominations]);

  // Only meaningful when the cashier is allowed to see what was expected.
  const variance = expected === undefined ? null : Math.round((countedTotal - expected) * 100) / 100;

  const submit = () => {
    const denoms: Record<string, number> = {};
    for (const d of denominations) {
      const n = Number(counts[String(d)]) || 0;
      if (n > 0) denoms[String(d)] = n;
    }

    const tenders: Record<string, number> = {};
    for (const t of DECLARABLE) {
      const raw = declared[t.key];
      // Zero is a declaration ("the card machine took nothing today"), so an
      // explicitly typed 0 is kept and only an untouched box is skipped.
      if (raw !== undefined && raw.trim() !== "") tenders[t.key] = Number(raw) || 0;
    }

    onSubmit({
      counted: countedTotal,
      denominations: byNote && Object.keys(denoms).length ? denoms : undefined,
      declared: Object.keys(tenders).length ? tenders : undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg p-6">
      <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Close shift</h3>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        {byNote
          ? "Count the drawer note by note — the total adds itself up."
          : "Count the drawer and enter the cash total."}
        {blind && " Expected cash is hidden until you've counted."}
      </p>

      {provisional && (
        <p className="mb-4 rounded-lg border border-warning-300 bg-warning-50 p-3 text-theme-sm text-warning-700 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-400">
          {owed > 0
            ? `${owed} sale${owed === 1 ? "" : "s"} on this device ${owed === 1 ? "has" : "have"} not reached the server yet. `
            : "This till has no line right now. "}
          Count the drawer as usual — the count is kept and sent. The Z-read and
          the variance are worked out by the server once everything has arrived,
          so treat any figure here as provisional until then.
        </p>
      )}

      {byNote ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {denominations.map((d) => {
            const qty = Number(counts[String(d)]) || 0;
            return (
              <div key={d} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-right text-sm tabular-nums text-gray-500 dark:text-gray-400">
                  {d.toLocaleString()}
                </span>
                <span className="text-gray-300">×</span>
                <input
                  inputMode="numeric"
                  // Ten identical boxes, and until now every one of them was
                  // announced as "0" — so the row is legible only to somebody
                  // who can see the figure printed to its left. This is a
                  // drawer being counted; naming the box is the difference
                  // between counting the five-hundreds and counting the fives.
                  aria-label={`How many ${d.toLocaleString()} notes`}
                  data-denomination={d}
                  className="h-9 w-16 rounded-lg border border-gray-200 bg-white px-2 text-center text-sm tabular-nums text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                  value={counts[String(d)] ?? ""}
                  placeholder="0"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setCounts((c) => ({ ...c, [String(d)]: e.target.value.replace(/\D/g, "") }))}
                />
                <span className={`flex-1 text-right text-sm tabular-nums ${qty ? "text-gray-700 dark:text-gray-200" : "text-gray-300 dark:text-gray-600"}`}>
                  {qty ? (d * qty).toLocaleString() : "—"}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          <label className="text-sm text-gray-500 dark:text-gray-400">Counted cash</label>
          <input
            type="number"
            min="0"
            className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      )}

      <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 dark:bg-white/[0.04]">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">Counted</span>
          <span className="text-lg font-semibold tabular-nums text-gray-800 dark:text-white/90">
            {money(countedTotal)}
          </span>
        </div>
        {expected !== undefined && (
          <>
            <div className="mt-1 flex items-baseline justify-between text-theme-xs">
              <span className="text-gray-400">Expected</span>
              <span className="tabular-nums text-gray-500">{money(expected)}</span>
            </div>
            {variance !== null && Math.abs(variance) > 0.001 && (
              <div className="mt-1 flex items-baseline justify-between text-theme-xs">
                <span className="text-gray-400">{variance > 0 ? "Over" : "Short"}</span>
                <span className="font-medium tabular-nums text-error-600 dark:text-error-400">
                  {money(Math.abs(variance))}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {askTenders && (
        <div className="mt-4">
          <p className="mb-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400">
            What the machines took
          </p>
          <div className="grid grid-cols-3 gap-2">
            {DECLARABLE.map((t) => (
              <div key={t.key}>
                <label className="text-theme-xs text-gray-500 dark:text-gray-400">{t.label}</label>
                <input
                  inputMode="decimal"
                  className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-right text-sm tabular-nums text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                  value={declared[t.key] ?? ""}
                  placeholder="—"
                  onChange={(e) => setDeclared((d) => ({ ...d, [t.key]: e.target.value.replace(/[^\d.]/g, "") }))}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        className="mt-4 h-10 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
        placeholder="Notes (optional) — anything that explains a difference"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="mt-5 flex justify-end gap-3">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={busy}>
          {busy ? "Closing…" : "Close shift"}
        </Button>
      </div>
    </Modal>
  );
}
