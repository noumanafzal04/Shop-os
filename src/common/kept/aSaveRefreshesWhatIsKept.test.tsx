import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as client from "../api/client";
import { useAuthStore } from "../../stores/authStore";
import { ME_TRUSTED_FOR, useLogout, useMe } from "../../modules/auth/hooks/useAuth";
import { authService } from "../../modules/auth/services/authService";
import { useBranchMutations, useBranches } from "../../modules/branches/hooks/useBranches";
import { branchService, type Branch } from "../../modules/branches/services/branchService";
import { useNotificationActions, useNotifications } from "../../modules/notifications/hooks/useNotifications";
import { useShopSettings, useUpdateShopSettings } from "../../modules/shop/hooks/useShop";
import { shopService, type ShopSettings } from "../../modules/shop/services/shopService";
import { heldFor } from "./kept";
import { useKeptStore } from "./keptStore";

/**
 * ADD, CHANGE, REMOVE — and what is kept on the device follows.
 *
 * The shell's answers are kept between loads so that opening a screen asks
 * nothing (`kept.ts`). The danger in that is the obvious one: something is
 * saved, the screen refreshes, and the DEVICE goes on holding the answer from
 * before — so the next load opens with the old shop name, the branch that was
 * deleted, the notification that was read.
 *
 * So each of the four kept answers is walked through its own saves here, with
 * the real hooks, and three things are checked every time:
 *
 *   the server was asked again           (a save is news)
 *   the device holds the NEW answer      (not only the screen)
 *   the next load opens with it, asking nothing
 *
 * The owner asked for exactly this: "add, remove, update par store invalidate
 * hota hai ya nahi".
 */

const OWNER = "t1:u1";
let queries: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queries}>{children}</QueryClientProvider>;
const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });
const kept = (name: string) => heldFor(useKeptStore.getState().record, OWNER, name)?.data;
const aMoment = () => act(async () => { await new Promise((turn) => setTimeout(turn, 60)); });
/** A reload: everything in memory is gone, and the device is the same device. */
const reload = () => {
  queries.clear();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
};

beforeEach(() => {
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useKeptStore.setState({ record: null });
  useAuthStore.setState({
    user: { id: "u1", role: "shop_owner", permissions: [], tenant: { id: "t1", name: "Rahat Garments" } } as never,
    userAt: null,
    isAuthenticated: true,
  });
});

afterEach(() => {
  queries.clear();
  vi.restoreAllMocks();
});

describe("the shop's settings", () => {
  const settings = (over: Partial<ShopSettings>) => ({ default_tax_rate: 0, invoice_header: "Thank you", ...over }) as ShopSettings;
  let onServer: ShopSettings;
  let asked: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    onServer = settings({});
    asked = vi.spyOn(shopService, "settings").mockImplementation(async () => envelope(onServer));
    vi.spyOn(shopService, "updateSettings").mockImplementation(async (patch) => {
      onServer = { ...onServer, ...patch };

      return envelope(onServer);
    });
    vi.spyOn(authService, "me").mockResolvedValue(envelope(useAuthStore.getState().user) as never);
  });

  const useScreen = () => ({ settings: useShopSettings(), save: useUpdateShopSettings() });

  it("is asked for once, then a reload opens with it and asks nothing", async () => {
    const first = renderHook(useScreen, { wrapper });
    await waitFor(() => expect(first.result.current.settings.data?.invoice_header).toBe("Thank you"));
    expect(asked).toHaveBeenCalledTimes(1);
    first.unmount();

    reload();
    const again = renderHook(useScreen, { wrapper });
    expect(again.result.current.settings.data?.invoice_header, "the reload did not open with the kept settings").toBe("Thank you");
    await aMoment();

    expect(asked, "a reload asked for settings the device already had").toHaveBeenCalledTimes(1);
  });

  it("a save asks again, and the device holds what was saved", async () => {
    const { result } = renderHook(useScreen, { wrapper });
    await waitFor(() => expect(result.current.settings.data).toBeDefined());

    await act(async () => { await result.current.save.mutateAsync({ invoice_header: "Shukriya" }); });

    await waitFor(() => expect(result.current.settings.data?.invoice_header).toBe("Shukriya"));
    expect(asked, "saving the settings did not ask for them again").toHaveBeenCalledTimes(2);
    expect((kept("shop-settings") as ShopSettings).invoice_header, "the screen was refreshed and the device still holds the old header").toBe("Shukriya");
  });

  it("so the load after a save opens with what was saved", async () => {
    const first = renderHook(useScreen, { wrapper });
    await waitFor(() => expect(first.result.current.settings.data).toBeDefined());
    await act(async () => { await first.result.current.save.mutateAsync({ invoice_header: "Shukriya" }); });
    await waitFor(() => expect(first.result.current.settings.data?.invoice_header).toBe("Shukriya"));
    first.unmount();

    reload();
    asked.mockClear();
    const again = renderHook(useScreen, { wrapper });

    expect(again.result.current.settings.data?.invoice_header).toBe("Shukriya");
    await aMoment();
    expect(asked).not.toHaveBeenCalled();
  });

  it("is never asked for by somebody who is not in a shop", async () => {
    act(() => useAuthStore.setState({ user: { id: "a1", role: "super_admin", permissions: [], tenant: null } as never }));

    renderHook(() => useShopSettings(), { wrapper });
    await aMoment();

    expect(asked).not.toHaveBeenCalled();
  });
});

