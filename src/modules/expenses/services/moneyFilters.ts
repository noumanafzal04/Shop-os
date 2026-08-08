import { iso } from "../reportPeriod";

/**
 * The questions a merchant asks their own books.
 *
 * Expenses, income and the ledger all take the same shape, because they are
 * three views of one thing and a person who learns the filter bar on one
 * should not have to learn it again on the next. Mirrors
 * App\Support\MoneyEntryFilters on the server.
 */
export interface MoneyFilters {
  search?: string;
  /** Several categories at once — "utilities AND fuel" is one question. */
  category_id?: string[];
  payment_method?: string[];
  from?: string;
  to?: string;
  min_amount?: string;
  max_amount?: string;
  sort?: "date" | "amount" | "created";
  dir?: "asc" | "desc";
  page?: number;
  per_page?: number;
}

/** What a filtered set comes to — the answer, when the filter WAS the question. */
export interface MoneyTotals {
  count: number;
  total: number;
}

/**
 * The categories an ENTRY form may offer — live ones only.
 *
 * A shop retires a category instead of deleting it because deleting one with
 * history strands a year of entries under a blank. Retiring only means
 * something if nothing new can be filed there, and the entry forms offered
 * every category regardless, so switching one off changed nothing a merchant
 * could see. (The FILTER bar keeps them — that is where history is found.)
 *
 * `keepId` is the category a row being edited already sits under. It stays in
 * the list even when retired, or opening an old expense would silently blank
 * its category and the next save would move it somewhere it never belonged.
 */
export function categoryOptions(
  categories: Array<{ id: string; name: string; is_active: boolean }> | undefined,
  keepId?: string | null,
): Array<{ value: string; label: string }> {
  return (categories ?? [])
    .filter((c) => c.is_active || c.id === keepId)
    .map((c) => ({
      value: c.id,
      label: c.is_active ? c.name : `${c.name} (switched off)`,
    }));
}

/**
 * Filters as query params. Empty values are DROPPED rather than sent blank:
 * an empty string reaching the server as `search=` would be a filter for
 * nothing, and the row count would quietly stop matching the total.
 */
export function toParams(filters: MoneyFilters): Record<string, string | number> {
  const params: Record<string, string | number> = {};

  if (filters.search?.trim()) params.search = filters.search.trim();
  if (filters.category_id?.length) params.category_id = filters.category_id.join(",");
  if (filters.payment_method?.length) params.payment_method = filters.payment_method.join(",");
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.min_amount?.trim()) params.min_amount = filters.min_amount.trim();
  if (filters.max_amount?.trim()) params.max_amount = filters.max_amount.trim();
  if (filters.sort) params.sort = filters.sort;
  if (filters.dir) params.dir = filters.dir;
  if (filters.page) params.page = filters.page;
  if (filters.per_page) params.per_page = filters.per_page;

  return params;
}

/** How many filters are actually narrowing the view — for the "clear" pill. */
export function activeFilterCount(filters: MoneyFilters): number {
  return [
    filters.search?.trim(),
    filters.category_id?.length,
    filters.payment_method?.length,
    filters.from,
    filters.to,
    filters.min_amount?.trim(),
    filters.max_amount?.trim(),
  ].filter(Boolean).length;
}

/** A month, as the two dates that bound it. Handy default for a books screen. */
export function monthRange(date = new Date()): { from: string; to: string } {
  const y = date.getFullYear();
  const m = date.getMonth();

  return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
}

export type RangePreset = "today" | "week" | "month" | "last_month" | "quarter" | "year";

/**
 * The ranges people actually ask for.
 *
 * Two date boxes can express any window, and typing both of them is still the
 * wrong way to ask for "last month" — the question every set of books is
 * closed against. The boxes stay; these are the shortcuts to the six windows
 * that account for most of the asking.
 */
export const DATE_PRESETS: Array<[RangePreset, string]> = [
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["last_month", "Last month"],
  ["quarter", "This quarter"],
  ["year", "This year"],
];

/** Weeks start MONDAY, matching the server's Carbon and the reports screen. */
export function presetRange(key: RangePreset, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();

  switch (key) {
    case "today":
      return { from: iso(today), to: iso(today) };
    case "week": {
      const offset = (today.getDay() + 6) % 7;

      return { from: iso(new Date(y, m, d - offset)), to: iso(new Date(y, m, d - offset + 6)) };
    }
    case "last_month":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "quarter": {
      const q = Math.floor(m / 3) * 3;

      return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
    }
    case "year":
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    default:
      return monthRange(today);
  }
}

/** Which preset a from/to pair IS, so the chosen one can read as chosen. */
export function matchingPreset(filters: MoneyFilters, today = new Date()): RangePreset | null {
  if (!filters.from || !filters.to) return null;

  return DATE_PRESETS.map(([key]) => key).find((key) => {
    const r = presetRange(key, today);

    return r.from === filters.from && r.to === filters.to;
  }) ?? null;
}
