import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, apiGet, apiPut } from "../api/client";
import { queryClient } from "../api/queryClient";
import { useAuthStore } from "../../stores/authStore";
import { useMe } from "../../modules/auth/hooks/useAuth";
import { authService } from "../../modules/auth/services/authService";
import { useBranches } from "../../modules/branches/hooks/useBranches";
import { branchService } from "../../modules/branches/services/branchService";
import { useShopSettings } from "../../modules/shop/hooks/useShop";
import { shopService, type ShopSettings } from "../../modules/shop/services/shopService";
import { heldFor } from "./kept";
import { useKeptStore } from "./keptStore";
import { heardShellStamp, stampNow } from "./shellStamp";

/**
 * A CHANGE MADE SOMEWHERE ELSE REACHES THIS DEVICE — with the next thing it
 * asks, and without asking for it.
 *
 * The shell's answers are kept on the device and a load asks for none of
 * them. On its own that would mean an admin switching a module on, or an
 * owner changing a cashier's permissions from the office, did not show until
 * the kept copy aged out: "refresh the page" would refresh nothing.
 *
 * Every signed-in answer carries a stamp; this is what a device does with it.
 */

const OWNER = "t1:u1";
const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
const aMoment = () => act(async () => { await new Promise((turn) => setTimeout(turn, 80)); });
const kept = (name: string) => heldFor(useKeptStore.getState().record, OWNER, name);

let settingsAsked: ReturnType<typeof vi.spyOn>;
let branchesAsked: ReturnType<typeof vi.spyOn>;
let meAsked: ReturnType<typeof vi.spyOn>;
let modules: string[];

beforeEach(() => {
  queryClient.clear();
  useKeptStore.setState({ record: null });
  useAuthStore.setState({
    user: { id: "u1", role: "shop_owner", permissions: [], tenant: { id: "t1", features: { pos: true } } } as never,
    userAt: Date.now(), userUnder: null, isAuthenticated: true, accessToken: "token", refreshToken: null,
  });
  modules = ["pos"];
  settingsAsked = vi.spyOn(shopService, "settings").mockImplementation(async () => envelope({ modules: [...modules] } as unknown as ShopSettings));
  branchesAsked = vi.spyOn(branchService, "list").mockResolvedValue(envelope([]));
  meAsked = vi.spyOn(authService, "me").mockImplementation(async () => envelope({ ...useAuthStore.getState().user!, name: `with ${modules.join("+")}` }) as never);
});

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  delete api.defaults.adapter;
});

const useShell = () => ({ settings: useShopSettings(), branches: useBranches(), me: useMe() });

