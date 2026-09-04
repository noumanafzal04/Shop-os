import { useState } from "react";
import TableEmpty from "../../../components/ui/table/TableEmpty";
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
import { useSuppliers, useSupplier, useSupplierMutations } from "../hooks/usePurchases";
import type { PurchaseOrder, Supplier } from "../types";
import Select from "../../../components/form/Select";
import Label from "../../../components/form/Label";
import { toIsoDate } from "../../../components/ui/filters/dateRanges";
import { useConfirm } from "../../../components/ui/confirm";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import Pager from "../../../components/ui/pager";
import { payOutlook } from "../payMath";


export default function SuppliersPage() {
  const confirm = useConfirm();
  const money = useMoney();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const suppliers = useSuppliers({ search: search || undefined, page });
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
  const [payAgainst, setPayAgainst] = useState("");   // "" = whole account
  const [payRef, setPayRef] = useState("");
  const [payDate, setPayDate] = useState(toIsoDate(new Date()));

  // The orders this payment could go against. Only loaded while the dialog is
  // open — the list page itself has no use for one supplier's order history.
  const detail = useSupplier(payModal.isOpen ? target?.id : undefined);
  const openOrders: PurchaseOrder[] = (detail.data?.purchase_orders ?? []).filter(
    (po) => po.status !== "draft" && po.status !== "cancelled"
      && Number(po.total) - Number(po.amount_paid) > 0.001,
  );

  const owed = target?.outstanding ?? 0;
  const paidAhead = target?.advance ?? 0;
  const entered = Number(payAmount) || 0;

  // What this order still needs, when one is picked; otherwise the whole
  // account. This is the figure the shopkeeper is actually paying down.
  const chosen = openOrders.find((po) => po.id === payAgainst);
  const dueHere = chosen ? Number(chosen.total) - Number(chosen.amount_paid) : Math.max(0, owed);
  const outlook = payOutlook(dueHere, entered);

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
    // No onError here on purpose: the modal already renders `err` above the
    // form, and it uses firstFieldError(), which names the field. A toast
    // would say less, somewhere else, at the same time.
    const opts = { onSuccess: () => editor.closeModal() };
    if (editing) update.mutate({ id: editing.id, ...payload }, opts);
    else create.mutate(payload, opts);
  };

  const openPay = (s: Supplier) => {
    setTarget(s);
    setPayAmount("");
    setPayMethod("cash");
    setPayAgainst("");
    setPayRef("");
    setPayDate(toIsoDate(new Date()));
    payModal.openModal();
  };
  const doPay = () => {
    if (!target || entered <= 0 || pay.isPending) return;
    pay.mutate(
      {
        supplierId: target.id,
        amount: entered,
        method: payMethod as never,
        reference: payRef.trim() || null,
        paid_at: payDate || null,
        purchase_order_id: payAgainst || null,
      },
      {
        // The modal shows `pay.error` itself, so a refusal is already covered.
        // What was missing is the other half: on success the dialog just
        // vanished, and money that leaves without a word is money a shopkeeper
        // pays twice.
        onSuccess: () => { payModal.closeModal(); toast.success(`Payment to ${target.name} recorded`); },
      },
    );
  };

  if (!hasPermission("suppliers.manage")) {
    return <Alert variant="error" title="No access" message="You don't have permission to manage suppliers." />;
  }

  const rows = suppliers.data?.data ?? [];

  return (
    <>
      <PageMeta title="Suppliers | CartZe" description="Your vendors and payables" />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Suppliers</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Vendors you buy stock from, and what you owe them.</p>
        </div>
        <Button size="sm" onClick={openCreate}>+ New supplier</Button>
      </div>

      <div className="mb-4 max-w-xs">
        <Input placeholder="Search suppliers…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-sm">
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
              <tr><TableEmpty colSpan={5} className="px-5 py-10 text-center text-gray-500 dark:text-gray-400">No suppliers yet.</TableEmpty></tr>
            ) : (
              rows.map((s) => (
                <tr key={s.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800 dark:text-white/90">{s.name}</div>
                    {s.phone && <div className="text-theme-xs text-gray-400">{s.phone}</div>}
                  </td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{s.contact_person ?? "—"}</td>
                  <td className="px-5 py-3 text-right font-medium">
                    {(s.outstanding ?? 0) > 0 ? (
                      <span className="text-error-500">{money(s.outstanding ?? 0)}</span>
                    ) : (s.advance ?? 0) > 0 ? (
                      // Paid ahead of any order. Reading "Settled" here hid
                      // money the shop is owed back in goods.
                      <span className="text-brand-500">{money(s.advance ?? 0)} in advance</span>
                    ) : (
                      <span className="text-success-500">Settled</span>
                    )}
                  </td>
                  <td className="px-5 py-3">{!s.is_active && <Badge size="sm" color="light">inactive</Badge>}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      {/* Always offered. A wholesaler's van arrives, cash
                          changes hands, and no order was ever raised — hiding
                          Pay on a settled account refused the commonest
                          payment a small shop makes. */}
                      <button className={ROW_ACTION} onClick={() => openPay(s)}>Pay</button>
                      <button className={ROW_ACTION} onClick={() => openEdit(s)}>Edit</button>
                      <button className={ROW_ACTION_DANGER} onClick={async () => {
                        if (await confirm({ title: `Delete supplier "${s.name}"?`, message: "Purchase orders already raised keep their record.", confirmLabel: "Delete", tone: "danger" })) removeWithFeedback(s.id, s.name);
                      }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
        <Pager pagination={suppliers.data?.meta?.pagination} onPage={setPage} noun="suppliers" />
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
      <Modal isOpen={payModal.isOpen} onClose={payModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Pay {target?.name}</h3>

        {/* What the account stands at, before anything is typed. */}
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {owed > 0 ? <>You owe <span className="font-medium text-error-500">{money(owed)}</span></>
            : paidAhead > 0 ? <>Paid ahead: <span className="font-medium text-brand-500">{money(paidAhead)}</span></>
            : "Nothing owed — this will be recorded as an advance."}
        </p>

        {pay.error instanceof ApiError && <div className="mb-3"><Alert variant="error" title="Couldn't record" message={pay.error.message} /></div>}

        <div className="space-y-4">
          <div>
            <Label htmlFor="pay-amount">Amount</Label>
            <div className="flex gap-2">
              <Input id="pay-amount" type="number" step={0.01} placeholder="0.00" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              {dueHere > 0 && (
                <Button size="sm" variant="outline" onClick={() => setPayAmount(String(Math.round(dueHere * 100) / 100))}>
                  Pay full
                </Button>
              )}
            </div>
            {/* The half the screen never showed: what is left after this. */}
            {entered > 0 && (
              <p className="mt-2 text-sm">
                {outlook.kind === "still-owed" ? (
                  <span className="text-gray-500 dark:text-gray-400">
                    Still owed after this: <span className="font-medium text-error-500">{money(outlook.remaining)}</span>
                  </span>
                ) : outlook.kind === "advance" ? (
                  <span className="text-brand-500">
                    {money(outlook.advance)} more than is owed — recorded as an advance.
                  </span>
                ) : (
                  <span className="text-success-600 dark:text-success-500">
                    {chosen ? "Settles this order in full." : "Settles the account in full."}
                  </span>
                )}
              </p>
            )}
          </div>

          {openOrders.length > 0 && (
            <div>
              <Label>Against</Label>
              <Select
                aria-label="Which order this payment is against"
                value={payAgainst}
                onChange={setPayAgainst}
                options={[
                  { value: "", label: "Whole account (oldest orders first)" },
                  ...openOrders.map((po) => ({
                    value: po.id,
                    label: `${po.po_number} · ${money(Number(po.total) - Number(po.amount_paid))} due`,
                  })),
                ]}
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Method</Label>
              <Select
                aria-label="Payment method"
                value={payMethod}
                onChange={setPayMethod}
                options={[
                  { value: "cash", label: "Cash" },
                  { value: "bank_transfer", label: "Bank transfer" },
                  { value: "card", label: "Card" },
                  { value: "cheque", label: "Cheque" },
                ]}
              />
            </div>
            <div>
              <Label htmlFor="pay-date">Paid on</Label>
              <Input id="pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
          </div>

          {payMethod !== "cash" && (
            <div>
              <Label htmlFor="pay-ref">Reference</Label>
              <Input id="pay-ref" placeholder="Cheque no. / transaction id" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={payModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={doPay} disabled={pay.isPending || entered <= 0}>{pay.isPending ? "Saving…" : "Record payment"}</Button>
        </div>
      </Modal>
    </>
  );
}
