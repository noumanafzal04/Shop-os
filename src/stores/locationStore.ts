import { create } from "zustand";
import { PermissionsAndroid, Platform } from "react-native";
import Geolocation from "@react-native-community/geolocation";
import { marketplaceService, type LocateResult } from "../modules/marketplace/services/marketplaceService";
import { reverseGeocode } from "../services/geo";
import { BRAND } from "../common/brand";

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

const getPosition = () =>
  new Promise<{ lat: number; lng: number }>((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      reject,
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
    );
  });

export const useLocationStore = create<LocationState>((set, get) => ({
  status: "idle",
  lat: null,
  lng: null,
  city: null,
  label: null,

  detect: async () => {
    if (get().status === "locating") return;
    set({ status: "locating" });

    try {
      if (Platform.OS === "android") {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: "Find shops near you",
            message: `${BRAND.name} uses your location to show nearby shops and delivery options.`,
            buttonPositive: "Allow",
          },
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          set({ status: "denied" });
          return;
        }
      }

      const { lat, lng } = await getPosition();
      await get().setPin(lat, lng);
    } catch {
      // Timeout / services off / iOS denial all land here.
      set({ status: "denied" });
    }
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
