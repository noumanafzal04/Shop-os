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
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
}
