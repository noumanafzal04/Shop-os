import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { fuelService } from "../services/fuelService";

/**
 * A MONTH OF THE FORECOURT.
 *
 * Every figure here was already being written at close, once, and could only
 * be read one shift at a time. So a manager could see that Tuesday was forty
 * litres short and could not see that it had been forty litres short every
 * Tuesday — which is the only form in which that fact is worth acting on.
 *
 * ── The two variances are drawn apart, on purpose ───────────────────────
 *
 * A forecourt is measured twice, and the two answers mean different things:
 *
 *   at the pump    metered litres against what the till rang. Fuel that left
 *                  the nozzle unbilled. A question for a person.
 *   in the ground  book stock against the closing dip. Fuel that left without
 *                  crossing a meter at all. A leak, or a tanker that arrived
 *                  short.
 *
 * They are never summed here and there is no combined figure to sum them into.
 * One number covering both destroys the distinction the owner is trying to
 * make, and that distinction is the whole difference between a conversation
 * and an engineer.
 */

const litres = (n: number) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 })} L`;
const money = (n: number) => `Rs ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso === null ? "—" : new Date(iso).toLocaleDateString());

/**
 * A variance card. `tone` is the SUBJECT, not the sentiment — a shortfall is
 * amber and a surplus is not green, because fuel that appeared is as much a
 * measurement problem as fuel that vanished.
 */
function Variance({ title, hint, amount, value }: {
  title: string;
  hint: string;
  amount: number;
  value: number;
}) {
  const off = Math.abs(amount) > 0.0005;

  return (
    <div className={`rounded-2xl border p-4 ${
      off
        ? "border-warning-300 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/10"
        : "border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
    }`}>
      <p className="text-theme-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-gray-900 dark:text-white">
        {litres(amount)}
      </p>
      <p className="mt-0.5 text-theme-sm tabular-nums text-gray-600 dark:text-gray-300">{money(value)}</p>
      <p className="mt-2 text-theme-xs leading-snug text-gray-500 dark:text-gray-400">{hint}</p>
    </div>
  );
}

