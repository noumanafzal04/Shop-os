import { useState } from "react";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import Badge from "../../../components/ui/badge/Badge";
import Switch from "../../../components/form/switch/Switch";
import { useConfirm } from "../../../components/ui/confirm";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useBranches } from "../../branches/hooks/useBranches";
import { useRegisterMutations, useRegisters } from "../hooks/useRegisters";
import type { Register } from "../services/registerService";

interface Draft {
  id?: string;
  name: string;
  code: string;
  branch_id: string;
  is_active: boolean;
}

const blank: Draft = { name: "", code: "", branch_id: "", is_active: true };

/**
 * Registers = the shop's checkout lanes. A single-counter shop can ignore this
 * entirely; a mart adds one row per lane, and from then on a shift is
 * "cashier × lane" so every drawer reconciles on its own.
 */
export default function RegistersPanel() {
  const { data: registers, isLoading } = useRegisters();
  const branches = useBranches();
  const { create, update, remove, forceClose } = useRegisterMutations();
  const modal = useModal();
  const closeModal = useModal();
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(blank);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<Register | null>(null);
  const [counted, setCounted] = useState("");
  const isEdit = !!draft.id;

  const branchList = branches.data ?? [];
  const multiSite = branchList.length > 1;

  const openNew = () => { setDraft(blank); setError(null); modal.openModal(); };
  const openEdit = (r: Register) => {
    setDraft({ id: r.id, name: r.name, code: r.code ?? "", branch_id: r.branch_id ?? "", is_active: r.is_active });
    setError(null);
    modal.openModal();
  };

  const save = () => {
    if (!draft.name.trim()) return;
    setError(null);
    const onError = (e: unknown) =>
      setError(e instanceof ApiError ? e.message : "Could not save the register.");
    const done = {
      onSuccess: () => { toast.success(isEdit ? "Register updated" : "Register added"); modal.closeModal(); },
      onError,
    };

    if (isEdit) {
      // The branch is fixed after creation — a lane's shifts, sales and bound
      // hardware all belong to where it physically stands.
      update.mutate({ id: draft.id!, name: draft.name.trim(), code: draft.code.trim() || null, is_active: draft.is_active }, done);
    } else {
      create.mutate({
        name: draft.name.trim(),
        code: draft.code.trim() || null,
        branch_id: draft.branch_id || null,
        is_active: draft.is_active,
      }, done);
    }
  };

  const del = async (r: Register) => {
    if (await confirm({
      title: `Remove ${r.name}?`,
      message: "Its sales history is kept. Any printer or drawer bound to it goes back to the shared pool.",
      tone: "danger",
      confirmLabel: "Remove",
    })) {
      remove.mutate(r.id, {
        onSuccess: () => toast.success("Register removed"),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not remove the register."),
      });
    }
  };

  const startForceClose = (r: Register) => { setClosing(r); setCounted(""); closeModal.openModal(); };

  const submitForceClose = () => {
    if (!closing) return;
    forceClose.mutate({ registerId: closing.id, counted_cash: Number(counted) || 0, notes: "Closed by manager" }, {
      onSuccess: () => { toast.success(`${closing.name} closed`); closeModal.closeModal(); },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not close the shift."),
    });
  };

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      ) : (registers ?? []).length === 0 ? (
        <p className="text-theme-sm text-gray-400">
          No registers yet. One counter needs none — add a row per lane once you run more than one checkout.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {(registers ?? []).map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90">{r.name}</span>
                  {r.code && <span className="text-theme-xs text-gray-400">{r.code}</span>}
                  {r.is_busy && <Badge size="sm" color="warning">In use</Badge>}
                  {!r.is_active && <Badge size="sm" color="light">Off</Badge>}
                </div>
                <div className="truncate text-theme-xs text-gray-400">
                  {multiSite && r.branch?.name ? `${r.branch.name} · ` : ""}
                  {r.open_session
                    ? `${r.open_session.user_name ?? "A cashier"} · since ${new Date(r.open_session.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : "Free"}
                </div>
              </div>
              {/* A cashier who left without counting out would otherwise keep a
                  checkout locked until they came back. */}
              {r.is_busy && (
                <button type="button" onClick={() => startForceClose(r)} className="text-theme-xs font-medium text-warning-600 hover:text-warning-700">
                  Close shift
                </button>
              )}
              <button type="button" onClick={() => openEdit(r)} className="text-theme-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                Edit
              </button>
              <button type="button" onClick={() => del(r)} className="text-theme-xs font-medium text-error-500 hover:text-error-600">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button size="sm" variant="outline" onClick={openNew}>+ Add register</Button>

      {/* Add / edit */}
      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-md p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
          {isEdit ? "Edit register" : "Add register"}
        </h3>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Lane 1" />
          </div>
          <div>
            <Label>Short code <span className="font-normal text-gray-400">(optional, printed on receipts)</span></Label>
            <Input value={draft.code} onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))} placeholder="e.g. L1" />
          </div>
          {!isEdit && multiSite && (
            <div>
              <Label>Branch</Label>
              <Select
                value={draft.branch_id}
                options={branchList.map((b) => ({ value: b.id, label: b.name }))}
                placeholder="This branch"
                onChange={(v) => setDraft((d) => ({ ...d, branch_id: v }))}
              />
            </div>
          )}
          <Switch
            label="Active"
            defaultChecked={draft.is_active}
            onChange={(v) => setDraft((d) => ({ ...d, is_active: v }))}
          />
          {error && <p className="text-theme-sm text-error-500">{error}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={create.isPending || update.isPending}>
            {create.isPending || update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Modal>

      {/* Manager force-close of an abandoned lane */}
      <Modal isOpen={closeModal.isOpen} onClose={closeModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Close {closing?.name}</h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {closing?.open_session?.user_name
            ? `${closing.open_session.user_name}'s shift is still open. Count the drawer and close it here — the shift records that you closed it.`
            : "Count the drawer and close the shift."}
        </p>
        <Label>Counted cash</Label>
        <Input type="number" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} />
        <div className="mt-5 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={closeModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={submitForceClose} disabled={forceClose.isPending}>
            {forceClose.isPending ? "Closing…" : "Close shift"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
