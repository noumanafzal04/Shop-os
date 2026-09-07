import { Platform } from "react-native";

/**
 * A PAIR OF COORDINATES, HANDED TO WHATEVER MAPS APP THE PHONE HAS.
 *
 * ── Why a URL and not a map ──────────────────────────────────────────
 *
 * A map inside the app means a native module, a tile bill, and an API key in a
 * build — for a picture the phone's own maps app draws better, with the
 * person's saved places, their traffic, and turn-by-turn voice they already
 * trust. Two taps instead of one, and everything after the tap is somebody
 * else's problem.
 *
 * ── The two platforms ────────────────────────────────────────────────
 *
 * `geo:` is the Android intent every navigation app registers for, so the
 * phone offers whichever ones are installed rather than this app choosing.
 * iOS has no `geo:` handler and takes an Apple Maps URL.
 *
 * Neither is guaranteed to resolve — a phone with no maps app is unusual, not
 * impossible — so every caller has to have something to say when the open
 * fails. That is why this returns a string instead of opening it: a helper
 * that swallowed the failure would make "nothing happened" the behaviour on
 * exactly the phones where it matters.
 */
export function mapsUrl(lat: number, lng: number, label: string): string {
  return Platform.OS === "ios"
    ? `http://maps.apple.com/?daddr=${lat},${lng}`
    : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`;
}

/**
 * "About 1.4 km away", or null when the distance is not known.
 *
 * ── Why the word "about" is in the string ────────────────────────────
 *
 * The number is a straight line. A rider 1.2 km away across a canal with one
 * bridge is fifteen minutes, and an app that says "1.2 km" without hedging has
 * made a promise about a road it has not looked at.
 *
 * Under a kilometre reads in metres, rounded to fifty, because "0.3 km" is a
 * number nobody pictures and "about 300 m" is a walk to the corner. Rounded
 * rather than exact for the same reason the word "about" is there: a pin from
 * a phone GPS is not accurate to ten metres, and printing 287 m claims it is.
 */
export function distanceLabel(km: number | null | undefined): string | null {
  if (km == null || !Number.isFinite(km) || km < 0) return null;

  if (km < 1) {
    const metres = Math.max(50, Math.round((km * 1000) / 50) * 50);
    return `About ${metres} m away`;
  }

  // One decimal up to ten kilometres, whole numbers past it — the difference
  // between 12.3 and 12 km is not a difference to anybody waiting.
  return km < 10 ? `About ${km.toFixed(1)} km away` : `About ${Math.round(km)} km away`;
}
