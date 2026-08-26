import type { ReactNode } from "react";

import { CrossGlyph, FunnelGlyph, SearchGlyph } from "./FilterIcons";

/** One filter currently in force, in the words it was chosen by. */
export interface AppliedFilter {
  key: string;
  /** What it filters — "City", "Plan". Small, so the VALUE is what is read. */
  label: string;
  value: string;
  onRemove: () => void;
}

/**
 * THE FILTER BAR — one treatment, on every list.
 *
 * Before this, each screen drew its own: a bare grid of inputs on one, a row
 * of square chips on another, three different heights of select, and on the
 * busiest screens a set of controls that scrolled off the top of the page
 * while you read the rows they were filtering.
 *
 * None of them had the part that matters. You could set four filters, scroll,
 * and have no way to see what was in force — the controls were the only record
 * of the state, and they were off screen. An empty table then reads as "there
 * is nothing here" rather than "you filtered it all away", which is the single
 * most common way a working screen gets reported as broken.
 *
 * ── So the bar says three things, always ───────────────────────────────
 *
 *   what you can change   — the search box and the controls
 *   what is in force      — a removable pill per filter, and ONE clear-all
 *   what it left you      — the result count, in the noun of the thing listed
 *
 * The pills are the load-bearing part. Each one names its axis and its value
 * and removes only itself, so narrowing a search by one step does not mean
 * starting over.
 */
export function FilterBar({
  search,
  applied = [],
  onClearAll,
  results,
  children,
  right,
}: {
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    /** Announced to a screen reader; the placeholder is not a label. */
    label?: string;
  };
  applied?: AppliedFilter[];
  onClearAll?: () => void;
  /** "43 tenants" — the answer to what the filters left. */
  results?: { count: number | undefined; noun: string; loading?: boolean };
  /** The controls: selects, date ranges, toggles. */
  children?: ReactNode;
  /** Actions that belong to the list rather than the filter — Export, Add. */
  right?: ReactNode;
}) {
  const hasApplied = applied.length > 0;

  return (
    <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center gap-2.5">
        {search && (
          <div className="relative min-w-0 flex-1 basis-64">
            <SearchGlyph className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              aria-label={search.label ?? search.placeholder ?? "Search"}
              placeholder={search.placeholder ?? "Search…"}
              className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 pl-11 pr-4 text-theme-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-brand-400 focus:bg-white dark:border-gray-800 dark:bg-white/[0.03] dark:text-white dark:focus:bg-white/[0.06]"
            />
          </div>
        )}

        {children}

        {right && <div className="ml-auto flex items-center gap-2.5">{right}</div>}
      </div>

      {(hasApplied || results !== undefined) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          {hasApplied && (
            <span className="inline-flex items-center gap-1.5 text-theme-xs font-medium text-gray-400">
              <FunnelGlyph className="size-3.5" />
              Filtering by
            </span>
          )}

          {applied.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={filter.onRemove}
              // "Remove" and not "Clear": it says what pressing it does to
              // THIS pill, which is the question somebody has when four of
              // them are sitting in a row.
              aria-label={`Remove filter ${filter.label}: ${filter.value}`}
              className="group inline-flex max-w-full items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 py-1 pl-2.5 pr-1.5 text-theme-xs font-medium text-brand-700 transition hover:border-brand-300 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
            >
              <span className="opacity-60">{filter.label}</span>
              <span className="truncate">{filter.value}</span>
              <span className="grid size-4 shrink-0 place-items-center rounded text-brand-500 transition group-hover:bg-brand-500 group-hover:text-white">
                <CrossGlyph className="size-3" />
              </span>
            </button>
          ))}

          {hasApplied && onClearAll && (
            <button
              type="button"
              onClick={onClearAll}
              className="rounded-lg px-2 py-1 text-theme-xs font-semibold text-gray-500 underline-offset-2 transition hover:text-gray-800 hover:underline dark:text-gray-400 dark:hover:text-white"
            >
              Clear all
            </button>
          )}

          {results !== undefined && (
            <span className="ml-auto text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">
              {results.loading || results.count === undefined
                ? "Counting…"
                : `${results.count.toLocaleString()} ${results.noun}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A plain choice from a short list.
 *
 * Deliberately a NATIVE select. The popper next door is the right control when
 * the options carry a second fact — a resolved date, a count — but for "which
 * plan", a native select is the one that already works with a keyboard, opens
 * as a proper wheel on a phone, and cannot be got wrong. Reaching for a custom
 * menu everywhere is how a toolbar ends up worse on the device most of these
 * shops are actually held in.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  icon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  icon?: ReactNode;
}) {
  const chosen = value !== "";

  return (
    <div className="relative">
      {icon && (
        <span
          className={`pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 ${
            chosen ? "text-brand-600 dark:text-brand-300" : "text-gray-400"
          }`}
        >
          {icon}
        </span>
      )}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className={`h-11 min-w-36 cursor-pointer appearance-none rounded-xl border bg-[length:18px] bg-[right_0.9rem_center] bg-no-repeat py-0 pr-9 text-theme-sm font-medium outline-none transition ${
          icon ? "pl-10" : "pl-3.5"
        } ${
          chosen
            ? "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-500/50 dark:bg-brand-500/10 dark:text-brand-300"
            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300"
        }`}
        style={{
          // The chevron rides on the select itself: a positioned sibling would
          // sit over the click target on Safari and swallow the tap.
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9.5 6 6 6-6'/%3E%3C/svg%3E\")",
        }}
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * MUTUALLY EXCLUSIVE BUCKETS, each carrying how many it holds.
 *
 * The count is the whole point and it has one rule: it must be taken with
 * every OTHER filter applied and not its own. A count that included its own
 * filter would always equal the number of rows on screen — a number that
 * agrees with the screen no matter what and therefore tells nobody anything.
 * Every endpoint feeding this computes them that way; see the note on
 * TenantController::index.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  counts,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  counts?: Partial<Record<string, number>>;
  ariaLabel: string;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-0.5" role="group" aria-label={ariaLabel}>
      <div className="flex w-max gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800/60">
        {options.map((option) => {
          const active = value === option.value;
          const count = counts?.[option.value === "" ? "all" : option.value];

          return (
            <button
              key={option.value || "all"}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-theme-sm font-medium transition ${
                active
                  ? "bg-white text-gray-900 shadow-theme-xs dark:bg-white/10 dark:text-white"
                  : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {option.label}
              {count !== undefined && (
                <span
                  className={`grid min-w-5 place-items-center rounded-md px-1 text-theme-xs tabular-nums ${
                    active
                      ? "bg-brand-500 text-white"
                      : "bg-gray-200 text-gray-600 dark:bg-white/10 dark:text-gray-300"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
