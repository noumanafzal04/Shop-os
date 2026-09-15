import { create } from "zustand";
import { prefs } from "../common/utils/prefs";
import { marketplaceService, type LocateResult } from "../modules/marketplace/services/marketplaceService";
import { reverseGeocode } from "../services/geo";
import { askForLocation, currentPosition } from "../services/position";

/**
 * Foodpanda model — NO city picker. Everything (home feed, distances, delivery
 * radius) follows one pin.
 *
 * ── AUTOMATIC ONCE, MANUAL FOR EVER AFTER ────────────────────────────
 *
 * The rule, and it was the wrong way round. `status` began every launch at
 * `idle`, nothing was persisted, and the home screen ran `detect()` whenever it
 * saw `idle` — so GPS wrote the phone's CURRENT position over whatever the
 * shopper had chosen, every single time they opened the app.
 *
 * Somebody ordering to their mother's house from the office set the pin, came
 * back an hour later, and the app had quietly moved them. Not a cosmetic
 * failure: the pin decides which shops are listed at all, what the delivery fee
 * is, and whether checkout refuses the order as out of area.
 *
 * So the pin is remembered, and after the first launch nothing changes it
 * except a person: the map picker, a saved address, or pressing "Use my current
 * location". `detect()` refuses to run over a pin that already exists unless it
 * is asked twice — see its `force` argument.
 *
 * States: idle → locating → located | denied | unserved
 *  - denied:   permission refused → browse city-less (backend still works)
 *  - unserved: located but >60km from any city we serve
 */
export type LocationStatus = "idle" | "locating" | "located" | "denied" | "unserved";

interface LocationState {
  status: LocationStatus;
  lat: number | null;
  lng: number | null;
  city: LocateResult["city"];
  /** Human label shown in the header ("Gulberg, Lahore" / saved-address label). */
  label: string | null;
  /**
   * Whether the pin came back from the last session rather than from GPS just
   * now. Read by the header so it can say "change" rather than implying the
   * app is still looking.
   */
  restored: boolean;
  /**
   * Bring back the pin this device last used. Called before `detect`.
   *
   * Resolves to true when there was one, which is also the answer to "may GPS
   * run" — nothing else about the app has to know where it was kept.
   */
  hydrate: () => Promise<boolean>;
  /**
   * Find them by GPS.
   *
   * Refuses to overwrite a pin that already exists unless `force` — that is
   * the whole difference between the first launch and every launch after it.
   * Pass `force` only from a control a person pressed.
   */
  detect: (force?: boolean) => Promise<void>;
  /** Manually set the pin (map picker / saved address). */
  setPin: (lat: number, lng: number, label?: string) => Promise<void>;
  /** Forget it, so the next launch detects again. */
  forget: () => Promise<void>;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  status: "idle",
  lat: null,
  lng: null,
  city: null,
  label: null,
  restored: false,

  hydrate: async () => {
    if (get().lat !== null) return true;

    const { place } = await prefs.all();
    if (place == null) return false;

    // Set straight from the remembered values — no `locate` call, no reverse
    // geocode, no spinner. The label was resolved when they chose it, and
    // asking the network to confirm a decision a person already made is how a
    // header flickers through "Locating…" on every cold start.
    set({
      status: "located",
      lat: place.lat,
      lng: place.lng,
      city: place.city,
      label: place.label,
      restored: true,
    });

    return true;
  },

  forget: async () => {
    await prefs.forgetPlace();
    set({ status: "idle", lat: null, lng: null, city: null, label: null, restored: false });
  },

  detect: async (force = false) => {
    if (get().status === "locating") return;

    // THE RULE. A pin that exists was put there by somebody, either in this
    // session or in a previous one, and GPS does not get to have an opinion
    // about it. `force` is what a pressed button carries.
    if (!force && get().lat !== null) return;

    set({ status: "locating" });

    /**
     * ONE COPY OF THE PERMISSION PROMPT, AND IT IS `position.ts`.
     *
     * This file had its own — a bare `request(ACCESS_FINE_LOCATION)` — beside
     * the rider's. Two copies meant one bug in two places: since Android 12,
     * a person who taps Allow with **Approximate** selected grants COARSE and
     * denies FINE, so a request for FINE alone comes back denied after they
     * pressed Allow. The shopper was then told to allow a location they had
     * just allowed, and the app browsed city-less with a blank pin.
     */
    const allowed = await askForLocation(
      "uses your location to show nearby shops and delivery options.",
    );
    if (!allowed) {
      set({ status: "denied" });
      return;
    }

    // `currentPosition` never throws and retries once without high accuracy,
    // so a phone that cannot see satellites indoors still resolves its city.
    const { fix } = await currentPosition();
    if (fix == null) {
      set({ status: "denied" });
      return;
    }

    await get().setPin(fix.latitude, fix.longitude);
  },

  setPin: async (lat, lng, label) => {
    try {
      const { data } = await marketplaceService.locate(lat, lng);
      set({
        lat,
        lng,
        city: data.city,
        label: label ?? data.city?.name ?? null,
        status: data.in_service_area ? "located" : "unserved",
        restored: false,
      });
    } catch {
      // Backend unreachable — keep the pin so distances still work later.
      set({ lat, lng, label: label ?? null, status: "located", restored: false });
    }

    // REMEMBERED HERE, and not at each of the four call sites. A pin the app
    // resolved and did not write down is a pin it loses at the next cold
    // start, which is the bug this whole file was rewritten for.
    void remember(get);

    // Upgrade the label to a street address ("49 Saeed Street, Gulberg") —
    // async and best-effort; the city name already rendered.
    if (!label) {
      const street = await reverseGeocode(lat, lng);
      if (street && get().lat === lat && get().lng === lng) {
        set({ label: street });
        // Written down again with the better label, or the header would come
        // back as "Lahore" tomorrow after saying "49 Saeed Street" today.
        void remember(get);
      }
    }
  },
}));

/**
 * Write the current pin down.
 *
 * Failure is deliberately silent: not remembering a location is not worth
 * interrupting anybody over, and the pin is still correct for this run.
 */
function remember(get: () => LocationState): Promise<void> {
  const { lat, lng, label, city } = get();
  if (lat === null || lng === null) return Promise.resolve();

  return prefs.setPlace({ lat, lng, label, city }).catch(() => {});
}
