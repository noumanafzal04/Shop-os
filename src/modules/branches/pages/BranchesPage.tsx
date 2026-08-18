import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { ApiError } from "../../../common/types/api";
import { useShopSettings } from "../../shop/hooks/useShop";
import { useBranches, useBranchMutations } from "../hooks/useBranches";
import type { Branch, BranchInput } from "../services/branchService";

/**
 * Branch management — a physical location under the shop. Only reachable when
 * the plan allows more than one branch (single-shop owners never see this).
 */
export default function BranchesPage() {
  const settings = useShopSettings();
  const maxBranches = settings.data?.max_branches ?? 1; // null (unlimited) handled below
  const branches = useBranches();
  const { create, update, remove } = useBranchMutations();

  const modal = useModal();
  const toast = useToast();
  const confirm = useConfirm();

  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchInput>({ name: "" });

  const count = branches.data?.length ?? 0;
  const atLimit = settings.data?.max_branches != null && count >= maxBranches;

  const openCreate = () => { setEditing(null); setForm({ name: "" }); modal.openModal(); };
  const openEdit = (b: Branch) => {
    setEditing(b);
    setForm({ name: b.name, code: b.code ?? "", address: b.address ?? "", phone: b.phone ?? "", is_active: b.is_active });
    modal.openModal();
  };

  const fieldErrors = (editing ? update.error : create.error) instanceof ApiError
    ? ((editing ? update.error : create.error) as ApiError).errors : {};
  const err = (k: string) => fieldErrors[k]?.[0];

  const save = () => {
    const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Couldn't save branch.");
    const onSuccess = () => { toast.success(editing ? "Branch updated" : "Branch added"); modal.closeModal(); };
    if (editing) {
      update.mutate({ id: editing.id, ...form }, { onSuccess, onError });
    } else {
      create.mutate(form, { onSuccess, onError });
    }
  };

  const del = async (b: Branch) => {
    if (await confirm({ title: `Delete "${b.name}"?`, message: "This location will be removed.", tone: "danger" })) {
      remove.mutate(b.id, {
        onSuccess: () => toast.success(`Deleted "${b.name}"`),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Delete failed."),
      });
    }
  };

  return (
    <>
      <PageMeta title="Branches | ShopOS" description="Your shop locations" />

      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Branches</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Your shop locations · {count}
            {settings.data?.max_branches != null ? ` of ${maxBranches}` : ""} used
          </p>
        </div>
        <Button size="sm" onClick={openCreate} disabled={atLimit}>+ Add branch</Button>
      </div>

      {atLimit && (
        <div className="mb-4">
          <Alert
            variant="info"
            title="Branch limit reached"
            message={`Your plan allows ${maxBranches} ${maxBranches === 1 ? "branch" : "branches"}. Ask support to raise this limit to add more locations.`}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {branches.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
          ))
        ) : (
          (branches.data ?? []).map((b) => (
            <div key={b.id} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="font-medium text-gray-800 dark:text-white/90">{b.name}</h3>
                {b.is_default ? (
                  <Badge size="sm" color="info">Main</Badge>
                ) : !b.is_active ? (
                  <Badge size="sm" color="warning">Inactive</Badge>
                ) : null}
              </div>
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">{b.address || "No address set"}</p>
              {b.phone && <p className="text-theme-xs text-gray-400">{b.phone}</p>}
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(b)}>Edit</Button>
                {/* A Button rather than the row-action pill, because the Edit
                    beside it is a Button. A pair where only one half is a
                    control reads as a control and a label. */}
                {!b.is_default && (
                  <Button size="sm" variant="danger" onClick={() => del(b)}>
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-lg p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editing ? "Edit branch" : "Add branch"}
        </h3>
        <div className="space-y-4">
          <div>
            <Label>Name <span className="text-error-500">*</span></Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Gulberg" />
            {err("name") && <p className="mt-1 text-theme-xs text-error-500">{err("name")}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Short code</Label>
              <Input value={form.code ?? ""} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="GLB" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone ?? ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="042…" />
            </div>
          </div>
          <div>
            <Label>Address</Label>
            <Input value={form.address ?? ""} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Street, area" />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={create.isPending || update.isPending || !form.name.trim()}>
            {create.isPending || update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
