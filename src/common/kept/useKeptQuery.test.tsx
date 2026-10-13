import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../../stores/authStore";
import { heldFor } from "./kept";
import { useKeptStore } from "./keptStore";
import { useKeptQuery } from "./useKeptQuery";

/**
 * A QUERY WHOSE ANSWER STAYS ON THE DEVICE — when the server is asked, and
 * when it is not.
 *
 * What is counted is the REQUESTS. An answer that is right and was asked for
 * on every load is the fault this exists to fix, so "the data is correct" is
 * never the whole of an assertion here.
 */

const TRUSTED = 5 * 60_000;

let asked: ReturnType<typeof vi.fn<() => Promise<{ tax: number }>>>;
let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const signedIn = (shop: string | null, user: string) =>
  act(() => useAuthStore.setState({ user: { id: user, tenant: shop === null ? null : { id: shop } } as never, isAuthenticated: true }));
const hold = (owner: string, data: unknown, ago: number, name = "settings") =>
  useKeptStore.setState({ record: { owner, held: { [name]: { data, at: Date.now() - ago } } } });
const kept = (owner: string, name = "settings") => heldFor(useKeptStore.getState().record, owner, name);
/** Long enough for a request that was going to be made to have been. */
const aMoment = () => act(async () => { await new Promise((turn) => setTimeout(turn, 60)); });

const useSettings = (options: { enabled?: boolean; kept?: boolean } = {}) =>
  useKeptQuery<{ tax: number }>("settings", { queryKey: ["settings"], queryFn: asked, staleTime: TRUSTED, ...options });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  asked = vi.fn(async () => ({ tax: 17 }));
  useKeptStore.setState({ record: null });
  signedIn("t1", "u1");
});

afterEach(() => {
  client.clear();
});

describe("with nothing kept", () => {
  it("asks once, and keeps the answer for this person in this shop", async () => {
    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ tax: 17 }));
    await aMoment();

    expect(asked).toHaveBeenCalledTimes(1);
    expect(kept("t1:u1")?.data).toEqual({ tax: 17 });
    expect(Date.now() - (kept("t1:u1")?.at ?? 0)).toBeLessThan(5_000);
  });

  it("asks nothing while it is switched off", async () => {
    const { result } = renderHook(() => useSettings({ enabled: false }), { wrapper });
    await aMoment();

    expect(asked).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("asks nothing while nobody is signed in — there is nobody to keep it for", async () => {
    act(() => useAuthStore.setState({ user: null, isAuthenticated: false }));

    renderHook(() => useSettings(), { wrapper });
    await aMoment();

    expect(asked).not.toHaveBeenCalled();
  });
});

describe("opened again — a reload", () => {
  it("opens with what was kept and asks NOTHING, while the answer is trusted", async () => {
    hold("t1:u1", { tax: 5 }, 60_000);

    const { result } = renderHook(() => useSettings(), { wrapper });
    // On the first paint, before anything could have answered.
    expect(result.current.data, "the screen did not open with the kept answer").toEqual({ tax: 5 });
    await aMoment();

    expect(asked, "a reload asked for an answer it already had").not.toHaveBeenCalled();
    expect(result.current.data).toEqual({ tax: 5 });
  });

  it("opens with what was kept and asks behind it, once it is older than that", async () => {
    hold("t1:u1", { tax: 5 }, TRUSTED + 1_000);

    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.data, "an old answer was thrown away instead of shown").toEqual({ tax: 5 });

    await waitFor(() => expect(result.current.data).toEqual({ tax: 17 }));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(kept("t1:u1")?.data, "the fresh answer was not kept in the old one's place").toEqual({ tax: 17 });
  });

  it("does not believe an answer from the future — it asks at once", async () => {
    // The device's clock was put back a day since it was kept.
    useKeptStore.setState({ record: { owner: "t1:u1", held: { settings: { data: { tax: 5 }, at: Date.now() + 86_400_000 } } } });

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ tax: 17 }));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(kept("t1:u1")?.at, "the answer was kept with the old, wrong time").toBeLessThanOrEqual(Date.now());
  });

  it("asks once for many readers — a screen reads the settings in a dozen places", async () => {
    renderHook(() => { useSettings(); useSettings(); useSettings(); }, { wrapper });
    await aMoment();

    expect(asked).toHaveBeenCalledTimes(1);
  });
});

