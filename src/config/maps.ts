/**
 * Maps configuration — provider-switchable. Geoapify is used now; Google is
 * wired as an option so a later switch is a config change, not a rewrite.
 *
 * These keys are client-side by design (both Geoapify and Google Maps JS run
 * in the browser) — lock them down by allowed domain/referrer in the provider
 * dashboard, not by hiding them. Values come from Vite env with a dev fallback.
 */
export type MapsProvider = "geoapify" | "google";

export const mapsConfig = {
  provider: ((import.meta.env.VITE_MAPS_PROVIDER as string) || "geoapify") as MapsProvider,
  geoapifyApiKey: (import.meta.env.VITE_GEOAPIFY_API_KEY as string) || "b6b195b0c6d946d282733dbc9b2c841e",
  googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || "",
};

/** Country bias for geocoding (ISO 3166-1 alpha-2). Most shops are here. */
export const MAPS_COUNTRY_BIAS = "pk";

/** Where the map opens when a shop has no coordinates yet (Pakistan centroid). */
export const DEFAULT_MAP_CENTER = { lat: 30.3753, lng: 69.3451 };
export const DEFAULT_MAP_ZOOM = 5;
/** Zoom used once a specific point (search result / dropped pin) is chosen. */
export const PINNED_MAP_ZOOM = 16;
