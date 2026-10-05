/**
 * The standard backend envelope: every API response has this shape.
 */
export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message: string;
  data: T;
  errors: Record<string, string[]>;
  meta: ApiMeta;
}

export interface ApiMeta {
  error_code?: string;
  pagination?: Pagination;
  /** How far back this shop's plan lets it look — see RetentionNotice. */
  retention?: RetentionNotice;
  [key: string]: unknown;
}

/**
 * WHY A LIST STOPS WHERE IT STOPS.
 *
 * Carried on every fenced historical read, and present even when the request
 * stayed well inside the window. That is deliberate: a notice that appears
 * for the first time at the moment history runs out teaches a shopkeeper
 * nothing, because by then they are already on the phone convinced their
 * records are gone.
 *
 * Absent entirely on a plan that keeps everything, so the screen says nothing
 * at all.
 */
export interface RetentionNotice {
  /** Months of history this plan keeps online. */
  months: number;
  /** The earliest date still listed, as YYYY-MM-DD. */
  from: string;
  /** True when THIS request asked for something older than the window. */
  reached: boolean;
  asked_from: string | null;
}

export interface Pagination {
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
}

/**
 * Normalized error thrown by the API client — UI code catches this,
 * never raw axios errors.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errorCode?: string,
    public readonly errors: Record<string, string[]> = {},
    /**
     * FIGURES THE SERVER SENT WITH THE REFUSAL, when it sent any.
     *
     * A refusal is a sentence for a person and, sometimes, a number for a
     * program. "Amount paid (12,610.00) is less than the total (14,023.94)"
     * was a good sentence the till could do nothing with: the one figure that
     * would have let the cashier finish the sale was inside a formatted
     * string, and reading money out of prose is one thousands separator away
     * from a wrong charge.
     *
     * So it travels as data. Empty for every refusal with nothing to add,
     * which is nearly all of them — read it through `figure()` below rather
     * than directly, because `meta` is whatever the server put there.
     */
    public readonly meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  /**
   * A numeric figure from the refusal, or null.
   *
   * Narrowed here, once: a missing key, a string and a NaN all come back as
   * null, so a caller can write `error.figure("amount_due") ?? fallback`
   * without knowing which of the three it was.
   */
  figure(key: string): number | null {
    const value = this.meta[key];
    const n = typeof value === "string" ? Number(value) : value;

    return typeof n === "number" && Number.isFinite(n) ? n : null;
  }

  /** First field-level validation message, if any. */
  firstFieldError(): string | undefined {
    const first = Object.values(this.errors)[0];
    return first?.[0];
  }
}
