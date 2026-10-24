import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { applyTenantTheme, DEFAULT_SIDEBAR } from "../../../common/theme/tenantTheme";
import { recallTenantTheme, rememberTenantTheme } from "../../../common/theme/rememberedTheme";
import { useAuthStore } from "../../../stores/authStore";
import { shopService, type SetupPayload, type ShopSettings } from "../services/shopService";
import { currencyOf, formatIn, type CurrencyFormat } from "../../../common/format/currency";
import {
  DEFAULT_DATE_FORMAT, dateFormatOf, dateIn, dateTimeIn, setShopDateFormat, shopDateFormat, shopDateFormatIsRemembered, shortDateIn, shortDateTimeIn, timeOf, typedDayIn,
  type DateFormatCode, type Datish,
} from "../../../common/format/date";
import { setShopDayRule } from "../../../common/shopDay";
import { useKeptQuery } from "../../../common/kept/useKeptQuery";

/**
 * What this shop has. Read-only — modules are the admin's decision, and this is
 * the answer to "why can I not see Purchases", not a way to change it.
 */
export function useShopModules() {
  return useQuery({
    queryKey: ["shop", "modules"],
    queryFn: () => shopService.modules().then((r) => r.data),
    // It changes when an admin changes it, which is rare and never mid-session.
    staleTime: 5 * 60_000,
  });
}

export function useShopSettings() {
  // /shop/settings is owner/staff-only — don't fire it for admins or customers
  // (it would 403). Other roles just get the default formatting.
  const role = useAuthStore((s) => s.user?.role);
  const isShop = role === "shop_owner" || role === "staff";
  // KEPT ON THE DEVICE (common/kept): every shop screen reads this, so it was
  // asked for on every load. A screen opening within five minutes of the last
  // answer now asks nothing; a save here still refreshes it at once.
  const query = useKeptQuery<ShopSettings>("shop-settings", {
    queryKey: ["shop-settings"],
    queryFn: async () => (await shopService.settings()).data,
    staleTime: 5 * 60 * 1000,
    enabled: isShop,
  });

  // WHICH DAY IT IS HERE. The shop's settings say when its day turns; every
  // "Today" in the panel is worked out from that (common/shopDay.ts). Told
  // from the one hook every shop screen already reads, so no screen has to
  // remember to — and taken away again for anybody who is not in a shop.
  const zone = query.data?.shop_day?.zone ?? null;
  const turnsAt = query.data?.shop_day?.turns_at_minutes ?? null;
  useEffect(() => {
    if (!isShop) setShopDayRule(null);
    else if (zone !== null && turnsAt !== null) setShopDayRule({ zone, turnsAtMinutes: turnsAt });
  }, [isShop, zone, turnsAt]);

  // HOW A DATE IS WRITTEN HERE — told the same way, from the same hook, for the
  // same reason (common/format/date.ts). Nobody's shop forgets it.
  const dates = query.data ? dateFormatOf(query.data.date_format) : null;
  useEffect(() => {
    if (!isShop) setShopDateFormat(null);
    else if (dates !== null) setShopDateFormat(dates);
  }, [isShop, dates]);

  return query;
}

/**
 * Paints the tenant's chosen brand colours onto the document as soon as their
 * settings arrive, and repaints whenever they change it. Re-declaring Tailwind's
 * --color-brand-* variables re-skins the entire panel — light and dark alike —
 * so this hook is the only wiring theming needs. An unset colour restores the
 * True Serve default, which is also what non-shop roles get.
 */
export function useTenantTheme() {
  const settings = useShopSettings();
  const tenantId = useAuthStore((s) => s.user?.tenant?.id ?? null);
  const loaded = settings.data !== undefined;
  const primary = settings.data?.theme_primary ?? null;
  const secondary = settings.data?.theme_secondary ?? null;
  const tint = settings.data?.theme_tint ?? "subtle";
  const sidebar = settings.data?.theme_sidebar ?? DEFAULT_SIDEBAR;

  useEffect(() => {
    // UNTIL THE SETTINGS ARRIVE, the page keeps what this device remembers.
    //
    // This effect used to run with `data` still undefined, which read as "no
    // colour chosen" and painted the house blue — every reload, for as long
    // as the request took — and then painted the shop's own when it landed.
    // See rememberedTheme.ts.
    if (!loaded) {
      const kept = recallTenantTheme(tenantId);
      if (kept) applyTenantTheme(kept);

      return;
    }

    const theme = { primary, secondary, tint, sidebar };
    applyTenantTheme(theme);
    rememberTenantTheme(tenantId, theme);
  }, [loaded, tenantId, primary, secondary, tint, sidebar]);

  // Leaving the shop's screens takes its colours off. The platform console
  // and the front page are not this shop's to dress.
  useEffect(() => () => applyTenantTheme({}), []);
}

/**
 * The currencies a shop may choose, and whether it still may.
 *
 * Asked by the settings screen alone — "has this business begun to trade?"
 * looks at the books, and is not a question for every page. Kept under the
 * settings key, so saving a new currency asks again.
 */
export function useShopCurrencies(enabled: boolean = true) {
  return useQuery({
    queryKey: ["shop-settings", "currencies"],
    queryFn: async () => (await shopService.currencies()).data,
    enabled,
  });
}

