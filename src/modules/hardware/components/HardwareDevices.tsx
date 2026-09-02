import { useState } from "react";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import Label from "../../../components/form/Label";
import Badge from "../../../components/ui/badge/Badge";
import { useConfirm } from "../../../components/ui/confirm";
import { failed } from "../../../common/api/failed";
import { useToast } from "../../../components/ui/toast";
import { useHardwareDevices, useHardwareMutations } from "../hooks/useHardware";
import { useRegisters } from "../../registers/hooks/useRegisters";
import { canKick, connectDrawer, isSerialSupported, kickDrawer } from "../../../common/escpos";
import type {
  ConnectionType,
  HardwareDevice,
  HardwareType,
} from "../services/hardwareService";

const TYPE_LABEL: Record<HardwareType, string> = {
  receipt_printer: "Receipt printer",
  label_printer: "Label printer",
  barcode_scanner: "Barcode scanner",
  cash_drawer: "Cash drawer",
  customer_display: "Customer display",
};

const CONNECTION_LABEL: Record<ConnectionType, string> = {
  browser: "Browser (print dialog)",
  serial: "Serial (Web Serial)",
  usb: "USB",
  bluetooth: "Bluetooth",
  lan: "Network (LAN)",
  wifi: "Wi-Fi",
  native: "Built-in (device app)",
};

/**
 * Peripherals nothing in the app drives yet.
 *
 * A customer display could be registered here — named, given a connection,
 * saved, listed like any other device — and no code path has ever rendered a
 * single character to one. That is not an unimplemented feature to a merchant;
 * it is a broken one, and the trust it costs is out of all proportion to the
 * peripheral. So the option is withheld until something drives it.
 *
 * Kept in TYPE_LABEL rather than deleted: the server still accepts the type,
 * and a shop that already saved one must see it listed with an honest note
 * instead of a blank row.
 */
const UNDRIVEN_TYPES: HardwareType[] = ["customer_display"];

const TYPE_OPTIONS = (Object.keys(TYPE_LABEL) as HardwareType[])
  .filter((v) => !UNDRIVEN_TYPES.includes(v))
  .map((v) => ({ value: v, label: TYPE_LABEL[v] }));
const CONNECTION_OPTIONS = (Object.keys(CONNECTION_LABEL) as ConnectionType[]).map((v) => ({ value: v, label: CONNECTION_LABEL[v] }));

interface Draft {
  id?: string;
  type: HardwareType;
  name: string;
  brand: string;
  model: string;
  connection_type: ConnectionType;
  connection_value: string;
  is_default: boolean;
  is_active: boolean;
  paper_size: "58mm" | "80mm" | "a4";
  /** "" = shop-wide (shared by every lane). */
  register_id: string;
}

const blank: Draft = {
  type: "receipt_printer",
  name: "",
  brand: "",
  model: "",
  connection_type: "browser",
  connection_value: "",
  is_default: false,
  is_active: true,
  register_id: "",
  paper_size: "80mm",
};

