import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import MapPicker from "../../../components/maps/MapPicker";
import { useToast } from "../../../components/ui/toast";
import { FilterTabs } from "../../../components/ui/tabs/FilterTabs";
import { ApiError } from "../../../common/types/api";
import { apiGet, apiPut } from "../../../common/api/client";
import { useCities, useShopSettings, useUpdateShopSettings } from "../hooks/useShop";
import { settingsTabsFor, type SettingsTab } from "../settingsTabs";
import { shopService } from "../services/shopService";
import { useAuthStore } from "../../../stores/authStore";
import { usePrimaryBusinessType } from "../../../common/tenant/businessType";
import type { Tenant } from "../../auth/types";
import HardwareDevices from "../../hardware/components/HardwareDevices";
import RegistersPanel from "../../registers/components/RegistersPanel";
import TaxGroupsManager from "../../catalog/components/TaxGroupsManager";
import { ReceiptPreview } from "../../receipts/components/ReceiptPreview";
import TillPinsPanel from "../../pos/components/TillPinsPanel";
import DeviceSessionsPanel from "../../auth/components/DeviceSessionsPanel";
import TillDevicesPanel from "../../offline/device/TillDevicesPanel";
import PricingVariancesPanel from "../../offline/pricing/PricingVariancesPanel";

/** One saved shop preference. Arrays exist because kitchen stations are a list. */
type PrefValue = string | number | boolean | string[] | null;

