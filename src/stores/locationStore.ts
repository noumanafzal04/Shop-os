import { create } from "zustand";
import { marketplaceService, type LocateResult } from "../modules/marketplace/services/marketplaceService";
import { reverseGeocode } from "../services/geo";
import { askForLocation, currentPosition } from "../services/position";

/**
 * Foodpanda model — NO city picker. On launch: GPS → /marketplace/locate →
 * city resolved automatically. The user can later move the pin (delivery
 * address); everything (home feed, distances, delivery radius) follows it.
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
  detect: () => Promise<void>;
  /** Manually set the pin (map picker / saved address). */
  setPin: (lat: number, lng: number, label?: string) => Promise<void>;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  status: "idle",
  lat: null,
  lng: null,
  city: null,
  label: null,

  detect: async () => {
    if (get().status === "locating") return;
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
      });
    } catch {
      // Backend unreachable — keep the pin so distances still work later.
      set({ lat, lng, label: label ?? null, status: "located" });
    }

    // Upgrade the label to a street address ("49 Saeed Street, Gulberg") —
    // async and best-effort; the city name already rendered.
    if (!label) {
      const street = await reverseGeocode(lat, lng);
      if (street && get().lat === lat && get().lng === lng) {
        set({ label: street });
      }
    }
  },
}));
