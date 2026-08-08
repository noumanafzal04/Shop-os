import { useMemo, useRef, useState } from "react";
import { useMoney } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import { FilterTabs } from "../../../components/ui/tabs/FilterTabs";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import TextArea from "../../../components/form/input/TextArea";
import Alert from "../../../components/ui/alert/Alert";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useConfirm } from "../../../components/ui/confirm";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import {
  useBudgets,
  useExpenseAdminMutations,
  useExpenseCategories,
  useExpenseCategoryMutations,
  useExpenseMutations,
  useExpenses,
  useRecurringExpenses,
} from "../hooks/useExpenses";
import { PAYMENT_METHODS, type BudgetRow, type Expense, type RecurringExpense } from "../services/expensesService";
import { activeFilterCount, categoryOptions, toParams, type MoneyFilters, type MoneyTotals } from "../services/moneyFilters";
import { MoneyFilterBar } from "../components/MoneyFilterBar";
import { CategoryManager } from "../components/CategoryManager";
import { downloadFile } from "../../../common/api/download";

const today = () => new Date().toISOString().slice(0, 10);

const TABS = [
  { key: "expenses", label: "Expenses" },
  { key: "recurring", label: "Recurring" },
  { key: "budgets", label: "Budgets" },
  // The vocabulary a business describes itself in. Last, because it is set up
  // once and then left alone — but present, because the seeded list was never
  // meant to be the final word.
  { key: "categories", label: "Categories" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** The orders the server can honour on this list (MoneyEntryFilters::SORTS). */
const SORTS: Array<{ value: NonNullable<MoneyFilters["sort"]>; label: string }> = [
  { value: "date", label: "Date" },
  { value: "amount", label: "Amount" },
  { value: "created", label: "Recently added" },
];

/**
 * The Expense Manager.
 *
 * Three jobs that share a vocabulary but not a screen — filing what was spent,
 * keeping the bills that come round again, and watching a category against its
 * ceiling. Tabbed rather than stacked, because a shopkeeper opens this page to
 * do exactly one of them.
 *
 * Every tab carries the same three controls in the same order — find, narrow,
 * act — because for a books-only business this page IS the product, and a
 * screen whose four halves each filter differently is four screens.
 */
export default function ExpensesPage() {
  const money = useMoney();
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>("expenses");

  const recurring = useRecurringExpenses();
  const dueCount = recurring.data?.dueCount ?? 0;

  return (
    <>
      <PageMeta title="Expenses | ShopOS" description="Business expenses" />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Expenses</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Your own categories — seeded from your business type, yours to change.
          </p>
        </div>
      </div>

      {/* Bills that have fallen due are the only thing on this page that is
          time-sensitive, so the count follows you between tabs. */}
      <FilterTabs
        tabs={TABS.map((t) => ({
          ...t,
          badge:
            t.key === "recurring" && dueCount > 0 ? (
              <span className="rounded-full bg-warning-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{dueCount}</span>
            ) : undefined,
        }))}
        value={tab}
        onChange={setTab}
        className="mb-5"
      />

      {tab === "expenses" && <ExpensesTab money={money} toast={toast} />}
      {tab === "recurring" && <RecurringTab money={money} toast={toast} />}
      {tab === "budgets" && <BudgetsTab money={money} toast={toast} />}
      {tab === "categories" && <ExpenseCategoriesTab money={money} />}
    </>
  );
}

type Money = (n: string | number) => string;
type Toast = ReturnType<typeof useToast>;

/**
 * The one toolbar shape the smaller tabs share: find, then narrow. The big
 * list has MoneyFilterBar; these two have lists of tens rather than thousands,
 * so they narrow in the browser and never round-trip.
 */
function MiniFilterBar({
  search,
  onSearch,
  placeholder,
  segments,
  value,
  onSegment,
  summary,
  action,
}: {
  search: string;
  onSearch: (v: string) => void;
  placeholder: string;
  segments: Array<[string, string, number]>;
  value: string;
  onSegment: (v: string) => void;
  summary?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-52 flex-1">
          <Input placeholder={placeholder} value={search} onChange={(e) => onSearch(e.target.value)} />
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800/60">
          {segments.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              aria-pressed={value === key}
              onClick={() => onSegment(key)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-theme-xs font-medium transition ${
                value === key
                  ? "bg-brand-500 text-white shadow-theme-xs"
                  : "text-gray-500 hover:bg-white/70 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5"
              }`}
            >
              {label} <span className="tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>

        {action}
      </div>

      {summary && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-gray-100 pt-3 dark:border-gray-800">
          {summary}
        </div>
      )}
    </div>
  );
}

// ── Expenses ──────────────────────────────────────────────────────────

function ExpensesTab({ money, toast }: { money: Money; toast: Toast }) {
  const [filters, setFilters] = useState<MoneyFilters>({ page: 1 });
  // Typing must not fire a request per keystroke, but every other filter is a
  // deliberate click and should answer at once.
  const debouncedSearch = useDebouncedValue(filters.search ?? "", 350);
  const query = { ...filters, search: debouncedSearch };
  const page = filters.page ?? 1;
  const setPage = (p: number) => setFilters((f) => ({ ...f, page: p }));

  const expenses = useExpenses(query);
  const totals = (expenses.data?.meta as { totals?: MoneyTotals } | undefined)?.totals;
  const categories = useExpenseCategories();
  const { create, update, remove, attach, detach } = useExpenseMutations();
  const confirm = useConfirm();

  const modal = useModal();
  // Which row this modal is editing, or null for a new one. Correcting a
  // mis-keyed amount used to mean deleting the row and typing it again — and
  // once the shift that paid it had closed, the delete was refused too, so a
  // typo made yesterday could never be fixed at all. Income had this button
  // from the start; expenses, the far busier half, did not.
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState({
    category: "", description: "", reference: "", amount: "",
    method: "cash", date: today(), notes: "",
  });
  const [warnings, setWarnings] = useState<string[]>([]);

  // One hidden picker, retargeted per row — a file input per expense would put
  // dozens of them in the DOM for no gain.
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachTo, setAttachTo] = useState<string | null>(null);

  const rows = expenses.data?.data ?? [];
  const pagination = expenses.data?.meta.pagination;

  // The server sorts (MoneyEntryFilters::sort). Nothing here ever asked it to,
  // so a merchant hunting the biggest bill of the quarter read four pages by
  // eye. The headers ask now.
  const sort = filters.sort ?? "date";
  const dir = filters.dir ?? "desc";
  const sortBy = (key: MoneyFilters["sort"]) =>
    setFilters((f) => ({
      ...f,
      sort: key,
      dir: (f.sort ?? "date") === key && (f.dir ?? "desc") === "desc" ? "asc" : "desc",
      page: 1,
    }));

  // Whichever mutation this modal is driving — the form, its errors and its
  // pending state all read from one place so the two paths can't drift.
  const active = editing ? update : create;
  const apiError = active.error instanceof ApiError ? active.error : null;
  const errorFor = (key: string) => apiError?.errors[key]?.[0];
  const generalError = apiError && Object.keys(apiError.errors).length === 0 ? apiError.message : null;

  const openAdd = () => {
    setEditing(null);
    setForm({ category: "", description: "", reference: "", amount: "", method: "cash", date: today(), notes: "" });
    setWarnings([]);
    create.reset();
    update.reset();
    modal.openModal();
  };

  const openEdit = (expense: Expense) => {
    setEditing(expense);
    setForm({
      category: expense.expense_category_id ?? expense.category?.id ?? "",
      description: expense.description,
      reference: expense.reference ?? "",
      amount: String(expense.amount),
      method: expense.payment_method,
      date: expense.expense_date.slice(0, 10),
      notes: expense.notes ?? "",
    });
    setWarnings([]);
    create.reset();
    update.reset();
    modal.openModal();
  };

  const submit = () => {
    if (active.isPending) return;
    const payload = {
      expense_category_id: form.category,
      description: form.description.trim(),
      reference: form.reference.trim() || undefined,
      amount: Number(form.amount),
      payment_method: form.method,
      expense_date: form.date,
      notes: form.notes.trim() || undefined,
    };
    const onSuccess = (response: { meta?: unknown }) => {
      const w = (response.meta as { warnings?: string[] } | undefined)?.warnings ?? [];
      // Warnings are things the shop needs to hear — a budget passed, a
      // cash payment with no drawer open — never reasons to hold the form.
      if (w.length) setWarnings(w);
      else modal.closeModal();
      toast.success(editing ? "Expense updated" : "Expense recorded");
    };

    if (editing) update.mutate({ id: editing.id, ...payload }, { onSuccess });
    else create.mutate(payload, { onSuccess });
  };

  const onFilePicked = (file: File | undefined) => {
    if (!file || !attachTo) return;
    attach.mutate(
      { id: attachTo, file },
      {
        onSuccess: () => toast.success("Receipt attached"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed"),
      },
    );
    setAttachTo(null);
  };

  const SortHeader = ({ label, column, align = "left" }: { label: string; column: MoneyFilters["sort"]; align?: "left" | "right" }) => (
    <th className={`px-5 py-3 font-medium ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => sortBy(column)}
        aria-label={`Sort by ${label}`}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-gray-600 dark:hover:text-gray-300 ${
          sort === column ? "text-brand-600 dark:text-brand-400" : ""
        }`}
      >
        {label}
        <span aria-hidden className={sort === column ? "" : "opacity-0"}>{dir === "desc" ? "↓" : "↑"}</span>
      </button>
    </th>
  );

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => { onFilePicked(e.target.files?.[0]); e.currentTarget.value = ""; }}
      />

      <MoneyFilterBar
        filters={filters}
        onChange={setFilters}
        // Every category, retired ones included. The filter is how you FIND
        // history, and hiding a switched-off category here is what made three
        // years of "Cooking Gas" unreachable the day it was retired.
        categories={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name, retired: !c.is_active }))}
        methods={PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label }))}
        totals={totals}
        money={money}
        sorts={SORTS}
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => downloadFile("/expenses/export", toParams(query), "expenses.csv")}
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-theme-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
            >
              Export
            </button>
            <Button size="sm" onClick={openAdd}>Add expense</Button>
          </div>
        }
      />

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <SortHeader label="Date" column="date" />
                <th className="px-5 py-3 font-medium">Description</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">Paid</th>
                <SortHeader label="Amount" column="amount" align="right" />
                <th className="px-5 py-3 text-right font-medium">Receipt</th>
                <th className="px-5 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {expenses.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-5 py-4"><div className="h-6 animate-pulse rounded bg-gray-100 dark:bg-gray-800" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    {activeFilterCount(filters) > 0 ? "No expenses match these filters." : "No expenses recorded yet."}
                  </td>
                </tr>
              ) : (
                rows.map((e: Expense) => (
                  <tr key={e.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-5 py-3.5 tabular-nums">{e.expense_date.slice(0, 10)}</td>
                    <td className="px-5 py-3.5 font-medium text-gray-800 dark:text-white/90">
                      {e.description}
                      {e.reference && <span className="ml-2 text-theme-xs font-normal text-gray-400">{e.reference}</span>}
                      {/* Who was paid, when the shop said so. It has always
                          been on the row and on the CSV, and never on screen. */}
                      {e.supplier?.name && (
                        <span className="ml-2 text-theme-xs font-normal text-gray-400">· {e.supplier.name}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">{e.category?.name ?? "—"}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-theme-xs capitalize text-gray-500">{e.payment_method.replace("_", " ")}</span>
                      {/* The one that matters: this expense took real cash out
                          of a real drawer, and the shift knows about it. */}
                      {e.cash_movement_id && (
                        <span className="ml-1.5 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                          till
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums">{money(e.amount)}</td>
                    <td className="px-5 py-3.5 text-right">
                      {e.attachment_url ? (
                        <span className="inline-flex items-center gap-2">
                          <a href={e.attachment_url} target="_blank" rel="noreferrer" className="text-theme-xs text-brand-600 hover:underline dark:text-brand-400">View</a>
                          <button className="text-theme-xs text-gray-400 hover:text-error-500" onClick={() => detach.mutate(e.id)}>✕</button>
                        </span>
                      ) : (
                        <button
                          className="text-theme-xs text-gray-400 hover:text-brand-600"
                          onClick={() => { setAttachTo(e.id); fileRef.current?.click(); }}
                        >
                          Attach
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="inline-flex items-center gap-3">
                        <button
                          className="text-theme-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
                          onClick={() => openEdit(e)}
                        >
                          Edit
                        </button>
                        <button
                          className="text-theme-xs text-gray-400 hover:text-error-500"
                          onClick={async () => {
                            if (await confirm({ title: `Delete "${e.description}"?`, tone: "danger" })) {
                              remove.mutate(e.id, {
                                onSuccess: () => toast.success("Expense deleted"),
                                onError: (err) => toast.error(err instanceof Error ? err.message : "Could not delete"),
                              });
                            }
                          }}
                        >
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.last_page > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3 text-sm dark:border-gray-800">
            <span className="text-theme-xs text-gray-400">
              {pagination.total} expenses · page {pagination.current_page} of {pagination.last_page}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pagination.current_page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={pagination.current_page >= pagination.last_page} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-md">
        <ModalForm
          title={editing ? "Edit expense" : "Add expense"}
          footer={
            <>
              <Button size="sm" variant="outline" onClick={modal.closeModal}>{warnings.length ? "Done" : "Cancel"}</Button>
              <Button size="sm" onClick={submit} disabled={active.isPending || !form.category || !form.description.trim() || !form.amount}>
                {active.isPending ? "Saving…" : editing ? "Save changes" : "Save expense"}
              </Button>
            </>
          }
        >
          {generalError && <div className="mb-4"><Alert variant="error" title="Couldn't save" message={generalError} /></div>}
          {warnings.map((w, i) => (
            <div className="mb-3" key={i}><Alert variant="warning" title="Saved" message={w} /></div>
          ))}
          <div className="space-y-4">
            <div>
              <Label>Category <span className="text-error-500">*</span></Label>
              <Select
                options={categoryOptions(categories.data, editing?.expense_category_id)}
                placeholder="Choose category"
                value={form.category}
                onChange={(v) => setForm((f) => ({ ...f, category: v }))}
              />
              {errorFor("expense_category_id") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("expense_category_id")}</p>}
              {categories.data?.length === 0 && (
                <p className="mt-1 text-theme-xs text-gray-400">
                  No categories yet — add one on the <strong>Categories</strong> tab first.
                </p>
              )}
            </div>
            <div>
              <Label>Description <span className="text-error-500">*</span></Label>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. July shop rent" />
              {errorFor("description") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("description")}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount <span className="text-error-500">*</span></Label>
                <Input type="number" min="0" step={0.01} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                {errorFor("amount") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("amount")}</p>}
              </div>
              <div>
                <Label>Date <span className="text-error-500">*</span></Label>
                <Input type="date" value={form.date} max={today()} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
                {errorFor("expense_date") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("expense_date")}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Paid by</Label>
                <Select
                  options={PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label }))}
                  value={form.method}
                  onChange={(v) => setForm((f) => ({ ...f, method: v }))}
                />
              </div>
              <div>
                <Label>Bill / voucher no.</Label>
                <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
              </div>
            </div>
            {/* The note has always been stored, exported and SEARCHED — the
                filter bar reaches into it — and there was no box to type it
                in, so it was empty on every row ever filed. */}
            <div>
              <Label>Note</Label>
              <TextArea
                rows={2}
                value={form.notes}
                onChange={(v) => setForm((f) => ({ ...f, notes: v }))}
                placeholder="Anything you'll want to remember when you read this back"
              />
            </div>
            {form.method === "cash" && (
              <p className="text-theme-xs text-gray-400">
                Cash comes out of your open drawer, so the shift's expected cash drops by this amount.
              </p>
            )}
          </div>
        </ModalForm>
      </Modal>
    </>
  );
}

// ── Recurring ─────────────────────────────────────────────────────────

function RecurringTab({ money, toast }: { money: Money; toast: Toast }) {
  const list = useRecurringExpenses();
  const categories = useExpenseCategories();
  const { createRecurring, updateRecurring, removeRecurring, postRecurring } = useExpenseAdminMutations();
  const confirm = useConfirm();
  const modal = useModal();

  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [form, setForm] = useState({
    category: "", description: "", amount: "", method: "cash", frequency: "monthly", next_due_on: today(), notes: "",
  });
  const [posting, setPosting] = useState<RecurringExpense | null>(null);
  const [postAmount, setPostAmount] = useState("");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const due = rows.filter((r) => r.is_due);
  const active = editing ? updateRecurring : createRecurring;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((r) => {
      if (q && !r.description.toLowerCase().includes(q) && !(r.category?.name ?? "").toLowerCase().includes(q)) {
        return false;
      }
      if (status === "due") return r.is_due;
      if (status === "paused") return !r.is_active;
      if (status === "active") return r.is_active;

      return true;
    });
  }, [rows, search, status]);

  const blank = () => ({
    category: "", description: "", amount: "", method: "cash", frequency: "monthly", next_due_on: today(), notes: "",
  });

  const openAdd = () => {
    setEditing(null);
    setForm(blank());
    modal.openModal();
  };

  const openEdit = (r: RecurringExpense) => {
    setEditing(r);
    setForm({
      category: r.expense_category_id ?? r.category?.id ?? "",
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
    if (active.isPending) return;
    const payload = {
      expense_category_id: form.category,
      description: form.description.trim(),
      amount: Number(form.amount),
      payment_method: form.method,
      frequency: form.frequency,
      next_due_on: form.next_due_on,
      notes: form.notes.trim() || undefined,
    };
    const onSuccess = () => {
      toast.success(editing ? "Recurring expense updated" : "Recurring expense added");
      setEditing(null);
      setForm(blank());
      modal.closeModal();
    };
    const onError = (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save");

    if (editing) updateRecurring.mutate({ id: editing.id, ...payload }, { onSuccess, onError });
    else createRecurring.mutate(payload, { onSuccess, onError });
  };

  /**
   * Pause and resume. `is_active` has been on the row, in the API and in this
   * table's own "paused" label since the feature shipped — and there was no
   * control anywhere that could set it, so the only way to stop a template
   * that had outlived its bill was to delete it and lose the schedule.
   */
  const togglePaused = async (r: RecurringExpense) => {
    if (r.is_active) {
      const ok = await confirm({
        title: `Pause "${r.description}"?`,
        message: "It stops falling due. Nothing already posted changes, and you can start it again any time.",
        confirmLabel: "Pause",
      });
      if (!ok) return;
    }

    updateRecurring.mutate(
      { id: r.id, is_active: !r.is_active },
      {
        onSuccess: () => toast.success(r.is_active ? "Paused" : "Running again"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
      },
    );
  };

  const post = () => {
    if (!posting) return;
    postRecurring.mutate(
      { id: posting.id, amount: Number(postAmount) || undefined },
      {
        onSuccess: () => { toast.success("Expense posted"); setPosting(null); },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not post"),
      },
    );
  };

  const openPost = (r: RecurringExpense) => {
    setPosting(r);
    setPostAmount(String(Number(r.amount)));
  };

  const monthly = rows
    .filter((r) => r.is_active && r.frequency === "monthly")
    .reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          Rent, salaries, the internet bill. Nothing posts on its own — you confirm the real figure.
        </p>
        <Button size="sm" onClick={openAdd}>Add recurring</Button>
      </div>

      {rows.length > 0 && (
        <MiniFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Find a bill by name or category…"
          segments={[
            ["all", "All", rows.length],
            ["due", "Due now", due.length],
            ["active", "Running", rows.filter((r) => r.is_active && !r.is_due).length],
            ["paused", "Paused", rows.filter((r) => !r.is_active).length],
          ]}
          value={status}
          onSegment={setStatus}
          summary={
            <>
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                {shown.length} of {rows.length} shown
              </p>
              {/* What the shop is committed to before it sells anything — the
                  one figure a standing-costs list exists to produce. */}
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                Monthly commitments{" "}
                <span className="font-semibold tabular-nums text-gray-800 dark:text-white/90">{money(monthly)}</span>
              </p>
            </>
          }
        />
      )}

      {due.length > 0 && status !== "paused" && (
        <div className="mb-5 rounded-2xl border border-warning-200 bg-warning-50 p-4 dark:border-warning-500/30 dark:bg-warning-500/10">
          <p className="mb-3 text-sm font-medium text-warning-700 dark:text-warning-400">
            {due.length} due now
          </p>
          <div className="space-y-2">
            {due.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 dark:bg-white/[0.04]">
                <div className="min-w-0">
                  <span className="text-sm text-gray-800 dark:text-white/90">{r.description}</span>
                  <span className="ml-2 text-theme-xs text-gray-400">
                    {r.category?.name} · due {r.next_due_on.slice(0, 10)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm tabular-nums text-gray-600 dark:text-gray-300">{money(r.amount)}</span>
                  <Button size="sm" onClick={() => openPost(r)}>Post</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <th className="px-5 py-3 font-medium">Description</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">Every</th>
                <th className="px-5 py-3 font-medium">Next due</th>
                <th className="px-5 py-3 text-right font-medium">Usual amount</th>
                <th className="px-5 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-400">Nothing recurring yet.</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-400">Nothing matches these filters.</td></tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-5 py-3.5 font-medium text-gray-800 dark:text-white/90">
                      {r.description}
                      {r.last_posted_on && (
                        <span className="ml-2 text-theme-xs font-normal text-gray-400">
                          last posted {r.last_posted_on.slice(0, 10)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">{r.category?.name ?? "—"}</td>
                    <td className="px-5 py-3.5 capitalize">{r.frequency}</td>
                    <td className="px-5 py-3.5 tabular-nums">
                      {r.is_active ? (
                        <span className={r.is_due ? "font-medium text-warning-600 dark:text-warning-400" : ""}>
                          {r.next_due_on.slice(0, 10)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums">{money(r.amount)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {r.is_due && (
                          <Button size="sm" onClick={() => openPost(r)}>Post</Button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-theme-xs font-medium text-gray-700 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-gray-700 dark:text-gray-200"
                        >
                          Edit
                        </button>
                        {/* State, not command — the same treatment a category
                            gets, because it is the same idea. */}
                        <button
                          type="button"
                          onClick={() => togglePaused(r)}
                          aria-pressed={r.is_active}
                          title={r.is_active ? "Running — it will fall due" : "Paused — it never falls due"}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-theme-xs font-medium transition-colors ${
                            r.is_active
                              ? "border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400"
                              : "border-gray-300 text-gray-500 dark:border-gray-700 dark:text-gray-400"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${r.is_active ? "bg-success-500" : "bg-gray-400"}`} />
                          {r.is_active ? "Running" : "Paused"}
                        </button>
                        <button
                          className="rounded-lg border border-transparent px-3 py-1.5 text-theme-xs text-gray-400 transition-colors hover:border-error-200 hover:bg-error-50 hover:text-error-600 dark:hover:border-error-500/30 dark:hover:bg-error-500/10"
                          onClick={async () => {
                            if (await confirm({ title: `Remove "${r.description}"?`, tone: "danger" })) {
                              removeRecurring.mutate(r.id, { onSuccess: () => toast.success("Removed") });
                            }
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / edit template */}
      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-md">
        <ModalForm
          title={editing ? "Edit recurring expense" : "Add recurring expense"}
          footer={
            <>
              <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={!form.category || !form.description.trim() || !form.amount || active.isPending}>
                {active.isPending ? "Saving…" : editing ? "Save changes" : "Save"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <Label>Category</Label>
              <Select
                options={categoryOptions(categories.data, editing?.expense_category_id)}
                placeholder="Choose category"
                value={form.category}
                onChange={(v) => setForm((f) => ({ ...f, category: v }))}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Shop rent" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Usual amount</Label>
                <Input type="number" min="0" step={0.01} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <Label>Every</Label>
                <Select
                  options={[
                    { value: "weekly", label: "Week" },
                    { value: "monthly", label: "Month" },
                    { value: "quarterly", label: "Quarter" },
                    { value: "yearly", label: "Year" },
                  ]}
                  value={form.frequency}
                  onChange={(v) => setForm((f) => ({ ...f, frequency: v }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{editing ? "Next due on" : "First due on"}</Label>
                <Input type="date" value={form.next_due_on} onChange={(e) => setForm((f) => ({ ...f, next_due_on: e.target.value }))} />
              </div>
              <div>
                <Label>Paid by</Label>
                <Select
                  options={PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label }))}
                  value={form.method}
                  onChange={(v) => setForm((f) => ({ ...f, method: v }))}
                />
              </div>
            </div>
            <div>
              <Label>Note</Label>
              <TextArea
                rows={2}
                value={form.notes}
                onChange={(v) => setForm((f) => ({ ...f, notes: v }))}
                placeholder="Copied onto every expense this posts"
              />
            </div>
            <p className="text-theme-xs text-gray-400">
              The amount is a starting point — you can correct it each time you post.
            </p>
          </div>
        </ModalForm>
      </Modal>

      {/* Post one */}
      <Modal isOpen={!!posting} onClose={() => setPosting(null)} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Post {posting?.description}</h3>
        <p className="mb-4 text-theme-xs text-gray-400">
          Check the figure against the bill — it is rarely the same twice.
        </p>
        <Label>Amount</Label>
        <Input type="number" min="0" step={0.01} value={postAmount} onChange={(e) => setPostAmount(e.target.value)} />
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={() => setPosting(null)}>Cancel</Button>
          <Button size="sm" onClick={post} disabled={postRecurring.isPending}>Post expense</Button>
        </div>
      </Modal>
    </>
  );
}

// ── Budgets ───────────────────────────────────────────────────────────

/** The first of a month, as the API wants it. */
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
const shortMonth = (key: string) =>
  new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, { month: "short" });
const shiftMonth = (key: string, by: number) => {
  const [y, m] = key.split("-").map(Number);

  return monthKey(new Date(y, m - 1 + by, 1));
};

function BudgetsTab({ money, toast }: { money: Money; toast: Toast }) {
  // The month is the axis this screen turns on and there was no way to move
  // it: the API has taken a `month` since budgets shipped, the model keeps a
  // standing ceiling and per-month overrides, and the panel only ever asked
  // for "now" — so last month could not be reviewed and next month could not
  // be planned.
  const thisMonth = monthKey(new Date());
  const [month, setMonth] = useState(thisMonth);
  const budgets = useBudgets(`${month}-01`);
  const { setBudget } = useExpenseAdminMutations();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, "standing" | "month">>({});
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const all = useMemo(() => budgets.data ?? [], [budgets.data]);

  const scopeOf = (row: BudgetRow): "standing" | "month" =>
    scopes[row.expense_category_id] ?? (row.is_override ? "month" : "standing");

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();

    return all.filter((row) => {
      if (q && !row.category.toLowerCase().includes(q)) return false;
      if (status === "over") return row.over;
      if (status === "budgeted") return row.budget !== null;
      if (status === "unbudgeted") return row.budget === null;

      return true;
    });
  }, [all, search, status]);

  const totals = useMemo(() => ({
    budget: all.reduce((s, r) => s + (r.budget ?? 0), 0),
    spent: all.reduce((s, r) => s + r.spent, 0),
    over: all.filter((r) => r.over).length,
  }), [all]);

  const save = (row: BudgetRow) => {
    const raw = drafts[row.expense_category_id];
    // Drop this row's draft — the saved value comes back from the server.
    setDrafts((d) => Object.fromEntries(
      Object.entries(d).filter(([key]) => key !== row.expense_category_id),
    ));
    if (raw === undefined) return;

    const scope = scopeOf(row);

    // An empty box removes the ceiling. That is not the same as zero — zero
    // means "spend nothing here", and the two read very differently.
    setBudget.mutate(
      {
        expense_category_id: row.expense_category_id,
        amount: raw.trim() === "" ? null : Number(raw),
        // Omitted = the standing ceiling, every month. Given = this month
        // alone, which is how a shop budgets the month its licence renews.
        month: scope === "month" ? `${month}-01` : undefined,
      },
      {
        onSuccess: () => toast.success(
          raw.trim() === ""
            ? "Budget removed"
            : scope === "month" ? `${monthLabel(month)} budget saved` : "Monthly budget saved",
        ),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
      },
    );
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          A monthly ceiling per category. It never blocks an entry — the bill arrived either way — it just
          tells you at the moment you file one.
        </p>

        {/* Move the month, and the whole screen answers for that month. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            aria-label="Previous month"
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-theme-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            ‹
          </button>
          <span className="min-w-36 text-center text-theme-sm font-medium text-gray-800 dark:text-white/90">
            {monthLabel(month)}
          </span>
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            aria-label="Next month"
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-theme-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            ›
          </button>
          {month !== thisMonth && (
            <button
              type="button"
              onClick={() => setMonth(thisMonth)}
              className="text-theme-xs text-gray-500 underline-offset-2 hover:underline dark:text-gray-400"
            >
              This month
            </button>
          )}
        </div>
      </div>

      {all.length > 0 && (
        <MiniFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Find a category…"
          segments={[
            ["all", "All", all.length],
            ["budgeted", "Budgeted", all.filter((r) => r.budget !== null).length],
            ["over", "Over", totals.over],
            ["unbudgeted", "No ceiling", all.filter((r) => r.budget === null).length],
          ]}
          value={status}
          onSegment={setStatus}
          summary={
            <>
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                Budgeted{" "}
                <span className="font-semibold tabular-nums text-gray-800 dark:text-white/90">{money(totals.budget)}</span>
              </p>
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                Spent{" "}
                <span className={`font-semibold tabular-nums ${
                  totals.spent > totals.budget && totals.budget > 0
                    ? "text-error-600 dark:text-error-400"
                    : "text-gray-800 dark:text-white/90"
                }`}>
                  {money(totals.spent)}
                </span>
              </p>
              {totals.over > 0 && (
                <p className="text-theme-sm text-error-600 dark:text-error-400">
                  {totals.over} over budget
                </p>
              )}
            </>
          }
        />
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">{monthLabel(month)}</th>
                <th className="px-5 py-3 text-right font-medium">Spent</th>
                <th className="px-5 py-3 text-right font-medium">Budget</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {budgets.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td colSpan={4} className="px-5 py-4"><div className="h-6 animate-pulse rounded bg-gray-100 dark:bg-gray-800" /></td></tr>
                ))
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-sm text-gray-400">
                    {all.length === 0 ? "No categories to budget yet." : "Nothing matches these filters."}
                  </td>
                </tr>
              ) : (
                shown.map((row) => {
                  const pct = row.budget && row.budget > 0 ? Math.min(100, (row.spent / row.budget) * 100) : 0;
                  const scope = scopeOf(row);
                  const shownValue = scope === "standing" ? row.standing : row.budget;

                  return (
                    <tr key={row.expense_category_id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                      <td className="px-5 py-3.5">
                        <span className="font-medium text-gray-800 dark:text-white/90">{row.category}</span>
                        {row.is_override && (
                          <p className="mt-0.5 text-theme-xs text-gray-400">
                            {shortMonth(month)} only
                            {row.standing !== null && ` · every month ${money(row.standing)}`}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {row.budget === null ? (
                          <span className="text-theme-xs text-gray-400">No budget set</span>
                        ) : (
                          <div className="w-40">
                            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                              <div
                                className={`h-full rounded-full ${row.over ? "bg-error-500" : pct > 80 ? "bg-warning-500" : "bg-success-500"}`}
                                style={{ width: `${row.over ? 100 : pct}%` }}
                              />
                            </div>
                            <p className={`mt-1 text-[10px] ${row.over ? "text-error-600 dark:text-error-400" : "text-gray-400"}`}>
                              {row.over
                                ? `${money(row.spent - row.budget)} over`
                                : `${money(row.remaining ?? 0)} left`}
                            </p>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">{money(row.spent)}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-2">
                          <input
                            className="h-9 w-28 rounded-lg border border-gray-200 bg-white px-2 text-right text-sm tabular-nums text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                            placeholder="—"
                            inputMode="decimal"
                            aria-label={`Budget for ${row.category}`}
                            value={drafts[row.expense_category_id] ?? (shownValue === null ? "" : String(shownValue))}
                            onChange={(e) => setDrafts((d) => ({ ...d, [row.expense_category_id]: e.target.value.replace(/[^\d.]/g, "") }))}
                            onBlur={() => save(row)}
                            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          />
                          {/* Which of the two ceilings the box is editing.
                              Without it the screen can show an effective
                              figure it has no honest way to change. */}
                          <button
                            type="button"
                            onClick={() => setScopes((s) => ({
                              ...s,
                              [row.expense_category_id]: scope === "standing" ? "month" : "standing",
                            }))}
                            title={scope === "standing"
                              ? "This box sets the ceiling for every month"
                              : `This box sets the ceiling for ${monthLabel(month)} alone`}
                            className="w-24 shrink-0 rounded-lg border border-gray-300 px-2 py-1.5 text-theme-xs font-medium text-gray-600 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-gray-700 dark:text-gray-300"
                          >
                            {scope === "standing" ? "Every month" : `${shortMonth(month)} only`}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── Categories ────────────────────────────────────────────────────────

/**
 * The list a shop files its spending under. Seeded from the business type on
 * day one and edited from here after — a restaurant that starts with
 * "Ingredients" and later wants "Dairy" separately should not have to ask us.
 */
function ExpenseCategoriesTab({ money }: { money: Money }) {
  const categories = useExpenseCategories();
  const mutations = useExpenseCategoryMutations();

  return (
    <CategoryManager
      title="Expense categories"
      hint="Seeded from your trade, then yours. One with entries filed under it is turned off rather than deleted, so past months stay readable."
      noun="expense"
      money={money}
      categories={categories.data ?? []}
      loading={categories.isLoading}
      mutations={mutations}
    />
  );
}
