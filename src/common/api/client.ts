import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import { useAuthStore } from "../../stores/authStore";
import { ApiError, type ApiEnvelope } from "../types/api";

const BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { Accept: "application/json" },
});

// ── Request: attach access token ─────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
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

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiEnvelope>) => {
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

    throw new ApiError(
      body?.message ?? (error.code === "ERR_NETWORK" ? "Network error — check your connection." : "Request failed."),
      status,
      body?.meta?.error_code,
      body?.errors ?? {},
    );
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
