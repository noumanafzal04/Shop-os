import { useMemo, useState } from "react";

import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useConfirm } from "../../../components/ui/confirm";
import { useToast } from "../../../components/ui/toast";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import { useIncomeCategories, useRecurringIncomeMutations, useRecurringIncomes } from "../hooks/useIncome";
import type { RecurringIncome } from "../services/incomeService";

const today = () => new Date().toISOString().slice(0, 10);

const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

/**
 * Money that comes round again: the flat upstairs, a let shutter, a monthly
 * supply contract.
 *
 * ── Why this screen exists at all ───────────────────────────────────────
 *
 * The backend, the service and the hooks all shipped before it did, and for a
 * few hours this feature was the exact shape the rest of this codebase keeps
 * producing: **built, tested, and with nothing a person touches able to reach
 * it.** Written down because the author found it in his own work by running the
 * same check that found it in everybody else's.
 *
 * ── Nothing here posts by itself ────────────────────────────────────────
 *
 * A template falls DUE and a person files it. Income that appears in the books
 * because a clock ticked is income nobody checked against a payment — and rent
 * is exactly the thing that goes unpaid quietly. So the due ones are surfaced
 * loudly and the amount is editable at the moment of filing: a tenant who paid
 * short HAS paid short, and filing the agreed figure would be a receipt for
 * money nobody received.
 */
