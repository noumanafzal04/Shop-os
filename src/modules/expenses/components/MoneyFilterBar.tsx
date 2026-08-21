import { useEffect, useId, useState } from "react";

import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import SearchableSelect from "../../../components/form/SearchableSelect";
import {
  activeFilterCount,
  DATE_PRESETS,
  matchingPreset,
  presetRange,
  type MoneyFilters,
  type MoneyTotals,
} from "../services/moneyFilters";

interface Option {
  value: string;
  label: string;
  /**
   * A category the shop has switched off. It stays FILTERABLE — retiring
   * "Cooking Gas" must not make three years of gas bills unfindable — but it
   * reads as retired so nobody mistakes it for somewhere to file today's.
   */
  retired?: boolean;
}

type SortKey = NonNullable<MoneyFilters["sort"]>;

interface Props {
  filters: MoneyFilters;
  onChange: (next: MoneyFilters) => void;
  categories: Option[];
  methods: Option[];
  totals?: MoneyTotals;
  money: (n: number | string) => string;
  /** Rendered on the right of the bar — the export button, usually. */
  action?: React.ReactNode;
  searchPlaceholder?: string;
  /**
   * Offered ONLY where the server can honour it. The expense and income lists
   * sort server-side; the ledger has one fixed order (it carries a running
   * balance, which is meaningless in any other), so it passes nothing and gets
   * no control rather than a control that quietly does nothing.
   */
  sorts?: Array<{ value: SortKey; label: string }>;
  /**
   * Same rule as `sorts`: offered only where the server can honour it. Expenses
   * can be told apart by whether a schedule posted them; income has no
   * schedules, so its bar passes nothing and shows no control.
   */
  showSource?: boolean;
}

/**
 * The filter bar for a set of money entries.
 *
 * Three decisions carry it.
 *
 * FILTERS ARE NEVER HIDDEN BEHIND A DISCLOSURE. Search and the date range sit
 * on the bar itself and everything else is one clearly-counted button away.
 * The old bar folded all seven inputs into a collapsed panel, so a screen with
 * a full filter vocabulary read as a screen with none.
 *
 * WHAT IS APPLIED IS VISIBLE, ALWAYS. Every active filter is a chip above the
 * table with its own ✕. A panel that hides what it applied is how a merchant
 * ends up certain the totals are wrong — the rows are narrowed and nothing on
 * screen says why.
 *
 * THE LONG LISTS ARE SEARCHABLE, NOT SPRAYED. Categories were a chip cloud,
 * one per category, all rendered. Fine at eight. A books-only business keeps a
 * hundred and fifty, and their filter bar was a wall. They are a type-ahead
 * multi-select now, which is the same control at eight and at three hundred.
 *
 * The totals stay where they were: in the bar, above the rows. A merchant
 * filtering to "rent, this quarter" is asking a question whose answer is the
 * total, and burying it under fifteen rows makes them scroll to find out what
 * they asked.
 */