// ── Section icons (inline line-SVGs, currentColor) ───────────────────────
const g = "h-[18px] w-[18px]";
const StoreGlyph = () => (<svg viewBox="0 0 24 24" fill="none" className={g}><path d="M4 9V6l2-3h12l2 3v3M4 9v11h16V9M4 9h16M9 20v-6h6v6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>);
const PinGlyph = () => (<svg viewBox="0 0 24 24" fill="none" className={g}><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.7" /></svg>);
const GlobeGlyph = () => (<svg viewBox="0 0 24 24" fill="none" className={g}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" stroke="currentColor" strokeWidth="1.7" /></svg>);
const PercentGlyph = () => (<svg viewBox="0 0 24 24" fill="none" className={g}><path d="M6 18 18 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="7.5" cy="7.5" r="2.2" stroke="currentColor" strokeWidth="1.7" /><circle cx="16.5" cy="16.5" r="2.2" stroke="currentColor" strokeWidth="1.7" /></svg>);
const TruckGlyph = () => (<svg viewBox="0 0 24 24" fill="none" className={g}><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><circle cx="7" cy="18" r="1.8" stroke="currentColor" strokeWidth="1.7" /><circle cx="17" cy="18" r="1.8" stroke="currentColor" strokeWidth="1.7" /></svg>);
const ReceiptGlyph = () => (<svg viewBox="0 0 24 24" fill="none" className={g}><path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M9 8h6M9 12h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>);
const CartGlyph = () => (<svg viewBox="0 0 24 24" fill="none" className={g}><path d="M3 4h2l2.2 11h10l1.8-8H6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><circle cx="9" cy="19" r="1.6" stroke="currentColor" strokeWidth="1.7" /><circle cx="17" cy="19" r="1.6" stroke="currentColor" strokeWidth="1.7" /></svg>);
const BarcodeGlyph = () => (<svg viewBox="0 0 24 24" fill="none" className={g}><path d="M4 5v14M8 5v14M11 5v14M14 5v10M17 5v14M20 5v14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>);
const ScaleGlyph = () => (<svg viewBox="0 0 24 24" fill="none" className={g}><path d="M12 4v16M6 20h12M5 8h14l-2.5 6h-9L5 8ZM9 4h6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>);
const PrinterGlyph = () => (<svg viewBox="0 0 24 24" fill="none" className={g}><path d="M6 9V3h12v6M6 18H4v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6h-2M6 14h12v7H6z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>);
const UserGlyph = () => (<svg viewBox="0 0 24 24" fill="none" className={g}><circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.7" /><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>);
const GiftGlyph = () => (<svg viewBox="0 0 24 24" fill="none" className={g}><path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7S10.5 3 8.5 3 6 5 8 7h4Zm0 0s1.5-4 3.5-4 2.5 2 .5 4h-4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>);

/**
 * The tab order and the module each one needs live in `../settingsTabs` so they
 * can be tested without mounting this screen. Only the icons stay here.
 */
const TAB_ICONS: Record<SettingsTab, ReactNode> = {
  business: <StoreGlyph />,
  tax: <PercentGlyph />,
  pos: <CartGlyph />,
  loyalty: <GiftGlyph />,
  receipt: <ReceiptGlyph />,
  hardware: <PrinterGlyph />,
  barcode: <BarcodeGlyph />,
};

/**
 * The till carries more settings than the rest of the shop put together, so it
 * gets a second row of its own. Lanes and PINs share one: on a counter with
 * more than one person behind it, they are what you actually came here to set
 * up, and they were previously eight cards down a single scroll.
 */
const POS_SUBTABS = [
  { key: "till", label: "Counter" },
  { key: "registers", label: "Lanes & PINs" },
  { key: "selling", label: "Quotes & advances" },
  { key: "kitchen", label: "Kitchen", needs: "dine_in" },
] as const;
type PosSubTab = (typeof POS_SUBTABS)[number]["key"];

function SectionCard({ icon, title, description, children, badge }: {
  icon: ReactNode; title: string; description?: string; children: ReactNode; badge?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <header className="mb-5 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-500/10 dark:text-brand-400">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-800 dark:text-white/90">{title}</h3>
            {badge}
          </div>
          {description && <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">{description}</p>}
        </div>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Unit({ side, children }: { side: "left" | "right"; children: ReactNode }) {
  return (
    <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-theme-sm text-gray-500 dark:text-gray-400 ${side === "left" ? "left-3.5" : "right-3.5"}`}>
      {children}
    </span>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && !error && <p className="mt-1 text-theme-xs text-gray-400">{hint}</p>}
      {error && <p className="mt-1 text-theme-xs text-error-500">{error}</p>}
    </div>
  );
}

/**
 * A switch that explains itself.
 *
 * Four paragraphs at the foot of a card is where settings copy goes to be
 * unread — you finish the sentence and have to go back up to find which switch
 * it was about. The sentence belongs to the switch. Laid out as a bordered row
 * so a column of them reads as a list rather than as text that wrapped.
 */
function ToggleRow({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-xl border border-gray-200 p-3.5 text-left transition hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700"
    >
      <span className={`mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition ${checked ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-700"}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition ${checked ? "translate-x-4" : ""}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-theme-sm font-medium text-gray-800 dark:text-white/90">{label}</span>
        {hint && <span className="mt-0.5 block text-theme-xs leading-relaxed text-gray-500 dark:text-gray-400">{hint}</span>}
      </span>
    </button>
  );
}

/**
 * Settings in two columns.
 *
 * Every tab used to be one 3xl-wide stack down the middle of a wide screen,
 * which put Point of Sale at roughly four screens of scrolling with the save
 * button at the bottom of it — and nobody scrolls that far to discover a card
 * exists. Cards are dealt into a column by hand rather than flowed, because a
 * tall one (Registers, Quotations) has to be balanced against short ones, and
 * CSS columns would happily split a card across the fold.
 */
function TwoCol({ left, right }: { left: ReactNode; right: ReactNode }) {
  // A trade-gated card can leave the second column empty — a shop that doesn't
  // sell tyres has no stock-ageing card. Half a screen of nothing beside one
  // card is worse than one honest column, so it collapses.
  if (!right) return <div className="flex max-w-3xl flex-col gap-5">{left}</div>;
  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
      <div className="flex flex-col gap-5">{left}</div>
      <div className="flex flex-col gap-5">{right}</div>
    </div>
  );
}

/**
 * The save action, pinned to the foot of the page.
 *
 * A settings page you can scroll past the button on is a settings page people
 * lose edits in. It also answers the question the old footer couldn't: whether
 * there is anything to lose. `dirty` is set by the editing itself, not by
 * comparing against the server — the server hands back "5.00" for a 5 you
 * typed, and a page that calls that a change never stops saying "unsaved".
 */
function SaveBar({ dirty, saving, onSave, label = "Save changes", blocked }: {
  dirty: boolean; saving: boolean; onSave: () => void; label?: string; blocked?: boolean;
}) {
  return (
    <div className="sticky bottom-0 z-30 -mx-4 mt-1 border-t border-gray-200 bg-white/90 px-4 py-3 backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/90 md:-mx-6 md:px-6">
      <div className="flex items-center gap-3">
        <span className={`flex items-center gap-2 text-theme-xs ${dirty ? "font-medium text-warning-600 dark:text-warning-400" : "text-gray-400"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${dirty ? "bg-warning-500" : "bg-success-500"}`} />
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <Button className="ml-auto" size="sm" onClick={onSave} disabled={saving || blocked || !dirty}>
          {saving ? "Saving…" : label}
        </Button>
      </div>
    </div>
  );
}

export default function ShopSettingsPage() {
  const queryClient = useQueryClient();
  const cities = useCities();
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);
  const trade = usePrimaryBusinessType();

  // Every save on this page reports through the same toast. A settings page is
  // one where nothing visibly happens when it works — the field you edited still
  // reads what you typed — so the confirmation has to come from somewhere.
  const toast = useToast();
  const failed = (fallback: string) => (e: unknown) =>
    toast.error(e instanceof ApiError ? e.firstFieldError() ?? e.message : fallback);

  const shop = useQuery({
    queryKey: ["shop", "profile"],
    queryFn: async () => (await apiGet<Tenant>("/shop")).data,
  });

  // ── Profile (PUT /shop) ──────────────────────────────────────────────
  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiPut<Tenant>("/shop", payload),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ["shop"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (user) setUser({ ...user, tenant: data });
      toast.success("Shop profile saved.");
    },
    onError: failed("Couldn't save your profile."),
  });
  const [form, setForm] = useState({
    business_name: "", city_id: "", phone: "", address: "", delivery_fee: "0", latitude: "", longitude: "",
  });
  const [profileDirty, setProfileDirty] = useState(false);
  const set = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setProfileDirty(true); };

  // ── The shop's mark, as printed on its invoices ──────────────────────
  const logoRef = useRef<HTMLInputElement>(null);
  const uploadLogo = useMutation({
    mutationFn: (file: File) => shopService.uploadLogo(file),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ["shop"] });
      if (user) setUser({ ...user, tenant: data });
      toast.success("Logo updated — it prints on your next invoice.");
    },
    onError: failed("Couldn't upload that logo."),
  });

  useEffect(() => {
    if (shop.data) {
      const s = shop.data;
      const anyS = s as unknown as { delivery_fee?: string; latitude?: string | number; longitude?: string | number };
      setForm({
        business_name: s.business_name ?? "",
        city_id: s.city?.id ?? "",
        phone: s.phone ?? "",
        address: s.address ?? "",
        delivery_fee: String(anyS.delivery_fee ?? "0"),
        latitude: anyS.latitude != null ? String(anyS.latitude) : "",
        longitude: anyS.longitude != null ? String(anyS.longitude) : "",
      });
      // Arrives on load and again after a save refetch — either way the form
      // now holds exactly what the server holds, so nothing is outstanding.
      setProfileDirty(false);
    }
  }, [shop.data]);

  const apiError = save.error instanceof ApiError ? save.error : null;
  const errorFor = (k: string) => apiError?.errors[k]?.[0];

  const submitProfile = () => {
    if (save.isPending) return;
    save.mutate({
      business_name: form.business_name.trim(),
      city_id: form.city_id || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      delivery_fee: Number(form.delivery_fee) || 0,
      latitude: form.latitude !== "" ? Number(form.latitude) : null,
      longitude: form.longitude !== "" ? Number(form.longitude) : null,
    });
  };

  // ── Preferences (PUT /shop/settings) ─────────────────────────────────
  const settings = useShopSettings();
  const updatePrefs = useUpdateShopSettings();
  const [prefs, setPrefs] = useState<Record<string, PrefValue> | null>(null);
  const [prefsDirty, setPrefsDirty] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("business");
  const [posTab, setPosTab] = useState<PosSubTab>("till");

  // Which modules this shop actually has. A sub-tab gated on one it lacks is
  // never offered — and if the module is switched off while you are standing on
  // that sub-tab, the view falls back rather than going blank.
  const tenantFeatures = ((user?.tenant as { features?: Record<string, boolean> } | null | undefined)?.features ?? {}) as Record<string, boolean>;
  const settingsTabs = settingsTabsFor(tenantFeatures).map((t) => ({ key: t.key, label: t.label, icon: TAB_ICONS[t.key] }));
  // Business is universal, so there is always something to fall back TO.
  const activeTab = settingsTabs.some((t) => t.key === tab) ? tab : "business";
  const posSubTabs = POS_SUBTABS.filter((t) => !("needs" in t) || tenantFeatures[t.needs]);
  const activePosTab = posSubTabs.some((t) => t.key === posTab) ? posTab : "till";
  useEffect(() => { if (settings.data && !prefs) setPrefs({ ...settings.data }); }, [settings.data, prefs]);
  const setP = (k: string, v: PrefValue) => { setPrefs((f) => ({ ...f!, [k]: v })); setPrefsDirty(true); };

  // Appearance (brand colour, sidebar, tint) lives in the floating Appearance
  // canvas, reachable from every screen — not here. One home per concern.
  const savePrefs = () =>
    prefs &&
    updatePrefs.mutate(prefs as never, {
      onSuccess: () => { setPrefsDirty(false); toast.success("Settings saved."); },
      onError: failed("Couldn't save your settings."),
    });

  const online = shop.data?.online_shop_enabled;
  const cityOptions = [{ value: "", label: "— Select city —" }, ...(cities.data ?? []).map((c) => ({ value: c.id, label: c.name }))];

  // Every preferences tab edits the one `prefs` object and shares this bar —
  // saving from any tab persists all preferences (no cross-tab data loss), which
  // is also why an edit made on one tab still shows as unsaved on the next.
  const prefsFooter = (
    <SaveBar
      dirty={prefsDirty}
      saving={updatePrefs.isPending}
      onSave={savePrefs}
      label="Save preferences"
    />
  );

  return (
    <>
      <PageMeta title="Settings | ShopOS" description="Shop settings" />
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Settings</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Manage your shop profile, location and how the app works for you.</p>
      </div>

      {/* Topics. The underline treatment is reserved for the second level of
          tabs inside Point of Sale — two levels of navigation on one screen
          must not read as the same control. */}
      <FilterTabs tabs={settingsTabs} value={activeTab} onChange={setTab} sticky className="mb-5" />

      {/* Full width, two columns. The old single 3xl stack wasted half of a
          desktop and paid for it in scrolling. */}
      <div>
        {shop.isLoading ? (
          <div className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
        ) : activeTab === "business" ? (
          <div className="space-y-5">

            <TwoCol
              left={
                <>
                  <SectionCard icon={<StoreGlyph />} title="Business profile" description="Your shop's name and contact — shown on invoices and your storefront.">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Business name" error={errorFor("business_name")}>
                        <Input value={form.business_name} onChange={(e) => set("business_name", e.target.value)} />
                      </Field>
                      <Field label="Phone" error={errorFor("phone")}>
                        <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="03xx-xxxxxxx" />
                      </Field>
                    </div>
                  </SectionCard>

                  <SectionCard icon={<GlobeGlyph />} title="Online shop" description="Your customer-facing storefront." badge={<Badge size="sm" color={online ? "success" : "light"}>{online ? "Enabled" : "Off"}</Badge>}>
                    {online ? (
                      <Field label="Delivery fee (Rs)" hint="Charged on delivery orders. Set 0 for free delivery / pickup-only." error={errorFor("delivery_fee")}>
                        <Input type="number" min="0" value={form.delivery_fee} onChange={(e) => set("delivery_fee", e.target.value)} className="max-w-xs" />
                      </Field>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400">Your plan is Expense Manager only. Contact the platform admin to enable online selling.</p>
                    )}
                  </SectionCard>
                </>
              }
              right={
                <SectionCard icon={<PinGlyph />} title="Location" description="Search or drop a pin — sets your city and powers delivery + “shops near me”.">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="City" error={errorFor("city_id")}>
                      <Select value={form.city_id} options={cityOptions} placeholder="— Select city —" onChange={(v) => set("city_id", v)} />
                    </Field>
                    <Field label="Address">
                      <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Shop street address" />
                    </Field>
                  </div>
                  <MapPicker
                    value={form.latitude !== "" && form.longitude !== "" ? { lat: Number(form.latitude), lng: Number(form.longitude) } : null}
                    onChange={({ lat, lng, place }) => {
                      set("latitude", String(lat));
                      set("longitude", String(lng));
                      if (place?.formatted && !form.address) set("address", place.formatted);
                      if (place?.city) {
                        const name = place.city.toLowerCase();
                        const match = (cities.data ?? []).find((c) => c.name.toLowerCase() === name || name.includes(c.name.toLowerCase()));
                        if (match) set("city_id", match.id);
                      }
                    }}
                  />
                  {form.latitude && form.longitude && (
                    <p className="text-theme-xs text-success-600 dark:text-success-400">
                      Pinned at {Number(form.latitude).toFixed(5)}, {Number(form.longitude).toFixed(5)}
                    </p>
                  )}
                </SectionCard>
              }
            />

            <SaveBar
              dirty={profileDirty}
              saving={save.isPending}
              onSave={submitProfile}
              label="Save profile"
              blocked={!form.business_name.trim()}
            />
          </div>
        ) : settings.isLoading || !prefs ? (
          <div className="h-96 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
        ) : (
          <div className="space-y-6">

            {activeTab === "tax" && (
              <>
              <TwoCol
                left={
                  <>
                    <SectionCard icon={<PercentGlyph />} title="Tax" description="Default tax applied at checkout when a product has no rate of its own.">
                      <Field label="Default tax %" hint="Set 0 for tax-exempt shops.">
                        <Input type="number" min="0" max="100" className="max-w-xs" value={String(prefs.default_tax_rate)} onChange={(e) => setP("default_tax_rate", Number(e.target.value))} />
                      </Field>
                      <ToggleRow
                        checked={!!prefs.tax_inclusive}
                        onChange={(v) => setP("tax_inclusive", v)}
                        label="Prices already include tax"
                        hint={prefs.tax_inclusive
                          ? "Inclusive: the price is the final price — the receipt shows the tax portion held within it."
                          : "Exclusive: tax is added on top of the price at checkout."}
                      />
                    </SectionCard>

                    <SectionCard icon={<TruckGlyph />} title="Order fulfillment" description="How customers get their orders. They only see the options you enable.">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <ToggleRow checked={!!prefs.pickup_enabled} onChange={(v) => setP("pickup_enabled", v)} label="Pickup" hint="The customer collects from your counter." />
                        <ToggleRow checked={!!prefs.delivery_enabled} onChange={(v) => setP("delivery_enabled", v)} label="Delivery" hint="You take it to them, within the limits set below." />
                      </div>
                      {!prefs.pickup_enabled && !prefs.delivery_enabled && (
                        <p className="text-theme-xs font-medium text-error-500">At least one option must stay on — with both off, nobody can order.</p>
                      )}
                      <Field label="Service area (service businesses)">
                        <Input value={String(prefs.service_area ?? "")} onChange={(e) => setP("service_area", e.target.value)} placeholder="e.g. We serve Gulberg, DHA, Model Town" />
                      </Field>
                      {!!prefs.delivery_enabled && (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <Field label="Delivery radius (km)" hint="Orders beyond this distance are rejected.">
                            <Input type="number" min="0.5" step={0.5} value={prefs.delivery_radius_km != null ? String(prefs.delivery_radius_km) : ""} onChange={(e) => setP("delivery_radius_km", e.target.value === "" ? null : Number(e.target.value))} placeholder="No limit" />
                          </Field>
                          <Field label="Prep time (min)" hint="Estimated preparation time shown to customers.">
                            <Input type="number" min="1" max="480" value={prefs.prep_time_minutes != null ? String(prefs.prep_time_minutes) : ""} onChange={(e) => setP("prep_time_minutes", e.target.value === "" ? null : Number(e.target.value))} placeholder="e.g. 25" />
                          </Field>
                          <Field label="Minimum order (Rs)" hint="Delivery orders below this are rejected.">
                            <Input type="number" min="0" value={prefs.min_order_amount != null ? String(prefs.min_order_amount) : ""} onChange={(e) => setP("min_order_amount", e.target.value === "" ? null : Number(e.target.value))} placeholder="No minimum" />
                          </Field>
                          <Field label="Free delivery above (Rs)" hint="Waive the delivery fee at/above this subtotal.">
                            <Input type="number" min="0" value={prefs.free_delivery_threshold != null ? String(prefs.free_delivery_threshold) : ""} onChange={(e) => setP("free_delivery_threshold", e.target.value === "" ? null : Number(e.target.value))} placeholder="Never" />
                          </Field>
                        </div>
                      )}
                    </SectionCard>
                  </>
                }
                right={<TaxGroupsManager />}
              />
              {prefsFooter}
              </>
            )}

            {/* The receipt is the only thing that leaves the shop, so it is
                edited beside the thing itself — the preview is the real
                template, server-rendered, not a mock-up of it. */}
            {activeTab === "receipt" && (
              <>
              <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
                <div className="flex flex-col gap-5">
                  <SectionCard icon={<ReceiptGlyph />} title="Invoice / receipt" description="What prints on your sales receipts.">
                    <Field label="Invoice header line" hint="An extra line under your shop name.">
                      <Input value={String(prefs.invoice_header ?? "")} onChange={(e) => setP("invoice_header", e.target.value)} placeholder="e.g. Wholesale &amp; retail since 1998" />
                    </Field>
                    <Field label="Invoice footer">
                      <Input value={String(prefs.invoice_footer ?? "")} onChange={(e) => setP("invoice_footer", e.target.value)} placeholder="e.g. Thank you for shopping!" />
                    </Field>
                    <Field label="Receipt size" hint="Thermal sizes print a narrow roll; Standard is a filed A4/Letter invoice with a signature line.">
                      <Select
                        className="max-w-xs"
                        value={String(prefs.receipt_width ?? "standard")}
                        options={[{ value: "standard", label: "Standard (A4/Letter)" }, { value: "thermal_80", label: "Thermal 80mm" }, { value: "thermal_58", label: "Thermal 58mm" }]}
                        placeholder="Standard"
                        onChange={(v) => setP("receipt_width", v)}
                      />
                    </Field>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <ToggleRow checked={!!prefs.invoice_show_logo} onChange={(v) => setP("invoice_show_logo", v)} label="Show logo" hint="Prints your mark at the top of the paper." />
                      <ToggleRow checked={!!prefs.receipt_show_cashier} onChange={(v) => setP("receipt_show_cashier", v)} label="Show who served" hint="Names the cashier who rang the sale." />
                    </div>

                    {/* The logo itself. "Show logo" was a live toggle with
                        nothing behind it — switch it on, print nothing, and no
                        screen anywhere to say why. */}
                    {!!prefs.invoice_show_logo && (
                      <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                        <input
                          ref={logoRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) uploadLogo.mutate(file);
                            e.currentTarget.value = "";
                          }}
                        />
                        {shop.data?.logo_url ? (
                          <img
                            src={shop.data.logo_url}
                            alt="Shop logo"
                            className="h-14 w-14 rounded-lg border border-gray-200 object-contain dark:border-gray-700"
                          />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-gray-300 text-theme-xs text-gray-400 dark:border-gray-700">
                            None
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                            {shop.data?.logo_url ? "Your invoice logo" : "No logo uploaded yet"}
                          </p>
                          <p className="text-theme-xs text-gray-400">
                            {shop.data?.logo_url
                              ? "PNG, JPG or WebP. It prints at the top of every invoice."
                              : "Nothing will print at the top of your invoices until you add one."}
                          </p>
                          {uploadLogo.isError && (
                            <p className="mt-1 text-theme-xs text-error-500">
                              {uploadLogo.error instanceof ApiError ? uploadLogo.error.message : "Upload failed"}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={uploadLogo.isPending}
                          onClick={() => logoRef.current?.click()}
                        >
                          {uploadLogo.isPending ? "Uploading…" : shop.data?.logo_url ? "Replace" : "Upload logo"}
                        </Button>
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard icon={<PercentGlyph />} title="Tax identifiers" description="Printed on the receipt when you're registered. Leave blank if you're not — nothing prints.">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="NTN" hint="National Tax Number.">
                        <Input value={String(prefs.invoice_ntn ?? "")} onChange={(e) => setP("invoice_ntn", e.target.value)} placeholder="e.g. 1234567-8" />
                      </Field>
                      <Field label="STRN" hint="Sales Tax Registration Number.">
                        <Input value={String(prefs.invoice_strn ?? "")} onChange={(e) => setP("invoice_strn", e.target.value)} placeholder="e.g. 03-04-8765-432-11" />
                      </Field>
                    </div>
                    <Field label="FBR POS ID" hint="Your FBR POS registration, if you're a Tier-1 retailer. ShopOS prints it — it does not transmit invoices to FBR.">
                      <Input className="max-w-xs" value={String(prefs.invoice_fbr_pos_id ?? "")} onChange={(e) => setP("invoice_fbr_pos_id", e.target.value)} placeholder="e.g. 556677" />
                    </Field>
                  </SectionCard>
                </div>

                {/* The paper stays in view while the form beside it is edited —
                    that is the whole point of previewing the real template. */}
                <div className="lg:sticky lg:top-36">
                  <ReceiptPreview settings={prefs} />
                </div>
              </div>
              {prefsFooter}
              </>
            )}

            {activeTab === "hardware" && (
              <SectionCard icon={<PrinterGlyph />} title="Hardware" description="Your shop's receipt printer, label printer, barcode scanner, and cash drawer.">
                <HardwareDevices />
              </SectionCard>
            )}

            {activeTab === "pos" && (
              <>
              <div className="mb-1 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
                {posSubTabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setPosTab(t.key)}
                    className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-theme-sm font-medium transition ${activePosTab === t.key ? "border-brand-500 text-brand-500" : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {activePosTab === "till" && (
                <TwoCol
                  left={
                    <SectionCard icon={<CartGlyph />} title="Point of sale" description="Defaults for the counter till.">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Default payment">
                          <Select value={String(prefs.pos_default_payment)} options={[{ value: "cash", label: "Cash" }, { value: "card", label: "Card" }]} placeholder="Cash" onChange={(v) => setP("pos_default_payment", v)} />
                        </Field>
                        <Field label="Lock the till when idle" hint="The next sale is stamped with whoever unlocks it.">
                          <Select
                            value={String(prefs.pos_idle_lock_minutes ?? 0)}
                            options={[
                              { value: "0", label: "Never" },
                              { value: "3", label: "After 3 minutes" },
                              { value: "5", label: "After 5 minutes" },
                              { value: "10", label: "After 10 minutes" },
                              { value: "30", label: "After 30 minutes" },
                            ]}
                            placeholder="Never"
                            onChange={(v) => setP("pos_idle_lock_minutes", Number(v))}
                          />
                        </Field>
                        <Field
                          label="Round cash bills to"
                          hint="Cash only — a card or khata bill always settles to the exact figure. A bill of Rs 1,238.15 has no exact cash tender, and a tie is rounded in the customer's favour."
                        >
                          <Select
                            value={String(prefs.cash_rounding ?? 0)}
                            options={[
                              { value: "0", label: "Nothing — exact to the paisa" },
                              { value: "1", label: "Nearest Rs 1" },
                              { value: "5", label: "Nearest Rs 5" },
                              { value: "10", label: "Nearest Rs 10" },
                            ]}
                            placeholder="Nothing — exact to the paisa"
                            onChange={(v) => setP("cash_rounding", Number(v))}
                          />
                        </Field>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <ToggleRow
                          checked={!!prefs.pos_require_shift}
                          onChange={(v) => setP("pos_require_shift", v)}
                          label="Require open shift"
                          hint="Refuses a counter sale unless the cashier has a drawer open, so every rupee belongs to a shift that gets counted. Recommended once you have staff."
                        />
                        <ToggleRow
                          checked={!!prefs.pos_auto_print}
                          onChange={(v) => setP("pos_auto_print", v)}
                          label="Auto-print receipt"
                          hint="Sends the receipt to the printer the moment a sale is paid, without asking."
                        />
                        <ToggleRow
                          checked={!!prefs.pos_ask_who_served}
                          onChange={(v) => setP("pos_ask_who_served", v)}
                          label="Ask who served the customer"
                          hint="For a shop where the salesman and the counter are different people. The till adds a 'Served by' box, and Reports → Staff then shows who SOLD each sale as well as who rang it. Leave it off if one person does both — that is most shops."
                        />
                        <ToggleRow
                          checked={!!prefs.pos_drawer_kick}
                          onChange={(v) => setP("pos_drawer_kick", v)}
                          label="Open drawer on cash"
                          hint="Only works where the drawer — or the printer it plugs into — is wired over a direct connection. Set that up under Hardware."
                        />
                        <ToggleRow
                          checked={prefs.pos_denomination_count !== false}
                          onChange={(v) => setP("pos_denomination_count", v)}
                          label="Count by note & coin"
                          hint="Adds the closing total up from the drawer itself, so a second person can re-check it."
                        />
                        <ToggleRow
                          checked={!!prefs.pos_blind_close}
                          onChange={(v) => setP("pos_blind_close", v)}
                          label="Blind close"
                          hint="Hides expected cash until the count is submitted — a till that says it expects 47,320 tends to get a count of 47,320. Turn it on the day someone else counts your drawer."
                        />
                        <ToggleRow
                          checked={!!prefs.pos_declare_tenders}
                          onChange={(v) => setP("pos_declare_tenders", v)}
                          label="Declare card totals"
                          hint="Asks for the card machine's own total at close, so a mis-keyed tender is caught the same day."
                        />
                      </div>
                    </SectionCard>
                  }
                  right={
                    <>
                      {/* The ceiling the `discounts.override` permission exists to
                          guard. The server has enforced this since day one — there was
                          simply no way to set the number, so it sat at null and the
                          permission guarded nothing. */}
                      <SectionCard
                        icon={<PercentGlyph />}
                        title="Discount limits"
                        description="How much a cashier may take off without asking. Anyone holding “Override discount limit” can go past it; everyone else is stopped at the till."
                      >
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <Field label="Most they can discount" hint="As a share of the bill. Empty = no limit.">
                            <div className="relative">
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                className="pr-9"
                                value={prefs.max_discount_percent == null ? "" : String(prefs.max_discount_percent)}
                                onChange={(e) => setP("max_discount_percent", e.target.value === "" ? null : Number(e.target.value))}
                                placeholder="No limit"
                              />
                              <Unit side="right">%</Unit>
                            </div>
                          </Field>
                          <Field label="Or at most" hint="A cash ceiling, whatever the percentage works out to. Empty = no limit.">
                            <div className="relative">
                              <Input
                                type="number"
                                min="0"
                                className="pl-11"
                                value={prefs.max_discount_amount == null ? "" : String(prefs.max_discount_amount)}
                                onChange={(e) => setP("max_discount_amount", e.target.value === "" ? null : Number(e.target.value))}
                                placeholder="No limit"
                              />
                              <Unit side="left">{String(prefs.currency_symbol ?? "Rs")}</Unit>
                            </div>
                          </Field>
                        </div>
                        <p className="text-theme-xs text-gray-400">
                          Set both and whichever is hit first stops the sale. Leave both empty and any cashier can discount
                          anything — which is the setting most shops discover they had after the fact.
                        </p>
                      </SectionCard>

                      {/* Tips are not a restaurant feature. A salon, a workshop and a
                          delivery service all take them, and burying this in the
                          Kitchen card meant a shop without dine-in could never turn
                          them on at all. */}
                      <SectionCard icon={<GiftGlyph />} title="Tips" description="Not a restaurant feature — a salon, a workshop and a delivery service all take them.">
                        <ToggleRow
                          checked={!!prefs.tips_enabled}
                          onChange={(v) => setP("tips_enabled", v)}
                          label="Ask for a tip at checkout"
                          hint="The money is the staff’s. It never counts as a sale, and it is shown separately on the drawer count."
                        />
                      </SectionCard>
                    </>
                  }
                />
              )}

              {activePosTab === "registers" && (
                <TwoCol
                  left={
                    /* Lanes live with the till, not with hardware: a register is an
                        operating position, and the printer bound to it comes after. */
                    <SectionCard icon={<CartGlyph />} title="Registers" description="Your checkout lanes. One counter needs none — add a lane each for a busy mart, and each drawer reconciles on its own.">
                      <RegistersPanel />
                    </SectionCard>
                  }
                  right={
                    <>
                      <SectionCard icon={<UserGlyph />} title="Till PINs" description="A short PIN lets someone take the till in a second, so sales, voids and drawers belong to whoever actually made them. A PIN only works at a till already signed in — never to log in.">
                        <TillPinsPanel />
                      </SectionCard>

                      <SectionCard
                        icon={<UserGlyph />}
                        title="Signed-in devices"
                        description="Every browser and tablet currently signed in to your account. Lost one, or lent it out and never got it back? Sign that one out without throwing every working till off mid-queue."
                      >
                        <DeviceSessionsPanel />
                      </SectionCard>

                      {/* A SESSION is who is signed in; a TILL is the machine
                          itself, which keeps its identity across sign-outs and
                          cashier handovers. Both belong here, and the two
                          answer different questions — "whose login is on that
                          tablet" and "when did that tablet last reach us". */}
                      <SectionCard
                        icon={<CartGlyph />}
                        title="Your tills"
                        description="The devices this shop's POS runs on, and when each last reached us. Signing one out stops it being used without touching the sales it already sent."
                      >
                        <TillDevicesPanel />
                      </SectionCard>

                      {/* Sits with the tills because it is a fact ABOUT them:
                          whether this shop's own devices have been proved able
                          to price without the server. */}
                      <SectionCard
                        icon={<CartGlyph />}
                        title="Offline pricing checks"
                        description="Every sale is priced a second time by the offline engine and the two answers compared. Customers always pay the server's price — this is the evidence being gathered before a till is allowed to price on its own."
                      >
                        <PricingVariancesPanel />
                      </SectionCard>
                    </>
                  }
                />
              )}

              {activePosTab === "selling" && (
                <TwoCol
                  left={
                    /* The two promises made before a sale exists. They live with the
                        till because that is where both are written and both are
                        settled — a quote is priced at the counter, and an advance is
                        cash in the counter's drawer. */
                    <SectionCard
                      icon={<ReceiptGlyph />}
                      title="Quotations & advances"
                      description="Prices you put in writing, and goods you hold until they're paid for."
                    >
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <ToggleRow
                          checked={prefs.quotations_enabled !== false}
                          onChange={(v) => setP("quotations_enabled", v)}
                          label="Write quotations"
                          hint="A price put in writing before there is a sale."
                        />
                        <ToggleRow
                          checked={prefs.layaway_enabled !== false}
                          onChange={(v) => setP("layaway_enabled", v)}
                          label="Hold goods on advance"
                          hint="Goods come off the floor and wait until they're paid for."
                        />
                      </div>

                      {prefs.quotations_enabled !== false && (
                        <>
                          <Field
                            label="Quotation valid for"
                            hint="Long enough for the customer to shop around, short enough that a supplier price rise doesn't land on you. 0 = no expiry."
                          >
                            <div className="relative">
                              <Input
                                type="number"
                                className="pr-14"
                                value={String(prefs.quotation_valid_days ?? 15)}
                                onChange={(e) => setP("quotation_valid_days", Number(e.target.value))}
                              />
                              <Unit side="right">days</Unit>
                            </div>
                          </Field>
                          <Field
                            label="Printed terms"
                            hint="Goes at the foot of every quotation — delivery time, warranty, whether fitting is included."
                          >
                            <textarea
                              rows={3}
                              className="dark:bg-dark-900 h-auto w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30"
                              value={(prefs.quotation_terms as string) ?? ""}
                              onChange={(e) => setP("quotation_terms", e.target.value)}
                              placeholder={"Prices valid for the period shown.\nDelivery within 3 working days."}
                            />
                          </Field>
                        </>
                      )}

                      {prefs.layaway_enabled !== false && (
                        <>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field
                              label="Minimum advance"
                              hint="Rs 100 against a Rs 90,000 fridge takes it off your floor for weeks and costs the customer nothing to walk away from. 20% is usual. 0 = any amount."
                            >
                              <div className="relative">
                                <Input
                                  type="number"
                                  className="pr-9"
                                  value={String(prefs.layaway_min_deposit_percent ?? 20)}
                                  onChange={(e) => setP("layaway_min_deposit_percent", Number(e.target.value))}
                                />
                                <Unit side="right">%</Unit>
                              </div>
                            </Field>
                            <Field
                              label="Collect within"
                              hint="Before a booking shows as overdue. Nothing is voided — it's the list worth phoning down."
                            >
                              <div className="relative">
                                <Input
                                  type="number"
                                  className="pr-14"
                                  value={String(prefs.layaway_days ?? 30)}
                                  onChange={(e) => setP("layaway_days", Number(e.target.value))}
                                />
                                <Unit side="right">days</Unit>
                              </div>
                            </Field>
                            <Field
                              label="Usual cancellation fee"
                              hint="Fills in the fee box when a booking is cancelled — a starting figure, not a rule. Whoever cancels can change or waive it. 0 = suggest nothing."
                            >
                              <div className="relative">
                                <Input
                                  type="number"
                                  min="0"
                                  max="100"
                                  className="pr-9"
                                  value={String(prefs.layaway_cancellation_fee_percent ?? 0)}
                                  onChange={(e) => setP("layaway_cancellation_fee_percent", Number(e.target.value))}
                                />
                                <Unit side="right">%</Unit>
                              </div>
                            </Field>
                          </div>
                          <p className="text-theme-xs text-gray-400">
                            Cancelling always puts the goods back on your shelf, and the advance goes back in full unless
                            a fee is kept — nothing is deducted from a customer's money without someone choosing it.
                          </p>
                        </>
                      )}
                    </SectionCard>
                  }
                  right={
                    /* Stock that ages rather than expires. A tyre is not unsafe on a
                        date stamped by a supplier — it is unsafe after so many years
                        from its DOT week, which is why this is a span and not an
                        expiry. BatchController has read these since it shipped;
                        there was no way to set them. */
                    trade === "automotive" && (
                      <SectionCard
                        icon={<BarcodeGlyph />}
                        title="Stock ageing"
                        description="When goods dated by manufacture — tyres above all — start counting as old. Nothing is blocked from sale; the counter is told, and the decision stays with whoever is standing there."
                      >
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <Field label="Flag as ageing after" hint="Years from the DOT week.">
                            <div className="relative">
                              <Input
                                type="number"
                                min="1"
                                max="30"
                                className="pr-12"
                                value={String(prefs.stock_age_warn_years ?? 5)}
                                onChange={(e) => setP("stock_age_warn_years", Number(e.target.value))}
                              />
                              <Unit side="right">yrs</Unit>
                            </div>
                          </Field>
                          <Field label="Flag as old after" hint="The stronger warning. Keep it above the first.">
                            <div className="relative">
                              <Input
                                type="number"
                                min="1"
                                max="30"
                                className="pr-12"
                                value={String(prefs.stock_age_old_years ?? 6)}
                                onChange={(e) => setP("stock_age_old_years", Number(e.target.value))}
                              />
                              <Unit side="right">yrs</Unit>
                            </div>
                          </Field>
                        </div>
                      </SectionCard>
                    )
                  }
                />
              )}

              {/* Only offered to a shop that seats people — POS_SUBTABS gates it. */}
              {activePosTab === "kitchen" && (
                <div className="max-w-3xl">
                    <SectionCard icon={<ReceiptGlyph />} title="Kitchen" description="Where fired orders go, and whether they print.">
                      <Field
                        label="Stations"
                        hint="One line each — Kitchen, Bar, Grill. A fired order splits into one ticket per station, so the bar never gets the biryani. Leave empty for a single kitchen printer."
                      >
                        <textarea
                          rows={3}
                          className="dark:bg-dark-900 h-auto w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30"
                          value={(Array.isArray(prefs.kitchen_stations) ? prefs.kitchen_stations : []).join("\n")}
                          onChange={(e) =>
                            setP(
                              "kitchen_stations",
                              e.target.value.split("\n").map((x) => x.trim()).filter(Boolean),
                            )
                          }
                          placeholder={"Kitchen\nBar"}
                        />
                      </Field>
                      <ToggleRow
                        checked={prefs.kot_auto_print !== false}
                        onChange={(v) => setP("kot_auto_print", v)}
                        label="Print kitchen tickets"
                        hint="Turn this off only if the kitchen works from the Kitchen screen — a ticket that was never printed has not reached anyone."
                      />
                    </SectionCard>
                </div>
              )}

              {prefsFooter}
              </>
            )}

            {activeTab === "loyalty" && (
              <>
              {/* One card — stretching three number boxes across a whole desktop
                  would be worse than the scroll this page is fixing. */}
              <div className="max-w-3xl">
              <SectionCard icon={<GiftGlyph />} title="Loyalty & rewards" description="Customers earn points on sales and redeem them as a discount at the counter.">
                <ToggleRow
                  checked={!!prefs.loyalty_enabled}
                  onChange={(v) => setP("loyalty_enabled", v)}
                  label="Enable loyalty points"
                  hint="Points are tied to the customer's phone — add a customer at the till to earn or redeem."
                />
                {!!prefs.loyalty_enabled && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Earn: Rs per point" hint="Spend this much (Rs) to earn 1 point.">
                      <Input type="number" min="1" value={String(prefs.loyalty_earn_per_amount ?? 100)} onChange={(e) => setP("loyalty_earn_per_amount", Number(e.target.value))} />
                    </Field>
                    <Field label="Redeem: Rs per point" hint="What each point is worth when redeemed.">
                      <Input type="number" min="0" step={0.01} value={String(prefs.loyalty_redeem_value ?? 1)} onChange={(e) => setP("loyalty_redeem_value", Number(e.target.value))} />
                    </Field>
                    <Field label="Minimum to redeem" hint="Points needed before any redemption.">
                      <Input type="number" min="0" value={String(prefs.loyalty_min_redeem ?? 0)} onChange={(e) => setP("loyalty_min_redeem", Number(e.target.value))} />
                    </Field>
                  </div>
                )}
              </SectionCard>
              </div>
              {prefsFooter}
              </>
            )}

            {activeTab === "barcode" && (
              <>
              <TwoCol
                left={
                  <SectionCard icon={<BarcodeGlyph />} title="Barcode labels" description="What shows on printed product labels.">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <ToggleRow checked={!!prefs.barcode_show_name} onChange={(v) => setP("barcode_show_name", v)} label="Show name" hint="Prints the product name above the bars." />
                      <ToggleRow checked={!!prefs.barcode_show_price} onChange={(v) => setP("barcode_show_price", v)} label="Show price" hint="Prints the retail price on the label." />
                    </div>
                  </SectionCard>
                }
                right={
                  <SectionCard icon={<ScaleGlyph />} title="Scale barcodes" description="For groceries that weigh loose items on a barcode-printing scale.">
                    <ToggleRow
                      checked={!!prefs.scale_barcode_enabled}
                      onChange={(v) => setP("scale_barcode_enabled", v)}
                      label="Read weighing-scale labels"
                      hint="A label printed by the scale carries the weight or the price inside the barcode itself."
                    />
                    {!!prefs.scale_barcode_enabled && (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Prefix" hint="The leading digit(s) your scale uses — usually 2.">
                          <Input value={String(prefs.scale_barcode_prefix ?? "2")} onChange={(e) => setP("scale_barcode_prefix", e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="2" />
                        </Field>
                        <Field label="Label encodes">
                          <Select value={String(prefs.scale_barcode_mode ?? "weight")} options={[{ value: "weight", label: "Weight" }, { value: "price", label: "Price" }]} placeholder="Weight" onChange={(v) => setP("scale_barcode_mode", v)} />
                        </Field>
                      </div>
                    )}
                    <p className="text-theme-xs text-gray-400">Set each item's <span className="font-medium">Scale PLU code</span> on its product page.</p>
                  </SectionCard>
                }
              />
              {prefsFooter}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
