import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { useMoney } from "../../shop/hooks/useShop";
import { useDeliveries, useFuelMutations, useFuelTanks, usePriceChanges } from "../hooks/useFuel";

const litres = (n: number | string) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 })} L`;

/**
 * Tankers in, and the rate log.
 *
 * A delivery is recorded twice on purpose — what the invoice claims, and what
 * the dip either side says arrived. They routinely differ by a few hundred
 * litres, and a station that records only the invoice pays for every one of
 * them with nothing to argue with.
 */
export default function FuelDeliveriesPage() {
  const money = useMoney();
  const toast = useToast();
  const tanks = useFuelTanks();
  const deliveries = useDeliveries();
  const prices = usePriceChanges();
  const m = useFuelMutations();

  const deliveryModal = useModal();
  const rateModal = useModal();

  const [form, setForm] = useState({ fuel_tank_id: "", invoiced_litres: "", dip_before: "", dip_after: "", unit_cost: "", invoice_number: "", tanker_number: "" });
  const [rate, setRate] = useState({ product_id: "", new_price: "", reason: "" });

  const tankOptions = (tanks.data ?? []).map((t) => ({ value: t.id, label: t.name }));
  // Only what a tank holds can be repriced through the notification log.
  const fuelOptions = (tanks.data ?? [])
    .filter((t) => t.product)
    .map((t) => ({ value: t.product!.id, label: t.product!.name }));

  const saveDelivery = async () => {
    try {
      await m.createDelivery.mutateAsync({
        fuel_tank_id: form.fuel_tank_id,
        invoiced_litres: Number(form.invoiced_litres),
        ...(form.dip_before && form.dip_after
          ? { dip_before: Number(form.dip_before), dip_after: Number(form.dip_after) }
          : {}),
        ...(form.unit_cost ? { unit_cost: Number(form.unit_cost) } : {}),
        ...(form.invoice_number ? { invoice_number: form.invoice_number } : {}),
        ...(form.tanker_number ? { tanker_number: form.tanker_number } : {}),
      });
      toast.success("Delivery recorded");
      setForm({ fuel_tank_id: "", invoiced_litres: "", dip_before: "", dip_after: "", unit_cost: "", invoice_number: "", tanker_number: "" });
      deliveryModal.closeModal();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the delivery");
    }
  };

  const saveRate = async () => {
    try {
      await m.createPrice.mutateAsync({
        product_id: rate.product_id,
        new_price: Number(rate.new_price),
        ...(rate.reason ? { reason: rate.reason } : {}),
      });
      toast.success("Rate updated");
      setRate({ product_id: "", new_price: "", reason: "" });
      rateModal.closeModal();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the rate");
    }
  };

  return (
    <>
      <PageMeta title="Deliveries & Rates | ShopOS" description="Tanker deliveries and fuel rate changes" />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Deliveries & rates</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            What arrived in the ground, and what it sells for.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={rateModal.openModal}>New rate</Button>
          <Button size="sm" onClick={deliveryModal.openModal}>Record delivery</Button>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <header className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">Deliveries</h3>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <th className="px-4 py-2.5 font-medium">Tank</th>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 text-right font-medium">Invoiced</th>
                <th className="px-4 py-2.5 text-right font-medium">Received</th>
                <th className="px-4 py-2.5 text-right font-medium">Short</th>
                <th className="px-4 py-2.5 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {(deliveries.data?.rows ?? []).length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">No deliveries yet.</td></tr>
              ) : (
                deliveries.data?.rows.map((d) => {
                  const short = Number(d.shortage_litres);
                  return (
                    <tr key={d.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                      <td className="px-4 py-3">
                        <div className="text-gray-800 dark:text-white/90">{d.tank?.name ?? "—"}</div>
                        <div className="text-theme-xs text-gray-400">
                          {new Date(d.received_at).toLocaleDateString()}
                          {d.shift ? ` · ${d.shift.number}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        {d.supplier?.name ?? "—"}
                        {d.invoice_number && <div className="text-theme-xs text-gray-400">{d.invoice_number}</div>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-500">{litres(d.invoiced_litres)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-800 dark:text-white/90">{litres(d.received_litres)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {short > 0.001 ? (
                          <span className="font-medium text-error-600 dark:text-error-400">{litres(short)}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-200">{money(d.total_cost)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <header className="flex items-baseline justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">Rate history</h3>
          <span className="text-theme-xs text-gray-400">Append-only — a shift's valuation has to stay defensible.</span>
        </header>
        <div className="divide-y divide-gray-50 dark:divide-gray-800/60">
          {(prices.data?.rows ?? []).length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-400">No rate changes recorded.</p>
          ) : (
            prices.data?.rows.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <span className="text-sm text-gray-800 dark:text-white/90">{c.product?.name ?? "—"}</span>
                  <span className="ml-2 text-theme-xs text-gray-400">
                    {new Date(c.effective_at).toLocaleString()}
                    {c.reason ? ` · ${c.reason}` : ""}
                  </span>
                </div>
                <div className="text-sm tabular-nums">
                  <span className="text-gray-400 line-through">{money(c.old_price)}</span>
                  <span className="ml-2 font-semibold text-gray-800 dark:text-white/90">{money(c.new_price)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Record delivery ────────────────────────────────────────── */}
      <Modal isOpen={deliveryModal.isOpen} onClose={deliveryModal.closeModal} className="max-w-lg">
        <ModalForm
          title="Record delivery"
          footer={
            <>
              <Button size="sm" variant="outline" onClick={deliveryModal.closeModal}>Cancel</Button>
              <Button size="sm" onClick={saveDelivery} disabled={!form.fuel_tank_id || !form.invoiced_litres || m.createDelivery.isPending}>
                Record
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <Label>Into</Label>
              <Select options={tankOptions} placeholder="Pick the tank" value={form.fuel_tank_id} onChange={(v) => setForm((f) => ({ ...f, fuel_tank_id: v }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Invoiced litres</Label>
                <Input type="number" value={form.invoiced_litres} onChange={(e) => setForm((f) => ({ ...f, invoiced_litres: e.target.value }))} />
              </div>
              <div>
                <Label>Rate per litre</Label>
                <Input type="number" value={form.unit_cost} onChange={(e) => setForm((f) => ({ ...f, unit_cost: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Dip before</Label>
                <Input type="number" value={form.dip_before} onChange={(e) => setForm((f) => ({ ...f, dip_before: e.target.value }))} />
              </div>
              <div>
                <Label>Dip after</Label>
                <Input type="number" value={form.dip_after} onChange={(e) => setForm((f) => ({ ...f, dip_after: e.target.value }))} />
              </div>
            </div>
            <p className="text-theme-xs text-gray-400">
              The dips are the station's own count. Given both, the delivery is received on what they say
              arrived — not on the invoice — and the difference is recorded as a shortage.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Invoice no.</Label>
                <Input value={form.invoice_number} onChange={(e) => setForm((f) => ({ ...f, invoice_number: e.target.value }))} />
              </div>
              <div>
                <Label>Tanker no.</Label>
                <Input value={form.tanker_number} onChange={(e) => setForm((f) => ({ ...f, tanker_number: e.target.value }))} />
              </div>
            </div>
          </div>
        </ModalForm>
      </Modal>

      {/* ── New rate ───────────────────────────────────────────────── */}
      <Modal isOpen={rateModal.isOpen} onClose={rateModal.closeModal} className="max-w-sm">
        <ModalForm
          title="New rate"
          footer={
            <>
              <Button size="sm" variant="outline" onClick={rateModal.closeModal}>Cancel</Button>
              <Button size="sm" onClick={saveRate} disabled={!rate.product_id || !rate.new_price || m.createPrice.isPending}>
                Apply
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <Label>Fuel</Label>
              <Select options={fuelOptions} placeholder="Pick the fuel" value={rate.product_id} onChange={(v) => setRate((r) => ({ ...r, product_id: v }))} />
            </div>
            <div>
              <Label>New rate</Label>
              <Input type="number" value={rate.new_price} onChange={(e) => setRate((r) => ({ ...r, new_price: e.target.value }))} />
            </div>
            <div>
              <Label>Reason</Label>
              <Input placeholder="OGRA notification" value={rate.reason} onChange={(e) => setRate((r) => ({ ...r, reason: e.target.value }))} />
            </div>
          </div>
        </ModalForm>
      </Modal>
    </>
  );
}
