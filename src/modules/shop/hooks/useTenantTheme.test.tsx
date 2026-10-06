import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { useTenantTheme } from "./useShop";
import { shopService, type ShopSettings } from "../services/shopService";
import { useAuthStore } from "../../../stores/authStore";
import { applyTenantTheme, buildRamp } from "../../../common/theme/tenantTheme";
import { recallTenantTheme, rememberTenantTheme } from "../../../common/theme/rememberedTheme";

/**
 * WHILE THE SHOP'S SETTINGS ARE STILL ON THEIR WAY.
 *
 * `bootTheme` puts the remembered colours on the page before React starts.
 * This hook used to take them straight back off: it ran with the settings
 * still undefined, read that as "no colour chosen", and painted the house
 * blue until the request landed. So the boot step alone fixes nothing — what
 * is held here is that the hook LEAVES the page alone until it has an answer.
 */

const GREEN = "#16a34a";
const RED = "#e11d48";
const brand = () => document.documentElement.style.getPropertyValue("--color-brand-500");

const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });
const settings = (over: Partial<ShopSettings>) => envelope({ currency_symbol: "Rs", ...over } as ShopSettings);

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

  return renderHook(() => useTenantTheme(), { wrapper });
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  applyTenantTheme({});
  useAuthStore.setState({
    user: { id: "u1", role: "shop_owner", permissions: [], tenant: { id: "shop-a" } },
  } as never);
});

describe("until the settings arrive", () => {
  it("keeps the colours this device remembers", async () => {
    rememberTenantTheme("shop-a", { primary: GREEN, sidebar: "primary" });
    applyTenantTheme({ primary: GREEN, sidebar: "primary" });   // what bootTheme did
    // A request that never answers: the slow line, held open.
    vi.spyOn(shopService, "settings").mockReturnValue(new Promise(() => {}));

    mount();
    // Give an effect that WOULD strip the colours every chance to run.
    await new Promise((r) => setTimeout(r, 30));

    expect(brand()).toBe(buildRamp(GREEN)[500]);
    expect(document.documentElement.dataset.sidebar).toBe("primary");
  });

  it("puts them on even when nothing did at boot — signing in without a reload", async () => {
    rememberTenantTheme("shop-a", { primary: GREEN });
    vi.spyOn(shopService, "settings").mockReturnValue(new Promise(() => {}));
    expect(brand()).toBe("");

    mount();

    await waitFor(() => expect(brand()).toBe(buildRamp(GREEN)[500]));
  });

  it("does not borrow another shop's", async () => {
    rememberTenantTheme("shop-b", { primary: GREEN });
    vi.spyOn(shopService, "settings").mockReturnValue(new Promise(() => {}));

    mount();
    await new Promise((r) => setTimeout(r, 30));

    expect(brand()).toBe("");
  });
});

describe("once they arrive", () => {
  it("follows the answer, and remembers it for next time", async () => {
    // The owner changed the colour on another machine since this one last looked.
    rememberTenantTheme("shop-a", { primary: GREEN });
    vi.spyOn(shopService, "settings").mockResolvedValue(settings({ theme_primary: RED, theme_sidebar: "dark" }));

    mount();

    await waitFor(() => expect(brand()).toBe(buildRamp(RED)[500]));
    expect(recallTenantTheme("shop-a")).toMatchObject({ primary: RED, sidebar: "dark" });
  });

  it("a shop that chose no colour goes back to the house look, and that is remembered too", async () => {
    rememberTenantTheme("shop-a", { primary: GREEN });
    applyTenantTheme({ primary: GREEN });
    vi.spyOn(shopService, "settings").mockResolvedValue(settings({ theme_primary: null }));

    mount();

    await waitFor(() => expect(brand()).toBe(""));
    expect(recallTenantTheme("shop-a")).toMatchObject({ primary: null });
  });
});

describe("leaving the shop's screens", () => {
  it("takes the shop's colours off the page", async () => {
    vi.spyOn(shopService, "settings").mockResolvedValue(settings({ theme_primary: GREEN }));
    const { unmount } = mount();
    await waitFor(() => expect(brand()).toBe(buildRamp(GREEN)[500]));

    unmount();

    // The platform console and the front page are not this shop's to dress.
    expect(brand()).toBe("");
  });
});