/**
 * The shop's currency as the server describes it — its mark, where its commas
 * go, whether a whole amount carries ".00". The default (rupees) until the
 * settings have loaded.
 */
export function useCurrency(): CurrencyFormat {
  const settings = useShopSettings();

  return currencyOf(settings.data?.currency_format);
}

/**
 * `money(n)` — an amount written in THIS SHOP's money: "Rs 4,000",
 * "₹12,34,567", "$4,000.00". Use it everywhere a shop's own figure is shown.
 *
 * It was bound to a symbol only, so every currency was written by the rupee's
 * rules and the browser's commas. The format comes from the server now, with
 * the shop's settings.
 */
export function useMoney() {
  const currency = useCurrency();

  return (n: string | number | null | undefined, places?: number) => formatIn(currency, n, places);
}

/**
 * How this shop writes a date. Until its settings have loaded it is what this
 * device remembers of it — so a reload does not write one frame in the default
 * and the next in the shop's own — and for nobody's shop it is the default.
 */
export function useDateFormat(): DateFormatCode {
  const settings = useShopSettings();
  const role = useAuthStore((s) => s.user?.role);

  if (settings.data) return dateFormatOf(settings.data.date_format);

  return role === "shop_owner" || role === "staff" ? shopDateFormat() : DEFAULT_DATE_FORMAT;
}

/**
 * Is it KNOWN yet how this shop writes a date?
 *
 * It is known once its settings have answered, or when this device remembers
 * it from the last visit, or when there is no shop to ask (the console). On
 * the very first visit of a device it is not — for the fraction of a second
 * the settings take — and a page drawn then would be drawn in the default and
 * drawn again a moment later, with whatever had been pressed in between
 * thrown away.
 *
 * It does not wait for ever: a settings request that fails, or cannot be made
 * because the line is down, leaves the default, which is a date nobody can
 * misread.
 */
export function useDateFormatIsKnown(): boolean {
  const settings = useShopSettings();
  const role = useAuthStore((s) => s.user?.role);
  const [waitedLongEnough, setWaited] = useState(false);
  const isShop = role === "shop_owner" || role === "staff";
  const answered = settings.data !== undefined || settings.isError || settings.fetchStatus === "paused";
  const known = !isShop || answered || shopDateFormatIsRemembered();

  useEffect(() => {
    if (known) return;
    const giveUp = setTimeout(() => setWaited(true), 2_000);

    return () => clearTimeout(giveUp);
  }, [known]);

  return known || waitedLongEnough;
}

/**
 * Dates and times written THIS SHOP's way — `dates.date(sale.created_at)`,
 * `dates.dateTime(…)`, `dates.shortDate(…)`. Use it wherever a shop's own
 * screen shows when something happened; never `toLocaleDateString()`, which is
 * the browser's opinion of how a date is written and differs from one laptop
 * to the next. (The console uses `platformDate`.)
 */
export function useDates() {
  const code = useDateFormat();

  return useMemo(() => ({
    code,
    /** "12 Oct 2026" */
    date: (value: Datish) => dateIn(code, value),
    /** "12 Oct" — where the year goes without saying. */
    shortDate: (value: Datish) => shortDateIn(code, value),
    /** "12 Oct 2026, 5:14 PM" */
    dateTime: (value: Datish) => dateTimeIn(code, value),
    /** "12 Oct, 5:14 PM" */
    shortDateTime: (value: Datish) => shortDateTimeIn(code, value),
    /** "5:14 PM" */
    time: (value: Datish) => timeOf(value),
    /** What somebody typed, as a day — or null. */
    typed: (text: string) => typedDayIn(code, text),
  }), [code]);
}

export function useUpdateShopSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<ShopSettings>) => shopService.updateSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shop-settings"] });
      // Refresh the persisted session too — the sidebar/shell reads
      // tenant info from the auth store, not shop-settings, so it would
      // otherwise stay stale until the next full load.
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

export function useGallery() {
  return useQuery({
    queryKey: ["shop-gallery"],
    queryFn: async () => (await shopService.gallery()).data,
  });
}

export function useGalleryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["shop-gallery"] });
  const upload = useMutation({ mutationFn: (files: File[]) => shopService.uploadGallery(files), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => shopService.deleteGalleryImage(id), onSuccess: invalidate });
  return { upload, remove };
}

export function useBusinessTypes() {
  return useQuery({
    queryKey: ["business-types"],
    queryFn: async () => (await shopService.businessTypes()).data,
    staleTime: 30 * 60 * 1000, // static catalog
  });
}

export function useSubscription() {
  return useQuery({
    queryKey: ["shop", "subscription"],
    queryFn: async () => (await shopService.subscription()).data,
  });
}

export function useCompleteSetup() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore.getState();

  return useMutation({
    mutationFn: (payload: SetupPayload) => shopService.setup(payload),
    onSuccess: ({ data: tenant }) => {
      // Keep the cached user's tenant in sync so the setup gate opens.
      if (user) setUser({ ...user, tenant });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      navigate("/tenant", { replace: true });
    },
  });
}
