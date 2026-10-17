import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios, { AxiosError } from "axios";

import { api, apiDelete, apiGet, apiPatch, apiPost, apiPut, IN_FLIGHT_TRIES, sessionHasExpired, TWIN_SETTLES_MS } from "./client";
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
  // A test that hung with fake timers installed must not hand them on.
  vi.useRealTimers();
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

describe("one press, one request", () => {
  /**
   * A double-click sent the same write twice before the button greyed. Where
   * the route kept no idempotency key, the shop got two of everything: two
   * transfers out of one Send, two purchase orders, two suppliers, two held
   * tickets (Codex QA 2026-10-16).
   */
  type Sent = { method: string; url: string; body: unknown };

  /** The server answers each write after `ms`, with a fresh id per request it SAW. */
  const slowServer = (sent: Sent[], ms = 20) => {
    api.defaults.adapter = async (config) => {
      sent.push({ method: String(config.method), url: String(config.url), body: config.data });
      const id = `rec-${sent.length}`;
      await new Promise((r) => setTimeout(r, ms));
      return { status: 201, statusText: "", headers: {}, config, data: { success: true, message: "Saved.", data: { id }, meta: {} } } as never;
    };
  };

  it("sends a write pressed twice ONCE, and both presses get its answer", async () => {
    const sent: Sent[] = [];
    slowServer(sent);
    const transfer = { mode: "send", product_id: "p1", quantity: 2 };

    const [first, second] = await Promise.all([
      apiPost<{ id: string }>("/inventory/transfers", transfer),
      apiPost<{ id: string }>("/inventory/transfers", { ...transfer }),
    ]);

    expect(sent, "a double-click sent the transfer twice — stock left the shelf twice").toHaveLength(1);
    expect(first.data.id).toBe("rec-1");
    expect(second.data.id, "the second press was not given the first one's record").toBe("rec-1");
  });

  it("twins PUT and DELETE the same way", async () => {
    const sent: Sent[] = [];
    slowServer(sent);

    await Promise.all([apiPut("/suppliers/s1", { name: "Ali" }), apiPut("/suppliers/s1", { name: "Ali" })]);
    await Promise.all([apiDelete("/held/h1"), apiDelete("/held/h1")]);

    expect(sent.map((s) => s.method)).toEqual(["put", "delete"]);
  });

  it("sends a different write — another body, address or key — as its own", async () => {
    const sent: Sent[] = [];
    slowServer(sent);

    await Promise.all([
      apiPost("/suppliers", { name: "Ali" }),
      apiPost("/suppliers", { name: "Bilal" }),
      apiPost("/customers", { name: "Ali" }),
      apiPost("/expenses", { amount: 500 }, { headers: { "Idempotency-Key": "k1" } }),
      apiPost("/expenses", { amount: 500 }, { headers: { "Idempotency-Key": "k2" } }),
    ]);

    expect(sent, "two different things were taken for one press").toHaveLength(5);
  });

  it("hands a click that lands just AFTER the answer the same answer — and lets go a moment later", async () => {
    // BUG-63: the first click closed the shift, the second asked to close a
    // closed shift and put "No open shift" over the success.
    vi.useFakeTimers();
    try {
      const sent: Sent[] = [];
      slowServer(sent, 5);
      const close = () => apiPost<{ id: string }>("/pos/session/close", { counted: 25726 });

      const first = close();
      await vi.advanceTimersByTimeAsync(10);
      const closed = await first;

      const second = await close();
      expect(sent, "the second click of a double-click was sent after the first came back").toHaveLength(1);
      expect(second.data.id).toBe(closed.data.id);

      await vi.advanceTimersByTimeAsync(TWIN_SETTLES_MS + 10);
      const later = close();
      await vi.advanceTimersByTimeAsync(10);
      await later;
      expect(sent, "a press long after the answer was swallowed").toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets go of a success when another write goes to the same address", async () => {
    // A switch pressed off, on and off again is three things, not two.
    const sent: Sent[] = [];
    slowServer(sent, 1);

    await apiPut("/products/p9/active", { is_active: false });
    await apiPut("/products/p9/active", { is_active: true });
    await apiPut("/products/p9/active", { is_active: false });

    expect(sent.map((s) => JSON.parse(String(s.body)).is_active)).toEqual([false, true, false]);
  });

  it("frees a refused write, so the corrected form can be sent", async () => {
    let calls = 0;
    api.defaults.adapter = async (config) => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      const err = new AxiosError("no", "ERR_BAD_REQUEST", config as never);
      err.response = { status: 422, statusText: "", headers: {}, config, data: { success: false, message: "Name is required.", meta: {} } } as never;
      throw err;
    };

    const both = await Promise.allSettled([apiPost("/suppliers", {}), apiPost("/suppliers", {})]);
    expect(both.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(calls).toBe(1);

    await expect(apiPost("/suppliers", {})).rejects.toMatchObject({ message: "Name is required." });
    expect(calls, "a refusal stayed on its way and swallowed the next press").toBe(2);
  });

  it("sends every press of a stepper — four taps on one dish are four naan", async () => {
    // $10 (money pass 2026-10-16): the line went up by one for four taps,
    // and three naan were served and never charged.
    const sent: Sent[] = [];
    slowServer(sent, 1);
    const oneMore = () => apiPatch("/restaurant/tickets/t1/items/i1", { adjust: 1 }, { everyPressCounts: true });

    await Promise.all([oneMore(), oneMore()]);
    await oneMore();
    await oneMore();

    expect(sent, "a tap on the same dish was handed the tap before it").toHaveLength(4);
  });

  it("never twins a file upload", async () => {
    const sent: Sent[] = [];
    slowServer(sent);
    const photo = () => {
      const form = new FormData();
      form.append("name", "Rice");
      return form;
    };

    await Promise.all([apiPost("/products", photo()), apiPost("/products", photo())]);

    expect(sent).toHaveLength(2);
  });
});

describe("a press whose twin is still being written", () => {
  /**
   * The server refuses a key it is still recording with 409
   * REQUEST_IN_FLIGHT. The first press IS the record, but the second one put
   * an error on the screen for something that had just been saved.
   */
  const inFlight = (config: never) => {
    const err = new AxiosError("busy", "ERR_BAD_REQUEST", config);
    err.response = {
      status: 409, statusText: "", headers: {}, config,
      data: { success: false, message: "This is already being recorded — one moment.", meta: { error_code: "REQUEST_IN_FLIGHT" } },
    } as never;
    return err;
  };

  it("waits, asks again, and is given the first press's answer", async () => {
    const answers = ["busy", "busy", "replay"];
    let asked = 0;
    api.defaults.adapter = async (config) => {
      const now = answers[asked++];
      if (now === "busy") throw inFlight(config as never);
      return { status: 201, statusText: "", headers: { "idempotent-replay": "true" }, config, data: { success: true, message: "Payment recorded.", data: { id: "pay-1" }, meta: {} } } as never;
    };

    const res = await apiPost<{ id: string }>("/customers/c1/payments", { amount: 500, idempotency_key: "k-replayed" });

    expect(res.data.id, "the second press showed an error for a payment that was saved").toBe("pay-1");
    expect(asked).toBe(3);
  });

  it("gives up after a few tries and says what it was told", async () => {
    vi.useFakeTimers();
    let asked = 0;
    api.defaults.adapter = async (config) => {
      asked++;
      throw inFlight(config as never);
    };

    const outcome = apiPost("/customers/c1/payments", { amount: 500, idempotency_key: "k-never-written" }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();

    expect(await outcome).toMatchObject({ status: 409, errorCode: "REQUEST_IN_FLIGHT" });
    expect(asked, "it asked forever, or never asked again").toBe(1 + IN_FLIGHT_TRIES);
  });

  it("does not ask again over any other 409", async () => {
    let asked = 0;
    api.defaults.adapter = async (config) => {
      asked++;
      const err = new AxiosError("taken", "ERR_BAD_REQUEST", config as never);
      err.response = { status: 409, statusText: "", headers: {}, config, data: { success: false, message: "That barcode is taken.", meta: { error_code: "CONFLICT" } } } as never;
      throw err;
    };

    await expect(apiPost("/products", { barcode: "123" })).rejects.toMatchObject({ message: "That barcode is taken." });
    expect(asked).toBe(1);
  });
});
