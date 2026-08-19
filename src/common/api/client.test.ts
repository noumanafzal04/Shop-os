import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios, { AxiosError } from "axios";

import { api, apiGet } from "./client";
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