export function RecurringIncomeTab({ money }: { money: (n: number | string) => string }) {
  const list = useRecurringIncomes();
  const categories = useIncomeCategories();
  const { create, update, remove, post } = useRecurringIncomeMutations();
  const confirm = useConfirm();
  const toast = useToast();
  const modal = useModal();

  const blank = () => ({
    category: "",
    description: "",
    amount: "",
    method: "cash",
    frequency: "monthly",
    next_due_on: today(),
    notes: "",
  });

  const [editing, setEditing] = useState<RecurringIncome | null>(null);
  const [form, setForm] = useState(blank);
  const [filing, setFiling] = useState<RecurringIncome | null>(null);
  const [fileAmount, setFileAmount] = useState("");

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const due = rows.filter((r) => r.is_due);
  const saving = editing ? update : create;

  const categoryOptions = [
    { value: "", label: "No category" },
    ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
  ];

  const openAdd = () => {
    setEditing(null);
    setForm(blank());
    modal.openModal();
  };

  const openEdit = (r: RecurringIncome) => {
    setEditing(r);
    setForm({
      category: r.income_category_id ?? r.category?.id ?? "",
      description: r.description,
      amount: String(Number(r.amount)),
      method: r.payment_method,
      frequency: r.frequency,
      next_due_on: r.next_due_on.slice(0, 10),
      notes: r.notes ?? "",
    });
    modal.openModal();
  };

  const save = () => {
    if (saving.isPending) return;

    const payload = {
      income_category_id: form.category || null,
      description: form.description.trim(),
      amount: Number(form.amount),
      payment_method: form.method,
      frequency: form.frequency,
      next_due_on: form.next_due_on,
      notes: form.notes.trim() || undefined,
    };
    const onSuccess = () => {
      toast.success(editing ? "Recurring income updated" : "Recurring income added");
      setEditing(null);
      setForm(blank());
      modal.closeModal();
    };
    const onError = (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save");

    if (editing) update.mutate({ id: editing.id, payload }, { onSuccess, onError });
    else create.mutate(payload, { onSuccess, onError });
  };

  /**
   * Pause and resume rather than delete.
   *
   * A tenant who moves out for three months has not ended the arrangement, and
   * deleting the template loses the schedule with it.
   */
  const togglePaused = async (r: RecurringIncome) => {
    if (r.is_active) {
      const ok = await confirm({
        title: `Pause "${r.description}"?`,
        message: "It stops falling due. Nothing already filed changes, and you can start it again any time.",
        confirmLabel: "Pause",
      });
      if (!ok) return;
    }

    update.mutate(
      { id: r.id, payload: { is_active: !r.is_active } },
      {
        onSuccess: () => toast.success(r.is_active ? "Paused" : "Running again"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
      },
    );
  };

  const askRemove = async (r: RecurringIncome) => {
    const ok = await confirm({
      title: `Remove "${r.description}"?`,
      message: "The schedule goes. Income already filed from it stays in your books.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;

    remove.mutate(r.id, {
      onSuccess: () => toast.success("Removed"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove"),
    });
  };

  const file = () => {
    if (filing === null) return;

    post.mutate(
      { id: filing.id, payload: { amount: Number(fileAmount) || undefined } },
      {
        onSuccess: () => {
          toast.success("Income filed");
          setFiling(null);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not file"),
      },
    );
  };

  const openFile = (r: RecurringIncome) => {
    setFiling(r);
    setFileAmount(String(Number(r.amount)));
  };

  // What the shop expects every month before it sells anything — the one
  // figure a standing-income list exists to produce.
  const monthly = rows
    .filter((r) => r.is_active && r.frequency === "monthly")
    .reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          The flat upstairs, a let shutter, a monthly contract. Nothing is filed on its own — you
          confirm what actually arrived.
        </p>
        <Button size="sm" onClick={openAdd}>Add recurring</Button>
      </div>

      {monthly > 0 && (
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
          Expected monthly{" "}
          <span className="font-semibold tabular-nums text-gray-800 dark:text-white/90">{money(monthly)}</span>
        </p>
      )}

      {due.length > 0 && (
        <div className="mb-5 rounded-2xl border border-warning-200 bg-warning-50 p-4 dark:border-warning-500/30 dark:bg-warning-500/10">
          <p className="mb-3 text-sm font-medium text-warning-700 dark:text-warning-400">
            {due.length} due now
          </p>
          <div className="space-y-2">
            {due.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 dark:bg-white/[0.04]"
              >
                <div className="min-w-0">
                  <span className="text-sm text-gray-800 dark:text-white/90">{r.description}</span>
                  <span className="ml-2 text-theme-xs text-gray-400">
                    {r.category?.name ?? "No category"} · due {r.next_due_on.slice(0, 10)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm tabular-nums text-gray-600 dark:text-gray-300">{money(r.amount)}</span>
                  <Button size="sm" onClick={() => openFile(r)}>File it</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="border-b border-gray-100 text-theme-xs uppercase text-gray-400 dark:border-gray-800">
            <tr>
              <th className="px-5 py-3">What</th>
              <th className="px-5 py-3">Every</th>
              <th className="px-5 py-3">Next due</th>
              <th className="px-5 py-3 text-right">Usual amount</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={5} className="px-5 py-4">
                    <div className="h-5 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-gray-500 dark:text-gray-400">
                  Nothing recurring yet. Add the flat upstairs, a let shutter, or a monthly contract
                  and it will offer itself each time it comes round.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800 dark:text-white/90">{r.description}</div>
                    <div className="text-theme-xs text-gray-400">
                      {r.category?.name ?? "No category"}
                      {!r.is_active && " · paused"}
                    </div>
                  </td>
                  <td className="px-5 py-3 capitalize text-gray-500 dark:text-gray-400">{r.frequency}</td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                    {r.next_due_on.slice(0, 10)}
                    {r.is_due && (
                      <span className="ml-2 rounded-full bg-warning-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        due
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums text-gray-800 dark:text-white/90">
                    {money(r.amount)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      {r.is_due && r.is_active && (
                        <button className={ROW_ACTION} onClick={() => openFile(r)}>File it</button>
                      )}
                      <button className={ROW_ACTION} onClick={() => void togglePaused(r)}>
                        {r.is_active ? "Pause" : "Resume"}
                      </button>
                      <button className={ROW_ACTION} onClick={() => openEdit(r)}>Edit</button>
                      <button className={ROW_ACTION_DANGER} onClick={() => void askRemove(r)}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add / edit the template */}
      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-md p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editing ? "Edit recurring income" : "Add recurring income"}
        </h3>
        <div className="space-y-3">
          <div>
            <Label>What is it</Label>
            <Input
              placeholder="Flat upstairs — rent"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category} options={categoryOptions} onChange={(v) => setForm({ ...form, category: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Usual amount</Label>
              <Input
                type="number"
                min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div>
              <Label>How it arrives</Label>
              <Select value={form.method} options={METHODS} onChange={(v) => setForm({ ...form, method: v })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Every</Label>
              <Select value={form.frequency} options={FREQUENCIES} onChange={(v) => setForm({ ...form, frequency: v })} />
            </div>
            <div>
              <Label>Next due</Label>
              <Input
                type="date"
                value={form.next_due_on}
                onChange={(e) => setForm({ ...form, next_due_on: e.target.value })}
              />
            </div>
          </div>
          <p className="text-theme-xs text-gray-400">
            The usual amount is a starting point, not a rule — you confirm what actually arrived each
            time it falls due.
          </p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving.isPending || !form.description.trim() || !Number(form.amount)}
          >
            {saving.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Modal>

      {/* File what actually arrived */}
      <Modal isOpen={filing !== null} onClose={() => setFiling(null)} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          File {filing?.description}
        </h3>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
          It goes into your books against {filing?.next_due_on.slice(0, 10)} — the month it was owed
          for, not today.
        </p>
        <Label>What actually arrived</Label>
        <Input type="number" min="0" value={fileAmount} onChange={(e) => setFileAmount(e.target.value)} />
        <p className="mt-1 text-theme-xs text-gray-400">
          Change it if they paid short. Filing the agreed figure when they did not is a receipt for
          money nobody received.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={() => setFiling(null)}>Cancel</Button>
          <Button size="sm" onClick={file} disabled={post.isPending || !Number(fileAmount)}>
            {post.isPending ? "Filing…" : "File it"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
