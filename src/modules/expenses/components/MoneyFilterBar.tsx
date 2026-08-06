import { useState } from "react";

import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { activeFilterCount, type MoneyFilters, type MoneyTotals } from "../services/moneyFilters";

interface Option {
  value: string;
  label: string;
}

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
}

/**
 * The filter bar for a set of money entries.
 *
 * Two decisions carry it. First, the totals sit IN the bar rather than under
 * the table: the merchant filtering to "rent, this quarter" is asking a
 * question whose answer is the total, and burying it below fifteen rows makes
 * them scroll to find out what they asked. Second, categories and methods are
 * multi-select, because "utilities and fuel" is one question and forcing two
 * searches makes the person add up the answer themselves.
 *
 * Everything past the search box folds away. A merchant recording today's
 * bills should not have to look at seven inputs to do it; a merchant
 * reconciling a quarter opens the drawer once and it stays open.
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
}: Props) {
  const active = activeFilterCount(filters);
  // Opens by default when arriving with filters already applied — otherwise
  // the rows are narrowed and nothing on screen says why.
  const [open, setOpen] = useState(active > 1);

  const set = (patch: Partial<MoneyFilters>) => onChange({ ...filters, ...patch, page: 1 });

  const toggle = (key: "category_id" | "payment_method", value: string) => {
    const current = filters[key] ?? [];
    set({
      [key]: current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    });
  };

  return (
    <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1">
          <Input
            placeholder={searchPlaceholder}
            value={filters.search ?? ""}
            onChange={(e) => set({ search: e.target.value })}
          />
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`rounded-lg border px-3 py-2.5 text-theme-sm font-medium transition-colors ${
            active > 0
              ? "border-brand-300 bg-brand-50 text-brand-600 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300"
              : "border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          }`}
        >
          Filters{active > 0 ? ` · ${active}` : ""}
        </button>

        {active > 0 && (
          <button
            type="button"
            onClick={() => onChange({ page: 1, sort: filters.sort, dir: filters.dir })}
            className="text-theme-sm text-gray-500 underline-offset-2 hover:underline dark:text-gray-400"
          >
            Clear
          </button>
        )}

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
          <p className="text-theme-sm font-semibold text-gray-800 tabular-nums dark:text-white/90">
            {money(totals.total)}
          </p>
        </div>
      )}

      {open && (
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-gray-100 pt-4 dark:border-gray-800 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <Label>From</Label>
            <Input type="date" value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value })} />
          </div>
          <div>
            <Label>Amount from</Label>
            <Input
              type="number"
              min="0"
              placeholder="Any"
              value={filters.min_amount ?? ""}
              onChange={(e) => set({ min_amount: e.target.value })}
            />
          </div>
          <div>
            <Label>Amount to</Label>
            <Input
              type="number"
              min="0"
              placeholder="Any"
              value={filters.max_amount ?? ""}
              onChange={(e) => set({ max_amount: e.target.value })}
            />
          </div>

          <Chips
            label="Categories"
            options={categories}
            selected={filters.category_id ?? []}
            onToggle={(v) => toggle("category_id", v)}
          />
          <Chips
            label="Paid by"
            options={methods}
            selected={filters.payment_method ?? []}
            onToggle={(v) => toggle("payment_method", v)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Multi-select as chips rather than a `<select multiple>`, which on a phone is
 * a scrolling list nobody can ctrl-click. Selecting nothing means everything —
 * the same rule the server applies.
 */
function Chips({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) return null;

  return (
    <div className="sm:col-span-2">
      <Label>
        {label}
        {selected.length > 0 && (
          <span className="ml-1 text-theme-xs font-normal text-gray-400">· {selected.length} chosen</span>
        )}
      </Label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const on = selected.includes(option.value);

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(option.value)}
              aria-pressed={on}
              className={`rounded-full border px-3 py-1.5 text-theme-xs font-medium transition-colors ${
                on
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-gray-300 text-gray-600 hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:text-gray-300"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
