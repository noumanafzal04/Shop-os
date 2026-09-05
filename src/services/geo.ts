import { GEOAPIFY_API_KEY, GOOGLE_MAPS_API_KEY, MAPS_PROVIDER } from "../common/config";

/**
 * Provider-agnostic geocoding. Geoapify today, Google later — callers never
 * know which answered. Both calls degrade to null/[] on any failure so the
 * app keeps working without a geocoder (labels fall back to the city name).
 */

export interface AddressSuggestion {
  label: string;      // "49 Saeed Street, Gulberg"
  detail: string;     // "Lahore, Pakistan"
  lat: number;
  lng: number;
}

/** Coordinates → a short human label ("49 Saeed Street, Gulberg"). */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    if (MAPS_PROVIDER === "google" && GOOGLE_MAPS_API_KEY) {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`,
      );
      const json = await res.json();
      return json.results?.[0]?.formatted_address?.split(",").slice(0, 2).join(",") ?? null;
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
      // Google Places text search (swap-in path; not used until a key is set).
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
