import { useState } from "react";
import { FilterTabs } from "../../../components/ui/tabs/FilterTabs";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Badge from "../../../components/ui/badge/Badge";
import Alert from "../../../components/ui/alert/Alert";
import { useDispensingRegister, useRecall } from "../hooks/usePharmacy";
import type { DispensingRow } from "../services/pharmacyService";
import { toIsoDate } from "../../../components/ui/filters";

const iso = (d: Date) => toIsoDate(d);

const TABS = [
  ["register", "Dispensing register"],
  ["recall", "Batch recall"],
] as const;

/**
 * The chemist's paperwork: the register someone official asks to see, and the
 * lookup a withdrawal notice sets off.
 *
 * Both are read-only by design. The register is DERIVED from the sales — a
 * second ledger that could disagree with the till would be worse than none —
 * and a recall is a question, not an action.
 */
export default function PharmacyPage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("register");

  return (
    <>
      <PageMeta title="Pharmacy | CartZe" description="Dispensing register and batch recall" />

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Pharmacy</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          What was dispensed and against whose prescription — and, when a batch is withdrawn, who took it home.
        </p>
      </div>

      <FilterTabs
        tabs={TABS.map(([key, label]) => ({ key, label }))}
        value={tab}
        onChange={setTab}
        className="mb-6"
      />

      {tab === "register" ? <RegisterTab /> : <RecallTab />}
    </>
  );
}

function RegisterTab() {
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(() => iso(new Date()));
  const [search, setSearch] = useState("");
  const [controlledOnly, setControlledOnly] = useState(false);

  const register = useDispensingRegister({ from, to, search, controlled_only: controlledOnly });
  const rows = register.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="min-w-[14rem] flex-1">
          <Label>Patient, prescriber or Rx number</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the register…" />
        </div>
        <button
          type="button"
          onClick={() => setControlledOnly((v) => !v)}
          className={`mb-0.5 rounded-lg border px-4 py-2.5 text-theme-sm font-medium transition ${
            controlledOnly
              ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
              : "border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-400"
          }`}
        >
          Controlled only
        </button>
      </div>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
        {register.isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-theme-sm text-gray-500 dark:text-gray-400">
            Nothing prescription-only was dispensed in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-theme-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                  <th className="px-5 py-2.5 font-medium">Dispensed</th>
                  <th className="px-3 py-2.5 font-medium">Drug</th>
                  <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                  <th className="px-3 py-2.5 font-medium">Batch</th>
                  <th className="px-3 py-2.5 font-medium">Patient</th>
                  <th className="px-3 py-2.5 font-medium">Prescriber</th>
                  <th className="px-5 py-2.5 font-medium">Rx / Invoice</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <RegisterRow key={`${r.sale_id}-${r.drug}-${i}`} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function RegisterRow({ row }: { row: DispensingRow }) {
  return (
    <tr className="border-b border-gray-100 last:border-0 dark:border-gray-800">
      <td className="whitespace-nowrap px-5 py-3 text-gray-500 dark:text-gray-400">
        {row.dispensed_at ? new Date(row.dispensed_at).toLocaleString() : "—"}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-800 dark:text-white/90">{row.drug}</span>
          {/* A schedule is the whole reason this row is legally interesting. */}
          {row.schedule && <Badge size="sm" color="warning">Schedule {row.schedule}</Badge>}
        </div>
        <div className="text-theme-xs text-gray-400">
          {[row.generic_name, row.strength, row.dosage_form].filter(Boolean).join(" · ") || "—"}
        </div>
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{row.quantity}</td>
      <td className="px-3 py-3 text-theme-xs text-gray-500 dark:text-gray-400">
        {(row.batches ?? []).length === 0
          ? "—"
          : (row.batches ?? []).map((b) => (
              <div key={b.batch_number} className="font-mono">
                {b.batch_number}
                {b.expiry_date ? ` · exp ${b.expiry_date}` : ""}
              </div>
            ))}
      </td>
      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
        {row.patient_name ?? "—"}
        {row.customer_phone && <div className="text-theme-xs text-gray-400">{row.customer_phone}</div>}
      </td>
      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{row.prescriber_name ?? "—"}</td>
      <td className="px-5 py-3 text-theme-xs text-gray-500 dark:text-gray-400">
        {row.prescription_number ?? "—"}
        <div className="text-gray-400">{row.invoice_number}</div>
      </td>
    </tr>
  );
}

function RecallTab() {
  const [input, setInput] = useState("");
  const [batch, setBatch] = useState("");
  const recall = useRecall(batch);
  const data = recall.data;

  return (
    <div className="space-y-5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => { e.preventDefault(); setBatch(input.trim()); }}
      >
        <div className="min-w-[16rem] flex-1">
          <Label>Batch / lot number</Label>
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="As printed on the recall notice" />
        </div>
        <Button type="submit" size="sm" disabled={!input.trim()}>Find it</Button>
      </form>

      {batch && recall.isLoading && (
        <div className="h-24 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
      )}

      {data && (
        <>
          {data.unreachable > 0 && (
            <Alert
              variant="warning"
              title={`${data.unreachable} sale${data.unreachable === 1 ? "" : "s"} with no phone number`}
              message="Those customers can't be telephoned — check whether the sale has a name on it."
            />
          )}

          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
            <div className="px-5 py-4">
              <h3 className="font-semibold text-gray-800 dark:text-white/90">Still on the shelf</h3>
              <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">Pull this first.</p>
            </div>
            {data.on_hand.length === 0 ? (
              <p className="px-5 pb-5 text-theme-sm text-gray-500 dark:text-gray-400">
                None of this lot is left in stock.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.on_hand.map((b, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-5 py-3 text-theme-sm">
                    <span className="text-gray-800 dark:text-white/90">{b.product_name ?? "—"}</span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {b.quantity} in stock{b.expiry_date ? ` · exp ${b.expiry_date}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
            <div className="px-5 py-4">
              <h3 className="font-semibold text-gray-800 dark:text-white/90">
                People to call · {data.dispensed.length}
              </h3>
              <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                Everyone who was sold this lot.
              </p>
            </div>
            {data.dispensed.length === 0 ? (
              <p className="px-5 pb-5 text-theme-sm text-gray-500 dark:text-gray-400">
                None of this lot has been sold.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-theme-sm">
                  <thead>
                    <tr className="border-y border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                      <th className="px-5 py-2.5 font-medium">Sold</th>
                      <th className="px-3 py-2.5 font-medium">Customer</th>
                      <th className="px-3 py-2.5 font-medium">Phone</th>
                      <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                      <th className="px-5 py-2.5 font-medium">Invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dispensed.map((s) => (
                      <tr key={s.sale_id} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
                        <td className="whitespace-nowrap px-5 py-3 text-gray-500 dark:text-gray-400">
                          {s.sold_at ? new Date(s.sold_at).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-3 py-3 text-gray-800 dark:text-white/90">{s.customer_name ?? "Walk-in"}</td>
                        <td className="px-3 py-3">
                          {s.customer_phone ? (
                            <a href={`tel:${s.customer_phone}`} className="font-medium text-brand-500 hover:text-brand-600">
                              {s.customer_phone}
                            </a>
                          ) : (
                            <span className="text-error-500">No number</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{s.quantity}</td>
                        <td className="px-5 py-3 text-theme-xs text-gray-500 dark:text-gray-400">{s.invoice_number}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