describe("the branches the header offers", () => {
  const place = (id: string, name: string): Branch => ({ id, name, kind: "shop", is_default: id === "b1", is_active: true } as Branch);
  let onServer: Branch[];
  let asked: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    onServer = [place("b1", "Main Shop")];
    asked = vi.spyOn(branchService, "list").mockImplementation(async () => envelope([...onServer]));
    vi.spyOn(branchService, "create").mockImplementation(async (input) => {
      const made = place(`b${onServer.length + 1}`, input.name);
      onServer = [...onServer, made];

      return envelope(made);
    });
    vi.spyOn(branchService, "update").mockImplementation(async (id, input) => {
      onServer = onServer.map((b) => (b.id === id ? { ...b, ...input } as Branch : b));

      return envelope(onServer.find((b) => b.id === id) as Branch);
    });
    vi.spyOn(branchService, "remove").mockImplementation(async (id) => {
      onServer = onServer.filter((b) => b.id !== id);

      return envelope(null);
    });
    // A branch changing also refreshes the shop's settings — the menu reads
    // how many places are open from there.
    vi.spyOn(shopService, "settings").mockResolvedValue(envelope({} as ShopSettings));
  });

  const useScreen = () => ({ list: useBranches(), change: useBranchMutations() });
  const names = (list: Branch[] | undefined) => (list ?? []).map((b) => b.name);
  const keptNames = () => names(kept("branches") as Branch[] | undefined);

  it("is asked for once, then a reload opens with it and asks nothing", async () => {
    const first = renderHook(useScreen, { wrapper });
    await waitFor(() => expect(names(first.result.current.list.data)).toEqual(["Main Shop"]));
    first.unmount();

    reload();
    const again = renderHook(useScreen, { wrapper });
    expect(names(again.result.current.list.data)).toEqual(["Main Shop"]);
    await aMoment();

    expect(asked, "a reload asked for branches the device already had").toHaveBeenCalledTimes(1);
  });

  it("ADD — the new branch is on the screen and on the device", async () => {
    const { result } = renderHook(useScreen, { wrapper });
    await waitFor(() => expect(result.current.list.data).toBeDefined());

    await act(async () => { await result.current.change.create.mutateAsync({ name: "Gulberg Outlet" }); });

    await waitFor(() => expect(names(result.current.list.data)).toEqual(["Main Shop", "Gulberg Outlet"]));
    expect(asked).toHaveBeenCalledTimes(2);
    expect(keptNames(), "the new branch is on the screen and not in what the device keeps").toEqual(["Main Shop", "Gulberg Outlet"]);
  });

  it("CHANGE — the new name replaces the old one on the device", async () => {
    const { result } = renderHook(useScreen, { wrapper });
    await waitFor(() => expect(result.current.list.data).toBeDefined());

    await act(async () => { await result.current.change.update.mutateAsync({ id: "b1", name: "Head Office" }); });

    await waitFor(() => expect(names(result.current.list.data)).toEqual(["Head Office"]));
    expect(keptNames(), "the device still calls the branch by its old name").toEqual(["Head Office"]);
  });

  it("REMOVE — a branch that was closed is gone from the device too", async () => {
    onServer = [place("b1", "Main Shop"), place("b2", "Gulberg Outlet")];
    const { result } = renderHook(useScreen, { wrapper });
    await waitFor(() => expect(names(result.current.list.data)).toHaveLength(2));

    await act(async () => { await result.current.change.remove.mutateAsync({ id: "b2" }); });

    await waitFor(() => expect(names(result.current.list.data)).toEqual(["Main Shop"]));
    expect(keptNames(), "a deleted branch is still offered from the device's copy").toEqual(["Main Shop"]);
  });

  it("and the load after each of them opens with the list as it now is", async () => {
    const first = renderHook(useScreen, { wrapper });
    await waitFor(() => expect(first.result.current.list.data).toBeDefined());
    await act(async () => { await first.result.current.change.create.mutateAsync({ name: "Gulberg Outlet" }); });
    await act(async () => { await first.result.current.change.update.mutateAsync({ id: "b1", name: "Head Office" }); });
    await act(async () => { await first.result.current.change.remove.mutateAsync({ id: "b2" }); });
    await waitFor(() => expect(names(first.result.current.list.data)).toEqual(["Head Office"]));
    first.unmount();

    reload();
    asked.mockClear();
    const again = renderHook(useScreen, { wrapper });

    expect(names(again.result.current.list.data), "the reload opened with a list from before the changes").toEqual(["Head Office"]);
    await aMoment();
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("the bell", () => {
  type Said = { id: string; type: string; read_at: string | null };
  let onServer: Said[];
  let asked: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onServer = [{ id: "n2", type: "order.placed", read_at: null }, { id: "n1", type: "stock.low", read_at: null }];
    asked = vi.fn();
    vi.spyOn(client, "apiGet").mockImplementation((async (url: string, config?: { params?: { page?: number } }) => {
      if (url !== "/notifications") throw new Error(`unexpected GET ${url}`);
      asked(config?.params?.page);

      return envelope(onServer.map((n) => ({ ...n })));
    }) as never);
    vi.spyOn(client, "apiPost").mockImplementation((async (url: string) => {
      if (url === "/notifications/read-all") onServer = onServer.map((n) => ({ ...n, read_at: "now" }));
      else onServer = onServer.map((n) => (url === `/notifications/${n.id}/read` ? { ...n, read_at: "now" } : n));

      return envelope(null);
    }) as never);
  });

  const useBell = (page = 1) => ({ bell: useNotifications(page), act: useNotificationActions() });
  const unread = (list: { data: Said[] } | undefined) => (list?.data ?? []).filter((n) => n.read_at === null).map((n) => n.id);
  const keptUnread = () => unread(kept("notifications") as { data: Said[] } | undefined);

  it("is asked for once, then a reload inside half a minute opens with it and asks nothing", async () => {
    const first = renderHook(() => useBell(), { wrapper });
    await waitFor(() => expect(unread(first.result.current.bell.data as never)).toEqual(["n2", "n1"]));
    first.unmount();

    reload();
    const again = renderHook(() => useBell(), { wrapper });
    expect(unread(again.result.current.bell.data as never)).toEqual(["n2", "n1"]);
    await aMoment();

    expect(asked, "a reload asked the bell again a moment after it had answered").toHaveBeenCalledTimes(1);
  });

  it("reading ONE asks again, and the device no longer counts it unread", async () => {
    const { result } = renderHook(() => useBell(), { wrapper });
    await waitFor(() => expect(result.current.bell.data).toBeDefined());

    await act(async () => { await result.current.act.markRead.mutateAsync("n2"); });

    await waitFor(() => expect(unread(result.current.bell.data as never)).toEqual(["n1"]));
    expect(asked).toHaveBeenCalledTimes(2);
    expect(keptUnread(), "a notification that was read would come back unread on the next load").toEqual(["n1"]);
  });

  it("reading ALL asks again, and the device holds none unread", async () => {
    const { result } = renderHook(() => useBell(), { wrapper });
    await waitFor(() => expect(result.current.bell.data).toBeDefined());

    await act(async () => { await result.current.act.markAllRead.mutateAsync(); });

    await waitFor(() => expect(unread(result.current.bell.data as never)).toEqual([]));
    expect(keptUnread()).toEqual([]);
  });

  it("keeps the first page only — an older page is read and left", async () => {
    const { result } = renderHook(() => useBell(2), { wrapper });
    await waitFor(() => expect(result.current.bell.data).toBeDefined());

    expect(asked).toHaveBeenCalledWith(2);
    expect(useKeptStore.getState().record, "an older page of the bell was written to the device").toBeNull();
  });

  it("does not open page two with page one's kept answer", async () => {
    const first = renderHook(() => useBell(1), { wrapper });
    await waitFor(() => expect(first.result.current.bell.data).toBeDefined());
    first.unmount();
    reload();

    const second = renderHook(() => useBell(2), { wrapper });

    expect(second.result.current.bell.data).toBeUndefined();
  });
});

