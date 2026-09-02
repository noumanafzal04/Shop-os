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
import { failed } from "../../../common/api/failed";
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
import { MoneySummary } from "../components/MoneySummary";
import { MoneyEntryTable, type MoneyEntryView } from "../components/MoneyEntryTable";
import { CategoryManager } from "../components/CategoryManager";
import { downloadCsv, downloadFile, openAuthedFile } from "../../../common/api/download";
import { useAuthStore } from "../../../stores/authStore";
import { useSuppliers } from "../../purchases/hooks/usePurchases";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import { formatEntryDate, toIsoDate } from "../../../components/ui/filters";
import { useBranchColumn } from "../../branches/hooks/useBranchColumn";

const today = () => toIsoDate(new Date());

const TABS = [
  { key: "expenses", label: "Expenses" },
  { key: "recurring", label: "Recurring" },
  { key: "budgets", label: "Budgets" },
  // The vocabulary a business describes itself in. Last, because it is set up
  // once and then left alone — but present, because the seeded list was never
  // meant to be the final word.
  { key: "categories", label: "Categories" },
] as const;

/**
 * What each tab is for, said once at the top.
 *
 * The page carried ONE subtitle — "Your own categories, seeded from your
 * business type" — over all four tabs. That sentence is about the fourth one.
 * A merchant on Budgets read a description of a screen they were not looking
 * at, which is worse than no description: it is a wrong answer to "what does
 * this do?", printed in the place that question gets asked.
 */
