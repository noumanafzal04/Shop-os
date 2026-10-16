import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import { useAuthStore } from "../../stores/authStore";
import { useBranchStore } from "../../stores/branchStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { ApiError, type ApiEnvelope } from "../types/api";
import { markServerContact } from "../../modules/offline/contact";
import { heardShellStamp, SHELL_STAMP_HEADER } from "../kept/shellStamp";

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

/**
 * How long a press that found its twin still being written waits before
 * asking again, and how many times — 0.3 s, 0.6 s, … about 6 s in all.
 */
export const IN_FLIGHT_WAIT_MS = 300;
export const IN_FLIGHT_TRIES = 6;

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

/**
 * Is this 401 about the SESSION, or about something the request said?
 *
 * The server answers 401 for two unrelated reasons:
 *
 *   UNAUTHENTICATED       the token is missing or expired. Refresh it and ask
 *                         again — the till should never notice.
 *   INVALID_CREDENTIALS,  the request carried a secret — a till PIN, a
 *   OTP_INVALID, …        password, a one-time code — and it was wrong.
 *
 * Every 401 was treated as the first. So a wrong PIN at a locked till
 * refreshed the session and then SENT THE WRONG PIN AGAIN: two failed
 * attempts counted for one, and a cashier was frozen out of the till after
 * half the tries the shop allows, with a spent refresh token for good
 * measure.
 *
 * Only an answer that names the session — or names nothing at all, which is
 * what a proxy in front of the API sends — is worth a refresh.
 */
