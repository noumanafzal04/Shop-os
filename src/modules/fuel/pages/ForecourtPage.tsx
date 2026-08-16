import { useMemo, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Alert from "../../../components/ui/alert/Alert";
import { useToast } from "../../../components/ui/toast";
import { useMoney } from "../../shop/hooks/useShop";
import { useCurrentShift, useFuelMutations, useShifts } from "../hooks/useFuel";
import { StartShiftModal } from "../components/StartShiftModal";
import type { ForecourtDip, ForecourtReading, ForecourtShift } from "../services/fuelService";

/** A totaliser rolls at 999999.999 and starts again — mirrors FuelNozzle::ROLLOVER_AT. */
const ROLLOVER_AT = 1_000_000;

const litres = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })} L`;

function litresBetween(opening: number, closing: number): number {
  const delta = closing - opening;
  return Math.round((delta < 0 ? delta + ROLLOVER_AT : delta) * 1000) / 1000;
}

/**
 * The forecourt shift.
 *
 * Two numbers come off this screen and they answer different questions, which
 * is why they are never added together:
 *
 *   UNBILLED       meters − till. Fuel that left a nozzle and was never rung
 *                  up. A counter problem.
 *   TANK VARIANCE  book − dip. Fuel that left the tank without crossing a
 *                  meter. A leak, or a draw straight from the tank.
 */
export default function ForecourtPage() {
  const money = useMoney();
  const toast = useToast();
  const current = useCurrentShift();
  const history = useShifts({ status: "closed" });
  const { openShift, closeShift } = useFuelMutations();

  const shift = current.data ?? null;
  const [starting, setStarting] = useState(false);

  /**
   * Assignments only. No meter is sent: an echoed reading is written back to
   * the nozzle, so a screen that posted the figure it had cached would move a
   * totaliser while it was naming a man.
   */
  const start = async (readings: Array<{ fuel_nozzle_id: string; attendant_id: string }>) => {
    try {
      const res = await openShift.mutateAsync(readings.length > 0 ? { readings } : {});
      toast.success(`Shift ${res.data.number} opened`);
      setStarting(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the shift");
    }
  };

  return (
    <>
      <PageMeta title="Forecourt | ShopOS" description="Open and reconcile forecourt shifts" />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Forecourt</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Read every meter, dip every tank, and the shift tells you where the fuel went.
          </p>
        </div>
        {!shift && !current.isLoading && (
          <Button size="sm" onClick={() => setStarting(true)} disabled={openShift.isPending}>
            {openShift.isPending ? "Opening…" : "Start shift"}
          </Button>
        )}
      </div>

      {current.isLoading ? (
        <div className="h-56 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
      ) : shift ? (
        <CloseShiftForm
          shift={shift}
          money={money}
          busy={closeShift.isPending}
          onClose={async (body) => {
            try {
              const res = await closeShift.mutateAsync({ id: shift.id, body });
              toast.success(`Shift ${res.data.number} closed`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not close the shift");
            }
          }}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-300">No shift is running.</p>
          <p className="mx-auto mt-1 max-w-md text-theme-xs text-gray-400">
            Starting one records where every meter and tank stands right now. Nothing can be
            reconciled without that first reading.
          </p>
          <Button size="sm" className="mt-3" onClick={() => setStarting(true)}>Start shift</Button>
        </div>
      )}

      {starting && (
        <StartShiftModal onClose={() => setStarting(false)} onStart={start} busy={openShift.isPending} />
      )}

      {/* ── Closed shifts ──────────────────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <header className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">Closed shifts</h3>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <th className="px-4 py-2.5 font-medium">Shift</th>
                <th className="px-4 py-2.5 text-right font-medium">Sold</th>
                <th className="px-4 py-2.5 text-right font-medium">Value</th>
                <th className="px-4 py-2.5 text-right font-medium">Unbilled</th>
                <th className="px-4 py-2.5 text-right font-medium">Tank variance</th>
              </tr>
            </thead>
            <tbody>
              {(history.data?.rows ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                    No shifts closed yet.
                  </td>
                </tr>
              ) : (
                history.data?.rows.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                    <td className="px-4 py-3">
                      <Link
                        to={`/tenant/fuel/shifts/${s.id}`}
                        className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {s.number}
                      </Link>
                      <div className="text-theme-xs text-gray-400">
                        {new Date(s.opened_at).toLocaleString()}
                        {s.price_changed_during && " · rate changed mid-shift"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-200">
                      {litres(Number(s.litres_sold))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-200">
                      {money(s.fuel_value)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <Variance litresValue={Number(s.unbilled_litres)} money={money} amount={s.unbilled_value} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <Variance
                        litresValue={Number(s.tank_variance_litres)}
                        money={money}
                        amount={s.tank_variance_value}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** A variance reads as fine, or it doesn't — colour carries that faster than the digits. */
function Variance({
  litresValue,
  amount,
  money,
}: {
  litresValue: number;
  amount: string;
  money: (n: string | number) => string;
}) {
  const clean = Math.abs(litresValue) < 0.001;
  return (
    <span className={clean ? "text-gray-400" : "font-medium text-error-600 dark:text-error-400"}>
      {clean ? "—" : `${litres(litresValue)} · ${money(amount)}`}
    </span>
  );
}

function CloseShiftForm({
  shift,
  money,
  busy,
  onClose,
}: {
  shift: ForecourtShift;
  money: (n: string | number) => string;
  busy: boolean;
  onClose: (body: {
    readings: Array<{ fuel_nozzle_id: string; closing_reading: number; test_litres?: number }>;
    dips: Array<{ fuel_tank_id: string; closing_dip: number }>;
    notes?: string;
  }) => void;
}) {
  const readings = shift.readings ?? [];
  const dips = shift.dips ?? [];

  const [closing, setClosing] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<Record<string, string>>({});
  const [dipInput, setDipInput] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  /** Live litres per nozzle, so a mis-keyed meter is obvious before it's submitted. */
  const perNozzle = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of readings) {
      const raw = closing[r.fuel_nozzle_id];
      if (raw === undefined || raw.trim() === "") continue;
      const sold = litresBetween(Number(r.opening_reading), Number(raw)) - (Number(tests[r.fuel_nozzle_id]) || 0);
      out[r.fuel_nozzle_id] = sold;
    }
    return out;
  }, [closing, tests, readings]);

  const totalLitres = Object.values(perNozzle).reduce((a, b) => a + b, 0);
  const totalValue = readings.reduce(
    (sum, r) => sum + (perNozzle[r.fuel_nozzle_id] ?? 0) * Number(r.unit_price),
    0,
  );

  const complete =
    readings.every((r) => (closing[r.fuel_nozzle_id] ?? "").trim() !== "") &&
    dips.every((d) => (dipInput[d.fuel_tank_id] ?? "").trim() !== "");

  const anyNegative = Object.values(perNozzle).some((n) => n < 0);

  const submit = () =>
    onClose({
      readings: readings.map((r) => ({
        fuel_nozzle_id: r.fuel_nozzle_id,
        closing_reading: Number(closing[r.fuel_nozzle_id]),
        ...(Number(tests[r.fuel_nozzle_id]) ? { test_litres: Number(tests[r.fuel_nozzle_id]) } : {}),
      })),
      dips: dips.map((d) => ({ fuel_tank_id: d.fuel_tank_id, closing_dip: Number(dipInput[d.fuel_tank_id]) })),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-success-200 bg-success-50 px-4 py-3 dark:border-success-500/30 dark:bg-success-500/10">
        <div>
          <p className="text-sm font-semibold text-success-700 dark:text-success-400">
            {shift.number} is running
          </p>
          <p className="text-theme-xs text-success-700/70 dark:text-success-400/70">
            Opened {new Date(shift.opened_at).toLocaleString()}
            {shift.opened_by ? ` by ${shift.opened_by.name}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-theme-xs uppercase tracking-wide text-success-700/70 dark:text-success-400/70">
            Metered so far
          </p>
          <p className="text-lg font-semibold tabular-nums text-success-700 dark:text-success-400">
            {litres(totalLitres)} · {money(totalValue)}
          </p>
        </div>
      </div>

      {/* ── Meters ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <header className="flex items-baseline justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">Meter readings</h3>
          <span className="text-theme-xs text-gray-400">Test litres go back in the tank — they aren't sales.</span>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <th className="px-4 py-2.5 font-medium">Nozzle</th>
                <th className="px-4 py-2.5 text-right font-medium">Opening</th>
                <th className="px-4 py-2.5 text-right font-medium">Closing</th>
                <th className="px-4 py-2.5 text-right font-medium">Test</th>
                <th className="px-4 py-2.5 text-right font-medium">Sold</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r: ForecourtReading) => {
                const sold = perNozzle[r.fuel_nozzle_id];
                return (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                    <td className="px-4 py-2.5">
                      <div className="text-gray-800 dark:text-white/90">
                        {r.pump_name} · {r.nozzle_name}
                      </div>
                      <div className="text-theme-xs text-gray-400">
                        {r.product_name} @ {money(r.unit_price)}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                      {Number(r.opening_reading).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <NumberCell
                        value={closing[r.fuel_nozzle_id] ?? ""}
                        onChange={(v) => setClosing((s) => ({ ...s, [r.fuel_nozzle_id]: v }))}
                        placeholder="—"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <NumberCell
                        value={tests[r.fuel_nozzle_id] ?? ""}
                        onChange={(v) => setTests((s) => ({ ...s, [r.fuel_nozzle_id]: v }))}
                        placeholder="0"
                        narrow
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {sold === undefined ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <span className={sold < 0 ? "font-medium text-error-500" : "text-gray-800 dark:text-white/90"}>
                          {litres(sold)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Dips ───────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <header className="flex items-baseline justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">Tank dips</h3>
          <span className="text-theme-xs text-gray-400">Every tank, or the stock this shift posts is a part count.</span>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <th className="px-4 py-2.5 font-medium">Tank</th>
                <th className="px-4 py-2.5 text-right font-medium">Opening dip</th>
                <th className="px-4 py-2.5 text-right font-medium">Closing dip</th>
              </tr>
            </thead>
            <tbody>
              {dips.map((d: ForecourtDip) => (
                <tr key={d.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                  <td className="px-4 py-2.5 text-gray-800 dark:text-white/90">{d.tank_name}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                    {litres(Number(d.opening_dip))}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <NumberCell
                      value={dipInput[d.fuel_tank_id] ?? ""}
                      onChange={(v) => setDipInput((s) => ({ ...s, [d.fuel_tank_id]: v }))}
                      placeholder="—"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {anyNegative && (
        <Alert
          variant="warning"
          title="Check a closing reading"
          message="One nozzle shows negative litres — the test figure is larger than the meter moved."
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          className="h-11 min-w-0 flex-1 rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
          placeholder="Notes (optional) — anything that explains a variance"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <Button onClick={submit} disabled={!complete || busy}>
          {busy ? "Closing…" : "Close & reconcile"}
        </Button>
      </div>
    </div>
  );
}

function NumberCell({
  value,
  onChange,
  placeholder,
  narrow = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  narrow?: boolean;
}) {
  return (
    <input
      inputMode="decimal"
      className={`h-9 rounded-lg border border-gray-200 bg-white px-2 text-right text-sm tabular-nums text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 ${
        narrow ? "w-20" : "w-32"
      }`}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
    />
  );
}
