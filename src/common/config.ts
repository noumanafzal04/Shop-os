import { Platform } from "react-native";

/**
 * Dev API host differs per platform:
 *  - iOS simulator reaches the Mac's localhost directly
 *  - Android emulator reaches it via 10.0.2.2
 * Real devices need the machine's LAN IP — override here when testing on-device.
 */
const DEV_HOST = Platform.select({
  ios: "http://localhost:8000",
  android: "http://10.0.2.2:8000",
  default: "http://localhost:8000",
});

/**
 * REAL-DEVICE TESTING: a tunnel to the dev backend. Set to null to fall
 * back to simulator/production URLs. The trycloudflare URL changes every
 * time the tunnel restarts — update it here when it does.
 */
const DEVICE_TEST_URL: string | null = null;

export const API_BASE_URL = DEVICE_TEST_URL
  ? `${DEVICE_TEST_URL}/api/v1`
  : __DEV__
    ? `${DEV_HOST}/api/v1`
    : "https://api.shopos.app/api/v1"; // production URL — set at release time

/**
 * Maps / geocoding provider. Geoapify for now (address autocomplete +
 * reverse geocoding); swap MAPS_PROVIDER to 'google' once a Google key
 * is added — geoService picks the provider automatically.
 *
 * The key is intentionally EMPTY in source. A working one used to sit here as
 * a literal, which put it in a public repo and in git history, and meant
 * rotating it was a code change. Geocoding fails soft (geo.ts returns
 * null/[]), so an empty key degrades address autocomplete rather than
 * breaking the app.
 *
 * TODO before the mobile app ships: this needs a real mechanism — no env
 * library is installed here yet (no react-native-config, no .env). Until one
 * is added, set the key locally and do not commit it.
 */
export const MAPS_PROVIDER: "geoapify" | "google" = "geoapify";
export const GEOAPIFY_API_KEY = "";
export const GOOGLE_MAPS_API_KEY = "";

if (__DEV__ && MAPS_PROVIDER === "geoapify" && !GEOAPIFY_API_KEY) {
  console.warn(
    "[maps] GEOAPIFY_API_KEY is empty — address search and reverse geocoding " +
      "will return nothing. Set it locally in src/common/config.ts; do not commit it.",
  );
}