describe("signing out", () => {
  it("leaves nothing of this person's on the device", async () => {
    vi.spyOn(authService, "logout").mockResolvedValue(envelope(null) as never);
    useKeptStore.getState().keep(OWNER, "shop-settings", { invoice_header: "Thank you" }, Date.now());
    useKeptStore.getState().keep(OWNER, "notifications", { data: [{ id: "n1" }] }, Date.now());
    const routed = ({ children }: { children: ReactNode }) => <MemoryRouter>{wrapper({ children })}</MemoryRouter>;
    const { result } = renderHook(() => useLogout(), { wrapper: routed });

    await act(async () => { await result.current.mutateAsync(); });

    expect(useKeptStore.getState().record, "a signed-out shop's settings and bell were left on a shared device").toBeNull();
    expect(JSON.parse(localStorage.getItem("shopos-kept") ?? "{}").state.record).toBeNull();
  });

  it("does so even when the server could not be told", async () => {
    vi.spyOn(authService, "logout").mockRejectedValue(new Error("Network Error"));
    useKeptStore.getState().keep(OWNER, "shop-settings", { invoice_header: "Thank you" }, Date.now());
    const routed = ({ children }: { children: ReactNode }) => <MemoryRouter>{wrapper({ children })}</MemoryRouter>;
    const { result } = renderHook(() => useLogout(), { wrapper: routed });

    await act(async () => { await result.current.mutateAsync().catch(() => {}); });

    expect(useKeptStore.getState().record).toBeNull();
  });
});

