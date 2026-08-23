import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useConfirm } from "../../../components/ui/confirm";
import { useToast } from "../../../components/ui/toast";
import { useProducts } from "../../catalog/hooks/useCatalog";
import { useFuelMutations, useFuelPumps, useFuelTanks } from "../hooks/useFuel";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";

const litres = (n: number | string) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })} L`;

/**
 * The plant: tanks, pumps and the hoses on them. Set up once and then left
 * alone — which is why removing any of it is refused while a shift is open,
 * and why a meter can't be typed backwards here.
 */
export default function FuelSetupPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const tanks = useFuelTanks();
  const pumps = useFuelPumps();
  const products = useProducts({});
  const m = useFuelMutations();

  const tankModal = useModal();
  const pumpModal = useModal();
  const [nozzleFor, setNozzleFor] = useState<string | null>(null);

  const [tankForm, setTankForm] = useState({ name: "", product_id: "", capacity_litres: "", current_dip_litres: "", dead_stock_litres: "" });
  const [pumpName, setPumpName] = useState("");
  const [nozzleForm, setNozzleForm] = useState({ name: "", fuel_tank_id: "", current_reading: "" });

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
      return false;
    }
  };

  const saveTank = async () => {
    const done = await run(
      () => m.createTank.mutateAsync({
        name: tankForm.name,
        product_id: tankForm.product_id,
        capacity_litres: Number(tankForm.capacity_litres) || 0,
        current_dip_litres: Number(tankForm.current_dip_litres) || 0,
        dead_stock_litres: Number(tankForm.dead_stock_litres) || 0,
      }),
      "Tank added",
    );
    if (done) {
      setTankForm({ name: "", product_id: "", capacity_litres: "", current_dip_litres: "", dead_stock_litres: "" });
      tankModal.closeModal();
    }
  };

  const savePump = async () => {
    if (await run(() => m.createPump.mutateAsync({ name: pumpName }), "Pump added")) {
      setPumpName("");
      pumpModal.closeModal();
    }
  };

  const saveNozzle = async () => {
    if (!nozzleFor) return;
    const done = await run(
      () => m.createNozzle.mutateAsync({
        pumpId: nozzleFor,
        body: {
          name: nozzleForm.name,
          fuel_tank_id: nozzleForm.fuel_tank_id,
          current_reading: Number(nozzleForm.current_reading) || 0,
        },
      }),
      "Nozzle added",
    );
    if (done) {
      setNozzleForm({ name: "", fuel_tank_id: "", current_reading: "" });
      setNozzleFor(null);
    }
  };

  const productOptions = (products.data?.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const tankOptions = (tanks.data ?? []).map((t) => ({ value: t.id, label: t.name }));

  return (
    <>
      <PageMeta title="Tanks & Pumps | CartZe" description="Forecourt equipment" />

      <div className="mb-5">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Tanks & pumps</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The physical forecourt. Each nozzle draws from one tank — that link is what lets a shift
          take metered litres off the right tank.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        {/* ── Tanks ────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
            <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">Tanks</h3>
            <Button size="sm" variant="outline" onClick={tankModal.openModal}>Add tank</Button>
          </header>

          <div className="divide-y divide-gray-50 dark:divide-gray-800/60">
            {(tanks.data ?? []).length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-gray-400">No tanks yet.</p>
            ) : (
              tanks.data?.map((t) => (
                <div key={t.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-gray-800 dark:text-white/90">{t.name}</div>
                    <div className="mt-0.5 text-theme-xs text-gray-400">
                      {t.product?.name ?? "—"} · {t.nozzles_count ?? 0} nozzle
                      {(t.nozzles_count ?? 0) === 1 ? "" : "s"}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-theme-xs">
                      <span className="text-gray-500 dark:text-gray-400">
                        Dip <span className="font-medium tabular-nums text-gray-800 dark:text-white/90">{litres(t.current_dip_litres)}</span>
                      </span>
                      {/* What can actually be sold, and whether a tanker would fit —
                          the two numbers read before placing an order. */}
                      <span className="text-gray-500 dark:text-gray-400">
                        Sellable <span className="font-medium tabular-nums text-gray-800 dark:text-white/90">{litres(t.sellable_litres)}</span>
                      </span>
                      <span className="text-gray-500 dark:text-gray-400">
                        Ullage <span className="font-medium tabular-nums text-gray-800 dark:text-white/90">{litres(t.ullage_litres)}</span>
                      </span>
                    </div>
                  </div>
                  <button
                    className={ROW_ACTION_DANGER}
                    onClick={async () => {
                      if (await confirm({ title: `Remove ${t.name}?`, tone: "danger" })) {
                        run(() => m.deleteTank.mutateAsync(t.id), "Tank removed");
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* ── Pumps ────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
            <h3 className="text-sm font-medium text-gray-800 dark:text-white/90">Pumps & nozzles</h3>
            <Button size="sm" variant="outline" onClick={pumpModal.openModal}>Add pump</Button>
          </header>

          <div className="divide-y divide-gray-50 dark:divide-gray-800/60">
            {(pumps.data ?? []).length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-gray-400">No pumps yet.</p>
            ) : (
              pumps.data?.map((p) => (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-gray-800 dark:text-white/90">{p.name}</span>
                    <div className="flex items-center gap-3">
                      <button
                        className={ROW_ACTION}
                        onClick={() => { setNozzleFor(p.id); setNozzleForm({ name: "", fuel_tank_id: "", current_reading: "" }); }}
                      >
                        Add nozzle
                      </button>
                      <button
                        className={ROW_ACTION_DANGER}
                        onClick={async () => {
                          if (await confirm({ title: `Remove ${p.name}?`, message: "Its nozzles go with it.", tone: "danger" })) {
                            run(() => m.deletePump.mutateAsync(p.id), "Pump removed");
                          }
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {p.nozzles.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {p.nozzles.map((n) => (
                        <li key={n.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-theme-xs dark:bg-white/[0.03]">
                          <span className="text-gray-700 dark:text-gray-200">{n.name}</span>
                          <span className="flex items-center gap-3">
                            <span className="tabular-nums text-gray-400">
                              {Number(n.current_reading).toLocaleString()}
                            </span>
                            <button
                              className={ROW_ACTION_DANGER}
                              onClick={async () => {
                                if (await confirm({ title: `Remove nozzle ${n.name}?`, tone: "danger" })) {
                                  run(() => m.deleteNozzle.mutateAsync({ pumpId: p.id, id: n.id }), "Nozzle removed");
                                }
                              }}
                            >
                              ✕
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* ── Add tank ───────────────────────────────────────────────── */}
      <Modal isOpen={tankModal.isOpen} onClose={tankModal.closeModal} className="max-w-md">
        <ModalForm
          title="Add tank"
          footer={
            <>
              <Button size="sm" variant="outline" onClick={tankModal.closeModal}>Cancel</Button>
              <Button size="sm" onClick={saveTank} disabled={!tankForm.name || !tankForm.product_id || m.createTank.isPending}>
                Add tank
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input placeholder="Tank 1 — Petrol" value={tankForm.name} onChange={(e) => setTankForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>Holds</Label>
              {/* Fuel is an ordinary product — the tank points at the catalog so
                  the rate is never kept in two places. */}
              <Select options={productOptions} placeholder="Pick the fuel" value={tankForm.product_id} onChange={(v) => setTankForm((f) => ({ ...f, product_id: v }))} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Capacity (L)</Label>
                <Input type="number" value={tankForm.capacity_litres} onChange={(e) => setTankForm((f) => ({ ...f, capacity_litres: e.target.value }))} />
              </div>
              <div>
                <Label>Current dip (L)</Label>
                <Input type="number" value={tankForm.current_dip_litres} onChange={(e) => setTankForm((f) => ({ ...f, current_dip_litres: e.target.value }))} />
              </div>
              <div>
                <Label>Dead stock (L)</Label>
                <Input type="number" value={tankForm.dead_stock_litres} onChange={(e) => setTankForm((f) => ({ ...f, dead_stock_litres: e.target.value }))} />
              </div>
            </div>
            <p className="text-theme-xs text-gray-400">
              Dead stock is the unpumpable bottom. Capacity less dead stock is what can actually be sold.
            </p>
          </div>
        </ModalForm>
      </Modal>

      {/* ── Add pump ───────────────────────────────────────────────── */}
      <Modal isOpen={pumpModal.isOpen} onClose={pumpModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Add pump</h3>
        <Label>Name</Label>
        <Input placeholder="Pump 1" value={pumpName} onChange={(e) => setPumpName(e.target.value)} />
        <div className="mt-6 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={pumpModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={savePump} disabled={!pumpName || m.createPump.isPending}>Add pump</Button>
        </div>
      </Modal>

      {/* ── Add nozzle ─────────────────────────────────────────────── */}
      <Modal isOpen={!!nozzleFor} onClose={() => setNozzleFor(null)} className="max-w-sm">
        <ModalForm
          title="Add nozzle"
          footer={
            <>
              <Button size="sm" variant="outline" onClick={() => setNozzleFor(null)}>Cancel</Button>
              <Button size="sm" onClick={saveNozzle} disabled={!nozzleForm.name || !nozzleForm.fuel_tank_id || m.createNozzle.isPending}>
                Add nozzle
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input placeholder="A1" value={nozzleForm.name} onChange={(e) => setNozzleForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>Draws from</Label>
              <Select options={tankOptions} placeholder="Pick the tank" value={nozzleForm.fuel_tank_id} onChange={(v) => setNozzleForm((f) => ({ ...f, fuel_tank_id: v }))} />
            </div>
            <div>
              <Label>Meter reading now</Label>
              <Input type="number" value={nozzleForm.current_reading} onChange={(e) => setNozzleForm((f) => ({ ...f, current_reading: e.target.value }))} />
              <p className="mt-1 text-theme-xs text-gray-400">
                The totaliser as it stands today. After this, only a shift close moves it — a meter only counts up.
              </p>
            </div>
          </div>
        </ModalForm>
      </Modal>
    </>
  );
}
