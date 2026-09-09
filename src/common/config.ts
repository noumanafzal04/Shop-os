import { Platform } from "react-native";
import { GEOAPIFY_KEY, GOOGLE_MAPS_KEY } from "./secrets";

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
 * Maps / geocoding provider — Google. `geoService` picks the implementation
 * from this, and both providers are implemented in `services/geo.ts`.
 *
 * ── The keys are NOT in this file any more ───────────────────────────
 *
 * They were literals here, and this file is TRACKED in a PUBLIC repository. A
 * working Geoapify key sat here and was readable by anyone from the moment it
 * was committed; rotating it was a code change. The TODO that used to be at
 * this spot said "set the key locally and do not commit it", which is a rule
 * one `git add -A` defeats — and this repo gets a lot of those.
 *
 * `secrets.ts` is gitignored and holds the real values. `secrets.example.ts`
 * is tracked, carries the empty shape, and `npm install` copies it across if
 * the real file is missing, so a fresh clone still bundles.
 *
 * Geocoding fails soft — `geo.ts` returns null/[] — so an empty key degrades
 * address autocomplete rather than breaking the app.
 */
export const MAPS_PROVIDER: "geoapify" | "google" = "google";
export const GEOAPIFY_API_KEY = GEOAPIFY_KEY;
export const GOOGLE_MAPS_API_KEY = GOOGLE_MAPS_KEY;

if (__DEV__) {
  /**
   * Warns about the key the provider ACTUALLY uses.
   *
   * The old version only ever checked Geoapify, so switching to Google with an
   * empty Google key would have gone quiet — the one moment the warning was
   * for.
   */
  const key = MAPS_PROVIDER === "google" ? GOOGLE_MAPS_API_KEY : GEOAPIFY_API_KEY;
  if (!key) {
    console.warn(
      `[maps] ${MAPS_PROVIDER} key is empty — address search and reverse ` +
        "geocoding will return nothing. Put it in src/common/secrets.ts " +
        "(gitignored); see secrets.example.ts.",
    );
  }
}
