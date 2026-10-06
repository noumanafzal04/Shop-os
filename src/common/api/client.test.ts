import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios, { AxiosError } from "axios";

import { api, apiGet, apiPost, sessionHasExpired } from "./client";
import { useAuthStore } from "../../stores/authStore";

/**
 * ONLY THE SERVER MAY END A SESSION.
 *
 * The refresh used to be wrapped in a bare `catch { clear(); }` carrying the
 * comment "refresh token dead → hard logout" — a cause the code never checked.
 * Every way a request can fail landed there: a dropped line, a timeout, a 502
 * while the API restarted, a rate limit. All of them signed the shop out.
 *
 * On a till that is the worst outcome in the app. Sales rung during an outage
 * live in IndexedDB and can only be sent with a token, so signing the till out
 * strands a day's takings behind a login screen that also needs the server.
 */

const user = { id: "u1", name: "Cashier" } as never;

/**
 * Make the till's own request come back 401, so the refresh is attempted.
 *
 * A custom adapter is responsible for settling itself — axios does not apply
 * `validateStatus` to whatever it returns — so a "401" that merely RESOLVES is
 * a successful request as far as the interceptor is concerned, and the whole
 * test passes without the code under test ever running.
 */
function serverSaysExpired(): void {
  api.defaults.adapter = async (config) => {
    const err = new AxiosError("Unauthenticated", "ERR_BAD_REQUEST", config as never);
    err.response = { status: 401, data: {}, statusText: "", headers: {}, config } as never;
    throw err;
  };
}

beforeEach(() => {
  useAuthStore.setState({
    user,
    accessToken: "stale",
    refreshToken: "refresh-1",
    isAuthenticated: true,
  });
  serverSaysExpired();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete api.defaults.adapter;
});

describe("a refresh that could not be made", () => {
  it("leaves the till signed in when there was no answer at all", async () => {
    // ERR_NETWORK: the line is down, or the API is unreachable. The refresh
    // token is not dead — nobody asked it anything.
    vi.spyOn(axios, "post").mockRejectedValue(
      new AxiosError("Network Error", "ERR_NETWORK"),
    );

    await expect(apiGet("/anything")).rejects.toBeDefined();

    expect(
      useAuthStore.getState().isAuthenticated,
      "a dropped line signed the till out — the outbox is now stranded behind a login screen",
    ).toBe(true);
    expect(useAuthStore.getState().refreshToken).toBe("refresh-1");
  });

  it("leaves the till signed in when the server was too busy", async () => {
    // 429 and 5xx are the server saying "not now", never "not you".
    const err = new AxiosError("Too Many Requests");
    err.response = { status: 429, data: {}, statusText: "", headers: {}, config: {} } as never;
    vi.spyOn(axios, "post").mockRejectedValue(err);

    await expect(apiGet("/anything")).rejects.toBeDefined();

    expect(
      useAuthStore.getState().isAuthenticated,
      "a rate limit signed the till out",
    ).toBe(true);
  });

  it("signs out only when the server says the refresh token is no good", async () => {
    const err = new AxiosError("Unauthenticated");
    err.response = { status: 401, data: {}, statusText: "", headers: {}, config: {} } as never;
    vi.spyOn(axios, "post").mockRejectedValue(err);

    await expect(apiGet("/anything")).rejects.toBeDefined();

    expect(
      useAuthStore.getState().isAuthenticated,
      "a dead refresh token left the session standing",
    ).toBe(false);
  });
});

describe("a 401 that is about the request, not the session", () => {
  /**
   * A wrong till PIN is answered 401 INVALID_CREDENTIALS. The client took
   * that for an expired session, refreshed, and sent the wrong PIN again — so
   * one mistake counted as two, and a cashier was frozen out in half the
   * tries. Found by the QA journey, which saw two refusals for one press.
   */
  const answers = (code: string | undefined, sent: string[]) => {
    api.defaults.adapter = async (config) => {
      sent.push(String(config.url));
      const err = new AxiosError("no", "ERR_BAD_REQUEST", config as never);
      err.response = {
        status: 401, statusText: "", headers: {}, config,
        data: { success: false, message: "That PIN is not right.", meta: code === undefined ? {} : { error_code: code } },
      } as never;
      throw err;
    };
  };

  it("sends a wrong PIN ONCE, and does not spend a refresh on it", async () => {
    const sent: string[] = [];
    answers("INVALID_CREDENTIALS", sent);
    const refresh = vi.spyOn(axios, "post");

    await expect(apiPost("/pos/unlock", { user_id: "u2", pin: "0000" })).rejects.toMatchObject({
      message: "That PIN is not right.",
    });

    expect(sent, "the wrong PIN was sent to the server twice").toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    // And nobody was signed out over a mistyped PIN.
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().refreshToken).toBe("refresh-1");
  });

  it("still refreshes and asks again when it IS the session", async () => {
    const sent: string[] = [];
    answers("UNAUTHENTICATED", sent);
    vi.spyOn(axios, "post").mockResolvedValue({ data: { data: { access_token: "new", refresh_token: "refresh-2" } } });

    await expect(apiGet("/products")).rejects.toBeTruthy();

    // Once, refreshed, once more — and no third time.
    expect(sent).toHaveLength(2);
    expect(useAuthStore.getState().refreshToken).toBe("refresh-2");
  });

  it("names the two kinds apart", () => {
    expect(sessionHasExpired(401, "UNAUTHENTICATED")).toBe(true);
    // A proxy's bare 401 says nothing; the session is the only thing it can mean.
    expect(sessionHasExpired(401, undefined)).toBe(true);
    for (const code of ["INVALID_CREDENTIALS", "OTP_INVALID", "OTP_EXPIRED", "OTP_MAX_ATTEMPTS"]) {
      expect(sessionHasExpired(401, code), code).toBe(false);
    }
    expect(sessionHasExpired(403, "UNAUTHENTICATED")).toBe(false);
  });
});
