import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { useShopSettings } from "./useShop";
import { shopService, type ShopSettings } from "../services/shopService";
import { useAuthStore } from "../../../stores/authStore";
import { setShopDayRule, shopToday } from "../../../common/shopDay";

/**
 * WHO TELLS THE PANEL WHICH DAY IT IS.
 *
 * `common/shopDay.ts` can work out the shop's day, but only once it has been
 * told the shop's rule — and a rule nobody delivers is the "switch with
 * nothing behind it" this codebase keeps finding. The shop's settings carry
 * it, and the one hook every shop screen already reads hands it over.
 *
 * Asked the only way that matters: what does "today" come out as.
 */

// One in the morning on the 7th in Karachi.
const ONE_AM = new Date("2026-10-07T01:00:00+05:00");
// Half past five on the 7th in Karachi — 00:30 on the 7th in UTC. A shop that
// turns at SIX is still on the 6th, and a device on EITHER clock says the 7th,
// so the first test proves the rule arrived on the Mac and on the CI runner
// alike. (Karachi turning at five is the UTC date exactly — on a UTC device
// "before the rule" and "after it" agree, and the test would prove nothing.)
const HALF_FIVE = new Date("2026-10-07T05:30:00+05:00");

const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });
const settings = (turnsAt: number | undefined) =>
  envelope({
    currency_symbol: "Rs",
    ...(turnsAt === undefined
      ? {}
      : { shop_day: { zone: "Asia/Karachi", turns_at_minutes: turnsAt, chosen_hour: null, today: "x" } }),
  } as ShopSettings);

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

  return renderHook(() => useShopSettings(), { wrapper });
}

const signIn = (role: string) =>
  useAuthStore.setState({ user: { id: "u1", role, permissions: [], tenant: { id: "shop-a" } } } as never);

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  setShopDayRule(null);
  signIn("shop_owner");
});

afterEach(() => setShopDayRule(null));

describe("the shop's settings say when its day turns", () => {
  it("makes the small hours last night, for a shop that turns at six", async () => {
    vi.spyOn(shopService, "settings").mockResolvedValue(settings(360));
    expect(shopToday(HALF_FIVE)).not.toBe("2026-10-06");

    mount();

    await waitFor(() => expect(shopToday(HALF_FIVE)).toBe("2026-10-06"));
  });

  it("follows the shop when it chooses midnight", async () => {
    setShopDayRule({ zone: "Asia/Karachi", turnsAtMinutes: 300 });   // what this device remembered
    vi.spyOn(shopService, "settings").mockResolvedValue(settings(0));

    mount();

    await waitFor(() => expect(shopToday(ONE_AM)).toBe("2026-10-07"));
  });

  it("keeps what the device remembers while the answer is on its way", async () => {
    setShopDayRule({ zone: "Asia/Karachi", turnsAtMinutes: 300 });
    vi.spyOn(shopService, "settings").mockReturnValue(new Promise(() => {}));

    mount();
    await new Promise((r) => setTimeout(r, 30));

    expect(shopToday(ONE_AM)).toBe("2026-10-06");
  });

  it("keeps it too when an older server sends no rule at all", async () => {
    setShopDayRule({ zone: "Asia/Karachi", turnsAtMinutes: 300 });
    const asked = vi.spyOn(shopService, "settings").mockResolvedValue(settings(undefined));

    const { result } = mount();
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(asked).toHaveBeenCalled();
    expect(shopToday(ONE_AM)).toBe("2026-10-06");
  });
});

describe("somebody who is not in a shop", () => {
  it("is given the device's own date, not the last shop's day", async () => {
    setShopDayRule({ zone: "Asia/Karachi", turnsAtMinutes: 300 });   // left behind by a shop's session
    const asked = vi.spyOn(shopService, "settings").mockResolvedValue(settings(300));
    signIn("super_admin");
    const device = new Date(2026, 9, 7, 1, 0);

    mount();

    await waitFor(() => expect(shopToday(device)).toBe("2026-10-07"));
    expect(localStorage.getItem("shopos-day")).toBeNull();
    // And the shop-only request is never made for them.
    expect(asked).not.toHaveBeenCalled();
  });
});
