import { GEOAPIFY_API_KEY, GOOGLE_MAPS_API_KEY, MAPS_PROVIDER } from "../common/config";

/**
 * Provider-agnostic geocoding. GOOGLE today, Geoapify still implemented beside
 * it — callers never know which answered. Both calls degrade to null/[] on any
 * failure so the app keeps working without a geocoder (labels fall back to the
 * city name).
 *
 * The keys come from `secrets.ts`, which is gitignored, because a working
 * Geoapify key sat in `config.ts` as a literal and is in public git history to
 * this day.
 */

export interface AddressSuggestion {
  label: string;      // "49 Saeed Street, Gulberg"
  detail: string;     // "Lahore, Pakistan"
  lat: number;
  lng: number;
}

/** A Plus Code ("G9C5+5F5") — Google's grid name for a spot, meaningless to a rider. */
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,3}$/i;

/**
 * THE STREET FROM GOOGLE'S ANSWER, without the grid code.
 *
 * Google's first result is often the Plus Code for the exact spot —
 * "G9C5+5F5, Block N Gulberg III" — which a person reads as a typo. Results
 * that ARE a plus code are skipped, a plus code leading any line is dropped,
 * and the first three parts are kept ("House 12, Street 4, Gulberg III").
 */
export function googleLine(results: Array<{ formatted_address?: string; types?: string[] }> | null | undefined): string | null {
  for (const r of results ?? []) {
    if (r.types?.includes("plus_code")) continue;
    const parts = (r.formatted_address ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p && !PLUS_CODE.test(p) && !/^pakistan$/i.test(p));
    if (parts.length) return parts.slice(0, 3).join(", ");
  }
  return null;
}

/** Coordinates → a short human label ("49 Saeed Street, Gulberg"). */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    if (MAPS_PROVIDER === "google" && GOOGLE_MAPS_API_KEY) {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`,
      );
      const json = await res.json();
      return googleLine(json.results);
    }

    const res = await fetch(
      `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&format=json&apiKey=${GEOAPIFY_API_KEY}`,
    );
    const json = await res.json();
    const r = json.results?.[0];
    if (!r) return null;
    const parts = [r.address_line1, r.suburb ?? r.city].filter(Boolean);
    return parts.join(", ") || null;
  } catch {
    return null;
  }
}

/** True when a provider key is configured and an address search can be made. */
export function canSearchAddresses(): boolean {
  return MAPS_PROVIDER === "google" ? !!GOOGLE_MAPS_API_KEY : !!GEOAPIFY_API_KEY;
}

/**
 * Free-text address search → pickable suggestions (autocomplete).
 *
 * `null` means the search COULD NOT BE MADE — no provider key. `[]` means it
 * was made and matched nothing. They are different answers and the screen owes
 * the person a different sentence for each: without the distinction, an unset
 * key looks exactly like "your street does not exist", for every street, for
 * ever, with nothing on screen to say otherwise.
 */
export async function searchAddress(
  text: string,
  bias?: { lat: number; lng: number },
): Promise<AddressSuggestion[] | null> {
  if (!canSearchAddresses()) return null;
  if (text.trim().length < 3) return [];
  try {
    if (MAPS_PROVIDER === "google" && GOOGLE_MAPS_API_KEY) {
      // Google Places text search. This branch is the LIVE one now — the
      // provider was switched and a key configured, so the path that had
      // never run once is the only one that runs.
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(text)}&key=${GOOGLE_MAPS_API_KEY}`,
      );
      const json = await res.json();
      return (json.results ?? []).slice(0, 6).map((r: any) => ({
        label: r.name,
        detail: r.formatted_address ?? "",
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
      }));
    }

    const biasParam = bias ? `&bias=proximity:${bias.lng},${bias.lat}` : "";
    const res = await fetch(
      `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&filter=countrycode:pk&limit=6&format=json${biasParam}&apiKey=${GEOAPIFY_API_KEY}`,
    );
    const json = await res.json();
    return (json.results ?? []).map((r: any) => ({
      label: r.address_line1 ?? r.formatted ?? text,
      detail: r.address_line2 ?? [r.city, r.country].filter(Boolean).join(", "),
      lat: r.lat,
      lng: r.lon,
    }));
  } catch {
    return [];
  }
}
