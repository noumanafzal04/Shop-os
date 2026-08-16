import { Link, useParams } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import { useMoney } from "../../shop/hooks/useShop";
import { useShift } from "../hooks/useFuel";

const litres = (n: number | string) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 })} L`;

/**
 * One reconciled shift, read after the fact.
 *
 * The three headline figures sit apart because they are three different
 * findings. Sold is the night's work. Unbilled is fuel that left a nozzle and
 * was never rung up — a counter problem. Tank variance is fuel that left the
 * ground without crossing a meter at all — a leak, or a direct draw. Merge them
 * and the owner can no longer tell which of those they are looking at.
 */
export default function ForecourtShiftPage() {
  const { id } = useParams();
  const money = useMoney();
  const shift = useShift(id);

  if (shift.isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />;
  }

  const s = shift.data;
  if (!s) return <p className="text-sm text-gray-400">Shift not found.</p>;

  return (
    <>
      <PageMeta title={`${s.number} | ShopOS`} description="Forecourt shift reconciliation" />

      <div className="mb-5">
        <Link to="/tenant/fuel" className="text-theme-xs text-gray-400 hover:text-gray-600">← Forecourt</Link>
        <h2 className="mt-1 text-xl font-semibold text-gray-800 dark:text-white/90">{s.number}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {new Date(s.opened_at).toLocaleString()}
          {s.closed_at ? ` → ${new Date(s.closed_at).toLocaleString()}` : ""}
          {s.closed_by ? ` · closed by ${s.closed_by.name}` : ""}
        </p>
      </div>

      {s.price_changed_during && (
        <p className="mb-4 rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-400">
          A rate changed while this shift was running. Its litres were valued at the rate in force when
          it opened, so the value below won't tie to the day's takings to the rupee.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Litres sold" value={litres(s.litres_sold)} sub={`${litres(s.test_litres)} tested`} />
        <Stat label="Fuel value" value={money(s.fuel_value)} sub={`Till rang ${money(s.pos_fuel_value)}`} />
        <Stat
          label="Unbilled"
          value={litres(s.unbilled_litres)}
          sub={money(s.unbilled_value)}
          tone={Math.abs(Number(s.unbilled_litres)) > 0.001 ? "bad" : "good"}
          hint="Left a nozzle, never rung up"
        />
        <Stat
          label="Tank variance"
          value={litres(s.tank_variance_litres)}
          sub={money(s.tank_variance_value)}
          tone={Math.abs(Number(s.tank_variance_litres)) > 0.001 ? "bad" : "good"}
          hint="Left the tank, crossed no meter"
        />
      </div>

      {/* ── Handover ───────────────────────────────────────────────────
          Above the meters because it is the part somebody acts on tonight.
          The rest of this page is read the next morning, if at all. */}
      {(s.attendant_totals ?? []).length > 0 && (
        <section className="mt-5 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
            <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">Handover</h3>
            <span className="text-theme-xs text-gray-400">
              Straight off each man&rsquo;s meters — count the cash against this
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                  <th className="px-4 py-2.5 font-medium">Attendant</th>
                  <th className="px-4 py-2.5 text-right font-medium">Nozzles</th>
                  <th className="px-4 py-2.5 text-right font-medium">Litres</th>
                  <th className="px-4 py-2.5 text-right font-medium">Owed</th>
                </tr>
              </thead>
              <tbody>
                {(s.attendant_totals ?? []).map((a) => (
                  <tr
                    key={a.attendant_id ?? "unassigned"}
                    className="border-b border-gray-50 last:border-0 dark:border-gray-800/60"
                  >
                    <td className="px-4 py-2.5">
                      {a.attendant ? (
                        <span className="text-gray-800 dark:text-white/90">{a.attendant}</span>
                      ) : (
                        /* A shortfall nobody is named for is still a shortfall.
                           Hiding this row would be worse than never asking. */
                        <span className="text-gray-400">Nobody assigned</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{a.nozzles}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-800 dark:text-white/90">
                      {litres(a.litres)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-800 dark:text-white/90">
                      {money(a.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* The line that stops this table being read as a charge sheet. */}
          <p className="border-t border-gray-100 px-4 py-2.5 text-theme-xs text-gray-400 dark:border-gray-800">
            The unbilled litres above are not split here. A till sale doesn&rsquo;t record which
            nozzle it came from, so that gap belongs to the station, not to a man.
          </p>
        </section>
      )}

      <section className="mt-5 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <header className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">Meters</h3>
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
                <th className="px-4 py-2.5 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {s.readings?.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                  <td className="px-4 py-2.5">
                    <div className="text-gray-800 dark:text-white/90">{r.pump_name} · {r.nozzle_name}</div>
                    <div className="text-theme-xs text-gray-400">
                      {r.product_name} @ {money(r.unit_price)}
                      {r.attendant ? ` · ${r.attendant.name}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{Number(r.opening_reading).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{r.closing_reading ? Number(r.closing_reading).toLocaleString() : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{litres(r.test_litres)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-800 dark:text-white/90">{litres(r.litres_sold)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-800 dark:text-white/90">{money(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <header className="flex items-baseline justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">Tanks</h3>
          <span className="text-theme-xs text-gray-400">Book = opening + delivered − metered</span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <th className="px-4 py-2.5 font-medium">Tank</th>
                <th className="px-4 py-2.5 text-right font-medium">Opening</th>
                <th className="px-4 py-2.5 text-right font-medium">Delivered</th>
                <th className="px-4 py-2.5 text-right font-medium">Metered</th>
                <th className="px-4 py-2.5 text-right font-medium">Book</th>
                <th className="px-4 py-2.5 text-right font-medium">Dip</th>
                <th className="px-4 py-2.5 text-right font-medium">Variance</th>
              </tr>
            </thead>
            <tbody>
              {s.dips?.map((d) => {
                const v = Number(d.variance_litres);
                return (
                  <tr key={d.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                    <td className="px-4 py-2.5 text-gray-800 dark:text-white/90">{d.tank_name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{litres(d.opening_dip)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{litres(d.delivered_litres)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{litres(d.meter_litres)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{litres(d.book_closing)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-800 dark:text-white/90">
                      {d.closing_dip ? litres(d.closing_dip) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {Math.abs(v) < 0.001 ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <span className="font-medium text-error-600 dark:text-error-400">
                          {litres(v)} · {money(d.variance_value)}
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

      {s.notes && (
        <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:bg-white/[0.03] dark:text-gray-300">
          {s.notes}
        </p>
      )}
    </>
  );
}

function Stat({
  label, value, sub, tone, hint,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
  hint?: string;
}) {
  const colour =
    tone === "bad" ? "text-error-600 dark:text-error-400"
      : tone === "good" ? "text-success-600 dark:text-success-400"
        : "text-gray-800 dark:text-white/90";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-theme-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${colour}`}>{value}</p>
      {sub && <p className="text-theme-xs text-gray-400">{sub}</p>}
      {hint && <p className="mt-1 text-[10px] text-gray-400">{hint}</p>}
    </div>
  );
}
