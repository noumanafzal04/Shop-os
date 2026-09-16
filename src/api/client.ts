import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import { ApiError, type ApiEnvelope } from "../types/api";
import { noteRateLimit } from "./backoff";

/**
 * WHICH SERVER, asked of the app rather than imported from it.
 *
 * This read `API_BASE_URL` from the app's own config — the last thing tying
 * the HTTP layer to one app. Two apps talk to the same API today and there is
 * no guarantee they always will: a staging build, a shopkeeper's app pointed
 * at a different host, an app that ships before the other.
 *
 * Set once at boot, beside `configureAuth`. Kept in a variable rather than
 * only on `api.defaults` because the refresh call is a bare `axios.post` —
 * it MUST NOT go through the instance, or its own 401 would be intercepted
 * and refreshed, which is a loop.
 */
let baseUrl = "";

export function configureApi(options: { baseUrl: string }): void {
  baseUrl = options.baseUrl;
  api.defaults.baseURL = options.baseUrl;
}

/**
 * WHERE THE TOKENS COME FROM, asked of the app rather than reached for.
 *
 * This file imported `authStore` directly. It worked, and it was the second
 * of the three things tying the shared layer to THIS app — a store holding a
 * customer's session, in a file that otherwise knows nothing but HTTP.
 *
 * The interceptors need exactly four things, and none of them is a store:
 * the access token to attach, the refresh token to try, somewhere to put the
 * new pair, and what to do when the refresh is refused. So that is the
 * contract, and the app supplies it in one call at boot.
 *
 * ── Why the shape is functions and not an object of values ───────────
 *
 * An interceptor runs long after `configureAuth` was called, and it must read
 * the tokens AS THEY ARE THEN. Handing it values would freeze the session at
 * boot — every request after the first refresh would carry a dead token.
 */
export interface AuthAdapter {
  accessToken: () => string | null;
  refreshToken: () => string | null;
  setTokens: (access: string, refresh: string) => Promise<void> | void;
  /** The refresh was refused. Sign out, however this app does that. */
  clear: () => Promise<void> | void;
}

/**
 * Nobody configured it.
 *
 * Answers "no session" rather than throwing, because a request made before
 * the app has wired itself up is a bug in the app's boot order, and failing
 * every unauthenticated call — the health check, the marketplace, sign-in
 * itself — would be a worse one.
 */
let auth: AuthAdapter = {
  accessToken: () => null,
  refreshToken: () => null,
  setTokens: () => {},
  clear: () => {},
};

/** Called once, at boot, before anything makes a request. */
export function configureAuth(adapter: AuthAdapter): void {
  auth = adapter;
}

export const api = axios.create({
  // Filled by `configureApi` at boot. Empty here rather than guessed: a
  // default host is a request that silently reaches the wrong server.
  baseURL: "",
  headers: { Accept: "application/json" },
  timeout: 20_000,
});

// ── Request: attach access token ─────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = auth.accessToken();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response: 401 → silent refresh (single-flight) → retry once ─────
let refreshPromise: Promise<string | null> | null = null;

async function refreshTokens(): Promise<string | null> {
  const refreshToken = auth.refreshToken();
  if (!refreshToken) return null;

  try {
    const { data } = await axios.post<
      ApiEnvelope<{ access_token: string; refresh_token: string }>
    >(
      `${baseUrl}/auth/refresh`,
      {},
      {
        headers: { Authorization: `Bearer ${refreshToken}`, Accept: "application/json" },
        timeout: 20_000,
      },
    );
    await auth.setTokens(data.data.access_token, data.data.refresh_token);
    return data.data.access_token;
  } catch {
    await auth.clear(); // refresh token dead → logged out
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiEnvelope>) => {
    const original = error.config as AxiosRequestConfig & { _retried?: boolean };
    const status = error.response?.status ?? 0;

    const isAuthCall =
      original.url?.includes("/auth/login") || original.url?.includes("/auth/refresh");

    if (
      status === 401 &&
      !original._retried &&
      !isAuthCall &&
      auth.refreshToken() !== null
    ) {
      original._retried = true;

      refreshPromise ??= refreshTokens().finally(() => {
        refreshPromise = null;
      });

      const newToken = await refreshPromise;

      if (newToken) {
        original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` };
        return api(original);
      }
    }

    const body = error.response?.data;
    const isNetwork = !error.response;

    /**
     * TOO MANY REQUESTS. Stop asking, for as long as the server says.
     *
     * React Query already refuses to retry a 4xx, so a single failed call is
     * handled. What is not is the POLLS — a rider's board and an order screen
     * ask by the clock, not by failure, and would keep being refused four and
     * six times a minute until somebody closed the app.
     *
     * `Retry-After` is what Laravel's throttle sends; `backoff` caps it,
     * because it is a number somebody else controls.
     */
    if (status === 429) {
      const after = Number(error.response?.headers?.["retry-after"]);
      noteRateLimit(Number.isFinite(after) ? after : undefined);
    }

    throw new ApiError(
      body?.message ??
        (status === 429
          ? "Too many requests just now — give it a few seconds."
          : isNetwork
            ? "No connection. Check your internet and try again."
            : "Request failed."),
      status,
      body?.meta?.error_code,
      body?.errors ?? {},
    );
  },
);

// ── Typed helpers ────────────────────────────────────────────────────
export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  const { data } = await api.get<ApiEnvelope<T>>(url, config);
  return data;
}

export async function apiPost<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<ApiEnvelope<T>> {
  const { data } = await api.post<ApiEnvelope<T>>(url, body, config);
  return data;
}

export async function apiPut<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<ApiEnvelope<T>> {
  const { data } = await api.put<ApiEnvelope<T>>(url, body, config);
  return data;
}

export async function apiDelete<T>(url: string, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  const { data } = await api.delete<ApiEnvelope<T>>(url, config);
  return data;
}
