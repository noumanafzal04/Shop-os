import { useRef, useState } from "react";
import { useMoney } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
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
import { activeFilterCount, toParams, type MoneyFilters, type MoneyTotals } from "../services/moneyFilters";
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

/**
 * The Expense Manager.
 *
 * Three jobs that share a vocabulary but not a screen — filing what was spent,
 * keeping the bills that come round again, and watching a category against its
 * ceiling. Tabbed rather than stacked, because a shopkeeper opens this page to
 * do exactly one of them.
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

      <div className="mb-5 flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition ${
              tab === t.key
                ? "border-brand-500 font-medium text-brand-600 dark:text-brand-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {t.label}
            {/* Bills that have fallen due are the only thing on this page that
                is time-sensitive, so the count follows you between tabs. */}
            {t.key === "recurring" && dueCount > 0 && (
              <span className="rounded-full bg-warning-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {dueCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "expenses" && <ExpensesTab money={money} toast={toast} />}
      {tab === "recurring" && <RecurringTab money={money} toast={toast} />}
      {tab === "budgets" && <BudgetsTab money={money} toast={toast} />}
      {tab === "categories" && <ExpenseCategoriesTab />}
    </>
  );
}

type Money = (n: string | number) => string;
type Toast = ReturnType<typeof useToast>;

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
  const { create, remove, attach, detach } = useExpenseMutations();
  const confirm = useConfirm();

  const modal = useModal();
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

  const apiError = create.error instanceof ApiError ? create.error : null;
  const errorFor = (key: string) => apiError?.errors[key]?.[0];
  const generalError = apiError && Object.keys(apiError.errors).length === 0 ? apiError.message : null;

  const openAdd = () => {
    setForm({ category: "", description: "", reference: "", amount: "", method: "cash", date: today(), notes: "" });
    setWarnings([]);
    create.reset();
    modal.openModal();
  };

  const submit = () => {
    if (create.isPending) return;
    create.mutate(
      {
        expense_category_id: form.category,
        description: form.description.trim(),
        reference: form.reference.trim() || undefined,
        amount: Number(form.amount),
        payment_method: form.method,
        expense_date: form.date,
        notes: form.notes.trim() || undefined,
      },
      {
        onSuccess: (response) => {
          const w = (response.meta as { warnings?: string[] })?.warnings ?? [];
          // Warnings are things the shop needs to hear — a budget passed, a
          // cash payment with no drawer open — never reasons to hold the form.
          if (w.length) setWarnings(w);
          else modal.closeModal();
          toast.success("Expense recorded");
        },
      },
    );
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
        categories={(categories.data ?? []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }))}
        methods={PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label }))}
        totals={totals}
        money={money}
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
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Description</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">Paid</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
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

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-md p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Add expense</h3>

        {generalError && <div className="mb-4"><Alert variant="error" title="Couldn't save" message={generalError} /></div>}
        {warnings.map((w, i) => (
          <div className="mb-3" key={i}><Alert variant="warning" title="Saved" message={w} /></div>
        ))}

        <div className="space-y-4">
          <div>
            <Label>Category <span className="text-error-500">*</span></Label>
            <Select
              options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Choose category"
              value={form.category}
              onChange={(v) => setForm((f) => ({ ...f, category: v }))}
            />
            {errorFor("expense_category_id") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("expense_category_id")}</p>}
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
          {form.method === "cash" && (
            <p className="text-theme-xs text-gray-400">
              Cash comes out of your open drawer, so the shift's expected cash drops by this amount.
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>{warnings.length ? "Done" : "Cancel"}</Button>
          <Button size="sm" onClick={submit} disabled={create.isPending || !form.category || !form.description.trim() || !form.amount}>
            {create.isPending ? "Saving…" : "Save expense"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

// ── Recurring ─────────────────────────────────────────────────────────

function RecurringTab({ money, toast }: { money: Money; toast: Toast }) {
  const list = useRecurringExpenses();
  const categories = useExpenseCategories();
  const { createRecurring, removeRecurring, postRecurring } = useExpenseAdminMutations();
  const confirm = useConfirm();
  const modal = useModal();

  const [form, setForm] = useState({
    category: "", description: "", amount: "", method: "cash", frequency: "monthly", next_due_on: today(),
  });
  const [posting, setPosting] = useState<RecurringExpense | null>(null);
  const [postAmount, setPostAmount] = useState("");

  const rows = list.data?.rows ?? [];
  const due = rows.filter((r) => r.is_due);

  const save = () => {
    createRecurring.mutate(
      {
        expense_category_id: form.category,
        description: form.description.trim(),
        amount: Number(form.amount),
        payment_method: form.method,
        frequency: form.frequency,
        next_due_on: form.next_due_on,
      },
      {
        onSuccess: () => {
          toast.success("Recurring expense added");
          setForm({ category: "", description: "", amount: "", method: "cash", frequency: "monthly", next_due_on: today() });
          modal.closeModal();
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
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

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Rent, salaries, the internet bill. Nothing posts on its own — you confirm the real figure.
        </p>
        <Button size="sm" onClick={modal.openModal}>Add recurring</Button>
      </div>

      {due.length > 0 && (
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
                  <Button size="sm" onClick={() => { setPosting(r); setPostAmount(String(Number(r.amount))); }}>Post</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left">
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
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-5 py-3.5 font-medium text-gray-800 dark:text-white/90">
                      {r.description}
                      {!r.is_active && <span className="ml-2 text-theme-xs font-normal text-gray-400">paused</span>}
                    </td>
                    <td className="px-5 py-3.5">{r.category?.name ?? "—"}</td>
                    <td className="px-5 py-3.5 capitalize">{r.frequency}</td>
                    <td className="px-5 py-3.5 tabular-nums">{r.next_due_on.slice(0, 10)}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums">{money(r.amount)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        className="text-theme-xs text-gray-400 hover:text-error-500"
                        onClick={async () => {
                          if (await confirm({ title: `Remove "${r.description}"?`, tone: "danger" })) {
                            removeRecurring.mutate(r.id, { onSuccess: () => toast.success("Removed") });
                          }
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add template */}
      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-md p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Add recurring expense</h3>
        <div className="space-y-4">
          <div>
            <Label>Category</Label>
            <Select
              options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
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
              <Label>First due on</Label>
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
          <p className="text-theme-xs text-gray-400">
            The amount is a starting point — you can correct it each time you post.
          </p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={!form.category || !form.description.trim() || !form.amount || createRecurring.isPending}>
            Save
          </Button>
        </div>
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

function BudgetsTab({ money, toast }: { money: Money; toast: Toast }) {
  const budgets = useBudgets();
  const { setBudget } = useExpenseAdminMutations();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const save = (row: BudgetRow) => {
    const raw = drafts[row.expense_category_id];
    setDrafts((d) => { const { [row.expense_category_id]: _drop, ...rest } = d; return rest; });
    if (raw === undefined) return;

    // An empty box removes the ceiling. That is not the same as zero — zero
    // means "spend nothing here", and the two read very differently.
    setBudget.mutate(
      { expense_category_id: row.expense_category_id, amount: raw.trim() === "" ? null : Number(raw) },
      {
        onSuccess: () => toast.success(raw.trim() === "" ? "Budget removed" : "Budget saved"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
      },
    );
  };

  return (
    <>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        A monthly ceiling per category. It never blocks an entry — the bill arrived either way — it just
        tells you at the moment you file one.
      </p>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">This month</th>
                <th className="px-5 py-3 text-right font-medium">Spent</th>
                <th className="px-5 py-3 text-right font-medium">Budget</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {budgets.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td colSpan={4} className="px-5 py-4"><div className="h-6 animate-pulse rounded bg-gray-100 dark:bg-gray-800" /></td></tr>
                ))
              ) : (
                (budgets.data ?? []).map((row) => {
                  const pct = row.budget && row.budget > 0 ? Math.min(100, (row.spent / row.budget) * 100) : 0;
                  return (
                    <tr key={row.expense_category_id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                      <td className="px-5 py-3.5 font-medium text-gray-800 dark:text-white/90">{row.category}</td>
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
                      <td className="px-5 py-3.5 text-right">
                        <input
                          className="h-9 w-28 rounded-lg border border-gray-200 bg-white px-2 text-right text-sm tabular-nums text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                          placeholder="—"
                          inputMode="decimal"
                          value={drafts[row.expense_category_id] ?? (row.budget === null ? "" : String(row.budget))}
                          onChange={(e) => setDrafts((d) => ({ ...d, [row.expense_category_id]: e.target.value.replace(/[^\d.]/g, "") }))}
                          onBlur={() => save(row)}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        />
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
function ExpenseCategoriesTab() {
  const categories = useExpenseCategories();
  const mutations = useExpenseCategoryMutations();

  return (
    <CategoryManager
      title="Expense categories"
      hint="Seeded from your trade, then yours. A category with entries filed under it is turned off rather than deleted, so past months stay readable."
      categories={categories.data ?? []}
      loading={categories.isLoading}
      mutations={mutations}
    />
  );
}
