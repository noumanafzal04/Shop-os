import { useEffect, useState } from "react";
import TableEmpty from "../../../components/ui/table/TableEmpty";
import { useSearchParams } from "react-router";
import { useMoney } from "../../shop/hooks/useShop";
import { downloadFile } from "../../../common/api/download";
import { failed } from "../../../common/api/failed";
import { useToast } from "../../../components/ui/toast";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import { FilterBar } from "../../../components/ui/filters";
import TextArea from "../../../components/form/input/TextArea";
import Select from "../../../components/form/Select";
import Alert from "../../../components/ui/alert/Alert";
import Badge from "../../../components/ui/badge/Badge";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { useAuthStore } from "../../../stores/authStore";
import { useCustomer, useCustomerMutations, useCustomers } from "../hooks/useCustomers";
import { useCustomerGroups, useCustomerGroupMutations } from "../hooks/useCustomerGroups";
import type { Customer } from "../services/customersService";
import type { CustomerGroup, PriceLevel } from "../services/customerGroupsService";
import { useConfirm } from "../../../components/ui/confirm";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import Pager from "../../../components/ui/pager";


export default function CustomersPage() {
  const confirm = useConfirm();
  const money = useMoney();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  // Seed the filter from ?q= so the ⌘K palette can deep-link into a filtered list.
  const [searchParams] = useSearchParams();
  const qParam = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(qParam);
  useEffect(() => {
    if (qParam) setSearch(qParam);
  }, [qParam]);
  const [page, setPage] = useState(1);
  const customers = useCustomers({ search: search || undefined, page });
  const { create, update, remove, recordPayment } = useCustomerMutations();

  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile("/customers/export", { search: search || undefined });
    } catch {
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "card" | "bank_transfer" | "other">("cash");

  const groups = useCustomerGroups();
  const groupMutations = useCustomerGroupMutations();
  const groupsModal = useModal();
  const [groupDraft, setGroupDraft] = useState<{ id?: string; name: string; price_level: PriceLevel; discount_percent: string }>({ name: "", price_level: "retail", discount_percent: "" });

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
      customer_group_id: c.customer_group_id ?? "",
    });
    editor.openModal();
  };
  const save = () => {
    if (!form.name?.trim() || mutation.isPending) return;
    const payload = {
      name: form.name.trim(), phone: form.phone || null, email: form.email || null,
      address: form.address || null, notes: form.notes || null,
      credit_limit: form.credit_limit !== "" && form.credit_limit != null ? Number(form.credit_limit) : null,
      customer_group_id: form.customer_group_id || null,
    };
    // A phone-less customer given a credit limit is now REFUSED by the server,
    // and until this the refusal arrived as a modal that simply stayed open.
    const opts = {
      onSuccess: () => editor.closeModal(),
      ...failed(toast, "That customer did not save."),
    };
    if (editing) update.mutate({ id: editing.id, ...payload }, opts);
    else create.mutate(payload, opts);
  };

  const groupOptions = [
    { value: "", label: "— No group (retail) —" },
    ...((groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))),
  ];
  const saveGroup = () => {
    if (!groupDraft.name.trim()) return;
    const payload = {
      name: groupDraft.name.trim(),
      price_level: groupDraft.price_level,
      discount_percent: groupDraft.discount_percent !== "" ? Number(groupDraft.discount_percent) : null,
    };
    const done = {
      onSuccess: () => { toast.success("Group saved"); setGroupDraft({ name: "", price_level: "retail", discount_percent: "" }); },
      // A group carries a members' discount, so a save that quietly failed
      // leaves every member on the old percentage.
      ...failed(toast, "That group did not save — its members keep the old pricing."),
    };
    if (groupDraft.id) groupMutations.update.mutate({ id: groupDraft.id, ...payload }, done);
    else groupMutations.create.mutate(payload, done);
  };
  const editGroup = (g: CustomerGroup) => setGroupDraft({ id: g.id, name: g.name, price_level: g.price_level, discount_percent: g.discount_percent != null ? String(g.discount_percent) : "" });
  const removeGroup = async (g: CustomerGroup) => {
    const ok = await confirm({
      title: `Delete group "${g.name}"?`,
      message: "Members fall back to retail pricing.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    groupMutations.remove.mutate(g.id, {
      onSuccess: () => toast.success("Group removed"),
      ...failed(toast, "That group is still there — nobody fell back to retail."),
    });
  };

  // Record a khata repayment against the open customer, then refresh the detail.
  const doRecordPayment = () => {
    const amount = Number(payAmount);
    if (!detailId || !(amount > 0) || recordPayment.isPending) return;
    recordPayment.mutate(
      { id: detailId, amount, method: payMethod },
      {
        onSuccess: () => { setPayAmount(""); detail.refetch(); },
        // MONEY. A repayment that vanished leaves the customer owing what they
        // have already handed over, and the field clearing was the only sign
        // either way.
        ...failed(toast, "That repayment was not recorded — the khata is unchanged."),
      },
    );
  };

  if (!hasPermission("customers.manage")) {
    return <Alert variant="error" title="No access" message="You don't have permission to view customers." />;
  }

  const rows = customers.data?.data ?? [];
  const pagination = customers.data?.meta.pagination;
  const d = detail.data;

  return (
    <>
      <PageMeta title="Customers | CartZe" description="Your customer directory" />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Customers</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Auto-built from sales & orders — add notes, track spend.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setGroupDraft({ name: "", price_level: "retail", discount_percent: "" }); groupsModal.openModal(); }}>Groups</Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
          <Button size="sm" onClick={openCreate}>+ Add customer</Button>
        </div>
      </div>

      <FilterBar
        search={{
          value: search,
          onChange: (value) => { setSearch(value); setPage(1); },
          placeholder: "Search name, phone or email…",
          label: "Search customers",
        }}
        results={{ count: pagination?.total, noun: "customers", loading: customers.isLoading }}
      />

      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-sm">
          <thead className="border-b border-gray-100 text-theme-xs uppercase text-gray-400 dark:border-gray-800">
            <tr><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Phone</th><th className="px-5 py-3 text-center">Sales</th><th className="px-5 py-3 text-right">Spent</th><th className="px-5 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {customers.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={5} className="px-5 py-4"><div className="h-5 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td></tr>)
            ) : rows.length === 0 ? (
              <tr><TableEmpty colSpan={5} className="px-5 py-10 text-center text-gray-500 dark:text-gray-400">No customers yet — they'll appear as you make sales.</TableEmpty></tr>
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
                      <button className={ROW_ACTION} onClick={() => openEdit(c)}>Edit</button>
                      <button className={ROW_ACTION_DANGER} onClick={async () => {
                        if (await confirm({ title: `Delete "${c.name}"?`, message: "Sales already made keep their record.", confirmLabel: "Delete", tone: "danger" })) {
                          remove.mutate(c.id, {
                            onSuccess: () => toast.success(`${c.name} removed`),
                            ...failed(toast, `${c.name} is still on the list.`),
                          });
                        }
                      }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
        <Pager pagination={customers.data?.meta?.pagination} onPage={setPage} noun="customers" />
      </div>

      {/* Create / edit */}
      <Modal isOpen={editor.isOpen} onClose={editor.closeModal} className="max-w-lg p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">{editing ? "Edit customer" : "Add customer"}</h3>
        {err && <div className="mb-3"><Alert variant="error" title="Couldn't save" message={err} /></div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input placeholder="Name *" value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} /></div>
          <Input placeholder={(Number(form.credit_limit) || 0) > 0 ? "Phone *" : "Phone"} value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          <Input placeholder="Email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          <div className="sm:col-span-2"><TextArea placeholder="Address" value={form.address ?? ""} onChange={(v) => set("address", v)} rows={2} /></div>
          <div className="sm:col-span-2"><TextArea placeholder="Notes (preferences, VIP…)" value={form.notes ?? ""} onChange={(v) => set("notes", v)} rows={2} /></div>
          <div className="sm:col-span-2">
            <Input type="number" min="0" placeholder="Credit limit (khata) — blank = no limit" value={form.credit_limit ?? ""} onChange={(e) => set("credit_limit", e.target.value)} />
            {/* The phone is not paperwork here. The till finds a customer by
                their number and by nothing else — there is no customer_id on a
                sale — so a khata without one can never be rung, repaid or
                chased. The server refuses it; saying so here means the
                shopkeeper does not meet that as a surprise. */}
            <p className="mt-1 text-theme-xs text-gray-400">
              The most this customer may owe on credit. Leave blank for no cap.
              {(Number(form.credit_limit) || 0) > 0 && !form.phone?.trim() ? (
                <span className="text-orange-500"> Add a phone number — the till finds a khata customer by their number.</span>
              ) : null}
            </p>
          </div>
          <div className="sm:col-span-2">
            <Select value={form.customer_group_id ?? ""} options={groupOptions} onChange={(v) => set("customer_group_id", v)} />
            <p className="mt-1 text-theme-xs text-gray-400">Pricing tier — a group can sell at wholesale and/or give a members' discount automatically.</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={editor.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={mutation.isPending || !form.name?.trim()}>{mutation.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </Modal>

      {/* Manage customer groups */}
      <Modal isOpen={groupsModal.isOpen} onClose={groupsModal.closeModal} className="max-w-lg p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Customer groups</h3>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">Tiered pricing — a group sells at retail or wholesale and can add an automatic members' discount.</p>

        <div className="mb-4 space-y-1.5">
          {(groups.data ?? []).length === 0 ? (
            <p className="text-theme-sm text-gray-400">No groups yet.</p>
          ) : (groups.data ?? []).map((g) => (
            <div key={g.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 dark:border-gray-800">
              <div>
                <span className="font-medium text-gray-800 dark:text-white/90">{g.name}</span>
                <span className="ml-2 text-theme-xs text-gray-400 capitalize">{g.price_level}{g.discount_percent != null && Number(g.discount_percent) > 0 ? ` · ${Number(g.discount_percent)}% off` : ""}{g.customers_count != null ? ` · ${g.customers_count} member(s)` : ""}</span>
              </div>
              <div className="flex gap-3">
                <button className={ROW_ACTION} onClick={() => editGroup(g)}>Edit</button>
                <button className={ROW_ACTION_DANGER} onClick={() => removeGroup(g)}>Remove</button>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-100 p-3 dark:border-gray-800 sm:grid-cols-3">
          <div className="sm:col-span-3 text-theme-xs font-medium uppercase text-gray-400">{groupDraft.id ? "Edit group" : "New group"}</div>
          <div className="sm:col-span-3"><Input placeholder="Group name (e.g. Wholesale)" value={groupDraft.name} onChange={(e) => setGroupDraft((d) => ({ ...d, name: e.target.value }))} /></div>
          <Select value={groupDraft.price_level} options={[{ value: "retail", label: "Retail price" }, { value: "wholesale", label: "Wholesale price" }]} onChange={(v) => setGroupDraft((d) => ({ ...d, price_level: v as PriceLevel }))} />
          <Input type="number" min="0" max="100" placeholder="Members' discount %" value={groupDraft.discount_percent} onChange={(e) => setGroupDraft((d) => ({ ...d, discount_percent: e.target.value }))} />
          <Button size="sm" onClick={saveGroup} disabled={!groupDraft.name.trim() || groupMutations.create.isPending || groupMutations.update.isPending}>{groupDraft.id ? "Save" : "Add"}</Button>
        </div>
        <div className="mt-6 flex justify-end">
          <Button size="sm" variant="outline" onClick={groupsModal.closeModal}>Done</Button>
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

            {/* Loyalty points — balance + statement (shown once they've earned any). */}
            {((d.loyalty_points ?? 0) > 0 || (d.loyalty_ledger?.length ?? 0) > 0) && (
              <div className="mb-4 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
                <div className="flex items-center justify-between">
                  <span className="text-theme-xs font-medium uppercase text-gray-400">Loyalty points</span>
                  <span className="text-lg font-bold text-brand-600 dark:text-brand-400">{d.loyalty_points ?? 0} pts</span>
                </div>
                {(d.loyalty_ledger?.length ?? 0) > 0 && (
                  <div className="mt-3 max-h-40 space-y-1 overflow-y-auto border-t border-gray-100 pt-2 dark:border-gray-800">
                    {d.loyalty_ledger!.map((e) => {
                      const positive = e.type === "earn" || e.type === "reverse_redeem";
                      const label = e.type === "earn" ? "Earned" : e.type === "redeem" ? "Redeemed" : e.type === "reverse_earn" ? "Reversed (return)" : "Refunded (return)";
                      return (
                        <div key={e.id} className="flex items-center justify-between text-theme-xs">
                          <span className="text-gray-500 dark:text-gray-400">{new Date(e.created_at).toLocaleDateString()} · {label}</span>
                          <span className={positive ? "text-success-600 dark:text-success-400" : "text-gray-600 dark:text-gray-300"}>
                            {positive ? "+" : "−"}{e.points} pts
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

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
