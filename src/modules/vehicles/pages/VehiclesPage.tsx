import { useEffect, useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { ApiError } from "../../../common/types/api";
import { useMoney } from "../../shop/hooks/useShop";
import { useVehicleHistory, useVehicleMutations, useVehicles } from "../hooks/useVehicles";
import type { Vehicle } from "../services/vehiclesService";

const blank = {
  registration: "", make: "", model: "", year: "", colour: "",
  tyre_size: "", engine_no: "", chassis_no: "", odometer: "", notes: "",
};

/**
 * The vehicles a shop works on.
 *
 * A customer is remembered by phone number, which is right for a grocery and
 * wrong here. Ask a tyre shop about a regular and they answer with a plate:
 * LEA-1234, the white Corolla, 195/65 R15, fitted a set in March.
 *
 * The history panel is the point of the whole screen — what was fitted, when,
 * and at what reading. It is what a warranty claim hangs off, and what lets the
 * counter say "your alignment was 11,000 km ago" instead of guessing.
 */
export default function VehiclesPage() {
  const money = useMoney();
  const toast = useToast();
  const confirm = useConfirm();
  const editModal = useModal();
  const historyModal = useModal();

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const vehicles = useVehicles({ search: query || undefined });
  const { create, update, remove } = useVehicleMutations();

  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form, setForm] = useState({ ...blank });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const [historyId, setHistoryId] = useState<string | null>(null);
  const history = useVehicleHistory(historyId);

  const mutation = editing ? update : create;
  const apiError = mutation.error instanceof ApiError ? mutation.error : null;
  const errorFor = (k: string) => apiError?.errors[k]?.[0];

  const openCreate = () => {
    setEditing(null);
    setForm({ ...blank });
    create.reset();
    editModal.openModal();
  };

  const openEdit = (v: Vehicle) => {
    setEditing(v);
    setForm({
      registration: v.registration,
      make: v.make ?? "", model: v.model ?? "",
      year: v.year ? String(v.year) : "", colour: v.colour ?? "",
      tyre_size: v.tyre_size ?? "", engine_no: v.engine_no ?? "",
      chassis_no: v.chassis_no ?? "", odometer: v.odometer ? String(v.odometer) : "",
      notes: v.notes ?? "",
    });
    update.reset();
    editModal.openModal();
  };

  const openHistory = (v: Vehicle) => {
    setHistoryId(v.id);
    historyModal.openModal();
  };

  const submit = () => {
    const text = (v: string) => v.trim() || null;
    const payload = {
      registration: form.registration.trim(),
      make: text(form.make), model: text(form.model),
      year: form.year ? Number(form.year) : null,
      colour: text(form.colour), tyre_size: text(form.tyre_size),
      engine_no: text(form.engine_no), chassis_no: text(form.chassis_no),
      odometer: form.odometer ? Number(form.odometer) : null,
      notes: text(form.notes),
    };
    const done = (verb: string) => {
      toast.success(`${payload.registration} ${verb}`);
      editModal.closeModal();
    };
    if (editing) {
      update.mutate({ id: editing.id, ...payload }, { onSuccess: () => done("updated") });
    } else {
      create.mutate(payload, { onSuccess: () => done("added") });
    }
  };

  const removeVehicle = async (v: Vehicle) => {
    const ok = await confirm({
      title: `Remove ${v.registration}?`,
      message: "Past jobs stay on the sales record — only the vehicle card goes.",
      confirmLabel: "Remove vehicle",
      tone: "danger",
    });
    if (!ok) return;
    remove.mutate(v.id, {
      onSuccess: () => toast.success(`Removed ${v.registration}`),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't remove it."),
    });
  };

  const rows = vehicles.data ?? [];

  return (
    <>
      <PageMeta title="Vehicles | ShopOS" description="Vehicles this shop works on" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Vehicles</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            What each car takes, and what you last did to it.
          </p>
        </div>
        <div className="flex gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Registration, make or model…" />
          <Button size="sm" onClick={openCreate}>+ Add vehicle</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        {vehicles.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {query
              ? "No vehicle matches."
              : "No vehicles yet — add one, or register a plate at the till while ringing a sale."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-theme-sm">
              <thead className="border-b border-gray-100 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <tr>
                  <th className="px-4 py-3">Registration</th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Takes</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3 text-right">Last seen at</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                    <td className="px-4 py-3">
                      <button onClick={() => openHistory(v)} className="font-mono font-semibold text-brand-600 hover:underline dark:text-brand-400">
                        {v.registration}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      {[v.make, v.model].filter(Boolean).join(" ") || <span className="text-gray-400">—</span>}
                      {v.year && <span className="text-gray-400"> ({v.year})</span>}
                    </td>
                    <td className="px-4 py-3">
                      {v.tyre_size ? <Badge size="sm" color="light">{v.tyre_size}</Badge> : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {v.customer?.name || v.customer?.phone || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {v.odometer ? `${v.odometer.toLocaleString()} km` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(v)} className="mr-3 text-theme-xs text-brand-500 hover:text-brand-600">Edit</button>
                      <button onClick={() => removeVehicle(v)} className="text-theme-xs text-error-500 hover:text-error-600">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / edit ─────────────────────────────────────────────────── */}
      <Modal isOpen={editModal.isOpen} onClose={editModal.closeModal} className="max-w-lg p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editing ? `Edit ${editing.registration}` : "Add a vehicle"}
        </h3>

        <div className="space-y-4">
          <div>
            <Label>Registration <span className="text-error-500">*</span></Label>
            <Input value={form.registration} onChange={(e) => set("registration", e.target.value.toUpperCase())} placeholder="LEA-1234" />
            <p className="mt-1 text-theme-xs text-gray-400">Spacing and dashes don't matter — it's stored one way.</p>
            {errorFor("registration") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("registration")}</p>}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div><Label>Make</Label><Input value={form.make} onChange={(e) => set("make", e.target.value)} placeholder="Toyota" /></div>
            <div><Label>Model</Label><Input value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="Corolla GLi" /></div>
            <div><Label>Year</Label><Input type="number" min="1900" value={form.year} onChange={(e) => set("year", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label>Tyre size</Label>
              <Input value={form.tyre_size} onChange={(e) => set("tyre_size", e.target.value)} placeholder="195/65 R15" />
            </div>
            <div><Label>Colour</Label><Input value={form.colour} onChange={(e) => set("colour", e.target.value)} /></div>
            <div>
              <Label>Odometer</Label>
              <Input type="number" min="0" value={form.odometer} onChange={(e) => set("odometer", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label>Engine no.</Label><Input value={form.engine_no} onChange={(e) => set("engine_no", e.target.value)} /></div>
            <div><Label>Chassis no.</Label><Input value={form.chassis_no} onChange={(e) => set("chassis_no", e.target.value)} /></div>
          </div>
          <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. alignment due at 55,000" /></div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={editModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={mutation.isPending || !form.registration.trim()}>
            {mutation.isPending ? "Saving…" : editing ? "Save changes" : "Add vehicle"}
          </Button>
        </div>
      </Modal>

      {/* History ────────────────────────────────────────────────────── */}
      <Modal isOpen={historyModal.isOpen} onClose={historyModal.closeModal} className="max-w-2xl p-6">
        <h3 className="mb-1 font-mono text-lg font-semibold text-gray-800 dark:text-white/90">
          {history.data?.vehicle.registration ?? "…"}
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          {history.data
            ? `${[history.data.vehicle.make, history.data.vehicle.model].filter(Boolean).join(" ") || "Vehicle"}`
              + `${history.data.vehicle.tyre_size ? ` · takes ${history.data.vehicle.tyre_size}` : ""}`
              + ` · ${money(history.data.lifetime_value)} of work`
            : "Loading…"}
        </p>

        {history.isLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
        ) : (history.data?.visits ?? []).length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Nothing done to this vehicle yet.
          </p>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {(history.data?.visits ?? []).map((visit) => (
              <div key={visit.id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                    {new Date(visit.sold_at).toLocaleDateString()}
                    <span className="ml-2 font-mono text-theme-xs text-gray-400">{visit.invoice_number}</span>
                    {visit.status === "cancelled" && <Badge size="sm" color="light">voided</Badge>}
                  </span>
                  <span className="text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">
                    {money(visit.total)}
                    {visit.odometer !== null && (
                      <span className="ml-2 text-theme-xs font-normal text-gray-400">at {visit.odometer.toLocaleString()} km</span>
                    )}
                  </span>
                </div>
                <ul className="space-y-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                  {visit.items.map((it) => (
                    <li key={it.id} className="flex justify-between gap-3">
                      <span className="truncate">
                        {it.product_name}{it.variant_name ? ` · ${it.variant_name}` : ""} × {Number(it.quantity)}
                      </span>
                      <span className="tabular-nums">{money(it.line_total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