export function sessionHasExpired(status: number, code: string | null | undefined): boolean {
  return status === 401 && (code === undefined || code === null || code === "" || code === "UNAUTHENTICATED");
}

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
  } catch (e) {
    // ── ONLY THE SERVER MAY END A SESSION ──────────────────────────────
    //
    // This was a bare `catch { clear(); }` with the comment "refresh token
    // dead → hard logout" — a cause the code never checked. Every way a
    // request can fail landed here and signed the shop out: a dropped line, a
    // timeout, a 502 while the API restarted, a rate limit.
    //
    // On a till that is not an inconvenience, it is the worst outcome in the
    // app. Sales rung during an outage sit in IndexedDB and can only be sent
    // with a token; sign the till out and the queue is stranded behind a login
    // screen that ALSO needs the server. The shop is then holding a day's
    // takings it cannot deliver, on a device that looks like it has been wiped.
    //
    // So: clear only when the server ANSWERED and said this refresh token is
    // no good — 401 or 403. Anything else, including no answer at all, leaves
    // the session alone. The request fails, the badge says offline, and the
    // till keeps working; the next attempt with a line will refresh normally.
    const status = axios.isAxiosError(e) ? (e.response?.status ?? 0) : 0;

    if (status === 401 || status === 403) {
      clear();
    }

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

/**
 * THIS DEVICE JUST CHANGED SOMETHING ON THE SERVER — and said so.
 *
 * Whoever keeps a copy of the server's data on the device needs to hear when
 * the device itself has changed it: the till's catalogue is the case
 * (`useKeepInSync`). A product made at this counter was not in this counter's
 * offline list until the next quarter-hour heartbeat, so the one till in the
 * world that certainly knew about it could not sell it with the line down.
 *
 * Told here, at the one place every write passes, and not by each screen that
 * saves: a new screen that forgot to say so would be exactly the gap this
 * closes. Only a write the server ACCEPTED is news; a refused one changed
 * nothing.
 *
 * Listeners are told the method and the path as the caller wrote it
 * (`/products/123`), and must not throw — one is not allowed to fail a save.
 */
type WriteListener = (method: string, path: string) => void;
const writeListeners = new Set<WriteListener>();

export function onServerWrite(listener: WriteListener): () => void {
  writeListeners.add(listener);

  return () => {
    writeListeners.delete(listener);
  };
}

function toldOfAWrite(method: string | undefined, path: string | undefined): void {
  const verb = (method ?? "get").toLowerCase();
  if (verb === "get" || verb === "head" || verb === "options") return;

  for (const listener of writeListeners) {
    try {
      listener(verb, path ?? "");
    } catch {
      // A listener's trouble is its own.
    }
  }
}

api.interceptors.response.use(
  (response) => {
    // Real traffic is the only honest signal that the server is reachable.
    touchedServer();
    // Whether what the shell keeps on the device still stands (kept/shellStamp).
    heardShellStamp(response.headers?.[SHELL_STAMP_HEADER], { method: response.config.method, path: response.config.url });
    toldOfAWrite(response.config.method, response.config.url);
    return response;
  },
  async (error: AxiosError<ApiEnvelope>) => {
    // A response of ANY status means we reached the server; only silence means
    // we didn't. A 500 is a broken server, not a broken connection.
    if (error.response) {
      touchedServer();
      // A refusal is still the server speaking, and says the same thing.
      heardShellStamp(error.response.headers?.[SHELL_STAMP_HEADER], { method: error.config?.method, path: error.config?.url });
    } else useConnectionStore.getState().markUnreachable();

    const original = error.config as AxiosRequestConfig & { _retried?: boolean };
    const status = error.response?.status ?? 0;

    // One silent refresh + retry per request; never for auth endpoints themselves.
    const isAuthCall = original.url?.includes("/auth/login") || original.url?.includes("/auth/refresh");

    if (sessionHasExpired(status, error.response?.data?.meta?.error_code) && !original._retried && !isAuthCall && useAuthStore.getState().refreshToken) {
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

    // ── The same press is still being written: wait for its answer ────────
    //
    // A keyed write the server is still recording is refused 409
    // REQUEST_IN_FLIGHT. That is not a failure — the first press IS the
    // record — but it was shown as one: the second press put an error on
    // the screen for something that had just been saved (Codex QA
    // 2026-10-16). Ask again in a moment; once the first is written the
    // server hands back its answer (Idempotent-Replay) and both presses see
    // the same success.
    if (status === 409 && error.response?.data?.meta?.error_code === "REQUEST_IN_FLIGHT") {
      const waited = (original as { _waited?: number })._waited ?? 0;

      if (waited < IN_FLIGHT_TRIES) {
        (original as { _waited?: number })._waited = waited + 1;
        await new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_WAIT_MS * (waited + 1)));
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

    // `meta` rides along. It is where the server puts a figure a screen can
    // ACT on — the amount a short tender has to reach, for one — and dropping
    // it here is what left the till with only a sentence to show.
    throw new ApiError(body?.message ?? fallback, status, code, body?.errors ?? {}, body?.meta ?? {});
  },
);

// ── One press, one request ───────────────────────────────────────────
//
// A double-click sends the same write twice before the screen has had a
// chance to grey the button. Where the route keeps an idempotency key the
// server turned the second into the first's answer; where it did not, the
// shop got two of everything — two transfers out of one Send (stock left the
// shelf twice), two purchase orders, two suppliers, two held tickets (Codex
// QA 2026-10-16).
//
// So a write that is the SAME as one still on its way — same verb, address,
// query and body — is not sent again: the second caller is handed the first
// one's answer. A different body is a different thing and goes. Files are
// never compared (an upload is not twinned).
//
// AND FOR A MOMENT AFTER IT SUCCEEDED. A double-click on a quick server is
// two presses on either side of the answer: the first closed the shift, the
// second asked to close a closed shift and put "No open shift" over the
// success (Codex QA 2026-10-16, BUG-63 — six screens: shift close, day close,
// transfer receive, count apply, order confirm, bill it). So a success is
// kept for `TWIN_SETTLES_MS` and handed to its twin. A refusal is let go at
// once — the corrected form must be able to go — and any OTHER write to the
// same address lets go of the ones before it: a switch pressed off, on and
// off again sends all three.
export const TWIN_SETTLES_MS = 1_000;

const writesOnTheirWay = new Map<string, { address: string; answer: Promise<unknown> }>();

function twinOf(method: string, url: string, body: unknown, config?: AxiosRequestConfig): string | null {
  if (config?.signal) return null;
  if (typeof FormData !== "undefined" && body instanceof FormData) return null;
  if (typeof Blob !== "undefined" && body instanceof Blob) return null;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return null;

  const headers = (config?.headers ?? {}) as Record<string, unknown>;

  try {
    return JSON.stringify([method, url, config?.params ?? null, headers["Idempotency-Key"] ?? null, body ?? null]);
  } catch {
    return null;
  }
}

function onceOnItsWay<T>(address: string, twin: string | null, send: () => Promise<T>): Promise<T> {
  if (twin === null) return send();

  const already = writesOnTheirWay.get(twin);
  if (already) return already.answer as Promise<T>;

  for (const [other, held] of writesOnTheirWay) {
    if (held.address === address) writesOnTheirWay.delete(other);
  }

  const letGo = () => {
    if (writesOnTheirWay.get(twin)?.answer === answer) writesOnTheirWay.delete(twin);
  };
  const answer: Promise<T> = send().then(
    (res) => {
      setTimeout(letGo, TWIN_SETTLES_MS);
      return res;
    },
    (err: unknown) => {
      letGo();
      throw err;
    },
  );
  writesOnTheirWay.set(twin, { address, answer });

  return answer;
}

// ── Typed helpers: unwrap the envelope ───────────────────────────────
export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  const { data } = await api.get<ApiEnvelope<T>>(url, config);
  return data;
}

export function apiPost<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  return onceOnItsWay(`post ${url}`, twinOf("post", url, body, config), async () => (await api.post<ApiEnvelope<T>>(url, body, config)).data);
}

export function apiPut<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  return onceOnItsWay(`put ${url}`, twinOf("put", url, body, config), async () => (await api.put<ApiEnvelope<T>>(url, body, config)).data);
}

export function apiPatch<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  return onceOnItsWay(`patch ${url}`, twinOf("patch", url, body, config), async () => (await api.patch<ApiEnvelope<T>>(url, body, config)).data);
}

export function apiDelete<T>(url: string, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  return onceOnItsWay(`delete ${url}`, twinOf("delete", url, config?.data, config), async () => (await api.delete<ApiEnvelope<T>>(url, config)).data);
}