export function MoneyFilterBar({
  filters,
  onChange,
  categories,
  methods,
  totals,
  money,
  action,
  searchPlaceholder = "Search description, bill number or note…",
  sorts,
  showSource = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const active = activeFilterCount(filters);
  // The two date boxes on the bar carry no visible caption — the arrow between
  // them says what they are — so they get real labels a screen reader can read.
  const fromId = useId();
  const toId = useId();
  // The drawer draws the SAME two fields again, and needs its own ids: two
  // elements cannot share one. The desktop bar has always tied its labels with
  // sr-only + htmlFor; the drawer had a VISIBLE label that was never associated
  // with anything, so a sighted user read it and a screen reader met a nameless
  // date box. Same two fields, one component, two paths — and only one of them
  // answering, which is this codebase's oldest bug shape wearing a new hat.
  const drawerFromId = useId();
  const drawerToId = useId();

  const set = (patch: Partial<MoneyFilters>) => onChange({ ...filters, ...patch, page: 1 });
  const clearAll = () => onChange({ page: 1, sort: filters.sort, dir: filters.dir });

  // Esc closes, matching every other overlay in the product.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const chosenPreset = matchingPreset(filters);
  const labelFor = (list: Option[], value: string) =>
    list.find((o) => o.value === value)?.label ?? value;

  /** One applied filter, as a chip that can undo itself. */
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];

  if (filters.search?.trim()) {
    chips.push({ key: "search", label: `“${filters.search.trim()}”`, clear: () => set({ search: "" }) });
  }
  if (filters.from || filters.to) {
    chips.push({
      key: "dates",
      label: filters.from && filters.to
        ? (filters.from === filters.to ? filters.from : `${filters.from} → ${filters.to}`)
        : filters.from ? `from ${filters.from}` : `up to ${filters.to}`,
      clear: () => set({ from: "", to: "" }),
    });
  }
  for (const id of filters.category_id ?? []) {
    chips.push({
      key: `cat-${id}`,
      label: labelFor(categories, id),
      clear: () => set({ category_id: (filters.category_id ?? []).filter((v) => v !== id) }),
    });
  }
  for (const m of filters.payment_method ?? []) {
    chips.push({
      key: `method-${m}`,
      label: labelFor(methods, m),
      clear: () => set({ payment_method: (filters.payment_method ?? []).filter((v) => v !== m) }),
    });
  }
  if (filters.min_amount?.trim()) {
    chips.push({ key: "min", label: `≥ ${money(filters.min_amount)}`, clear: () => set({ min_amount: "" }) });
  }
  if (filters.max_amount?.trim()) {
    chips.push({ key: "max", label: `≤ ${money(filters.max_amount)}`, clear: () => set({ max_amount: "" }) });
  }
  if (filters.source) {
    chips.push({
      key: "source",
      label: filters.source === "recurring" ? "From a schedule" : "Entered by hand",
      clear: () => set({ source: undefined }),
    });
  }

  return (
    <>
      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
        {/* Always visible. Nobody should have to open something to discover
            that this screen can be filtered at all. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-52 flex-1">
            <Input
              placeholder={searchPlaceholder}
              value={filters.search ?? ""}
              onChange={(e) => set({ search: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor={fromId} className="sr-only">From date</label>
            <div className="w-36">
              <Input
                id={fromId}
                type="date"
                value={filters.from ?? ""}
                max={filters.to || undefined}
                onChange={(e) => set({ from: e.target.value })}
              />
            </div>
            <span aria-hidden className="text-theme-xs text-gray-400">→</span>
            <label htmlFor={toId} className="sr-only">To date</label>
            <div className="w-36">
              <Input
                id={toId}
                type="date"
                value={filters.to ?? ""}
                min={filters.from || undefined}
                onChange={(e) => set({ to: e.target.value })}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2.5 text-theme-sm font-medium transition-colors ${
              active > 0
                ? "border-brand-300 bg-brand-50 text-brand-600 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300"
                : "border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
            }`}
          >
            <FilterGlyph />
            Filters
            {active > 0 && (
              <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                {active}
              </span>
            )}
          </button>

          {action}
        </div>

        {/* What the filtered set comes to — the answer to the question the
            filter just asked. Always visible, filtered or not. */}
        {totals && (
          <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-gray-100 pt-3 dark:border-gray-800">
            <p className="text-theme-sm text-gray-500 dark:text-gray-400">
              {totals.count} {totals.count === 1 ? "entry" : "entries"}
              {active > 0 ? " matching" : ""}
            </p>
            <p className="text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">
              {money(totals.total)}
            </p>
          </div>
        )}

        {/* Applied, and removable one at a time. The single most important
            part of this bar: a filter you cannot see is a filter you cannot
            trust the numbers under. */}
        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
            <span className="text-theme-xs uppercase tracking-wide text-gray-400">Showing</span>
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pl-3 pr-1.5 text-theme-xs font-medium text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={chip.clear}
                  aria-label={`Remove filter ${chip.label}`}
                  className="rounded-full p-0.5 text-brand-500 transition-colors hover:bg-brand-500/20 hover:text-brand-700 dark:text-brand-300"
                >
                  <CloseGlyph />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={clearAll}
              className="text-theme-xs text-gray-500 underline-offset-2 hover:underline dark:text-gray-400"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Scrim */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-[70] bg-gray-900/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/*
        A canvas from the right on anything bigger than a phone, and a sheet
        from the bottom below that. A bottom sheet on a desktop covers the very
        rows you are filtering; a right-hand canvas on a phone is a column two
        thumbs wide. Each pattern belongs where it belongs.
      */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        className={`fixed z-[80] flex flex-col bg-white transition-transform duration-200 dark:bg-gray-900
          inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl
          sm:inset-y-0 sm:left-auto sm:right-0 sm:h-dvh sm:max-h-none sm:w-[min(24rem,100vw)] sm:rounded-none
          ${open ? "translate-y-0 sm:translate-x-0" : "translate-y-full sm:translate-y-0 sm:translate-x-full"}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-white/90">Filters</h2>
            <p className="text-theme-xs text-gray-500 dark:text-gray-400">
              Every change applies straight away — the totals behind this panel move with it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5"
          >
            <CloseGlyph large />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div>
            <Label>Period</Label>
            <div className="flex flex-wrap gap-2">
              {DATE_PRESETS.map(([key, label]) => {
                const on = chosenPreset === key;

                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set(presetRange(key))}
                    className={`rounded-full border px-3 py-1.5 text-theme-xs font-medium transition-colors ${
                      on
                        ? "border-brand-500 bg-brand-500 text-white"
                        : "border-gray-300 text-gray-600 hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:text-gray-300"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={drawerFromId}>From</Label>
                <Input
                  id={drawerFromId}
                  type="date"
                  value={filters.from ?? ""}
                  max={filters.to || undefined}
                  onChange={(e) => set({ from: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={drawerToId}>To</Label>
                <Input
                  id={drawerToId}
                  type="date"
                  value={filters.to ?? ""}
                  min={filters.from || undefined}
                  onChange={(e) => set({ to: e.target.value })}
                />
              </div>
            </div>
          </div>

          {categories.length > 0 && (
            <div>
              <Label>Categories</Label>
              <SearchableSelect
                options={categories}
                selected={filters.category_id ?? []}
                onChange={(next) => set({ category_id: next })}
                placeholder="Any category"
                searchPlaceholder="Find a category…"
                noun="categories"
                emptyText="No category by that name."
              />
            </div>
          )}

          {methods.length > 0 && (
            <div>
              <Label>Paid by</Label>
              <SearchableSelect
                options={methods}
                selected={filters.payment_method ?? []}
                onChange={(next) => set({ payment_method: next })}
                placeholder="Any method"
                searchPlaceholder="Find a method…"
                noun="methods"
              />
            </div>
          )}

          <div>
            <Label>Amount</Label>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="number"
                min="0"
                placeholder="From"
                value={filters.min_amount ?? ""}
                onChange={(e) => set({ min_amount: e.target.value })}
              />
              <Input
                type="number"
                min="0"
                placeholder="To"
                value={filters.max_amount ?? ""}
                onChange={(e) => set({ max_amount: e.target.value })}
              />
            </div>
            <p className="mt-1 text-theme-xs text-gray-400">
              “Anything big” is the question behind most reviews of a cash book.
            </p>
          </div>

          {showSource && (
            <div>
              <Label>Where it came from</Label>
              <div className="flex flex-wrap gap-2">
                {([
                  ["recurring", "From a schedule"],
                  ["manual", "Entered by hand"],
                ] as const).map(([value, label]) => {
                  const on = filters.source === value;

                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={on}
                      // Pressing the one already on clears it — the third state
                      // is "both", and it needs no button of its own.
                      onClick={() => set({ source: on ? undefined : value })}
                      className={`rounded-full border px-3 py-1.5 text-theme-xs font-medium transition-colors ${
                        on
                          ? "border-brand-500 bg-brand-500 text-white"
                          : "border-gray-300 text-gray-600 hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-theme-xs text-gray-400">
                Rent and salaries post themselves from a schedule. Setting them aside leaves the
                spending someone actually decided on.
              </p>
            </div>
          )}

          {sorts && sorts.length > 0 && (
            <div>
              <Label>Order</Label>
              <div className="flex flex-wrap gap-2">
                {sorts.map((option) => {
                  const on = (filters.sort ?? "date") === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={on}
                      // Picking the column you are already on flips the
                      // direction, the way a table header does.
                      onClick={() => onChange({
                        ...filters,
                        sort: option.value,
                        dir: on && (filters.dir ?? "desc") === "desc" ? "asc" : "desc",
                        page: 1,
                      })}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-theme-xs font-medium transition-colors ${
                        on
                          ? "border-brand-500 bg-brand-500 text-white"
                          : "border-gray-300 text-gray-600 hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {option.label}
                      {on && <span aria-hidden>{(filters.dir ?? "desc") === "desc" ? "↓" : "↑"}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
          <button
            type="button"
            onClick={clearAll}
            disabled={active === 0}
            className="text-theme-sm text-gray-500 underline-offset-2 hover:underline disabled:opacity-40 dark:text-gray-400"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-theme-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            {totals ? `Show ${totals.count} ${totals.count === 1 ? "entry" : "entries"}` : "Done"}
          </button>
        </footer>
      </aside>
    </>
  );
}

function FilterGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M3 5h14M6 10h8M8.5 15h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function CloseGlyph({ large = false }: { large?: boolean }) {
  const size = large ? 18 : 12;

  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