describe("hearing the stamp", () => {
  it("keeps the first one it is ever sent, and asks nothing because of it", async () => {
    renderHook(useShell, { wrapper });
    await waitFor(() => expect(settingsAsked).toHaveBeenCalledTimes(1));
    await aMoment();
    settingsAsked.mockClear(); branchesAsked.mockClear(); meAsked.mockClear();

    act(() => heardShellStamp("aaaa"));
    await aMoment();

    expect(stampNow()).toBe("aaaa");
    expect(settingsAsked, "the first stamp ever heard was treated as a change").not.toHaveBeenCalled();
    expect(meAsked).not.toHaveBeenCalled();
  });

  it("does nothing at all when it is the same as last time — which is nearly every answer", async () => {
    act(() => heardShellStamp("aaaa"));
    renderHook(useShell, { wrapper });
    await waitFor(() => expect(settingsAsked).toHaveBeenCalledTimes(1));
    await aMoment();
    settingsAsked.mockClear(); branchesAsked.mockClear(); meAsked.mockClear();
    const written = vi.spyOn(Storage.prototype, "setItem");

    act(() => { heardShellStamp("aaaa"); heardShellStamp("aaaa"); heardShellStamp("aaaa"); });
    await aMoment();

    expect(settingsAsked).not.toHaveBeenCalled();
    expect(branchesAsked).not.toHaveBeenCalled();
    expect(written, "an unchanged stamp was written to the device on every request").not.toHaveBeenCalled();
  });

  it("asks for every kept answer again the moment it CHANGES", async () => {
    act(() => heardShellStamp("aaaa"));
    const { result } = renderHook(useShell, { wrapper });
    await waitFor(() => expect(result.current.settings.data).toBeDefined());
    await aMoment();
    settingsAsked.mockClear(); branchesAsked.mockClear(); meAsked.mockClear();

    // An admin switched Delivery on. Nothing on this device did anything.
    modules = ["pos", "delivery"];
    act(() => heardShellStamp("bbbb"));

    await waitFor(() => expect((result.current.settings.data as unknown as { modules: string[] }).modules).toEqual(["pos", "delivery"]));
    expect(settingsAsked).toHaveBeenCalledTimes(1);
    expect(branchesAsked).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(meAsked).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useAuthStore.getState().user?.name).toBe("with pos+delivery"));
  });

  it("and what comes back is kept under the NEW stamp", async () => {
    act(() => heardShellStamp("aaaa"));
    const { result } = renderHook(useShell, { wrapper });
    await waitFor(() => expect(result.current.settings.data).toBeDefined());
    expect(kept("shop-settings")?.under).toBe("aaaa");

    act(() => heardShellStamp("bbbb"));

    await waitFor(() => expect(kept("shop-settings")?.under).toBe("bbbb"));
    await waitFor(() => expect(useAuthStore.getState().userUnder).toBe("bbbb"));
  });

  it("ignores an answer that carried no stamp — an older server, a header the browser may not read", async () => {
    act(() => heardShellStamp("aaaa"));
    renderHook(useShell, { wrapper });
    await waitFor(() => expect(settingsAsked).toHaveBeenCalledTimes(1));
    await aMoment();
    settingsAsked.mockClear();

    act(() => { heardShellStamp(undefined); heardShellStamp(""); heardShellStamp(null); heardShellStamp(42); });
    await aMoment();

    expect(stampNow()).toBe("aaaa");
    expect(settingsAsked).not.toHaveBeenCalled();
  });

  it("does not act for nobody — a stamp heard while signed out is not kept for the next person", () => {
    useAuthStore.setState({ user: null, isAuthenticated: false });

    heardShellStamp("aaaa");

    expect(useKeptStore.getState().record).toBeNull();
  });

  it("starts over for the next person at the counter: their first stamp is a first stamp", async () => {
    act(() => heardShellStamp("aaaa"));
    act(() => useAuthStore.setState({ user: { id: "u2", role: "staff", permissions: [], tenant: { id: "t1" } } as never }));
    renderHook(useShell, { wrapper });
    await aMoment();
    settingsAsked.mockClear();

    // A different stamp — because it is a different person's, not because
    // anything changed.
    act(() => heardShellStamp("cccc"));
    await aMoment();

    expect(settingsAsked, "another person's stamp was read as a change to this person's shop").not.toHaveBeenCalled();
    expect(useKeptStore.getState().record).toMatchObject({ owner: "t1:u2", stamp: "cccc" });
  });
});

describe("the answer the stamp came with", () => {
  it("is not asked for again — it IS the shop's settings as they now stand", async () => {
    act(() => heardShellStamp("aaaa"));
    renderHook(useShell, { wrapper });
    await waitFor(() => expect(settingsAsked).toHaveBeenCalledTimes(1));
    await aMoment();
    settingsAsked.mockClear(); branchesAsked.mockClear(); meAsked.mockClear();

    // The settings were read, and that answer carried the moved stamp.
    act(() => heardShellStamp("bbbb", { method: "get", path: "/shop/settings" }));
    await aMoment();

    expect(settingsAsked, "the settings were asked for twice: once, and once more because of the stamp their own answer carried").not.toHaveBeenCalled();
    // Everything else the stamp speaks for still is.
    expect(branchesAsked).toHaveBeenCalledTimes(1);
    expect(meAsked).toHaveBeenCalledTimes(1);
  });

  it("is asked for when what carried the stamp was a SAVE to the same address", async () => {
    act(() => heardShellStamp("aaaa"));
    renderHook(useShell, { wrapper });
    await waitFor(() => expect(settingsAsked).toHaveBeenCalledTimes(1));
    await aMoment();
    settingsAsked.mockClear();

    act(() => heardShellStamp("bbbb", { method: "put", path: "/shop/settings" }));

    await waitFor(() => expect(settingsAsked).toHaveBeenCalledTimes(1));
  });
});

