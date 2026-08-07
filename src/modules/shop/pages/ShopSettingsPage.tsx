import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import Alert from "../../../components/ui/alert/Alert";
import MapPicker from "../../../components/maps/MapPicker";
import { ApiError } from "../../../common/types/api";
import { apiGet, apiPut } from "../../../common/api/client";
import { useCities, useShopSettings, useUpdateShopSettings } from "../hooks/useShop";
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

// Settings are split into tabs: shop info first, then module-wise topics.
const SETTINGS_TABS = [
  { key: "business", label: "Business" },
  { key: "tax", label: "Tax & Delivery" },
  { key: "pos", label: "Point of Sale" },
  { key: "loyalty", label: "Loyalty" },
  { key: "receipt", label: "Receipt" },
  { key: "hardware", label: "Hardware" },
  { key: "barcode", label: "Barcodes" },
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

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

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
      <span className={`h-5 w-9 rounded-full p-0.5 transition ${checked ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-700"}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition ${checked ? "translate-x-4" : ""}`} />
      </span>
      {label}
    </button>
  );
}

export default function ShopSettingsPage() {
  const queryClient = useQueryClient();
  const cities = useCities();
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);
  const trade = usePrimaryBusinessType();

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
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });
  const [form, setForm] = useState({
    business_name: "", city_id: "", phone: "", address: "", delivery_fee: "0", latitude: "", longitude: "",
  });
  const [saved, setSaved] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // ── The shop's mark, as printed on its invoices ──────────────────────
  const logoRef = useRef<HTMLInputElement>(null);
  const uploadLogo = useMutation({
    mutationFn: (file: File) => shopService.uploadLogo(file),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ["shop"] });
      if (user) setUser({ ...user, tenant: data });
    },
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
    }
  }, [shop.data]);

  const apiError = save.error instanceof ApiError ? save.error : null;
  const errorFor = (k: string) => apiError?.errors[k]?.[0];
  const generalError = apiError && Object.keys(apiError.errors).length === 0 ? apiError.message : null;

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
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("business");
  useEffect(() => { if (settings.data && !prefs) setPrefs({ ...settings.data }); }, [settings.data, prefs]);
  const setP = (k: string, v: PrefValue) => { setPrefs((f) => ({ ...f!, [k]: v })); setPrefsSaved(false); };

  // Appearance (brand colour, sidebar, tint) lives in the floating Appearance
  // canvas, reachable from every screen — not here. One home per concern.
  const prefsErr = updatePrefs.error instanceof ApiError ? updatePrefs.error.firstFieldError() ?? updatePrefs.error.message : null;
  const savePrefs = () => prefs && updatePrefs.mutate(prefs as never, { onSuccess: () => setPrefsSaved(true) });

  const online = shop.data?.online_shop_enabled;
  const cityOptions = [{ value: "", label: "— Select city —" }, ...(cities.data ?? []).map((c) => ({ value: c.id, label: c.name }))];

  // Every preferences tab edits the one `prefs` object and shares this footer —
  // saving from any tab persists all preferences (no cross-tab data loss).
  const prefsFooter = (
    <div className="flex justify-end">
      <Button size="sm" onClick={savePrefs} disabled={updatePrefs.isPending}>
        {updatePrefs.isPending ? "Saving…" : "Save preferences"}
      </Button>
    </div>
  );

  return (
    <>
      <PageMeta title="Settings | ShopOS" description="Shop settings" />
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Settings</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Manage your shop profile, location and how the app works for you.</p>
      </div>

      {/* Tab bar — shop info first, then module-wise topics. */}
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-theme-sm font-medium transition ${tab === t.key ? "border-brand-500 text-brand-500" : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* The receipt tab needs room for the paper beside the form; every other
          tab reads better narrow. */}
      <div className={tab === "receipt" ? "max-w-6xl" : "max-w-3xl"}>
        {shop.isLoading ? (
          <div className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
        ) : tab === "business" ? (
          <div className="space-y-6">
            {saved && <Alert variant="success" title="Saved" message="Your profile has been updated." />}
            {generalError && <Alert variant="error" title="Couldn't save" message={generalError} />}

            <SectionCard icon={<StoreGlyph />} title="Business profile" description="Your shop's name and contact — shown on invoices and your storefront.">
              <Field label="Business name" error={errorFor("business_name")}>
                <Input value={form.business_name} onChange={(e) => set("business_name", e.target.value)} />
              </Field>
              <Field label="Phone" error={errorFor("phone")}>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="03xx-xxxxxxx" />
              </Field>
            </SectionCard>

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

            <SectionCard icon={<GlobeGlyph />} title="Online shop" description="Your customer-facing storefront." badge={<Badge size="sm" color={online ? "success" : "light"}>{online ? "Enabled" : "Off"}</Badge>}>
              {online ? (
                <Field label="Delivery fee (Rs)" hint="Charged on delivery orders. Set 0 for free delivery / pickup-only." error={errorFor("delivery_fee")}>
                  <Input type="number" min="0" value={form.delivery_fee} onChange={(e) => set("delivery_fee", e.target.value)} className="max-w-xs" />
                </Field>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">Your plan is Expense Manager only. Contact the platform admin to enable online selling.</p>
              )}
            </SectionCard>

            <div className="flex justify-end">
              <Button size="sm" onClick={submitProfile} disabled={save.isPending || !form.business_name.trim()}>
                {save.isPending ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </div>
        ) : settings.isLoading || !prefs ? (
          <div className="h-96 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
        ) : (
          <div className="space-y-6">
            {tab !== "hardware" && prefsSaved && <Alert variant="success" title="Saved" message="Preferences updated." />}
            {tab !== "hardware" && prefsErr && <Alert variant="error" title="Couldn't save" message={prefsErr} />}

            {tab === "tax" && (
              <>
              <SectionCard icon={<PercentGlyph />} title="Tax" description="Default tax applied at checkout when a product has no rate of its own.">
                <Field label="Default tax %" hint="Set 0 for tax-exempt shops.">
                  <Input type="number" min="0" max="100" className="max-w-xs" value={String(prefs.default_tax_rate)} onChange={(e) => setP("default_tax_rate", Number(e.target.value))} />
                </Field>
                <Toggle checked={!!prefs.tax_inclusive} onChange={(v) => setP("tax_inclusive", v)} label="Prices already include tax (inclusive)" />
                <p className="-mt-2 text-theme-xs text-gray-400">
                  {prefs.tax_inclusive
                    ? "Inclusive: the price is the final price — the receipt shows the tax portion held within it."
                    : "Exclusive: tax is added on top of the price at checkout."}
                </p>
              </SectionCard>

              <TaxGroupsManager />

              <SectionCard icon={<TruckGlyph />} title="Order fulfillment" description="How customers get their orders. They only see the options you enable.">
                <div className="flex flex-wrap items-center gap-6">
                  <Toggle checked={!!prefs.pickup_enabled} onChange={(v) => setP("pickup_enabled", v)} label="Pickup" />
                  <Toggle checked={!!prefs.delivery_enabled} onChange={(v) => setP("delivery_enabled", v)} label="Delivery" />
                  {!prefs.pickup_enabled && !prefs.delivery_enabled && (
                    <span className="text-theme-xs font-medium text-error-500">At least one option must stay on.</span>
                  )}
                </div>
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
              {prefsFooter}
              </>
            )}

            {/* The receipt is the only thing that leaves the shop, so it is
                edited beside the thing itself — the preview is the real
                template, server-rendered, not a mock-up of it. */}
            {tab === "receipt" && (
              <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-6">
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
                    <div className="flex flex-wrap items-center gap-6">
                      <Toggle checked={!!prefs.invoice_show_logo} onChange={(v) => setP("invoice_show_logo", v)} label="Show logo" />
                      <Toggle checked={!!prefs.receipt_show_cashier} onChange={(v) => setP("receipt_show_cashier", v)} label="Show who served" />
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
                  {prefsFooter}
                </div>

                <div className="lg:sticky lg:top-24">
                  <ReceiptPreview settings={prefs} />
                </div>
              </div>
            )}

            {tab === "hardware" && (
              <SectionCard icon={<PrinterGlyph />} title="Hardware" description="Your shop's receipt printer, label printer, barcode scanner, and cash drawer.">
                <HardwareDevices />
              </SectionCard>
            )}

            {tab === "pos" && (
              <>
              <SectionCard icon={<CartGlyph />} title="Point of sale" description="Defaults for the counter till.">
                <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                  <Field label="Default payment">
                    <Select value={String(prefs.pos_default_payment)} options={[{ value: "cash", label: "Cash" }, { value: "card", label: "Card" }]} placeholder="Cash" onChange={(v) => setP("pos_default_payment", v)} />
                  </Field>
                  <Field label="Lock the till when idle" hint="The next sale is stamped with whoever unlocks it.">
                    <Select
                      className="max-w-xs"
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
                  <div className="flex flex-wrap items-center gap-6 pb-2.5">
                    <Toggle checked={!!prefs.pos_require_shift} onChange={(v) => setP("pos_require_shift", v)} label="Require open shift" />
                    <Toggle checked={!!prefs.pos_auto_print} onChange={(v) => setP("pos_auto_print", v)} label="Auto-print receipt" />
                    <Toggle checked={!!prefs.pos_drawer_kick} onChange={(v) => setP("pos_drawer_kick", v)} label="Open drawer on cash" />
                  </div>
                  <div className="flex flex-wrap items-center gap-6 pb-2.5">
                    <Toggle checked={prefs.pos_denomination_count !== false} onChange={(v) => setP("pos_denomination_count", v)} label="Count by note & coin" />
                    <Toggle checked={!!prefs.pos_blind_close} onChange={(v) => setP("pos_blind_close", v)} label="Blind close" />
                    <Toggle checked={!!prefs.pos_declare_tenders} onChange={(v) => setP("pos_declare_tenders", v)} label="Declare card totals" />
                  </div>
                </div>
                <Field
                  label="Round cash bills to"
                  hint="Cash only — a card or khata bill always settles to the exact figure, and the bill itself never changes. The difference is printed on the receipt and totalled in your reports."
                >
                  <Select
                    className="max-w-xs"
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
                <p className="text-theme-xs text-gray-400">
                  "Require open shift" refuses a counter sale unless the cashier has a drawer open, so every rupee
                  belongs to a shift that gets counted. Recommended once you have staff.
                </p>
                <p className="text-theme-xs text-gray-400">
                  Rounding exists so the drawer can be counted. A bill of Rs 1,238.15 has no exact cash tender —
                  without it the till expects a figure the drawer can never hold, and the difference shows up as
                  a variance somebody has to explain. A tie is always rounded in the customer's favour.
                </p>
                <p className="text-theme-xs text-gray-400">
                  "Count by note &amp; coin" adds the total up from the drawer itself, so a second person can
                  re-check it. "Blind close" hides expected cash until the count is submitted — a till that
                  says it expects 47,320 tends to get a count of 47,320. Leave it off in a one-person shop;
                  turn it on the day someone else counts your drawer.
                </p>
                <p className="text-theme-xs text-gray-400">
                  "Open drawer on cash" only works where the drawer (or the printer it plugs into) is wired over a
                  direct connection — set that up in Settings → Hardware. On a plain browser printer there is no
                  pulse to send, and the till will say so instead of pretending.
                </p>
              </SectionCard>
              {/* The ceiling the `discounts.override` permission exists to
                  guard. The server has enforced this since day one — there was
                  simply no way to set the number, so it sat at null and the
                  permission guarded nothing. */}
              <SectionCard
                icon={<PercentGlyph />}
                title="Discount limits"
                description="How much a cashier may take off without asking. Anyone holding “Override discount limit” can go past it; everyone else is stopped at the till."
              >
                <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                  <Field
                    label="Most they can discount"
                    hint="As a share of the bill. Leave empty for no limit."
                  >
                    <div className="flex max-w-[10rem] items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={prefs.max_discount_percent == null ? "" : String(prefs.max_discount_percent)}
                        onChange={(e) => setP("max_discount_percent", e.target.value === "" ? null : Number(e.target.value))}
                        placeholder="No limit"
                      />
                      <span className="text-theme-sm text-gray-500">%</span>
                    </div>
                  </Field>
                  <Field
                    label="Or at most"
                    hint="A cash ceiling, whatever the percentage works out to. Leave empty for no limit."
                  >
                    <div className="flex max-w-[12rem] items-center gap-2">
                      <span className="text-theme-sm text-gray-500">{String(prefs.currency_symbol ?? "Rs")}</span>
                      <Input
                        type="number"
                        min="0"
                        value={prefs.max_discount_amount == null ? "" : String(prefs.max_discount_amount)}
                        onChange={(e) => setP("max_discount_amount", e.target.value === "" ? null : Number(e.target.value))}
                        placeholder="No limit"
                      />
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
              <SectionCard
                icon={<GiftGlyph />}
                title="Tips"
                description="Whether the till asks for a tip after payment. The money is the staff’s — it never counts as a sale, and it is shown separately on the drawer count."
              >
                <Toggle checked={!!prefs.tips_enabled} onChange={(v) => setP("tips_enabled", v)} label="Ask for a tip at checkout" />
              </SectionCard>

              {prefsFooter}
              {/* Stock that ages rather than expires. A tyre is not unsafe on a
                  date stamped by a supplier — it is unsafe after so many years
                  from its DOT week, which is why this is a span and not an
                  expiry. BatchController has read these since it shipped;
                  there was no way to set them. */}
              {trade === "automotive" && (
                <SectionCard
                  icon={<BarcodeGlyph />}
                  title="Stock ageing"
                  description="When goods dated by manufacture — tyres above all — start counting as old. Nothing is blocked from sale; the counter is told, and the decision stays with whoever is standing there."
                >
                  <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                    <Field label="Flag as ageing after" hint="Years from the DOT week.">
                      <div className="flex max-w-[9rem] items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          max="30"
                          value={String(prefs.stock_age_warn_years ?? 5)}
                          onChange={(e) => setP("stock_age_warn_years", Number(e.target.value))}
                        />
                        <span className="text-theme-sm text-gray-500">yrs</span>
                      </div>
                    </Field>
                    <Field label="Flag as old after" hint="The stronger warning. Keep it above the first.">
                      <div className="flex max-w-[9rem] items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          max="30"
                          value={String(prefs.stock_age_old_years ?? 6)}
                          onChange={(e) => setP("stock_age_old_years", Number(e.target.value))}
                        />
                        <span className="text-theme-sm text-gray-500">yrs</span>
                      </div>
                    </Field>
                  </div>
                </SectionCard>
              )}

              {/* Lanes live with the till, not with hardware: a register is an
                  operating position, and the printer bound to it comes after. */}
              <SectionCard icon={<CartGlyph />} title="Registers" description="Your checkout lanes. One counter needs none — add a lane each for a busy mart, and each drawer reconciles on its own.">
                <RegistersPanel />
              </SectionCard>
              {/* Identity at a shared terminal. Every per-cashier control —
                  the drawer, the void report, the discount ceiling — is only
                  worth anything if the name on the sale is who rang it. */}
              {/* Only a shop that seats people has a kitchen to route to. */}
              {(user?.tenant as { features?: Record<string, boolean> } | null | undefined)?.features?.dine_in && (
                <SectionCard icon={<ReceiptGlyph />} title="Kitchen" description="Where fired orders go, and whether they print.">
                  <Field
                    label="Stations"
                    hint="One line each — Kitchen, Bar, Grill. A fired order splits into one ticket per station, so the bar never gets the biryani. Leave empty for a single kitchen printer."
                  >
                    <textarea
                      rows={3}
                      className="dark:bg-dark-900 h-auto w-full max-w-sm rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30"
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
                  <Toggle checked={prefs.kot_auto_print !== false} onChange={(v) => setP("kot_auto_print", v)} label="Print kitchen tickets" />
                  <p className="text-theme-xs text-gray-400">
                    Turn printing off only if the kitchen works from the Kitchen screen — a ticket that was never
                    printed has not reached anyone.
                  </p>
                </SectionCard>
              )}

              {/* The two promises made before a sale exists. They live with the
                  till because that is where both are written and both are
                  settled — a quote is priced at the counter, and an advance is
                  cash in the counter's drawer. */}
              <SectionCard
                icon={<ReceiptGlyph />}
                title="Quotations & advances"
                description="Prices you put in writing, and goods you hold until they're paid for."
              >
                <div className="flex flex-wrap items-center gap-6 pb-1">
                  <Toggle
                    checked={prefs.quotations_enabled !== false}
                    onChange={(v) => setP("quotations_enabled", v)}
                    label="Write quotations"
                  />
                  <Toggle
                    checked={prefs.layaway_enabled !== false}
                    onChange={(v) => setP("layaway_enabled", v)}
                    label="Hold goods on advance"
                  />
                </div>

                {prefs.quotations_enabled !== false && (
                  <>
                    <Field
                      label="Quotation valid for"
                      hint="How long you'll honour a quoted price. Long enough for the customer to shop around, short enough that a supplier price rise doesn't land on you. 0 = no expiry."
                    >
                      <Input
                        type="number"
                        value={String(prefs.quotation_valid_days ?? 15)}
                        onChange={(e) => setP("quotation_valid_days", Number(e.target.value))}
                        className="max-w-[10rem]"
                      />
                    </Field>
                    <Field
                      label="Printed terms"
                      hint="Goes at the foot of every quotation — delivery time, warranty, whether fitting is included."
                    >
                      <textarea
                        rows={3}
                        className="dark:bg-dark-900 h-auto w-full max-w-sm rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30"
                        value={(prefs.quotation_terms as string) ?? ""}
                        onChange={(e) => setP("quotation_terms", e.target.value)}
                        placeholder={"Prices valid for the period shown.\nDelivery within 3 working days."}
                      />
                    </Field>
                  </>
                )}

                {prefs.layaway_enabled !== false && (
                  <>
                    <Field
                      label="Minimum advance"
                      hint="A token deposit isn't a commitment — Rs 100 against a Rs 90,000 fridge takes it off your floor for weeks and costs the customer nothing to walk away from. 20% is the usual figure. 0 = accept any amount."
                    >
                      <div className="flex max-w-[10rem] items-center gap-2">
                        <Input
                          type="number"
                          value={String(prefs.layaway_min_deposit_percent ?? 20)}
                          onChange={(e) => setP("layaway_min_deposit_percent", Number(e.target.value))}
                        />
                        <span className="text-theme-sm text-gray-500">%</span>
                      </div>
                    </Field>
                    <Field
                      label="Collect within"
                      hint="Days before a booking shows as overdue. Nothing is voided and nobody's money evaporates — it's the list worth phoning down."
                    >
                      <Input
                        type="number"
                        value={String(prefs.layaway_days ?? 30)}
                        onChange={(e) => setP("layaway_days", Number(e.target.value))}
                        className="max-w-[10rem]"
                      />
                    </Field>
                    <Field
                      label="Usual cancellation fee"
                      hint="Holding a fridge for six weeks costs you the floor space and the sale you couldn't make. This fills in the fee box when a booking is cancelled — it's a starting figure, not a rule, and whoever cancels can change it or waive it there and then. 0 = suggest nothing."
                    >
                      <div className="flex max-w-[10rem] items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={String(prefs.layaway_cancellation_fee_percent ?? 0)}
                          onChange={(e) => setP("layaway_cancellation_fee_percent", Number(e.target.value))}
                        />
                        <span className="text-theme-sm text-gray-500">%</span>
                      </div>
                    </Field>
                    <p className="text-theme-xs text-gray-400">
                      Cancelling a booking always puts the goods back on your shelf. The advance goes back in full
                      unless a fee is kept, and that stays a deliberate decision on the day — nothing is ever
                      deducted from a customer's money without someone choosing it.
                    </p>
                  </>
                )}
              </SectionCard>

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
              </>
            )}

            {tab === "loyalty" && (
              <>
              <SectionCard icon={<GiftGlyph />} title="Loyalty & rewards" description="Customers earn points on sales and redeem them as a discount at the counter.">
                <Toggle checked={!!prefs.loyalty_enabled} onChange={(v) => setP("loyalty_enabled", v)} label="Enable loyalty points" />
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
                <p className="text-theme-xs text-gray-400">Points are tied to the customer's phone — add a customer at the till to earn/redeem.</p>
              </SectionCard>
              {prefsFooter}
              </>
            )}

            {tab === "barcode" && (
              <>
              <SectionCard icon={<BarcodeGlyph />} title="Barcode labels" description="What shows on printed product labels.">
                <div className="flex flex-wrap items-center gap-6">
                  <Toggle checked={!!prefs.barcode_show_name} onChange={(v) => setP("barcode_show_name", v)} label="Show name" />
                  <Toggle checked={!!prefs.barcode_show_price} onChange={(v) => setP("barcode_show_price", v)} label="Show price" />
                </div>
              </SectionCard>

              <SectionCard icon={<ScaleGlyph />} title="Scale barcodes" description="For groceries that weigh loose items on a barcode-printing scale.">
                <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                  <Toggle checked={!!prefs.scale_barcode_enabled} onChange={(v) => setP("scale_barcode_enabled", v)} label="Read weighing-scale labels" />
                  {!!prefs.scale_barcode_enabled && (
                    <>
                      <Field label="Prefix">
                        <Input value={String(prefs.scale_barcode_prefix ?? "2")} onChange={(e) => setP("scale_barcode_prefix", e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="2" />
                      </Field>
                      <Field label="Label encodes">
                        <Select value={String(prefs.scale_barcode_mode ?? "weight")} options={[{ value: "weight", label: "Weight" }, { value: "price", label: "Price" }]} placeholder="Weight" onChange={(v) => setP("scale_barcode_mode", v)} />
                      </Field>
                    </>
                  )}
                </div>
                <p className="text-theme-xs text-gray-400">Set each item's <span className="font-medium">Scale PLU code</span> on its product page. Prefix = the leading digit(s) your scale uses (usually 2).</p>
              </SectionCard>
              {prefsFooter}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
