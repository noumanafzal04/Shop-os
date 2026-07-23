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
  [key: string]: unknown;
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