describe("it is somebody's", () => {
  it("never opens with another shop's answer — it asks for its own", async () => {
    hold("t2:u1", { tax: 5 }, 1_000);

    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.data, "another shop's settings were shown").toBeUndefined();

    await waitFor(() => expect(result.current.data).toEqual({ tax: 17 }));
    expect(useKeptStore.getState().record?.owner).toBe("t1:u1");
  });

  it("never opens with another person's answer in the same shop", async () => {
    hold("t1:u2", { tax: 5 }, 1_000);

    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
  });

  it("keeps an answer for whoever ASKED, not whoever is at the till when it is looked at", async () => {
    // The first person's answer is in the query. A second takes over with a
    // PIN — no reload, and the query cache is not emptied.
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ tax: 17 }));
    expect(kept("t1:u1")?.data).toEqual({ tax: 17 });

    signedIn("t1", "u2");
    await aMoment();

    expect(kept("t1:u2"), "the first person's answer was filed under the second").toBeNull();
    expect(useKeptStore.getState().record?.owner).toBe("t1:u1");
  });

  it("files an answer that was in the air under the person whose token asked for it", async () => {
    // Asked as the first person; the second takes the till over before the
    // server has answered. What comes back is the first person's.
    let answer: (value: { tax: number }) => void = () => {};
    asked.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));

    signedIn("t1", "u2");
    await act(async () => { answer({ tax: 17 }); });
    await aMoment();

    expect(kept("t1:u2"), "an answer asked for by one person was kept for the next").toBeNull();
    expect(kept("t1:u1")?.data).toEqual({ tax: 17 });
  });

  it("keeps the next answer for the second person, once it is theirs", async () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ tax: 17 }));

    signedIn("t1", "u2");
    asked.mockResolvedValue({ tax: 9 });
    await act(async () => { await client.invalidateQueries({ queryKey: ["settings"] }); });

    await waitFor(() => expect(kept("t1:u2")?.data).toEqual({ tax: 9 }));
    expect(kept("t1:u1"), "the first person's record was left behind the second's").toBeNull();
  });
});

describe("when this device changes it", () => {
  it("asks again on a save, shows the new answer, and keeps it — inside the trusted time", async () => {
    hold("t1:u1", { tax: 5 }, 10_000);
    const { result } = renderHook(() => useSettings(), { wrapper });
    await aMoment();
    expect(asked).not.toHaveBeenCalled();

    // What every saving hook does on success.
    await act(async () => { await client.invalidateQueries({ queryKey: ["settings"] }); });

    await waitFor(() => expect(result.current.data).toEqual({ tax: 17 }));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(kept("t1:u1")?.data, "the save refreshed the screen and left the old answer on the device").toEqual({ tax: 17 });
  });

  it("so the load AFTER a save opens with what was saved, and asks nothing", async () => {
    hold("t1:u1", { tax: 5 }, 10_000);
    const first = renderHook(() => useSettings(), { wrapper });
    await act(async () => { await client.invalidateQueries({ queryKey: ["settings"] }); });
    await waitFor(() => expect(first.result.current.data).toEqual({ tax: 17 }));
    first.unmount();

    // A reload: a new query cache, the same device.
    client.clear();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    asked.mockClear();
    const { result } = renderHook(() => useSettings(), { wrapper });
    await aMoment();

    expect(result.current.data, "the reload opened with the answer from BEFORE the save").toEqual({ tax: 17 });
    expect(asked).not.toHaveBeenCalled();
  });

  it("keeps what it had when the asking fails — a dropped line does not empty the screen", async () => {
    hold("t1:u1", { tax: 5 }, TRUSTED + 1_000);
    asked.mockRejectedValue(new Error("Network Error"));

    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toEqual({ tax: 5 });
    expect(kept("t1:u1")?.data).toEqual({ tax: 5 });
  });
});

describe("a variant that is not worth keeping", () => {
  it("is asked like any query, and nothing is kept", async () => {
    const { result } = renderHook(() => useSettings({ kept: false }), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ tax: 17 }));

    expect(asked).toHaveBeenCalledTimes(1);
    expect(useKeptStore.getState().record).toBeNull();
  });

  it("does not open with an answer kept under the same name", async () => {
    hold("t1:u1", { tax: 5 }, 1_000);

    const { result } = renderHook(() => useSettings({ kept: false }), { wrapper });

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toEqual({ tax: 17 }));
  });
});
