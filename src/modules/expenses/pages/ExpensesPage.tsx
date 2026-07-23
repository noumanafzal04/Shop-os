import { useState } from "react";
import { useMoney } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import {
  useExpenseCategories,
  useExpenseMutations,
  useExpenses,
} from "../hooks/useExpenses";
import type { Expense } from "../services/expensesService";

const today = () => new Date().toISOString().slice(0, 10);

export default function ExpensesPage() {
  const money = useMoney();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 350);

  const expenses = useExpenses({ search: debounced, category_id: categoryId, page });
  const categories = useExpenseCategories();
  const { create, remove } = useExpenseMutations();

  const modal = useModal();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [formCategory, setFormCategory] = useState("");
  const [warning, setWarning] = useState<string | null>(null);

  const rows = expenses.data?.data ?? [];
  const pagination = expenses.data?.meta.pagination;

  const apiError = create.error instanceof ApiError ? create.error : null;
  const errorFor = (key: string) => apiError?.errors[key]?.[0];
  const generalError = apiError && Object.keys(apiError.errors).length === 0 ? apiError.message : null;

  const openAdd = () => {
    setDescription("");
    setAmount("");
    setDate(today());
    setFormCategory("");
    setWarning(null);
    create.reset();
    modal.openModal();
  };

  const submit = () => {
    if (create.isPending) return;
    create.mutate(
      {
        expense_category_id: formCategory,
        description: description.trim(),
        amount: Number(amount),
        expense_date: date,
      },
      {
        onSuccess: (response) => {
          const w = (response.meta as { warnings?: string[] }).warnings?.[0];
          if (w) {
            setWarning(w);
            setTimeout(() => modal.closeModal(), 1800);
          } else {
            modal.closeModal();
          }
        },
      },
    );
  };

  const confirmDelete = (expense: Expense) => {
    if (window.confirm(`Delete expense "${expense.description}"?`)) {
      remove.mutate(expense.id);
    }
  };

  return (
    <>
      <PageMeta title="Expenses | ShopOS" description="Business expenses" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Expenses</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Categories tailored to your business type — fully editable.
          </p>
        </div>
        <Button size="sm" onClick={openAdd}>+ Add Expense</Button>
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
              {expenses.isLoading ? (
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
                    {debounced || categoryId ? "No expenses match these filters." : "No expenses recorded yet."}
                  </td>
                </tr>
              ) : (
                rows.map((e) => (
                  <tr key={e.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4">{e.expense_date.slice(0, 10)}</td>
                    <td className="px-6 py-4 font-medium text-gray-800 dark:text-white/90">
                      {e.description}
                    </td>
                    <td className="px-6 py-4">{e.category?.name ?? "—"}</td>
                    <td className="px-6 py-4 text-right">{money(e.amount)}</td>
                    <td className="px-6 py-4 text-right">
                      <button className="text-error-500 hover:text-error-600" onClick={() => confirmDelete(e)}>
                        Delete
                      </button>
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
              {pagination.total} expenses · page {pagination.current_page} of {pagination.last_page}
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
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Add Expense</h3>

        {generalError && (
          <div className="mb-4">
            <Alert variant="error" title="Couldn't save" message={generalError} />
          </div>
        )}
        {warning && (
          <div className="mb-4">
            <Alert variant="warning" title="Saved — possible duplicate" message={warning} />
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label>Category <span className="text-error-500">*</span></Label>
            <Select
              options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Choose category"
              onChange={setFormCategory}
            />
            {errorFor("expense_category_id") && (
              <p className="mt-1 text-theme-xs text-error-500">{errorFor("expense_category_id")}</p>
            )}
          </div>
          <div>
            <Label>Description <span className="text-error-500">*</span></Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. July shop rent" />
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
              {errorFor("expense_date") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("expense_date")}</p>}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={create.isPending || !formCategory || !description.trim() || !amount}
          >
            {create.isPending ? "Saving…" : "Save expense"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
