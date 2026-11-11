import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Navigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import PageMeta from "../../../components/common/PageMeta";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import Input from "../../../components/form/input/InputField";
import Switch from "../../../components/form/switch/Switch";
import Button from "../../../components/ui/button/Button";
import Alert from "../../../components/ui/alert/Alert";
import MapPicker, { type PickedLocation } from "../../../components/maps/MapPicker";
import { ApiError } from "../../../common/types/api";
import {
  useBusinessTypes, useCompleteSetup, useShopCurrencies, useShopSettings, useShopTimezones, useUpdateShopSettings,
} from "../hooks/useShop";
import { cityForPin, useCities } from "../../../common/geo/places";
import { CityPicker } from "../../../common/geo/CityPicker";
import { useCapabilities } from "../../dashboard/components/shop/capabilities";
import { useAuthStore } from "../../../stores/authStore";
import {
  forgetStep, hoursFor, settingsToSave, setupExtras, setupSteps, whyNot, type SetupAnswers, type SetupStep,
} from "../setupSteps";

/** Sunday is 0, as the server keeps it; the week is shown from Monday. */
const WEEK = [
  { day: 1, short: "Mon" }, { day: 2, short: "Tue" }, { day: 3, short: "Wed" }, { day: 4, short: "Thu" },
  { day: 5, short: "Fri" }, { day: 6, short: "Sat" }, { day: 0, short: "Sun" },
];

/**
 * THE FIRST TIME A SHOP IS OPENED.
 *
 * Where the shop is — required, and all the old screen asked — then the money
 * and tax, the counter and the receipt, and opening hours and online orders,
 * each only where the business has it (see setupSteps). Next and Back between
 * them; every step after the first can be skipped, and "Finish setup" is on
 * every step for an owner who wants the usual settings and to start selling.
 * A skipped step changes nothing. The business TYPE is chosen by the platform
 * admin and shown here read-only.
 */
