import { useState } from "react";
import { useMoney } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import TextArea from "../../../components/form/input/TextArea";
import Alert from "../../../components/ui/alert/Alert";
import Badge from "../../../components/ui/badge/Badge";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { useToast } from "../../../components/ui/toast";
import { useAuthStore } from "../../../stores/authStore";
import { useSuppliers, useSupplierMutations } from "../hooks/usePurchases";
import type { Supplier } from "../types";


export default function SuppliersPage() {
  const money = useMoney();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [search, setSearch] = useState("");
  const suppliers = useSuppliers({ search: search || undefined });
  const { create, update, remove, pay } = useSupplierMutations();

  const editor = useModal();
  const toast = useToast();

  /**
   * A delete that fails silently is the worst version of this: the row simply
   * stays, and the shopkeeper is left pressing Delete on something that will
   * never go. Most refusals here are a REASON — a supplier still referenced by
   * something else — so the server's message is what gets shown.
   */
  const removeWithFeedback = (id: string, name: string) =>
    remove.mutate(id, {
      onSuccess: () => toast.success(`${name} deleted`),
      onError: (e) => toast.error(e instanceof Error ? e.message : `Couldn't delete this supplier.`),
    });

  const payModal = useModal();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [target, setTarget] = useState<Supplier | null>(null);

  const [form, setForm] = useState<Record<string, string>>({});
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");

  const mutation = editing ? update : create;
  const err = mutation.error instanceof ApiError ? mutation.error.firstFieldError() ?? mutation.error.message : null;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => { setEditing(null); setForm({}); editor.openModal(); };
  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      name: s.name, contact_person: s.contact_person ?? "", phone: s.phone ?? "",
      whatsapp: s.whatsapp ?? "", email: s.email ?? "", address: s.address ?? "", notes: s.notes ?? "",
    });
    editor.openModal();
  };

  const save = () => {
    if (!form.name?.trim() || mutation.isPending) return;
    const payload = {
      name: form.name.trim(),
      contact_person: form.contact_person || null, phone: form.phone || null,
      whatsapp: form.whatsapp || null, email: form.email || null,
      address: form.address || null, notes: form.notes || null,
    };
    const opts = { onSuccess: () => editor.closeModal() };
    if (editing) update.mutate({ id: editing.id, ...payload }, opts);
    else create.mutate(payload, opts);
  };

  const openPay = (s: Supplier) => { setTarget(s); setPayAmount(""); setPayMethod("cash"); payModal.openModal(); };
  const doPay = () => {
    if (!target || !payAmount || pay.isPending) return;
    pay.mutate(
      { supplierId: target.id, amount: Number(payAmount), method: payMethod as never },
      { onSuccess: () => payModal.closeModal() },
    );
  };

  if (!hasPermission("suppliers.manage")) {
    return <Alert variant="error" title="No access" message="You don't have permission to manage suppliers." />;
  }

  const rows = suppliers.data?.data ?? [];

  return (
    <>
      <PageMeta title="Suppliers | ShopOS" description="Your vendors and payables" />
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Suppliers</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Vendors you buy stock from, and what you owe them.</p>
        </div>
        <Button size="sm" onClick={openCreate}>+ New supplier</Button>
      </div>

      <div className="mb-4 max-w-xs">
        <Input placeholder="Search suppliers…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 text-theme-xs uppercase text-gray-400 dark:border-gray-800">
            <tr>
              <th className="px-5 py-3">Supplier</th>
              <th className="px-5 py-3">Contact</th>
              <th className="px-5 py-3 text-right">Outstanding</th>
              <th className="px-5 py-3"></th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}><td colSpan={5} className="px-5 py-4"><div className="h-5 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td></tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-500 dark:text-gray-400">No suppliers yet.</td></tr>
            ) : (
              rows.map((s) => (
                <tr key={s.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800 dark:text-white/90">{s.name}</div>
                    {s.phone && <div className="text-theme-xs text-gray-400">{s.phone}</div>}
                  </td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{s.contact_person ?? "—"}</td>
                  <td className="px-5 py-3 text-right font-medium">
                    {(s.outstanding ?? 0) > 0
                      ? <span className="text-error-500">{money(s.outstanding ?? 0)}</span>
                      : <span className="text-success-500">Settled</span>}
                  </td>
                  <td className="px-5 py-3">{!s.is_active && <Badge size="sm" color="light">inactive</Badge>}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      {(s.outstanding ?? 0) > 0 && (
                        <button className="text-brand-500 hover:text-brand-600 dark:text-brand-400" onClick={() => openPay(s)}>Pay</button>
                      )}
                      <button className="text-gray-500 hover:text-gray-700 dark:text-gray-400" onClick={() => openEdit(s)}>Edit</button>
                      <button className="text-error-500 hover:text-error-600" onClick={() => { if (confirm(`Delete supplier "${s.name}"?`)) removeWithFeedback(s.id, s.name); }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create / edit */}
      <Modal isOpen={editor.isOpen} onClose={editor.closeModal} className="max-w-lg p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">{editing ? "Edit supplier" : "New supplier"}</h3>
        {err && <div className="mb-3"><Alert variant="error" title="Couldn't save" message={err} /></div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input placeholder="Supplier / company name *" value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} /></div>
          <Input placeholder="Contact person" value={form.contact_person ?? ""} onChange={(e) => set("contact_person", e.target.value)} />
          <Input placeholder="Phone" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          <Input placeholder="WhatsApp" value={form.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value)} />
          <Input placeholder="Email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          <div className="sm:col-span-2"><TextArea placeholder="Address" value={form.address ?? ""} onChange={(v) => set("address", v)} rows={2} /></div>
          <div className="sm:col-span-2"><TextArea placeholder="Notes" value={form.notes ?? ""} onChange={(v) => set("notes", v)} rows={2} /></div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={editor.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={mutation.isPending || !form.name?.trim()}>{mutation.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </Modal>

      {/* Record payment */}
      <Modal isOpen={payModal.isOpen} onClose={payModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Pay {target?.name}</h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">Outstanding: {money(target?.outstanding ?? 0)}</p>
        {pay.error instanceof ApiError && <div className="mb-3"><Alert variant="error" title="Couldn't record" message={pay.error.message} /></div>}
        <div className="space-y-3">
          <Input type="number" placeholder="Amount" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
          <select className="h-11 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm dark:border-gray-700 dark:bg-gray-900" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cheque">Cheque</option>
          </select>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={payModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={doPay} disabled={pay.isPending || !payAmount}>{pay.isPending ? "Saving…" : "Record payment"}</Button>
        </div>
      </Modal>
    </>
  );
}