const BLURB: Record<TabKey, string> = {
  expenses: "Every bill the shop has paid. File one and it lands in your reports, your profit and — if it was cash — your drawer.",
  recurring: "The bills that come round again. Nothing posts on its own; you confirm the real figure each time.",
  budgets: "A monthly ceiling per category. It never blocks an entry — the bill arrived either way — it tells you the moment you file one.",
  categories: "The list your spending is filed under. Seeded from your trade on day one, yours to change after.",
};

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
      <PageMeta title="Expenses | CartZe" description="Business expenses" />

      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Expense Manager</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">{BLURB[tab]}</p>
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
  const branchCol = useBranchColumn();
  const [filters, setFilters] = useState<MoneyFilters>({ page: 1 });
  // Typing must not fire a request per keystroke, but every other filter is a
  // deliberate click and should answer at once.
  const debouncedSearch = useDebouncedValue(filters.search ?? "", 350);
  const query = { ...filters, search: debouncedSearch };
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
    method: "cash", date: today(), notes: "", supplier: "",
  });
  const [warnings, setWarnings] = useState<string[]>([]);

  // Who was paid. Two gates, not one: a shop without the inventory module has
  // no supplier directory at all, and reading one is narrower than filing a
  // bill because cost prices live there. A plain dropdown would 403 for a
  // book-keeper who can record expenses all day and must not see what the shop
  // pays its vendors.
  const canSeeSuppliers = useAuthStore((s) =>
    ["suppliers.manage", "purchases.manage", "inventory.manage"].some((p) => s.hasPermission(p)),
  );
  const stocksGoods = !!useAuthStore((s) => s.user?.tenant?.features?.inventory);
  const suppliersOffered = stocksGoods && canSeeSuppliers;
  const suppliers = useSuppliers({ is_active: true }, { enabled: suppliersOffered });
  const supplierOptions = suppliersOffered
    ? [{ value: "", label: "Nobody in particular" }, ...(suppliers.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))]
    : [];

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
    setForm({ category: "", description: "", reference: "", amount: "", method: "cash", date: today(), notes: "", supplier: "" });
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
      supplier: expense.supplier_id ?? "",
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
      // Null, not undefined, so clearing the picker actually unsets it — an
      // omitted key leaves the old supplier in place on an update.
      ...(suppliersOffered ? { supplier_id: form.supplier || null } : {}),
    };
    const onSuccess = (response: { meta?: unknown }) => {
      const w = (response.meta as { warnings?: string[] } | undefined)?.warnings ?? [];
      // Warnings are things the shop needs to hear — a budget passed, a
      // cash payment with no drawer open — never reasons to hold the form.
      if (w.length) setWarnings(w);
      else modal.closeModal();
      toast.success(editing ? "Expense updated" : "Expense recorded");
    };

    // A bill that did not record is money the books will never show, and the
    // modal closing was the only signal either way.
    const opts = { onSuccess, ...failed(toast, "That entry did not save.") };
    if (editing) update.mutate({ id: editing.id, ...payload }, opts);
    else create.mutate(payload, opts);
  };

  const byId = (id: string): Expense | undefined => rows.find((row: Expense) => row.id === id);

  const confirmDelete = async (expense: Expense) => {
    if (!(await confirm({ title: `Delete "${expense.description}"?`, tone: "danger" }))) return;

    remove.mutate(expense.id, {
      onSuccess: () => toast.success("Expense deleted"),
      ...failed(toast, "That expense is still on the books."),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not delete"),
    });
  };

  /**
   * An expense as the shared table reads it.
   *
   * Two things live on the meta line that never had a column: who was paid,
   * which the shop has always recorded and the screen never showed, and
   * whether a schedule posted this rather than a person. Without the second,
   * two rent rows in one month look like a mistake somebody has to go and
   * investigate.
   */
  const asEntry = (expense: Expense): MoneyEntryView => ({
    id: expense.id,
    date: expense.expense_date,
    title: expense.description,
    category: expense.category?.name ?? null,
    branch: branchCol.label(expense.branch_id),
    method: expense.payment_method,
    toTill: !!expense.cash_movement_id,
    amount: expense.amount,
    attachmentUrl: expense.attachment_url,
    meta: (
      <>
        {expense.reference && <span>{expense.reference}</span>}
        {expense.supplier?.name && <span>{expense.supplier.name}</span>}
        {expense.recurring_expense && (
          <span
            title={`Posted from the ${expense.recurring_expense.frequency} “${expense.recurring_expense.description}” schedule`}
            className="rounded-full bg-gray-100 px-1.5 py-0.5 font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400"
          >
            scheduled
          </span>
        )}
      </>
    ),
  });

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

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => { onFilePicked(e.target.files?.[0]); e.currentTarget.value = ""; }}
      />

      <MoneySummary
        totals={totals}
        money={money}
        direction="out"
        range={{ from: filters.from || null, to: filters.to || null }}
        filtered={activeFilterCount(filters) > 0}
        loading={expenses.isLoading}
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
        showSource
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

      <MoneyEntryTable
        rows={rows.map(asEntry)}
        loading={expenses.isLoading}
        money={money}
        direction="out"
        showBranch={branchCol.show}
        pagination={pagination}
        onPage={setPage}
        noun="expenses"
        sort={{ key: sort, dir, onSort: sortBy }}
        empty={
          activeFilterCount(filters) > 0
            ? {
                filtered: true,
                title: "Nothing matches these filters",
                hint: "Widen the date range, or clear a filter above to see the rest of the book.",
              }
            : {
                filtered: false,
                title: "No expenses recorded yet",
                hint: "Rent, wages, the electricity bill — file them here and they show up in your reports and your profit.",
                action: <Button size="sm" onClick={openAdd}>Add expense</Button>,
              }
        }
        onEdit={(id) => { const row = byId(id); if (row) openEdit(row); }}
        onDelete={(id) => { const row = byId(id); if (row) void confirmDelete(row); }}
        onAttach={(id) => { setAttachTo(id); fileRef.current?.click(); }}
        onView={(url) => void openAuthedFile(url)}
        onDetach={(id) => detach.mutate(id, failed(toast, "That receipt is still attached."))}
      />

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
            {/* Only for shops that keep a vendor directory, and only for people
                allowed to read it. Absent rather than disabled: a control you
                cannot use is a question about your own permissions. */}
            {suppliersOffered && (
              <div>
                <Label>Paid to</Label>
                <Select
                  options={supplierOptions}
                  value={form.supplier}
                  onChange={(v) => setForm((f) => ({ ...f, supplier: v }))}
                />
                <p className="mt-1 text-theme-xs text-gray-400">
                  {suppliers.data?.data?.length
                    ? "Links this bill to a supplier, so what you've paid them adds up."
                    : "No suppliers on file yet — add one under Suppliers."}
                </p>
                {errorFor("supplier_id") && (
                  <p className="mt-1 text-theme-xs text-error-500">{errorFor("supplier_id")}</p>
                )}
              </div>
            )}
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
      {rows.length > 0 && (
        <MiniFilterBar
          action={<Button size="sm" onClick={openAdd}>Add recurring</Button>}
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
                    {r.category?.name} · due {formatEntryDate(r.next_due_on)}
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
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <th className="px-3 py-3 font-medium sm:px-5">Description</th>
                <th className="hidden px-3 py-3 font-medium sm:px-5 sm:table-cell">Category</th>
                <th className="hidden px-3 py-3 font-medium sm:px-5 xl:table-cell">Every</th>
                <th className="px-3 py-3 font-medium sm:px-5">Next due</th>
                {/* State, not command, and out of the action group — four
                    controls crammed into one cell is how you press Remove
                    meaning Pause. */}
                <th className="hidden px-3 py-3 font-medium sm:px-5 sm:table-cell">Status</th>
                <th className="px-3 py-3 text-right font-medium sm:px-5">Usual amount</th>
                {/* `relative` — see MoneyEntryTable: an absolutely positioned
                    sr-only span with no positioned ancestor escapes the
                    scroller and widens the page. */}
                <th className="relative px-3 py-3 text-right font-medium sm:px-5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 sm:px-5 py-16">
                    <div className="mx-auto max-w-sm text-center">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Nothing recurring yet</p>
                      <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
                        Rent, wages, the internet bill — the costs you already know are coming. Add one and
                        it will remind you when it falls due.
                      </p>
                      <div className="mt-4 flex justify-center">
                        <Button size="sm" onClick={openAdd}>Add recurring</Button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={7} className="px-3 sm:px-5 py-12 text-center text-sm text-gray-400">Nothing matches these filters.</td></tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.id} className="text-theme-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.02]">
                    <td className="px-3 py-3.5 sm:px-5">
                      <p className="font-medium text-gray-800 dark:text-white/90">{r.description}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-theme-xs text-gray-400">
                        <span className="sm:hidden">{r.category?.name ?? "Uncategorised"}</span>
                        <span className="xl:hidden capitalize">{r.frequency}</span>
                        {r.last_posted_on && <span>last posted {formatEntryDate(r.last_posted_on)}</span>}
                      </p>
                      {/* Below `sm` the Status column is gone, and pausing a
                          bill is not something a phone should be unable to do.
                          It sits with the name rather than among Post / Edit /
                          Remove — it is state, and a fourth control in that
                          group is how Remove gets pressed by mistake. */}
                      <span className="mt-2 inline-flex sm:hidden">
                        <RunPill running={r.is_active} onToggle={() => togglePaused(r)} />
                      </span>
                    </td>
                    <td className="hidden px-3 py-3.5 sm:px-5 sm:table-cell">
                      {r.category?.name ? (
                        <span className="inline-block max-w-[12rem] truncate rounded-full bg-gray-100 px-2.5 py-1 text-theme-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">
                          {r.category.name}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="hidden px-3 py-3.5 sm:px-5 capitalize xl:table-cell">{r.frequency}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 sm:px-5 tabular-nums">
                      {r.is_active ? (
                        <span className={r.is_due ? "font-semibold text-warning-600 dark:text-warning-400" : ""}>
                          {formatEntryDate(r.next_due_on)}
                        </span>
                      ) : (
                        <span className="text-gray-400">Paused</span>
                      )}
                    </td>
                    <td className="hidden px-3 py-3.5 sm:px-5 sm:table-cell">
                      <RunPill running={r.is_active} onToggle={() => togglePaused(r)} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 sm:px-5 text-right text-theme-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                      {money(r.amount)}
                    </td>
                    <td className="px-3 py-3.5 sm:px-5">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {r.is_due && (
                          <Button size="sm" onClick={() => openPost(r)}>Post</Button>
                        )}
                        <button type="button" className={ROW_ACTION} onClick={() => openEdit(r)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className={ROW_ACTION_DANGER}
                          onClick={async () => {
                            if (await confirm({ title: `Remove "${r.description}"?`, tone: "danger" })) {
                              removeRecurring.mutate(r.id, {
                                onSuccess: () => toast.success("Removed"),
                                // A recurring bill that did not stop keeps
                                // posting itself every month.
                                ...failed(toast, "That recurring entry is still running."),
                              });
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

/** Running or paused, as one thing you press rather than a label plus a menu. */
function RunPill({ running, onToggle }: { running: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={running}
      title={running ? "Running — it will fall due" : "Paused — it never falls due"}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-theme-xs font-medium transition-colors ${
        running
          ? "border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400"
          : "border-gray-300 text-gray-500 hover:border-gray-400 dark:border-gray-700 dark:text-gray-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-success-500" : "bg-gray-400"}`} />
      {running ? "Running" : "Paused"}
    </button>
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

  /**
   * Two figures that used to sit side by side and could not be compared.
   *
   * "Budgeted Rs 100" beside "Spent Rs 960,318" reads as a shop nine thousand
   * times over its budget. It was not: eleven of the twelve categories had no
   * ceiling at all, so the spend was summed over all twelve and the budget
   * over the one. Anything set against a ceiling now counts only the rows that
   * HAVE one, and the whole month's spend is labelled as the whole month's
   * spend.
   */
  const totals = useMemo(() => {
    const watched = all.filter((r) => r.budget !== null);

    return {
      budget: watched.reduce((sum, r) => sum + (r.budget ?? 0), 0),
      spentWatched: watched.reduce((sum, r) => sum + r.spent, 0),
      spent: all.reduce((sum, r) => sum + r.spent, 0),
      watched: watched.length,
      over: all.filter((r) => r.over).length,
    };
  }, [all]);

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
      {/* The month and the figures it governs, on one line. The month picker
          used to float alone against 800px of white — and the figures sat in
          the filter bar below, two rows away from the control that decides
          which month they are about. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">
            Spent in {shortMonth(month)}{" "}
            <span className="font-semibold tabular-nums text-gray-800 dark:text-white/90">{money(totals.spent)}</span>
          </p>
          {totals.watched > 0 ? (
            <p className="text-theme-sm text-gray-500 dark:text-gray-400">
              {money(totals.spentWatched)} of it against ceilings worth{" "}
              <span className={`font-semibold tabular-nums ${
                totals.spentWatched > totals.budget
                  ? "text-error-600 dark:text-error-400"
                  : "text-gray-800 dark:text-white/90"
              }`}>
                {money(totals.budget)}
              </span>
            </p>
          ) : (
            <p className="text-theme-sm text-gray-400">No ceilings set — nothing is being watched yet</p>
          )}
          {totals.over > 0 && (
            <p className="text-theme-sm font-medium text-error-600 dark:text-error-400">
              {totals.over} over budget
            </p>
          )}
        </div>

        {/* Move the month, and the whole screen answers for that month. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={shown.length === 0}
            onClick={() => downloadCsv(
              `budgets-${month}.csv`,
              ["Category", "Status", "Budget", "Spent", "Remaining", "Over"],
              // What is on screen, filters and all — an export that quietly
              // widens the view is a different report with the same name.
              shown.map((r) => [
                r.category,
                r.is_retired ? "Closed" : r.is_override ? `${shortMonth(month)} only` : "Every month",
                r.budget ?? "",
                r.spent,
                r.remaining ?? "",
                r.over ? "yes" : "no",
              ]),
            )}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-theme-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Export
          </button>
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
            <p className="text-theme-sm text-gray-500 dark:text-gray-400">
              {shown.length} of {all.length} shown
            </p>
          }
        />
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <th className="px-3 py-3 font-medium sm:px-5">Category</th>
                <th className="hidden px-3 py-3 font-medium sm:px-5 sm:table-cell">Against the ceiling</th>
                <th className="px-3 py-3 text-right font-medium sm:px-5">Spent</th>
                <th className="px-3 py-3 text-right font-medium sm:px-5">Ceiling</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {budgets.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td colSpan={4} className="px-3 sm:px-5 py-4"><div className="h-6 animate-pulse rounded bg-gray-100 dark:bg-gray-800" /></td></tr>
                ))
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 sm:px-5 py-16">
                    <div className="mx-auto max-w-sm text-center">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                        {all.length === 0 ? "No categories to budget yet" : "Nothing matches these filters"}
                      </p>
                      <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
                        {all.length === 0
                          ? "Every expense category you keep can carry a ceiling. Add one on the Categories tab and it appears here."
                          : "Clear a filter above to see the rest of the categories."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                shown.map((row) => {
                  const pct = row.budget && row.budget > 0 ? Math.min(100, (row.spent / row.budget) * 100) : 0;
                  const scope = scopeOf(row);
                  const shownValue = scope === "standing" ? row.standing : row.budget;

                  return (
                    <tr key={row.expense_category_id} className="text-theme-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.02]">
                      <td className="px-3 py-3.5 sm:px-5">
                        <span className="font-medium text-gray-800 dark:text-white/90">{row.category}</span>
                        {row.is_retired && (
                          <span
                            title="This category is switched off. It still shows because money was filed under it."
                            className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400"
                          >
                            closed
                          </span>
                        )}
                        {row.is_override && (
                          <p className="mt-0.5 text-theme-xs text-gray-400">
                            {shortMonth(month)} only
                            {row.standing !== null && ` · every month ${money(row.standing)}`}
                          </p>
                        )}
                        {/* Below `sm` the bar has no column, and "over budget"
                            is the one thing on this row that must not be the
                            part that gets dropped. */}
                        <div className="mt-1 sm:hidden">
                          <Against row={row} pct={pct} money={money} compact />
                        </div>
                      </td>

                      <td className="hidden px-3 py-3.5 sm:px-5 sm:table-cell">
                        <Against row={row} pct={pct} money={money} />
                      </td>

                      <td className="whitespace-nowrap px-3 py-3.5 sm:px-5 text-right text-theme-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                        {money(row.spent)}
                      </td>

                      <td className="px-3 py-3.5 sm:px-5">
                        {row.is_retired ? (
                          // No box: setting next month's ceiling on a category
                          // nothing can be filed under is a promise the shop
                          // cannot keep. The row is here to account for money
                          // already spent, not to plan more.
                          <p className="text-right text-theme-xs text-gray-400">
                            Closed — turn it back on to budget it
                          </p>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <input
                              className="h-9 w-24 rounded-lg border sm:w-28 border-gray-200 bg-white px-2 text-right text-sm tabular-nums text-gray-800 placeholder:text-gray-300 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                              placeholder="Set one"
                              inputMode="decimal"
                              aria-label={`Ceiling for ${row.category}`}
                              value={drafts[row.expense_category_id] ?? (shownValue === null ? "" : String(shownValue))}
                              onChange={(e) => setDrafts((d) => ({ ...d, [row.expense_category_id]: e.target.value.replace(/[^\d.]/g, "") }))}
                              onBlur={() => save(row)}
                              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                            />
                            {/* WHICH of the two ceilings that box is editing.
                                Without it the screen can show an effective
                                figure it has no honest way to change. A quiet
                                line under the input rather than a button
                                beside it — it is a label you can press, not a
                                command competing with the number. */}
                            <button
                              type="button"
                              onClick={() => setScopes((sc) => ({
                                ...sc,
                                [row.expense_category_id]: scope === "standing" ? "month" : "standing",
                              }))}
                              title={scope === "standing"
                                ? `Setting the ceiling for every month — press to set ${monthLabel(month)} alone`
                                : `Setting the ceiling for ${monthLabel(month)} alone — press to set every month`}
                              className="text-theme-xs text-gray-400 underline decoration-dotted underline-offset-4 transition-colors hover:text-brand-600 dark:hover:text-brand-400"
                            >
                              {scope === "standing" ? "every month" : `${shortMonth(month)} only`}
                            </button>
                          </div>
                        )}
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

/**
 * Where this category stands against its ceiling.
 *
 * Twelve rows reading "No budget set" beside an empty box is what the column
 * used to be — a third of the table saying nothing at all. A category with no
 * ceiling is not an empty cell; it is a category nobody is watching, and
 * saying so is both shorter and true.
 */
function Against({
  row,
  pct,
  money,
  compact = false,
}: {
  row: BudgetRow;
  pct: number;
  money: Money;
  compact?: boolean;
}) {
  if (row.budget === null) {
    return <span className="text-theme-xs text-gray-400">Not watched</span>;
  }

  return (
    <div className={compact ? "w-full max-w-56" : "w-44"}>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          className={`h-full rounded-full ${row.over ? "bg-error-500" : pct > 80 ? "bg-warning-500" : "bg-success-500"}`}
          style={{ width: `${row.over ? 100 : pct}%` }}
        />
      </div>
      <p className={`mt-1 text-theme-xs ${row.over ? "font-medium text-error-600 dark:text-error-400" : "text-gray-400"}`}>
        {row.over
          ? `${money(row.spent - row.budget)} over ${money(row.budget)}`
          : `${money(row.remaining ?? 0)} left of ${money(row.budget)}`}
      </p>
    </div>
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