describe("when the stamp moved because THIS device saved", () => {
  it("asks once for what the save refreshes — the screen's asking and the stamp's are one", async () => {
    // What a settings save does: the PUT's answer carries the moved stamp,
    // and the screen then refreshes the settings and who-am-I itself.
    act(() => heardShellStamp("aaaa"));
    renderHook(useShell, { wrapper });
    await waitFor(() => expect(settingsAsked).toHaveBeenCalledTimes(1));
    await aMoment();
    settingsAsked.mockClear(); branchesAsked.mockClear(); meAsked.mockClear();

    await act(async () => {
      heardShellStamp("bbbb", { method: "put", path: "/shop/settings" });
      void queryClient.invalidateQueries({ queryKey: ["shop-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    });
    await aMoment();

    expect(settingsAsked, "a save asked for the settings twice").toHaveBeenCalledTimes(1);
    expect(meAsked, "a save asked who-am-I twice").toHaveBeenCalledTimes(1);
    // What the screen did not think to refresh, the stamp still does.
    expect(branchesAsked).toHaveBeenCalledTimes(1);
  });
});

describe("a device that kept the answers and lost the stamp", () => {
  /**
   * Nothing "moved" — this is the first stamp heard on this visit. But what
   * the device holds says which stamp it was heard under, and it is not this
   * one. Trusting it would be trusting the note that went missing.
   */
  it("asks for an answer that was heard under another stamp, the first time a stamp is heard", async () => {
    useKeptStore.setState({ record: {
      owner: OWNER,
      held: { "shop-settings": { data: { modules: ["pos"] }, at: Date.now() - 10_000, under: "aaaa" } },
    } });
    modules = ["pos", "delivery"];
    const { result } = renderHook(() => useShopSettings(), { wrapper });
    await aMoment();
    expect(settingsAsked).not.toHaveBeenCalled();

    act(() => heardShellStamp("bbbb"));

    await waitFor(() => expect((result.current.data as unknown as { modules: string[] }).modules).toEqual(["pos", "delivery"]));
  });

  it("does the same for who-am-I, which the session keeps", async () => {
    useAuthStore.setState({ userAt: Date.now() - 10_000, userUnder: "aaaa" });
    renderHook(() => useMe(), { wrapper });
    await aMoment();
    expect(meAsked).not.toHaveBeenCalled();

    act(() => heardShellStamp("bbbb"));

    await waitFor(() => expect(meAsked).toHaveBeenCalledTimes(1));
  });

  it("asks for nothing that was heard under this very stamp", async () => {
    useKeptStore.setState({ record: {
      owner: OWNER,
      held: { "shop-settings": { data: { modules: ["pos"] }, at: Date.now() - 10_000, under: "bbbb" } },
    } });
    useAuthStore.setState({ userAt: Date.now() - 10_000, userUnder: "bbbb" });
    renderHook(useShell, { wrapper });
    await aMoment();
    settingsAsked.mockClear(); meAsked.mockClear();

    act(() => heardShellStamp("bbbb"));
    await aMoment();

    expect(settingsAsked).not.toHaveBeenCalled();
    expect(meAsked).not.toHaveBeenCalled();
  });
});

describe("an answer that keeps failing", () => {
  it("is not set off again by its own failure — the stamp it carries is the same one", async () => {
    act(() => heardShellStamp("aaaa"));
    renderHook(useShell, { wrapper });
    await waitFor(() => expect(settingsAsked).toHaveBeenCalledTimes(1));
    await aMoment();
    act(() => heardShellStamp("bbbb"));
    await waitFor(() => expect(settingsAsked).toHaveBeenCalledTimes(2));
    await aMoment();
    settingsAsked.mockClear(); meAsked.mockClear(); branchesAsked.mockClear();

    // Twenty more answers, every one saying what the last one said.
    act(() => { for (let i = 0; i < 20; i++) heardShellStamp("bbbb"); });
    await aMoment();

    expect(settingsAsked).not.toHaveBeenCalled();
    expect(meAsked).not.toHaveBeenCalled();
    expect(branchesAsked).not.toHaveBeenCalled();
  });
});

describe("a reload after something changed elsewhere", () => {
  /**
   * The case the stamp exists for. The device kept its answers a minute ago;
   * since then an admin switched a module on. The page is reloaded.
   */
  it("opens from what was kept, hears the new stamp on the screen's own request, and asks again", async () => {
    // What the device holds from before the reload.
    useKeptStore.setState({ record: {
      owner: OWNER, stamp: "aaaa",
      held: { "shop-settings": { data: { modules: ["pos"] }, at: Date.now() - 60_000, under: "aaaa" } },
    } });
    modules = ["pos", "delivery"];

    const { result } = renderHook(() => useShopSettings(), { wrapper });
    // First paint: the kept answer, and nothing asked.
    expect((result.current.data as unknown as { modules: string[] }).modules).toEqual(["pos"]);
    await aMoment();
    expect(settingsAsked, "the reload asked before anything said there was a reason to").not.toHaveBeenCalled();

    // The screen's own first request comes back, stamped.
    act(() => heardShellStamp("bbbb"));

    await waitFor(() => expect((result.current.data as unknown as { modules: string[] }).modules).toEqual(["pos", "delivery"]));
    expect(settingsAsked).toHaveBeenCalledTimes(1);
  });

  it("asks at once on the NEXT load too, when the asking that followed a change did not get through", async () => {
    // The stamp moved to bbbb, the refetch failed (the line dropped), and the
    // page was reloaded. What is kept was heard under aaaa.
    useKeptStore.setState({ record: {
      owner: OWNER, stamp: "bbbb",
      held: { "shop-settings": { data: { modules: ["pos"] }, at: Date.now() - 10_000, under: "aaaa" } },
    } });
    modules = ["pos", "delivery"];

    const { result } = renderHook(() => useShopSettings(), { wrapper });
    expect((result.current.data as unknown as { modules: string[] }).modules, "the kept answer was thrown away instead of shown").toEqual(["pos"]);

    await waitFor(() => expect((result.current.data as unknown as { modules: string[] }).modules).toEqual(["pos", "delivery"]));
    expect(settingsAsked).toHaveBeenCalledTimes(1);
  });

  it("does the same for who-am-I", async () => {
    useKeptStore.setState({ record: { owner: OWNER, stamp: "bbbb", held: {} } });
    useAuthStore.setState({ userAt: Date.now() - 10_000, userUnder: "aaaa" });
    modules = ["pos", "delivery"];

    renderHook(() => useMe(), { wrapper });

    await waitFor(() => expect(meAsked).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useAuthStore.getState().userUnder).toBe("bbbb"));
  });

  it("trusts an answer kept before stamps existed for as long as its age allows", async () => {
    useKeptStore.setState({ record: {
      owner: OWNER, stamp: "bbbb",
      held: { "shop-settings": { data: { modules: ["pos"] }, at: Date.now() - 10_000 } },
    } });

    renderHook(() => useShopSettings(), { wrapper });
    await aMoment();

    expect(settingsAsked, "an answer with no stamp was treated as changed — every load would ask").not.toHaveBeenCalled();
  });
});

describe("where it is heard", () => {
  const answering = (stamp: string | undefined, status = 200) => {
    api.defaults.adapter = async (config) => {
      const response = { data: envelope(null), status, statusText: "", headers: stamp === undefined ? {} : { "x-shell-stamp": stamp }, config };
      if (status >= 400) {
        const { AxiosError } = await import("axios");
        const refused = new AxiosError("refused", "ERR_BAD_REQUEST", config as never);
        refused.response = response as never;
        throw refused;
      }

      return response as never;
    };
  };

  it("on any answer the server gives — a read", async () => {
    answering("aaaa");

    await apiGet("/products");

    expect(stampNow()).toBe("aaaa");
  });

  it("on a write", async () => {
    answering("aaaa");

    await apiPut("/products/7", { name: "Kurta" });

    expect(stampNow()).toBe("aaaa");
  });

  it("on a refusal — the server said no, and still said where it stands", async () => {
    answering("aaaa", 422);

    await expect(apiPut("/products/7", {})).rejects.toThrow();

    expect(stampNow()).toBe("aaaa");
  });

  it("and an answer without one changes nothing", async () => {
    answering("aaaa");
    await apiGet("/products");
    answering(undefined);

    await apiGet("/products");

    expect(stampNow()).toBe("aaaa");
  });
});
