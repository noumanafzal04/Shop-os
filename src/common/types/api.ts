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
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** First field-level validation message, if any. */
  firstFieldError(): string | undefined {
    const first = Object.values(this.errors)[0];
    return first?.[0];
  }
}
