import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import { useAuthStore } from "../../stores/authStore";
import { useBranchStore } from "../../stores/branchStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { ApiError, type ApiEnvelope } from "../types/api";
import { markServerContact } from "../../modules/offline/contact";

const BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

/**
 * A request that hangs forever is worse than one that fails: at the counter it
 * looks like a frozen till, and the cashier's next move is to press the button
 * again. 20s is long enough for a slow 3G upload and short enough that nobody
 * rings the same sale twice — every write that matters carries an idempotency
 * key, so a retry after a timeout is safe.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { Accept: "application/json" },
  timeout: REQUEST_TIMEOUT_MS,
});

// ── Request: attach access token ─────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Operating branch — the backend validates it and ignores it for pinned staff.
  const branchId = useBranchStore.getState().activeBranchId;
  if (branchId) {
    config.headers["X-Branch-Id"] = branchId;
  }
  // Which checkout lane this DEVICE is. The server validates it against the
  // tenant's lanes and the operating branch, and ignores a stale one — so a
  // tablet carrying a retired lane's id still works.
  const registerId = useTerminalStore.getState().activeRegisterId;
  if (registerId) {
    config.headers["X-Register-Id"] = registerId;
  }
  return config;
});

// ── Response: 401 → silent refresh (single-flight) → retry once ─────
let refreshPromise: Promise<string | null> | null = null;

async function refreshTokens(): Promise<string | null> {
  const { refreshToken, setTokens, clear } = useAuthStore.getState();
  if (!refreshToken) return null;

  try {
    // Plain axios: must not recurse through our interceptors.
    const { data } = await axios.post<ApiEnvelope<{ access_token: string; refresh_token: string }>>(
      `${BASE_URL}/auth/refresh`,
      {},
      { headers: { Authorization: `Bearer ${refreshToken}`, Accept: "application/json" } },
    );
    setTokens(data.data.access_token, data.data.refresh_token);
    return data.data.access_token;
  } catch {
    clear(); // refresh token dead → hard logout
    return null;
  }
}

/**
 * We touched the server. Two things record it, and both matter.
 *
 * The store drives the badge and lives in memory. The stamp is written to
 * localStorage, because the question the offline policy asks — "how long has
 * this tablet been out of contact?" — is asked hardest on a COLD boot with no
 * network, where memory is empty and the server cannot be asked.
 */
function touchedServer(): void {
  useConnectionStore.getState().markReachable();
  markServerContact();
}

api.interceptors.response.use(
  (response) => {
    // Real traffic is the only honest signal that the server is reachable.
    touchedServer();
    return response;
  },
  async (error: AxiosError<ApiEnvelope>) => {
    // A response of ANY status means we reached the server; only silence means
    // we didn't. A 500 is a broken server, not a broken connection.
    if (error.response) touchedServer();
    else useConnectionStore.getState().markUnreachable();

    const original = error.config as AxiosRequestConfig & { _retried?: boolean };
    const status = error.response?.status ?? 0;

    // One silent refresh + retry per request; never for auth endpoints themselves.
    const isAuthCall = original.url?.includes("/auth/login") || original.url?.includes("/auth/refresh");

    if (status === 401 && !original._retried && !isAuthCall && useAuthStore.getState().refreshToken) {
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

    // No response at all — say which kind of nothing, because the fix differs:
    // a timeout means try again, offline means stop and check the connection.
    let fallback = "Request failed.";
    let code = body?.meta?.error_code;
    if (!error.response) {
      if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
        fallback = "The server didn't answer in time. Try again.";
        code ??= "TIMEOUT";
      } else if (error.code === "ERR_NETWORK") {
        fallback = navigator.onLine
          ? "Can't reach the server. It may be down."
          : "You're offline — check your connection.";
        code ??= "NETWORK";
      }
    }

    throw new ApiError(body?.message ?? fallback, status, code, body?.errors ?? {});
  },
);

// ── Typed helpers: unwrap the envelope ───────────────────────────────
export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  const { data } = await api.get<ApiEnvelope<T>>(url, config);
  return data;
}

export async function apiPost<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  const { data } = await api.post<ApiEnvelope<T>>(url, body, config);
  return data;
}

export async function apiPut<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  const { data } = await api.put<ApiEnvelope<T>>(url, body, config);
  return data;
}

export async function apiPatch<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  const { data } = await api.patch<ApiEnvelope<T>>(url, body, config);
  return data;
}

export async function apiDelete<T>(url: string, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  const { data } = await api.delete<ApiEnvelope<T>>(url, config);
  return data;
}