export default function ShopSetupPage() {
  const user = useAuthStore((s) => s.user);
  const cities = useCities();
  const businessTypes = useBusinessTypes();
  const setup = useCompleteSetup();
  const saveSettings = useUpdateShopSettings();
  const settings = useShopSettings();
  const prefs = settings.data;
  const timezones = useShopTimezones();

  // B23: the city and address the shop was made with are already known —
  // asked again from nothing, the form read as if they had been lost. What
  // the owner picks or types replaces them (null = untouched).
  const [pickedCity, setCityId] = useState<string | null>(null);
  const cityId = pickedCity ?? user?.tenant?.city?.id ?? "";
  // …and a device signed in before setup was finished elsewhere held its old
  // answer for the five minutes /me is trusted, stuck on this form. Asked now.
  const queryClient = useQueryClient();
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
  }, [queryClient]);
  // The money the shop trades in. Asked on the first visit, because it is
  // fixed once there is a sale on the books. Until a choice is made it is
  // whatever the shop is already on.
  const currencies = useShopCurrencies();
  const [currency, setCurrency] = useState("");
  const chosenCurrency = currency || currencies.data?.current.code || "";
  const [typedAddress, setAddress] = useState<string | null>(null);
  const address = typedAddress ?? user?.tenant?.address ?? "";
  const [typedPhone, setPhone] = useState<string | null>(null);
  const phone = typedPhone ?? user?.tenant?.phone ?? "";
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [detectedCity, setDetectedCity] = useState<string | null>(null);

  /**
   * What to call this tenant. A Finance Manager tenant sells nothing — it is
   * a bookkeeping office, and calling it a "shop" on the first screen it ever
   * shows tells the owner the product was not built for them.
   */
  const caps = useCapabilities();
  const noun = caps.sells ? { Title: "Shop", lower: "shop" } : { Title: "Business", lower: "business" };

  const features = user?.tenant?.features ?? {};
  const steps = setupSteps(Boolean(features.pos), Boolean(features.marketplace || features.delivery));
  const [at, setAt] = useState(0);
  const step: SetupStep = steps[Math.min(at, steps.length - 1)];
  const last = at >= steps.length - 1;
  const [answers, setAnswers] = useState<SetupAnswers>({});
  const [skipped, setSkipped] = useState<Set<SetupStep>>(new Set());
  const answer = (patch: SetupAnswers) => setAnswers((was) => ({ ...was, ...patch }));

  const titles: Record<SetupStep, string> = {
    shop: `Your ${noun.lower}`,
    money: caps.sells ? "Money & tax" : "Money",
    counter: "Counter & receipt",
    online: "Hours & online orders",
  };

  // The admin-assigned type, shown for reassurance (not editable here).
  const assignedType = user?.tenant?.business_type ?? null;
  const typeLabel = useMemo(
    () => businessTypes.data?.find((t) => t.code === assignedType)?.label ?? assignedType,
    [businessTypes.data, assignedType],
  );

  const onLocation = ({ lat, lng, place }: PickedLocation) => {
    setCoords({ lat, lng });
    if (!place) return;
    if (place.formatted && !address) setAddress(place.formatted);
    if (place.city) setDetectedCity(place.city);
    // The exact name, or the nearest city to the pin — never a short name
    // found inside a long one. See cityForPin.
    const match = cityForPin(cities.data ?? [], place.city, { lat, lng });
    if (match) setCityId(match.id);
  };

  // The setup's own refusal by field where it names one; a refused settings
  // save in its own words — either keeps the owner here, told why.
  const fieldErrors = setup.error instanceof ApiError ? setup.error.errors : {};
  const settingsRefused = saveSettings.error instanceof ApiError ? saveSettings.error.message : null;
  const generalError =
    (setup.error instanceof ApiError && Object.keys(fieldErrors).length === 0 ? setup.error.message : null) ?? settingsRefused;

  const delivers = Boolean(features.delivery);
  const blocked = whyNot(step, answers, {
    pickup: prefs?.pickup_enabled ?? true,
    delivery: delivers && (prefs?.delivery_enabled ?? true),
  });
  const busy = setup.isPending || saveSettings.isPending;

  /**
   * Everything answered, saved: the settings first (only what was touched,
   * nothing from a skipped step), then the setup itself — which is what lets
   * the owner in. If the settings are refused the owner stays here, on a
   * screen that says why, with the shop not yet half-set-up.
   */
  const finish = async (skippedNow: ReadonlySet<SetupStep> = skipped, answersNow: SetupAnswers = answers) => {
    if (busy || !cityId) return;
    const patch = settingsToSave(answersNow, skippedNow, steps);
    if (Object.keys(patch).length > 0) {
      try {
        await saveSettings.mutateAsync(patch);
      } catch {
        return; // said above the form
      }
    }
    const moneyAsked = steps.includes("money") && !skippedNow.has("money");
    setup.mutate({
      city_id: cityId,
      // Not sent by a business that has already traded: it keeps its own.
      currency: moneyAsked && currencies.data && !currencies.data.locked && chosenCurrency ? chosenCurrency : undefined,
      address: address || undefined,
      phone: phone.trim() || undefined,
      latitude: coords?.lat,
      longitude: coords?.lng,
      ...setupExtras(answersNow, skippedNow, steps, timezones.data?.current),
    });
  };

  const goNext = () => {
    setSkipped((was) => {
      const next = new Set(was);
      next.delete(step);
      return next;
    });
    setAt((i) => Math.min(i + 1, steps.length - 1));
  };

  const skip = () => {
    const nextAnswers = forgetStep(answers, step);
    const nextSkipped = new Set(skipped).add(step);
    setAnswers(nextAnswers);
    setSkipped(nextSkipped);
    if (last) void finish(nextSkipped, nextAnswers);
    else setAt((i) => i + 1);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (blocked) return;
    if (last) void finish();
    else goNext();
  };

  // Done — here, or on another device. The form is for a shop not yet set up.
  if (user?.tenant?.setup_completed) {
    return <Navigate to="/tenant" replace />;
  }

  const hours = answers.business_hours;
  const openDays = hours?.map((h) => h.day) ?? [];
  const openAt = hours?.[0]?.open ?? "09:00";
  const closeAt = hours?.[0]?.close ?? "21:00";

  return (
    <>
      <PageMeta title={`${noun.Title} setup`} description={`Complete your ${noun.lower} profile`} />
      {/* `min-h-dvh` minus whatever is pinned to the bottom of the screen —
       * this page is NOT inside AppLayout, so the room the layout keeps for
       * the PWA install card does not reach it, and the card once sat on top
       * of "Finish setup". `dvh`, not `vh`: a phone's address bar. */}
      <div className="flex min-h-dvh items-center justify-center bg-gray-50 p-4 pb-[calc(1.5rem+var(--pinned-bottom,0px))] sm:p-6 dark:bg-gray-900">
        <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-5 sm:p-8 dark:border-gray-800 dark:bg-white/[0.03]">
          <h1 className="mb-1 text-title-sm font-semibold text-gray-800 dark:text-white/90">
            Set up {user?.tenant?.business_name ?? `your ${noun.lower}`}
          </h1>
          <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
            {step === "shop"
              ? <>Just a couple of basics — tell us where your {noun.lower} is and you&rsquo;re ready to go. The rest is optional.</>
              : "Optional — skip it and the usual settings stay. Everything here can be changed later in Settings."}
          </p>

          {/* Where you are in it — a real sequence, so it is numbered. A
              step already passed can be returned to by pressing it. */}
          <ol className="mb-6 flex flex-wrap gap-2" aria-label="Setup steps">
            {steps.map((s, i) => {
              const state = i === at ? "current" : i < at ? "done" : "next";
              return (
                <li key={s}>
                  <button
                    type="button"
                    disabled={i > at || busy}
                    onClick={() => setAt(i)}
                    aria-current={state === "current" ? "step" : undefined}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-theme-xs font-medium transition ${
                      state === "current"
                        ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                        : state === "done"
                          ? "border-gray-200 text-gray-700 hover:border-brand-300 dark:border-gray-700 dark:text-gray-200"
                          : "border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-500"
                    }`}
                  >
                    <span className={`grid size-5 place-items-center rounded-full text-[11px] ${state === "current" ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300"}`}>
                      {state === "done" ? (skipped.has(s) ? "–" : "✓") : i + 1}
                    </span>
                    {titles[s]}
                  </button>
                </li>
              );
            })}
          </ol>

          {generalError && (
            <div className="mb-5">
              <Alert variant="error" title="Setup failed" message={generalError} />
            </div>
          )}

          <form onSubmit={submit} className="space-y-5">
            {step === "shop" && (
              <>
                {/* Business type — set by the admin, shown read-only */}
                {assignedType && (
                  <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-white/[0.02]">
                    <div>
                      <p className="text-theme-xs uppercase tracking-wide text-gray-400">Business type</p>
                      <p className="text-sm font-medium capitalize text-gray-800 dark:text-white/90">{typeLabel}</p>
                    </div>
                    <span className="rounded-full bg-brand-50 px-3 py-1 text-theme-xs font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                      Set by admin
                    </span>
                  </div>
                )}

                <CityPicker
                  value={cityId}
                  onChange={(id) => setCityId(id)}
                  required
                  placeholder="Choose your city"
                  error={fieldErrors.city_id?.[0]}
                />

                <div>
                  <Label>{noun.Title} location</Label>
                  <MapPicker value={coords} onChange={onLocation} place={noun.lower} />
                  {coords && (
                    <p className="mt-1 text-theme-xs text-success-600 dark:text-success-400">
                      Pinned at {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                      {detectedCity ? ` · ${detectedCity}` : ""}
                    </p>
                  )}
                  {(fieldErrors.latitude || fieldErrors.longitude) && (
                    <p className="mt-1 text-theme-xs text-error-500">{(fieldErrors.latitude ?? fieldErrors.longitude)![0]}</p>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="setup-address">Address {coords ? "" : "(optional)"}</Label>
                    <Input id="setup-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={`${noun.Title} street address`} />
                  </div>
                  <div>
                    <Label htmlFor="setup-phone">Phone (optional)</Label>
                    <Input id="setup-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Printed on your receipts" />
                    {fieldErrors.phone && <p className="mt-1 text-theme-xs text-error-500">{fieldErrors.phone[0]}</p>}
                  </div>
                </div>
              </>
            )}

            {step === "money" && (
              <>
                {currencies.data && !currencies.data.locked && (
                  <Field label="Currency" hint="The money your prices and receipts are written in. Fixed after your first sale.">
                    <Select
                      aria-label="Currency"
                      value={chosenCurrency}
                      options={currencies.data.options.map((o) => ({ value: o.code, label: `${o.name} — ${o.symbol} (${o.code})` }))}
                      placeholder="Choose a currency"
                      onChange={(v) => v && setCurrency(v)}
                    />
                    {fieldErrors.currency && <p className="mt-1 text-theme-xs text-error-500">{fieldErrors.currency[0]}</p>}
                  </Field>
                )}

                {timezones.data && !timezones.data.locked && (
                  <Field label="Time zone" hint={`Set from your city. Your ${noun.lower}'s day, opening hours and offers run on this clock. Fixed after your first sale.`}>
                    <Select
                      aria-label="Time zone"
                      value={answers.timezone ?? timezones.data.current}
                      options={[
                        ...timezones.data.options.filter((o) => timezones.data!.suggested.includes(o.id)),
                        ...timezones.data.options.filter((o) => !timezones.data!.suggested.includes(o.id)),
                      ].map((o) => ({ value: o.id, label: o.label }))}
                      onChange={(v) => v && answer({ timezone: v })}
                    />
                  </Field>
                )}

                {caps.sells && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Tax on your prices (%)" hint="Use 0 if you charge no tax. An item can have its own rate.">
                        <Input
                          aria-label="Tax on your prices (%)"
                          type="number"
                          min="0"
                          max="100"
                          step={0.01}
                          value={String(answers.default_tax_rate ?? prefs?.default_tax_rate ?? 0)}
                          onChange={(e) => answer({ default_tax_rate: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                        />
                      </Field>
                      <div className="pt-1 sm:pt-7">
                        <Switch
                          label="My prices already include tax"
                          checked={answers.tax_inclusive ?? prefs?.tax_inclusive ?? false}
                          onChange={(on) => answer({ tax_inclusive: on })}
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="NTN (optional)" hint="Only if you are registered — printed on the receipt.">
                        <Input aria-label="NTN" value={answers.invoice_ntn ?? prefs?.invoice_ntn ?? ""} onChange={(e) => answer({ invoice_ntn: e.target.value })} />
                      </Field>
                      <Field label="STRN (optional)" hint="Sales tax registration, if you have one.">
                        <Input aria-label="STRN" value={answers.invoice_strn ?? prefs?.invoice_strn ?? ""} onChange={(e) => answer({ invoice_strn: e.target.value })} />
                      </Field>
                    </div>
                  </>
                )}
              </>
            )}

            {step === "counter" && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Receipt paper" hint="The paper in your receipt printer.">
                    <Select
                      aria-label="Receipt paper"
                      value={String(answers.receipt_width ?? prefs?.receipt_width ?? "standard")}
                      options={[
                        { value: "thermal_80", label: "Thermal roll 80mm" },
                        { value: "thermal_58", label: "Thermal roll 58mm" },
                        { value: "standard", label: "Standard page (A4/Letter)" },
                      ]}
                      onChange={(v) => v && answer({ receipt_width: v as SetupAnswers["receipt_width"] })}
                    />
                  </Field>
                  <Field label="Usual way customers pay" hint="Picked first on the till; any other is one tap away.">
                    <Select
                      aria-label="Usual way customers pay"
                      value={String(answers.pos_default_payment ?? prefs?.pos_default_payment ?? "cash")}
                      options={[
                        { value: "cash", label: "Cash" },
                        { value: "card", label: "Card" },
                        { value: "wallet", label: "Mobile wallet" },
                      ]}
                      onChange={(v) => v && answer({ pos_default_payment: v as SetupAnswers["pos_default_payment"] })}
                    />
                  </Field>
                </div>
                <div className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                  <Switch
                    label="Print the receipt after every sale"
                    checked={answers.pos_auto_print ?? prefs?.pos_auto_print ?? false}
                    onChange={(on) => answer({ pos_auto_print: on })}
                  />
                  <div>
                    <Switch
                      label="Open a shift and count the drawer before selling"
                      checked={answers.pos_require_shift ?? prefs?.pos_require_shift ?? false}
                      onChange={(on) => answer({ pos_require_shift: on })}
                    />
                    <p className="mt-1 pl-14 text-theme-xs text-gray-500 dark:text-gray-400">
                      For a shop with several cashiers. Leave it off if you run the counter yourself — your books add up either way.
                    </p>
                  </div>
                </div>
                <Field label="Message at the foot of the receipt (optional)">
                  <Input
                    aria-label="Message at the foot of the receipt"
                    value={answers.invoice_footer ?? prefs?.invoice_footer ?? ""}
                    onChange={(e) => answer({ invoice_footer: e.target.value })}
                    placeholder="Thank you for shopping with us"
                  />
                </Field>
              </>
            )}

            {step === "online" && (
              <>
                <div className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                  <Switch
                    label="Set opening hours for online orders"
                    checked={hours !== undefined && hours.length > 0}
                    onChange={(on) => answer({ business_hours: on ? hoursFor([1, 2, 3, 4, 5, 6], "09:00", "21:00") : [] })}
                  />
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                    {hours !== undefined && hours.length > 0
                      ? "Customers can order only while you are open."
                      : "Off: customers can order at any hour."}
                  </p>
                  {hours !== undefined && hours.length > 0 && (
                    <>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days open">
                        {WEEK.map(({ day, short }) => {
                          const on = openDays.includes(day);
                          return (
                            <button
                              key={day}
                              type="button"
                              aria-pressed={on}
                              onClick={() => {
                                const days = on ? openDays.filter((d) => d !== day) : [...openDays, day];
                                answer({ business_hours: days.length > 0 ? hoursFor(days, openAt, closeAt) : hoursFor([day], openAt, closeAt) });
                              }}
                              className={`min-w-11 rounded-lg border px-2.5 py-1.5 text-theme-xs font-medium ${on ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400"}`}
                            >
                              {short}
                            </button>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
                        <Field label="Opens">
                          <Input aria-label="Opens" type="time" value={openAt} onChange={(e) => answer({ business_hours: hoursFor(openDays, e.target.value, closeAt) })} />
                        </Field>
                        <Field label="Closes">
                          <Input aria-label="Closes" type="time" value={closeAt} onChange={(e) => answer({ business_hours: hoursFor(openDays, openAt, e.target.value) })} />
                        </Field>
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                  <Switch
                    label="Customers can collect from the shop"
                    checked={answers.pickup_enabled ?? prefs?.pickup_enabled ?? true}
                    onChange={(on) => answer({ pickup_enabled: on })}
                  />
                  {delivers && (
                    <Switch
                      label="We deliver"
                      checked={answers.delivery_enabled ?? prefs?.delivery_enabled ?? true}
                      onChange={(on) => answer({ delivery_enabled: on })}
                    />
                  )}
                </div>

                {delivers && (answers.delivery_enabled ?? prefs?.delivery_enabled ?? true) && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Delivery charge" hint="Added to every delivered order. 0 for free delivery.">
                      <Input
                        aria-label="Delivery charge"
                        type="number"
                        min="0"
                        value={String(answers.delivery_fee ?? Number((user?.tenant as { delivery_fee?: string | number } | undefined)?.delivery_fee ?? 0))}
                        onChange={(e) => answer({ delivery_fee: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </Field>
                    <Field label="Smallest order you deliver (optional)" hint="Leave empty for no minimum.">
                      <Input
                        aria-label="Smallest order you deliver"
                        type="number"
                        min="0"
                        value={answers.min_order_amount === undefined ? String(prefs?.min_order_amount ?? "") : answers.min_order_amount === null ? "" : String(answers.min_order_amount)}
                        onChange={(e) => answer({ min_order_amount: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </Field>
                  </div>
                )}
              </>
            )}

            {blocked && (
              <p role="alert" className="rounded-lg bg-warning-50 px-3 py-2 text-theme-sm text-warning-800 dark:bg-warning-500/10 dark:text-warning-300">
                {blocked}
              </p>
            )}

            <div className="flex flex-col-reverse gap-3 border-t border-gray-100 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
              <div className="flex gap-2">
                {at > 0 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setAt((i) => i - 1)} disabled={busy}>
                    Back
                  </Button>
                )}
                {step !== "shop" && (
                  <Button type="button" variant="ghost" size="sm" onClick={skip} disabled={busy}>
                    Skip this step
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {!last && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void finish()}
                    disabled={busy || !cityId || blocked !== null}
                  >
                    {busy ? "Saving…" : "Finish setup"}
                  </Button>
                )}
                <Button type="submit" size="sm" disabled={busy || !cityId || blocked !== null}>
                  {busy && last ? "Saving…" : last ? "Finish setup" : `Next: ${titles[steps[at + 1]]}`}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}
