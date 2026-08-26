import { useRef, useState } from "react";
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
  useIncomeCategoryMutations,
  useIncomeMutations,
  useIncomes,
  useRecurringIncomes,
} from "../hooks/useIncome";
import { CategoryManager } from "../../expenses/components/CategoryManager";
import { FilterTabs } from "../../../components/ui/tabs/FilterTabs";
import { RecurringIncomeTab } from "../components/RecurringIncomeTab";
import { MoneyFilterBar } from "../../expenses/components/MoneyFilterBar";
import { MoneySummary } from "../../expenses/components/MoneySummary";
import { MoneyEntryTable, type MoneyEntryView } from "../../expenses/components/MoneyEntryTable";
import { activeFilterCount, categoryOptions, toParams, type MoneyFilters, type MoneyTotals } from "../../expenses/services/moneyFilters";
import { downloadFile, openAuthedFile } from "../../../common/api/download";
import type { Income } from "../services/incomeService";
import { useBranchColumn } from "../../branches/hooks/useBranchColumn";
import { toIsoDate } from "../../../components/ui/filters";

const today = () => toIsoDate(new Date());

const TABS = [
  { key: "entries", label: "Income" },
  { key: "recurring", label: "Recurring" },
  { key: "categories", label: "Categories" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * What each tab is for — the mirror of the expense side, which carried one
 * sentence over all of its tabs and so described the wrong screen on three of
 * them.
 */
const BLURB: Record<TabKey, string> = {
  entries: "Money in that isn't a sale — rent received, an owner putting money in, a refund from a supplier. Your sales revenue is counted automatically in the Cashbook.",
  recurring: "Money that arrives on a schedule, like a monthly sublet. Nothing posts on its own; you confirm the real figure.",
  categories: "Where money in that isn't a sale gets filed. Yours to change — one with entries under it is turned off rather than deleted.",
};

/**
 * How money arrived. No `credit` — a promise to pay is not money in.
 *
 * This list drove the FILTER from the day it was written and never the form,
 * and the server defaults a missing method to `cash`. So every income entry
 * ever filed from this screen was recorded as cash — and a cash one puts money
 * in whatever drawer the person happens to have open. An owner logging a bank
 * transfer while a till was running gave that cashier a phantom overage they
 * had no way to explain, and an overage is the variance a shop is least likely
 * to investigate. The picker is the missing half.
 */
const INCOME_METHODS = [
  { value: "cash", label: "Cash (to till)" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

export default function IncomePage() {
  const branchCol = useBranchColumn();
  const money = useMoney();
  const toast = useToast();
  const confirm = useConfirm();

  // The same filter shape as expenses and the ledger — three views of one
  // thing, so a person who learns the bar once has learnt it everywhere.
  const [filters, setFilters] = useState<MoneyFilters>({ page: 1 });
  const [tab, setTab] = useState<TabKey>("entries");
  // Counted server-side, so the badge never re-derives "due" from a
  // timezone the panel may not share with the shop.
  const recurring = useRecurringIncomes();
  const dueCount = recurring.data?.filter((r) => r.is_due).length ?? 0;
  const debouncedSearch = useDebouncedValue(filters.search ?? "", 350);
  const query = { ...filters, search: debouncedSearch };
  const setPage = (p: number) => setFilters((f) => ({ ...f, page: p }));

  const incomes = useIncomes(query);
  const totals = (incomes.data?.meta as { totals?: MoneyTotals } | undefined)?.totals;
  const categoryMutations = useIncomeCategoryMutations();
  const categories = useIncomeCategories();
  const { create, update, remove, attach, detach } = useIncomeMutations();

  // One hidden input for the whole table — `attachTo` remembers which row asked.
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachTo, setAttachTo] = useState<string | null>(null);

  const modal = useModal();
  const [editing, setEditing] = useState<Income | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [formCategory, setFormCategory] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");

  const rows = incomes.data?.data ?? [];
  const pagination = incomes.data?.meta.pagination;

  // The server sorts (MoneyEntryFilters::sort) and the headers now ask, the
  // same way the expense side does. One list learning a trick the other one
  // does not is how the two halves of a books module drift apart.
  const sort = filters.sort ?? "date";
  const dir = filters.dir ?? "desc";
  const sortBy = (key: MoneyFilters["sort"]) =>
    setFilters((f) => ({
      ...f,
      sort: key,
      dir: (f.sort ?? "date") === key && (f.dir ?? "desc") === "desc" ? "asc" : "desc",
      page: 1,
    }));

  const byId = (id: string): Income | undefined => rows.find((row) => row.id === id);

  const asEntry = (income: Income): MoneyEntryView => ({
    id: income.id,
    date: income.income_date,
    title: income.description,
    category: income.category?.name ?? null,
    branch: branchCol.label(income.branch_id),
    method: income.payment_method ?? "cash",
    toTill: !!income.cash_movement_id,
    amount: income.amount,
    attachmentUrl: income.attachment_url,
    meta: income.reference ? <span>{income.reference}</span> : undefined,
  });

  const active = editing ? update : create;
  const apiError = active.error instanceof ApiError ? active.error : null;
  const errorFor = (key: string) => apiError?.errors[key]?.[0];

  const openAdd = () => {
    setEditing(null);
    setDescription("");
    setAmount("");
    setDate(today());
    setFormCategory("");
    setMethod("cash");
    setReference("");
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
    setMethod(income.payment_method ?? "cash");
    setReference(income.reference ?? "");
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
      payment_method: method,
      reference: reference.trim() || undefined,
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
      <PageMeta title="Income | CartZe" description="Other income (non-sales)" />

      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => { onFilePicked(e.target.files?.[0]); e.currentTarget.value = ""; }}
      />

      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Income</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">{BLURB[tab]}</p>
      </div>

      {/* The same three tabs the Expenses page has, in the same order.
          A books module where the two sides are navigated differently is one a
          shopkeeper learns to trust only half of. The due badge follows you
          between tabs, because a template that has fallen due is the only
          time-sensitive thing on this screen. */}
      <FilterTabs
        tabs={TABS.map((t) => ({
          ...t,
          badge:
            t.key === "recurring" && dueCount > 0 ? (
              <span className="rounded-full bg-warning-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {dueCount}
              </span>
            ) : undefined,
        }))}
        value={tab}
        onChange={setTab}
        className="mb-5"
      />

      {tab === "recurring" && <RecurringIncomeTab money={money} />}

      {tab === "categories" ? (
        <CategoryManager
          title="Income categories"
          hint="Where money in that isn't a sale gets filed. Yours to change — one with entries under it is turned off rather than deleted."
          noun="income entry"
          money={money}
          categories={categories.data ?? []}
          loading={categories.isLoading}
          mutations={categoryMutations}
        />
      ) : tab === "entries" ? (
      <>
      <MoneySummary
        totals={totals}
        money={money}
        direction="in"
        range={{ from: filters.from || null, to: filters.to || null }}
        filtered={activeFilterCount(filters) > 0}
        loading={incomes.isLoading}
      />

      <MoneyFilterBar
        filters={filters}
        onChange={setFilters}
        // Retired categories stay filterable — that is how their history is
        // found. Only the ENTRY form drops them.
        categories={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name, retired: !c.is_active }))}
        methods={INCOME_METHODS}
        totals={totals}
        money={money}
        sorts={[
          { value: "date", label: "Date" },
          { value: "amount", label: "Amount" },
          { value: "created", label: "Recently added" },
        ]}
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => downloadFile("/incomes/export", toParams(query), "income.csv")}
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-theme-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
            >
              Export
            </button>
            <Button size="sm" onClick={openAdd}>Add income</Button>
          </div>
        }
      />

      <MoneyEntryTable
        rows={rows.map(asEntry)}
        loading={incomes.isLoading}
        money={money}
        direction="in"
        showBranch={branchCol.show}
        pagination={pagination}
        onPage={setPage}
        noun="entries"
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
                title: "No income recorded yet",
                hint: "Money in that isn't a sale — rent received, an owner putting money in, a refund from a supplier.",
                action: <Button size="sm" onClick={openAdd}>Add income</Button>,
              }
        }
        onEdit={(id) => { const row = byId(id); if (row) openEdit(row); }}
        onDelete={(id) => { const row = byId(id); if (row) void confirmDelete(row); }}
        onAttach={(id) => { setAttachTo(id); fileRef.current?.click(); }}
        onView={(url) => void openAuthedFile(url)}
        onDetach={(id) => detach.mutate(id)}
      />
      </>
      ) : null}

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-md p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editing ? "Edit income" : "Add income"}
        </h3>

        <div className="space-y-4">
          <div>
            <Label>Category <span className="text-error-500">*</span></Label>
            <Select
              options={categoryOptions(categories.data, editing?.income_category_id)}
              placeholder="Choose category"
              value={formCategory}
              onChange={setFormCategory}
            />
            {errorFor("income_category_id") && (
              <p className="mt-1 text-theme-xs text-error-500">{errorFor("income_category_id")}</p>
            )}
            {categories.data?.length === 0 && (
              <p className="mt-1 text-theme-xs text-gray-400">
                No categories yet — add one with <strong>Manage categories</strong> first.
              </p>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Received by</Label>
              <Select options={INCOME_METHODS} value={method} onChange={setMethod} />
              {errorFor("payment_method") && (
                <p className="mt-1 text-theme-xs text-error-500">{errorFor("payment_method")}</p>
              )}
            </div>
            <div>
              <Label>Reference</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Slip or invoice no." />
            </div>
          </div>
          {method === "cash" && (
            <p className="text-theme-xs text-gray-400">
              Cash goes into your open drawer, so the shift's expected cash rises by this amount.
            </p>
          )}
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