export function FuelReportTab({ range }: { range: { from: string; to: string } }) {
  const report = useQuery({
    queryKey: ["reports", "fuel", range.from, range.to],
    queryFn: async () => (await fuelService.report(range)).data,
  });

  if (report.isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />;
  }

  const data = report.data;

  if (!data || data.totals.shifts === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
        <p className="text-gray-500 dark:text-gray-400">No forecourt shift was closed in this period.</p>
        <p className="mx-auto mt-1 max-w-md text-theme-xs text-gray-400">
          {/* An OPEN shift is not nothing, and saying so is the difference
              between "no trade" and "not counted yet". */}
          {data && data.totals.shifts_open > 0
            ? `${data.totals.shifts_open} ${data.totals.shifts_open === 1 ? "shift is" : "shifts are"} still open — a shift is counted here once it has been closed and reconciled.`
            : "Open a shift on the Forecourt screen, read the meters at the end of it, and every figure below fills in."}
        </p>
        <Link to="/tenant/fuel" className="mt-4 inline-block text-theme-sm font-semibold text-brand-600 dark:text-brand-400">
          Go to the forecourt
        </Link>
      </div>
    );
  }

  const t = data.totals;

  return (
    <div className="space-y-5">
      {/* What went out, and what it was worth. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Metered", value: litres(t.litres_sold), sub: money(t.fuel_value) },
          { label: "Rung at the till", value: litres(t.pos_fuel_litres), sub: money(t.pos_fuel_value) },
          { label: "Test litres", value: litres(t.test_litres), sub: "back in the tank" },
          {
            label: "Shifts",
            value: String(t.shifts),
            sub: t.shifts_open > 0 ? `${t.shifts_open} still open` : "all closed",
          },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
            <p className="text-theme-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{c.label}</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-gray-900 dark:text-white">{c.value}</p>
            <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Variance
          title="Unbilled at the pump"
          amount={t.unbilled_litres}
          value={t.unbilled_value}
          hint="Metered litres the till never rang. This is about people, not plumbing — and it is a station figure, which is why it is not broken down per attendant below."
        />
        <Variance
          title="Missing from the ground"
          amount={t.tank_variance_litres}
          value={t.tank_variance_value}
          hint="Book stock against the closing dip. Fuel that left without crossing a meter at all — a leak, or a tanker that arrived short."
        />
      </div>

      {t.shifts_repriced > 0 && (
        <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-theme-xs text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
          A rate changed part-way through {t.shifts_repriced} of these {t.shifts_repriced === 1 ? "shifts" : "shifts"}.
          The litres are exact; the rupee figures for {t.shifts_repriced === 1 ? "that shift" : "those shifts"} are an approximation.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="border-b border-gray-100 px-5 py-3 text-theme-sm font-semibold text-gray-800 dark:border-gray-800 dark:text-white/90">
            By fuel
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-theme-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-5 py-2 font-semibold">Product</th>
                  <th className="px-5 py-2 text-right font-semibold">Litres</th>
                  <th className="px-5 py-2 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {data.by_product.map((row) => (
                  <tr key={row.product} className="border-t border-gray-50 dark:border-gray-800/50">
                    <td className="px-5 py-2.5 text-gray-800 dark:text-gray-200">{row.product}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{litres(row.litres)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-gray-900 dark:text-white/90">{money(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="border-b border-gray-100 px-5 py-3 text-theme-sm font-semibold text-gray-800 dark:border-gray-800 dark:text-white/90">
            By attendant
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-theme-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-5 py-2 font-semibold">Who</th>
                  <th className="px-5 py-2 text-right font-semibold">Litres pumped</th>
                </tr>
              </thead>
              <tbody>
                {data.by_attendant.map((row) => (
                  <tr key={row.attendant_id ?? "unassigned"} className="border-t border-gray-50 dark:border-gray-800/50">
                    <td className="px-5 py-2.5 text-gray-800 dark:text-gray-200">
                      {row.attendant ?? <span className="text-gray-400">Nozzle not assigned</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{litres(row.litres)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Said out loud, because its ABSENCE is the feature. A till sale does
              not record its nozzle, so meters-minus-till cannot be attributed —
              and a column that guessed would be an accusation nobody could
              defend. */}
          <p className="border-t border-gray-100 px-5 py-3 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
            Litres only. Unbilled fuel is not split between attendants — a sale at the till does not
            record which nozzle it came out of, so the shortfall belongs to the station, not to a person.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="border-b border-gray-100 px-5 py-3 text-theme-sm font-semibold text-gray-800 dark:border-gray-800 dark:text-white/90">
          The shifts
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="text-theme-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-5 py-2 font-semibold">Shift</th>
                <th className="px-5 py-2 font-semibold">Closed</th>
                <th className="px-5 py-2 text-right font-semibold">Litres</th>
                <th className="px-5 py-2 text-right font-semibold">Unbilled</th>
                <th className="px-5 py-2 text-right font-semibold">In the ground</th>
              </tr>
            </thead>
            <tbody>
              {data.shifts.map((s) => (
                <tr key={s.id} className="border-t border-gray-50 dark:border-gray-800/50">
                  <td className="px-5 py-2.5">
                    <Link to={`/tenant/fuel/shifts/${s.id}`} className="font-semibold text-brand-600 dark:text-brand-400">
                      {s.number}
                    </Link>
                    {s.price_changed_during && (
                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">
                        rate moved
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-gray-600 dark:text-gray-300">
                    {day(s.closed_at)}
                    {s.closed_by && <span className="ml-1 text-theme-xs text-gray-400">· {s.closed_by}</span>}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{litres(s.litres_sold)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{litres(s.unbilled_litres)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{litres(s.tank_variance_litres)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
