import { Platform } from "react-native";

/**
 * Which backend the app talks to.
 *
 * ── Flip this one line to test against live ───────────────────────────
 *
 * `"auto"`  a debug build talks to the machine that built it; a release
 *           build talks to production. The normal case.
 * `"live"`  a debug build talks to PRODUCTION — real shops, real orders.
 *           This is how you check a change against live data from an
 *           emulator, and it is exactly as real as it sounds: an order
 *           placed here is an order a shop has to deliver.
 * `"tunnel"` a debug build talks to `TUNNEL_URL` — a phone on mobile data
 *           reaching a laptop, via ngrok or trycloudflare.
 */
type ApiTarget = "auto" | "live" | "tunnel";

// Cast, not an annotation: TypeScript narrows `const x: "a" | "b" = "a"` to the
// literal it was given and then calls every other branch dead code. The point
// of this line is that it gets edited.
const API_TARGET = "auto" as ApiTarget;

/**
 * PRODUCTION.
 *
 * An ADDRESS, deliberately a literal: the API does not move house because the
 * product was renamed, and deriving this from the brand would point a shipped
 * build at a domain nobody owns the day the name changes.
 *
 * `panel.cartze.shop` is the WEB PANEL and answers /api/* with its own HTML —
 * a 200 that is not the API. This host is the one that serves it.
 */
const PROD_URL = "https://cartze.shop/api/v1";

/**
 * The tunnel URL changes every time the tunnel restarts. Only read when
 * API_TARGET is "tunnel".
 */
const TUNNEL_URL = "";

/**
 * Dev API host differs per platform:
 *  - iOS simulator reaches the Mac's localhost directly
 *  - Android emulator reaches it via 10.0.2.2
 * A real device on the same Wi-Fi needs the machine's LAN IP — use the tunnel
 * above rather than editing this, so the platform mapping stays correct.
 */
const DEV_HOST = Platform.select({
  ios: "http://localhost:8000",
  android: "http://10.0.2.2:8000",
  default: "http://localhost:8000",
});

export const API_BASE_URL =
  API_TARGET === "live"
    ? PROD_URL
    : API_TARGET === "tunnel" && TUNNEL_URL
      ? `${TUNNEL_URL}/api/v1`
      : __DEV__
        ? `${DEV_HOST}/api/v1`
        : PROD_URL;

if (__DEV__ && API_TARGET === "live") {
  console.warn(
    "[api] Talking to PRODUCTION. Orders placed here are real orders. " +
      "Set API_TARGET back to \"auto\" in src/common/config.ts.",
  );
}

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