/** Open a small printable window and trigger the browser print dialog. */
function testPrint(d: HardwareDevice) {
  const w = d.settings?.paper_size === "58mm" ? "48mm" : d.settings?.paper_size === "a4" ? "480px" : "72mm";
  const win = window.open("", "_blank", "width=380,height=560");
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>Test print</title>
    <style>
      body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;padding:8px;color:#101828}
      .r{width:${w};max-width:100%;margin:0 auto;font-size:12px;text-align:center}
      h2{font-size:14px;margin:0 0 4px} hr{border:none;border-top:1px dashed #98a2b3;margin:8px 0}
      @media print{@page{size:${d.settings?.paper_size === "a4" ? "auto" : (d.settings?.paper_size ?? "80mm") + " auto"};margin:0}}
    </style></head><body>
    <div class="r"><h2>${d.name || TYPE_LABEL[d.type]}</h2>
    <div>${d.brand ?? ""} ${d.model ?? ""}</div><hr/>
    <div>Test print OK</div><div>${new Date().toLocaleString()}</div><hr/>
    <div>CartZe</div></div>
    <script>window.onload=function(){window.print()}</script>
    </body></html>`);
  win.document.close();
}

export default function HardwareDevices() {
  const { data: devices, isLoading } = useHardwareDevices();
  const { create, update, remove } = useHardwareMutations();
  const modal = useModal();
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(blank);
  const isEdit = !!draft.id;
  // Lanes, so a device can be wired to ONE checkout. Each lane keeps its own
  // default per type — lane 2's printer and lane 5's printer are both correct.
  const registers = useRegisters();
  const laneList = registers.data ?? [];

  const openNew = () => { setDraft(blank); modal.openModal(); };
  const openEdit = (d: HardwareDevice) => {
    setDraft({
      id: d.id, type: d.type, name: d.name, brand: d.brand ?? "", model: d.model ?? "",
      connection_type: d.connection_type, connection_value: d.connection_value ?? "",
      is_default: d.is_default, is_active: d.is_active,
      paper_size: d.settings?.paper_size ?? "80mm",
      register_id: d.register_id ?? "",
    });
    modal.openModal();
  };

  const isPrinter = draft.type === "receipt_printer" || draft.type === "label_printer";

  // ── Drawer permission (Web Serial) ──────────────────────────────
  // Granting a serial port is a browser-level permission, per device, and it
  // can only be asked for from a click. We ask once here and pulse the drawer
  // straight away, so the shopkeeper sees it work rather than being told it will.
  const [serialBusy, setSerialBusy] = useState(false);
  const connectAndTest = async (label: string) => {
    if (serialBusy) return;
    if (!isSerialSupported()) {
      toast.error("This browser can't open a drawer directly. Use Chrome or Edge on the till.");
      return;
    }
    setSerialBusy(true);
    try {
      await connectDrawer();
      const res = await kickDrawer();
      if (res.ok) toast.success(`${label} connected — the drawer should have opened.`);
      else toast.error(res.message);
    } catch {
      // The picker being dismissed is a normal outcome, not an error worth shouting about.
      toast.error("No device selected.");
    } finally {
      setSerialBusy(false);
    }
  };

  const save = () => {
    if (!draft.name.trim()) return;
    const payload = {
      name: draft.name.trim(),
      brand: draft.brand.trim() || null,
      model: draft.model.trim() || null,
      connection_type: draft.connection_type,
      connection_value: draft.connection_value.trim() || null,
      is_default: draft.is_default,
      is_active: draft.is_active,
      register_id: draft.register_id || null,
      settings: isPrinter ? { paper_size: draft.paper_size } : null,
    };
    const done = {
      onSuccess: () => { toast.success(isEdit ? "Device updated" : "Device added"); modal.closeModal(); },
      // A printer or drawer that did not save is found at the counter, by a
      // receipt that does not print.
      ...failed(toast, "That device did not save."),
    };
    if (isEdit) update.mutate({ id: draft.id!, ...payload }, done);
    else create.mutate({ type: draft.type, ...payload }, done);
  };

  const del = async (d: HardwareDevice) => {
    if (await confirm({ title: `Remove ${d.name}?`, tone: "danger", confirmLabel: "Remove" })) {
      remove.mutate(d.id, {
        onSuccess: () => toast.success("Device removed"),
        ...failed(toast, `${d.name} is still registered.`),
      });
    }
  };

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      ) : (devices ?? []).length === 0 ? (
        <p className="text-theme-sm text-gray-400">No devices yet. Add your receipt printer, scanner, or cash drawer.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {(devices ?? []).map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90">{d.name}</span>
                  {d.is_default && <Badge size="sm" color="success">Default</Badge>}
                  {!d.is_active && <Badge size="sm" color="light">Off</Badge>}
                  {/* Registered before the option was withheld. Saying so is
                      the point — a device listed like every other one, that
                      nothing drives, is worse than no device at all. */}
                  {UNDRIVEN_TYPES.includes(d.type) && (
                    <Badge size="sm" color="warning">Not supported yet</Badge>
                  )}
                </div>
                <div className="truncate text-theme-xs text-gray-400">
                  {TYPE_LABEL[d.type]} · {CONNECTION_LABEL[d.connection_type]}
                  {(d.brand || d.model) ? ` · ${[d.brand, d.model].filter(Boolean).join(" ")}` : ""}
                  {/* Where it's wired. "Shared" is the fallback every lane
                      reaches for when it has no device of its own. */}
                  {laneList.length > 0 ? ` · ${d.register?.name ?? "Shared"}` : ""}
                </div>
              </div>
              {(d.type === "receipt_printer" || d.type === "label_printer") && (
                <button type="button" onClick={() => testPrint(d)} className="text-theme-xs font-medium text-brand-500 hover:text-brand-600">
                  Test print
                </button>
              )}
              {/* A serial drawer needs a one-time permission grant, and the
                  browser only gives one from a click. After this it opens
                  silently for good. */}
              {canKick(d.connection_type) && (d.type === "cash_drawer" || d.type === "receipt_printer") && (
                <button type="button" onClick={() => connectAndTest(d.name)} className="text-theme-xs font-medium text-brand-500 hover:text-brand-600">
                  {serialBusy ? "…" : "Connect drawer"}
                </button>
              )}
              <button type="button" onClick={() => openEdit(d)} className="text-theme-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                Edit
              </button>
              <button type="button" onClick={() => del(d)} className="text-theme-xs font-medium text-error-500 hover:text-error-600">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button size="sm" variant="outline" onClick={openNew}>+ Add device</Button>

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-lg">
        <ModalForm
          title={isEdit ? "Edit device" : "Add device"}
          footer={
            <>
              <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={!draft.name.trim() || create.isPending || update.isPending}>
                {isEdit ? "Save" : "Add device"}
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {!isEdit && (
              <div>
                <Label>Type</Label>
                <Select value={draft.type} options={TYPE_OPTIONS} onChange={(v) => setDraft((d) => ({ ...d, type: v as HardwareType }))} />
              </div>
            )}
            <div>
              <Label>Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Front counter" />
            </div>
            <div>
              <Label>Connection</Label>
              <Select value={draft.connection_type} options={CONNECTION_OPTIONS} onChange={(v) => setDraft((d) => ({ ...d, connection_type: v as ConnectionType }))} />
            </div>
            <div>
              <Label>Address / device ID <span className="font-normal text-gray-400">(optional)</span></Label>
              <Input value={draft.connection_value} onChange={(e) => setDraft((d) => ({ ...d, connection_value: e.target.value }))} placeholder="e.g. 192.168.1.50:9100" />
            </div>
            <div>
              <Label>Brand</Label>
              <Input value={draft.brand} onChange={(e) => setDraft((d) => ({ ...d, brand: e.target.value }))} placeholder="e.g. XPrinter" />
            </div>
            <div>
              <Label>Model</Label>
              <Input value={draft.model} onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))} placeholder="e.g. XP-80" />
            </div>
            {isPrinter && (
              <div>
                <Label>Paper size</Label>
                <Select
                  value={draft.paper_size}
                  options={[{ value: "58mm", label: "58mm thermal" }, { value: "80mm", label: "80mm thermal" }, { value: "a4", label: "A4 / Letter" }]}
                  onChange={(v) => setDraft((d) => ({ ...d, paper_size: v as Draft["paper_size"] }))}
                />
              </div>
            )}
            {/* Only worth asking once the shop actually has lanes. */}
            {laneList.length > 0 && (
              <div>
                <Label>Register</Label>
                <Select
                  value={draft.register_id}
                  options={[
                    { value: "", label: "Shared — any register" },
                    ...laneList.map((l) => ({ value: l.id, label: l.name })),
                  ]}
                  placeholder="Shared — any register"
                  onChange={(v) => setDraft((d) => ({ ...d, register_id: v }))}
                />
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={draft.is_default} onChange={(e) => setDraft((d) => ({ ...d, is_default: e.target.checked }))} className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
              {draft.register_id ? "Default for this register" : "Default for its type"}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))} className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
              Active
            </label>
          </div>
        </ModalForm>
      </Modal>
    </div>
  );
}
