/**
 * Maps configuration — provider-switchable. Geoapify is used now; Google is
 * wired as an option so a later switch is a config change, not a rewrite.
 *
 * These keys are client-side by design (both Geoapify and Google Maps JS run
 * in the browser) — the real protection is an allowed-domain/referrer lock in
 * the provider dashboard, not secrecy.
 *
 * What is NOT fine is committing one. A literal default here shipped a working
 * key into a public repo, where it stays in git history after any edit, and it
 * made rotation a code change rather than a config change. The key now comes
 * only from the environment, and a missing one fails loudly at startup instead
 * of silently falling back to somebody else's quota.
 */
export type MapsProvider = "geoapify" | "google";

const provider = ((import.meta.env.VITE_MAPS_PROVIDER as string) || "geoapify") as MapsProvider;
const geoapifyApiKey = (import.meta.env.VITE_GEOAPIFY_API_KEY as string) || "";
const googleMapsApiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || "";

// Fail where a developer will see it, not on the map screen a shopkeeper opens
// while pinning their shop. Dev only: a production build must not crash on a
// missing map key when every other screen works fine without one.
if (import.meta.env.DEV) {
  const missing = provider === "geoapify" ? !geoapifyApiKey : !googleMapsApiKey;
  if (missing) {
    console.error(
      `[maps] No API key for provider "${provider}". Set VITE_${
        provider === "geoapify" ? "GEOAPIFY" : "GOOGLE_MAPS"
      }_API_KEY in .env — see .env.example. Address search and the map tiles will not load.`,
    );
  }
}

export const mapsConfig = { provider, geoapifyApiKey, googleMapsApiKey };

/**
 * Is maps actually usable in THIS build?
 *
 * The console warning above is `import.meta.env.DEV` only — correct, since a
 * production build must not crash over a map key when every other screen works
 * without one. But silence was the wrong other half: a staging build went out
 * with no `VITE_GEOAPIFY_API_KEY`, and address search and the map tiles simply
 * did nothing. QA reported it as "address and location functionality missing",
 * which is precisely what a dead field looks like when nothing explains it.
 *
 * The screens now ask this and say so, so a missing key reads as a setting
 * somebody has to fill in rather than as broken software.
 */
export const mapsConfigured =
  provider === "google" ? googleMapsApiKey !== "" : geoapifyApiKey !== "";

/** Country bias for geocoding (ISO 3166-1 alpha-2). Most shops are here. */
export const MAPS_COUNTRY_BIAS = "pk";

/** Where the map opens when a shop has no coordinates yet (Pakistan centroid). */
export const DEFAULT_MAP_CENTER = { lat: 30.3753, lng: 69.3451 };
export const DEFAULT_MAP_ZOOM = 5;
/** Zoom used once a specific point (search result / dropped pin) is chosen. */
export const PINNED_MAP_ZOOM = 16;
