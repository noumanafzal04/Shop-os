import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import Alert from "../../../components/ui/alert/Alert";
import Badge from "../../../components/ui/badge/Badge";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { useToast } from "../../../components/ui/toast";
import { useAuthStore } from "../../../stores/authStore";
import { useCouponMutations, useCoupons } from "../hooks/useCoupons";
import type { Coupon } from "../services/couponsService";
import { useConfirm } from "../../../components/ui/confirm";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";

export default function CouponsPage() {
  const confirm = useConfirm();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const coupons = useCoupons();
  const { create, update, remove } = useCouponMutations();
  const editor = useModal();
  const toast = useToast();

  /**
   * A delete that fails silently is the worst version of this: the row simply
   * stays, and the shopkeeper is left pressing Delete on something that will
   * never go. Most refusals here are a REASON — a coupon still referenced by
   * something else — so the server's message is what gets shown.
   */
  const removeWithFeedback = (id: string, name: string) =>
    remove.mutate(id, {
      onSuccess: () => toast.success(`${name} deleted`),
      onError: (e) => toast.error(e instanceof Error ? e.message : `Couldn't delete this coupon.`),
    });

  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ type: "percent" });

  const mutation = editing ? update : create;
  const err = mutation.error instanceof ApiError ? mutation.error.firstFieldError() ?? mutation.error.message : null;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => { setEditing(null); setForm({ type: "percent" }); editor.openModal(); };
  const openEdit = (c: Coupon) => {
    setEditing(c);
    setForm({
      code: c.code, type: c.type, value: String(c.value),
      min_spend: c.min_spend != null ? String(c.min_spend) : "",
      max_discount: c.max_discount != null ? String(c.max_discount) : "",
      usage_limit: c.usage_limit != null ? String(c.usage_limit) : "",
      expires_at: c.expires_at ? c.expires_at.slice(0, 10) : "",
    });
    editor.openModal();
  };

  const save = () => {
    if (!form.code?.trim() || !form.value || mutation.isPending) return;
    const payload = {
      code: form.code.trim(), type: form.type as "percent" | "fixed", value: Number(form.value),
      min_spend: form.min_spend ? Number(form.min_spend) : null,
      max_discount: form.type === "percent" && form.max_discount ? Number(form.max_discount) : null,
      usage_limit: form.usage_limit ? Number(form.usage_limit) : null,
      expires_at: form.expires_at || null,
    };
    const opts = { onSuccess: () => editor.closeModal() };
    if (editing) update.mutate({ id: editing.id, ...payload }, opts);
    else create.mutate(payload, opts);
  };

  if (!hasPermission("coupons.manage")) {
    return <Alert variant="error" title="No access" message="You don't have permission to manage coupons." />;
  }

  const rows = coupons.data?.data ?? [];
  const fmtValue = (c: Coupon) => (c.type === "percent" ? `${c.value}%` : `Rs ${Number(c.value).toLocaleString()}`);

  return (
    <>
      <PageMeta title="Coupons | ShopOS" description="Discount codes" />
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Coupons</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Discount codes for POS and online checkout.</p>
        </div>
        <Button size="sm" onClick={openCreate}>+ New coupon</Button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="border-b border-gray-100 text-theme-xs uppercase text-gray-400 dark:border-gray-800">
            <tr><th className="px-5 py-3">Code</th><th className="px-5 py-3">Discount</th><th className="px-5 py-3">Min spend</th><th className="px-5 py-3">Used</th><th className="px-5 py-3">Expires</th><th className="px-5 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {coupons.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <tr key={i}><td colSpan={6} className="px-5 py-4"><div className="h-5 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td></tr>)
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-500 dark:text-gray-400">No coupons yet.</td></tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/50">
                  <td className="px-5 py-3 font-medium text-gray-800 dark:text-white/90">
                    {c.code} {!c.is_active && <Badge size="sm" color="light">off</Badge>}
                  </td>
                  <td className="px-5 py-3">{fmtValue(c)}{c.max_discount ? ` (max Rs ${Number(c.max_discount).toLocaleString()})` : ""}</td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{c.min_spend ? `Rs ${Number(c.min_spend).toLocaleString()}` : "—"}</td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{c.used_count}{c.usage_limit ? ` / ${c.usage_limit}` : ""}</td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{c.expires_at ? c.expires_at.slice(0, 10) : "—"}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      <button className={ROW_ACTION} onClick={() => openEdit(c)}>Edit</button>
                      <button className={ROW_ACTION_DANGER} onClick={async () => {
                        if (await confirm({ title: `Delete coupon ${c.code}?`, message: "Sales that already used it keep their record.", confirmLabel: "Delete", tone: "danger" })) removeWithFeedback(c.id, c.code);
                      }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={editor.isOpen} onClose={editor.closeModal} className="max-w-lg p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">{editing ? "Edit coupon" : "New coupon"}</h3>
        {err && <div className="mb-3"><Alert variant="error" title="Couldn't save" message={err} /></div>}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Input placeholder="CODE (e.g. EID20)" value={form.code ?? ""} onChange={(e) => set("code", e.target.value.toUpperCase())} /></div>
          <div>
            <Select defaultValue={form.type} options={[{ value: "percent", label: "Percentage %" }, { value: "fixed", label: "Fixed Rs" }]} placeholder="Type" onChange={(v) => set("type", v)} />
          </div>
          <Input type="number" min="0" placeholder={form.type === "percent" ? "Value %" : "Value Rs"} value={form.value ?? ""} onChange={(e) => set("value", e.target.value)} />
          <Input type="number" min="0" placeholder="Min spend (optional)" value={form.min_spend ?? ""} onChange={(e) => set("min_spend", e.target.value)} />
          {form.type === "percent" && <Input type="number" min="0" placeholder="Max discount cap (optional)" value={form.max_discount ?? ""} onChange={(e) => set("max_discount", e.target.value)} />}
          <Input type="number" min="1" placeholder="Usage limit (optional)" value={form.usage_limit ?? ""} onChange={(e) => set("usage_limit", e.target.value)} />
          <Input type="date" placeholder="Expires" value={form.expires_at ?? ""} onChange={(e) => set("expires_at", e.target.value)} />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={editor.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={mutation.isPending || !form.code?.trim() || !form.value}>{mutation.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </Modal>
    </>
  );
}
