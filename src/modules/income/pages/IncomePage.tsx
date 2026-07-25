import { useState } from "react";
import { useMoney } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { ApiError } from "../../../common/types/api";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import {
  useIncomeCategories,
  useIncomeMutations,
  useIncomes,
} from "../hooks/useIncome";
import type { Income } from "../services/incomeService";

const today = () => new Date().toISOString().slice(0, 10);

export default function IncomePage() {
  const money = useMoney();
  const toast = useToast();
  const confirm = useConfirm();

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 350);

  const incomes = useIncomes({ search: debounced, category_id: categoryId, page });
  const categories = useIncomeCategories();
  const { create, update, remove } = useIncomeMutations();

  const modal = useModal();
  const [editing, setEditing] = useState<Income | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [formCategory, setFormCategory] = useState("");

  const rows = incomes.data?.data ?? [];
  const pagination = incomes.data?.meta.pagination;

  const active = editing ? update : create;
  const apiError = active.error instanceof ApiError ? active.error : null;
  const errorFor = (key: string) => apiError?.errors[key]?.[0];

  const openAdd = () => {
    setEditing(null);
    setDescription("");
    setAmount("");
    setDate(today());
    setFormCategory("");
    create.reset();
    update.reset();
    modal.openModal();
  };

  const openEdit = (income: Income) => {
    setEditing(income);
    setDescription(income.description);
    setAmount(String(income.amount));
    setDate(income.income_date.slice(0, 10));
    setFormCategory(income.income_category_id ?? "");
    create.reset();
    update.reset();
    modal.openModal();
  };

  const submit = () => {
    if (active.isPending) return;
    const payload = {
      income_category_id: formCategory,
      description: description.trim(),
      amount: Number(amount),
      income_date: date,
    };
    const done = (verb: string, meta?: unknown) => {
      const w = (meta as { warnings?: string[] } | undefined)?.warnings?.[0];
      if (w) toast.info(w);
      else toast.success(`Income ${verb}`);
      modal.closeModal();
    };
    if (editing) {
      update.mutate(
        { id: editing.id, ...payload },
        { onSuccess: () => done("updated"), onError: () => toast.error("Couldn't save the income.") },
      );
    } else {
      create.mutate(payload, {
        onSuccess: (res) => done("recorded", res.meta),
        onError: () => toast.error("Couldn't save the income."),
      });
    }
  };

  const confirmDelete = async (income: Income) => {
    const ok = await confirm({
      title: "Delete income?",
      message: `"${income.description}" will be removed from your books.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    remove.mutate(income.id, {
      onSuccess: () => toast.success("Income deleted"),
      onError: () => toast.error("Couldn't delete the income."),
    });
  };

  return (
    <>
      <PageMeta title="Income | ShopOS" description="Other income (non-sales)" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Income</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Money in that isn't a sale — rent received, owner investment, refunds from suppliers.
            Your sales revenue is tracked automatically in the Cashbook.
          </p>
        </div>
        <Button size="sm" onClick={openAdd}>+ Add Income</Button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          placeholder="Search description…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <Select
          options={[
            { value: "", label: "All categories" },
            ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
          placeholder="All categories"
          onChange={(v) => { setCategoryId(v); setPage(1); }}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium">Date</th>
                <th className="px-6 py-3 font-medium">Description</th>
                <th className="px-6 py-3 font-medium">Category</th>
                <th className="px-6 py-3 font-medium text-right">Amount</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {incomes.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={5} className="px-6 py-4">
                      <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    {debounced || categoryId ? "No income matches these filters." : "No income recorded yet."}
                  </td>
                </tr>
              ) : (
                rows.map((e) => (
                  <tr key={e.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4">{e.income_date.slice(0, 10)}</td>
                    <td className="px-6 py-4 font-medium text-gray-800 dark:text-white/90">{e.description}</td>
                    <td className="px-6 py-4">{e.category?.name ?? "—"}</td>
                    <td className="px-6 py-4 text-right text-success-600 dark:text-success-500">{money(e.amount)}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-3">
                        <button className="text-brand-500 hover:text-brand-600" onClick={() => openEdit(e)}>Edit</button>
                        <button className="text-error-500 hover:text-error-600" onClick={() => confirmDelete(e)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.last_page > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3 text-sm dark:border-gray-800">
            <span className="text-gray-500 dark:text-gray-400">
              {pagination.total} entries · page {pagination.current_page} of {pagination.last_page}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pagination.current_page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={pagination.current_page >= pagination.last_page} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-md p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editing ? "Edit Income" : "Add Income"}
        </h3>

        <div className="space-y-4">
          <div>
            <Label>Category <span className="text-error-500">*</span></Label>
            <Select
              options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Choose category"
              value={formCategory}
              onChange={setFormCategory}
            />
            {errorFor("income_category_id") && (
              <p className="mt-1 text-theme-xs text-error-500">{errorFor("income_category_id")}</p>
            )}
          </div>
          <div>
            <Label>Description <span className="text-error-500">*</span></Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Owner cash injection" />
            {errorFor("description") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("description")}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount <span className="text-error-500">*</span></Label>
              <Input type="number" min="0" step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} />
              {errorFor("amount") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("amount")}</p>}
            </div>
            <div>
              <Label>Date <span className="text-error-500">*</span></Label>
              <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
              {errorFor("income_date") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("income_date")}</p>}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={active.isPending || !formCategory || !description.trim() || !amount}
          >
            {active.isPending ? "Saving…" : editing ? "Save changes" : "Save income"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
