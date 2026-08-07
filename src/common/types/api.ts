/**
 * The standard backend envelope: every API response has this shape.
 * (Identical contract to the web panel.)
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

  firstFieldError(): string | undefined {
    const first = Object.values(this.errors)[0];
    return first?.[0];
  }
}
