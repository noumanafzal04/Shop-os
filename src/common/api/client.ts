import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import { API_BASE_URL } from "../config";
import { useAuthStore } from "../../stores/authStore";
import { ApiError, type ApiEnvelope } from "../types/api";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { Accept: "application/json" },
  timeout: 20_000,
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
    const { data } = await axios.post<
      ApiEnvelope<{ access_token: string; refresh_token: string }>
    >(
      `${API_BASE_URL}/auth/refresh`,
      {},
      {
        headers: { Authorization: `Bearer ${refreshToken}`, Accept: "application/json" },
        timeout: 20_000,
      },
    );
    await setTokens(data.data.access_token, data.data.refresh_token);
    return data.data.access_token;
  } catch {
    await clear(); // refresh token dead → logged out
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
      useAuthStore.getState().refreshToken
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

    throw new ApiError(
      body?.message ??
        (isNetwork ? "No connection. Check your internet and try again." : "Request failed."),
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
