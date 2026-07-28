import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
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
import { useAuthStore } from "../../../stores/authStore";
import { useCustomer, useCustomerMutations, useCustomers } from "../hooks/useCustomers";
import type { Customer } from "../services/customersService";


export default function CustomersPage() {
  const money = useMoney();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  // Seed the filter from ?q= so the ⌘K palette can deep-link into a filtered list.
  const [searchParams] = useSearchParams();
  const qParam = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(qParam);
  useEffect(() => {
    if (qParam) setSearch(qParam);
  }, [qParam]);
  const customers = useCustomers({ search: search || undefined });
  const { create, update, remove, recordPayment } = useCustomerMutations();
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "card" | "bank_transfer" | "other">("cash");

  const editor = useModal();
  const detailModal = useModal();
  const [editing, setEditing] = useState<Customer | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useCustomer(detailId ?? undefined);
  const [form, setForm] = useState<Record<string, string>>({});

  const mutation = editing ? update : create;
  const err = mutation.error instanceof ApiError ? mutation.error.firstFieldError() ?? mutation.error.message : null;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => { setEditing(null); setForm({}); editor.openModal(); };
  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({
      name: c.name, phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "", notes: c.notes ?? "",
      credit_limit: c.credit_limit != null ? String(c.credit_limit) : "",
    });
    editor.openModal();
  };
  const save = () => {
    if (!form.name?.trim() || mutation.isPending) return;
    const payload = {
      name: form.name.trim(), phone: form.phone || null, email: form.email || null,
      address: form.address || null, notes: form.notes || null,
      credit_limit: form.credit_limit !== "" && form.credit_limit != null ? Number(form.credit_limit) : null,
    };
    const opts = { onSuccess: () => editor.closeModal() };
    if (editing) update.mutate({ id: editing.id, ...payload }, opts);
    else create.mutate(payload, opts);
  };

  // Record a khata repayment against the open customer, then refresh the detail.
  const doRecordPayment = () => {
    const amount = Number(payAmount);
    if (!detailId || !(amount > 0) || recordPayment.isPending) return;
    recordPayment.mutate(
      { id: detailId, amount, method: payMethod },
      { onSuccess: () => { setPayAmount(""); detail.refetch(); } },
    );
  };

  if (!hasPermission("customers.manage")) {
    return <Alert variant="error" title="No access" message="You don't have permission to view customers." />;
  }

  const rows = customers.data?.data ?? [];
  const d = detail.data;

  return (
    <>
      <PageMeta title="Customers | ShopOS" description="Your customer directory" />
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Customers</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Auto-built from sales & orders — add notes, track spend.</p>
        </div>
        <Button size="sm" onClick={openCreate}>+ Add customer</Button>
      </div>

      <div className="mb-4 max-w-xs">
        <Input placeholder="Search name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 text-theme-xs uppercase text-gray-400 dark:border-gray-800">
            <tr><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Phone</th><th className="px-5 py-3 text-center">Sales</th><th className="px-5 py-3 text-right">Spent</th><th className="px-5 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {customers.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={5} className="px-5 py-4"><div className="h-5 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td></tr>)
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-500 dark:text-gray-400">No customers yet — they'll appear as you make sales.</td></tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50 dark:border-gray-800/50 dark:hover:bg-white/5" onClick={() => { setDetailId(c.id); detailModal.openModal(); }}>
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800 dark:text-white/90">{c.name}</div>
                    {c.notes && <div className="truncate text-theme-xs text-gray-400">{c.notes}</div>}
                  </td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{c.phone ?? "—"}</td>
                  <td className="px-5 py-3 text-center">{c.sales_count ?? 0}</td>
                  <td className="px-5 py-3 text-right font-medium text-gray-800 dark:text-white/90">{money(c.sales_total ?? 0)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                      <button className="text-gray-500 hover:text-gray-700 dark:text-gray-400" onClick={() => openEdit(c)}>Edit</button>
                      <button className="text-error-500 hover:text-error-600" onClick={() => { if (confirm(`Delete "${c.name}"?`)) remove.mutate(c.id); }}>Delete</button>
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
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">{editing ? "Edit customer" : "Add customer"}</h3>
        {err && <div className="mb-3"><Alert variant="error" title="Couldn't save" message={err} /></div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input placeholder="Name *" value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} /></div>
          <Input placeholder="Phone" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          <Input placeholder="Email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          <div className="sm:col-span-2"><TextArea placeholder="Address" value={form.address ?? ""} onChange={(v) => set("address", v)} rows={2} /></div>
          <div className="sm:col-span-2"><TextArea placeholder="Notes (preferences, VIP…)" value={form.notes ?? ""} onChange={(v) => set("notes", v)} rows={2} /></div>
          <div className="sm:col-span-2">
            <Input type="number" min="0" placeholder="Credit limit (khata) — blank = no limit" value={form.credit_limit ?? ""} onChange={(e) => set("credit_limit", e.target.value)} />
            <p className="mt-1 text-theme-xs text-gray-400">The most this customer may owe on credit. Leave blank for no cap.</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={editor.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={mutation.isPending || !form.name?.trim()}>{mutation.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </Modal>

      {/* Detail + history */}
      <Modal isOpen={detailModal.isOpen} onClose={detailModal.closeModal} className="max-w-lg p-6">
        {!d ? <div className="h-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" /> : (
          <>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">{d.name}</h3>
                <p className="text-theme-xs text-gray-500 dark:text-gray-400">{d.phone ?? "no phone"}{d.email ? ` · ${d.email}` : ""}</p>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-gray-800 dark:text-white/90">{money(d.history?.total_spent ?? 0)}</div>
                <div className="text-theme-xs text-gray-400">{d.history?.orders_count ?? 0} purchases</div>
              </div>
            </div>
            {d.notes && <div className="mb-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600 dark:bg-white/[0.03] dark:text-gray-300">{d.notes}</div>}
            {d.address && <p className="mb-3 text-theme-xs text-gray-400">{d.address}</p>}

            {/* Khata (sell-on-credit) — balance, record a repayment, statement */}
            <div className="mb-4 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <span className="text-theme-xs font-medium uppercase text-gray-400">Credit (khata)</span>
                <div className="text-right">
                  <span className={`text-lg font-bold ${Number(d.credit_balance ?? 0) > 0 ? "text-error-600 dark:text-error-400" : "text-gray-800 dark:text-white/90"}`}>
                    {money(d.credit_balance ?? 0)}
                  </span>
                  <span className="ml-1 text-theme-xs text-gray-400">owed{d.credit_limit != null ? ` / ${money(d.credit_limit)} limit` : ""}</span>
                </div>
              </div>

              {Number(d.credit_balance ?? 0) > 0 && (
                <div className="mt-3 flex items-end gap-2">
                  <div className="flex-1"><Input type="number" min="0" placeholder="Payment amount" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></div>
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}
                    className="h-11 rounded-lg border border-gray-200 bg-transparent px-2 text-theme-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Transfer</option>
                    <option value="other">Other</option>
                  </select>
                  <Button size="sm" onClick={doRecordPayment} disabled={recordPayment.isPending || !(Number(payAmount) > 0)}>
                    {recordPayment.isPending ? "…" : "Record"}
                  </Button>
                </div>
              )}

              {(d.ledger?.length ?? 0) > 0 && (
                <div className="mt-3 max-h-40 space-y-1 overflow-y-auto border-t border-gray-100 pt-2 dark:border-gray-800">
                  {d.ledger!.map((e) => (
                    <div key={e.id} className="flex items-center justify-between text-theme-xs">
                      <span className="text-gray-500 dark:text-gray-400">
                        {new Date(e.created_at).toLocaleDateString()} · {e.type === "charge" ? "Credit sale" : e.type === "payment" ? `Payment (${e.method})` : "Adjustment"}
                      </span>
                      <span className={e.type === "charge" ? "text-error-600 dark:text-error-400" : "text-success-600 dark:text-success-400"}>
                        {e.type === "charge" ? "+" : "−"}{money(e.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="mb-2 text-theme-xs font-medium uppercase text-gray-400">History</p>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {[...(d.history?.sales ?? []).map((s) => ({ ref: s.invoice_number, total: s.total, when: s.sold_at, tag: s.channel })),
                ...(d.history?.orders ?? []).map((o) => ({ ref: o.order_number, total: o.total, when: o.placed_at, tag: o.status }))]
                .sort((a, b) => (a.when < b.when ? 1 : -1))
                .map((h, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-gray-50 py-1.5 text-sm dark:border-gray-800/50">
                    <span className="text-gray-700 dark:text-gray-300">{h.ref} <Badge size="sm" color="light">{String(h.tag).replace(/_/g, " ")}</Badge></span>
                    <span className="font-medium">{money(h.total)}</span>
                  </div>
                ))}
              {(d.history?.orders_count ?? 0) === 0 && <p className="py-4 text-center text-theme-xs text-gray-400">No purchases recorded.</p>}
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <Button size="sm" variant="outline" onClick={() => { detailModal.closeModal(); openEdit(d); }}>Edit</Button>
              <Button size="sm" onClick={detailModal.closeModal}>Close</Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
