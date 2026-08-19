import { useMemo, useState, type FormEvent } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import Input from "../../../components/form/input/InputField";
import Button from "../../../components/ui/button/Button";
import Alert from "../../../components/ui/alert/Alert";
import MapPicker, { type PickedLocation } from "../../../components/maps/MapPicker";
import { ApiError } from "../../../common/types/api";
import { useBusinessTypes, useCities, useCompleteSetup } from "../hooks/useShop";
import { useCapabilities } from "../../dashboard/components/shop/capabilities";
import { useAuthStore } from "../../../stores/authStore";

/**
 * Onboarding — the owner adds BASIC info only: where the shop is (city +
 * pin) and its address. The business TYPE is chosen by the platform admin at
 * tenant creation and shown here read-only. Required before the dashboard.
 */
export default function ShopSetupPage() {
  const user = useAuthStore((s) => s.user);
  const cities = useCities();
  const businessTypes = useBusinessTypes();
  const setup = useCompleteSetup();

  const [cityId, setCityId] = useState("");
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [detectedCity, setDetectedCity] = useState<string | null>(null);

  /**
   * What to call this tenant.
   *
   * A Finance Manager tenant sells nothing — it is a bookkeeping office, and
   * calling it a "shop" four times on the first screen it ever shows tells the
   * owner the product was not built for them before they have entered a single
   * figure. The distinction is already known here: a tenant granted no selling
   * module keeps books and nothing else.
   */
  const caps = useCapabilities();
  const noun = caps.sells
    ? { Title: "Shop", lower: "shop" }
    : { Title: "Business", lower: "business" };

  // The admin-assigned type, shown for reassurance (not editable here).
  const assignedType = user?.tenant?.business_type ?? null;
  const typeLabel = useMemo(
    () => businessTypes.data?.find((t) => t.code === assignedType)?.label ?? assignedType,
    [businessTypes.data, assignedType],
  );

  const onLocation = ({ lat, lng, place }: PickedLocation) => {
    setCoords({ lat, lng });
    if (!place) return;
    if (place.formatted) setAddress((a) => a || place.formatted);
    if (place.city) {
      setDetectedCity(place.city);
      const name = place.city.toLowerCase();
      const match = (cities.data ?? []).find(
        (c) => c.name.toLowerCase() === name || name.includes(c.name.toLowerCase()),
      );
      if (match) setCityId(match.id);
    }
  };

  const fieldErrors = setup.error instanceof ApiError ? setup.error.errors : {};
  const generalError =
    setup.error instanceof ApiError && Object.keys(fieldErrors).length === 0
      ? setup.error.message
      : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (setup.isPending) return;
    setup.mutate({
      city_id: cityId,
      address: address || undefined,
      latitude: coords?.lat,
      longitude: coords?.lng,
    });
  };

  return (
    <>
      <PageMeta title={`${noun.Title} setup | ShopOS`} description={`Complete your ${noun.lower} profile`} />
      {/* `min-h-dvh` minus whatever is pinned to the bottom of the screen.
       *
       * This page is NOT inside AppLayout — it centres its own card in a
       * full-height box — so the room the layout reserves for the PWA install
       * card does not reach it. A browser found the card sitting on top of the
       * "Finish setup" button: the primary action of the first screen a new
       * shop ever sees, at exactly the moment that banner appears.
       *
       * `dvh`, not `vh`: on a phone with the address bar showing, `100vh` is
       * taller than the window and the bottom of the card is already off the
       * screen before anything is pinned to it. That one has cost this codebase
       * a Save button before. */}
      <div className="flex min-h-dvh items-center justify-center bg-gray-50 p-6 pb-[calc(1.5rem+var(--pinned-bottom,0px))] dark:bg-gray-900">
        <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-8 dark:border-gray-800 dark:bg-white/[0.03]">
          <h1 className="mb-1 text-title-sm font-semibold text-gray-800 dark:text-white/90">
            Set up {user?.tenant?.business_name ?? `your ${noun.lower}`}
          </h1>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
            Just a couple of basics — tell us where your {noun.lower} is and you&rsquo;re ready to go.
          </p>

          {generalError && (
            <div className="mb-5">
              <Alert variant="error" title="Setup failed" message={generalError} />
            </div>
          )}

          <form onSubmit={submit} className="space-y-5">
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

            <div>
              <Label>
                City <span className="text-error-500">*</span>
              </Label>
              <Select
                value={cityId}
                options={(cities.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                placeholder={cities.isLoading ? "Loading cities…" : "Choose your city"}
                onChange={setCityId}
              />
              {fieldErrors.city_id && (
                <p className="mt-1 text-theme-xs text-error-500">{fieldErrors.city_id[0]}</p>
              )}
            </div>

            <div>
              <Label>{noun.Title} location</Label>
              <MapPicker value={coords} onChange={onLocation} />
              {coords && (
                <p className="mt-1 text-theme-xs text-success-600 dark:text-success-400">
                  Pinned at {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                  {detectedCity ? ` · ${detectedCity}` : ""}
                </p>
              )}
              {(fieldErrors.latitude || fieldErrors.longitude) && (
                <p className="mt-1 text-theme-xs text-error-500">
                  {(fieldErrors.latitude ?? fieldErrors.longitude)![0]}
                </p>
              )}
            </div>

            <div>
              <Label>Address {coords ? "" : "(optional)"}</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={`${noun.Title} street address`} />
            </div>

            <Button className="w-full" size="sm" disabled={setup.isPending || !cityId}>
              {setup.isPending ? "Saving…" : "Finish setup"}
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