describe("who I am", () => {
  const person = (name: string) => ({ id: "u1", name, role: "shop_owner", permissions: [], tenant: { id: "t1", name: "Rahat Garments" } });
  let asked: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    asked = vi.spyOn(authService, "me").mockResolvedValue(envelope(person("Ayesha (from the server)")) as never);
  });

  it("is not asked straight after signing in — the answer came with the token", async () => {
    act(() => useAuthStore.getState().setAuth(person("Ayesha") as never, "access", "refresh"));

    renderHook(() => useMe(), { wrapper });
    await aMoment();

    expect(asked, "who-am-I was asked a second after the sign-in answered it").not.toHaveBeenCalled();
  });

  it("is not asked on a reload inside five minutes of the last answer", async () => {
    act(() => useAuthStore.setState({ user: person("Ayesha") as never, userAt: Date.now() - 60_000 }));

    renderHook(() => useMe(), { wrapper });
    await aMoment();

    expect(asked).not.toHaveBeenCalled();
  });

  it("is asked once that answer is older, and the new one is stamped", async () => {
    act(() => useAuthStore.setState({ user: person("Ayesha") as never, userAt: Date.now() - ME_TRUSTED_FOR - 1_000 }));

    renderHook(() => useMe(), { wrapper });

    await waitFor(() => expect(useAuthStore.getState().user?.name).toBe("Ayesha (from the server)"));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(Date.now() - (useAuthStore.getState().userAt ?? 0)).toBeLessThan(5_000);
  });

  it("is asked when the session was kept before its age was — an older install", async () => {
    act(() => useAuthStore.setState({ user: person("Ayesha") as never, userAt: null }));

    renderHook(() => useMe(), { wrapper });

    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
  });

  it("is asked when its age is in the future — the clock was put back", async () => {
    act(() => useAuthStore.setState({ user: person("Ayesha") as never, userAt: Date.now() + 86_400_000 }));

    renderHook(() => useMe(), { wrapper });

    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
  });

  it("a screen patching its own copy is not the server saying so", () => {
    act(() => useAuthStore.setState({ user: person("Ayesha") as never, userAt: 1000 }));

    act(() => useAuthStore.getState().setUser(person("Ayesha Khan") as never));

    expect(useAuthStore.getState().user?.name).toBe("Ayesha Khan");
    expect(useAuthStore.getState().userAt, "a local patch made an old answer look fresh").toBe(1000);
  });

  it("saving the shop's settings asks who-I-am again — the menu reads the shop from there", async () => {
    act(() => useAuthStore.getState().setAuth(person("Ayesha") as never, "access", "refresh"));
    vi.spyOn(shopService, "settings").mockResolvedValue(envelope({} as ShopSettings));
    vi.spyOn(shopService, "updateSettings").mockResolvedValue(envelope({} as ShopSettings));
    const { result } = renderHook(() => ({ me: useMe(), save: useUpdateShopSettings() }), { wrapper });
    await aMoment();
    expect(asked).not.toHaveBeenCalled();

    await act(async () => { await result.current.save.mutateAsync({}); });

    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useAuthStore.getState().user?.name).toBe("Ayesha (from the server)"));
  });

  it("signing out forgets the age with the person", () => {
    act(() => useAuthStore.getState().setAuth(person("Ayesha") as never, "access", "refresh"));

    act(() => useAuthStore.getState().clear());

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().userAt).toBeNull();
  });
});
