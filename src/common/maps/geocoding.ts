/**
 * Geocoding + tiles behind a provider-agnostic interface. The app talks to
 * `getGeocoder()` / `tileLayer()` and never to a specific vendor, so swapping
 * Geoapify → Google is a config change (see src/config/maps.ts).
 */
import { MAPS_COUNTRY_BIAS, mapsConfig } from "../../config/maps";

/** A resolved place — the shape the app consumes regardless of provider. */
export interface GeoPlace {
  lat: number;
  lng: number;
  formatted: string;
  city: string | null;
  state: string | null;
  country: string | null;
  postcode: string | null;
}

export interface GeocodingProvider {
  /** Type-ahead address search. Returns [] for queries shorter than 3 chars. */
  autocomplete(text: string, bias?: { lat: number; lng: number }): Promise<GeoPlace[]>;
  /** Resolve coordinates → address/city (used when a pin is dropped/dragged). */
  reverse(lat: number, lng: number): Promise<GeoPlace | null>;
}

export interface MapTileLayer {
  url: string;
  attribution: string;
  maxZoom: number;
}

// ── Geoapify ─────────────────────────────────────────────────────────────
const GEOAPIFY_GEOCODE = "https://api.geoapify.com/v1/geocode";

// Geoapify returns city under different keys depending on the place; fall back
// through the common ones so we almost always get *some* locality name.
function geoapifyPlace(feature: {
  properties?: Record<string, unknown>;
}): GeoPlace {
  const p = (feature.properties ?? {}) as Record<string, string | number | undefined>;
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  return {
    lat: num(p.lat),
    lng: num(p.lon),
    formatted: (p.formatted as string) ?? "",
    city:
      (p.city as string) ??
      (p.town as string) ??
      (p.village as string) ??
      (p.municipality as string) ??
      (p.county as string) ??
      null,
    state: (p.state as string) ?? null,
    country: (p.country as string) ?? null,
    postcode: (p.postcode as string) ?? null,
  };
}

class GeoapifyProvider implements GeocodingProvider {
  constructor(private readonly key: string) {}

  async autocomplete(text: string, bias?: { lat: number; lng: number }): Promise<GeoPlace[]> {
    if (text.trim().length < 3) return [];
    const params = new URLSearchParams({
      text,
      apiKey: this.key,
      limit: "6",
      format: "geojson",
    });
    if (MAPS_COUNTRY_BIAS) params.set("filter", `countrycode:${MAPS_COUNTRY_BIAS}`);
    if (bias) params.set("bias", `proximity:${bias.lng},${bias.lat}`);

    const res = await fetch(`${GEOAPIFY_GEOCODE}/autocomplete?${params.toString()}`);
    if (!res.ok) throw new Error("Address search failed.");
    const data = (await res.json()) as { features?: Array<{ properties?: Record<string, unknown> }> };
    return (data.features ?? [])
      .map(geoapifyPlace)
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }

  async reverse(lat: number, lng: number): Promise<GeoPlace | null> {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      apiKey: this.key,
      limit: "1",
      format: "geojson",
    });
    const res = await fetch(`${GEOAPIFY_GEOCODE}/reverse?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { features?: Array<{ properties?: Record<string, unknown> }> };
    const f = data.features?.[0];
    return f ? geoapifyPlace(f) : null;
  }
}

// ── Google (placeholder — provider switch lands its map + Places later) ────
class GoogleProvider implements GeocodingProvider {
  async autocomplete(): Promise<GeoPlace[]> {
    throw new Error("Google Maps provider is not implemented yet — set VITE_MAPS_PROVIDER=geoapify.");
  }
  async reverse(): Promise<GeoPlace | null> {
    return null;
  }
}

// ── Factory + tiles ────────────────────────────────────────────────────────
export function getGeocoder(): GeocodingProvider {
  return mapsConfig.provider === "google"
    ? new GoogleProvider()
    : new GeoapifyProvider(mapsConfig.geoapifyApiKey);
}

/** Raster tiles for the Leaflet base map (Geoapify's OSM-bright style). */
export function tileLayer(): MapTileLayer {
  return {
    url: `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${mapsConfig.geoapifyApiKey}`,
    attribution:
      'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · © OpenStreetMap contributors',
    maxZoom: 20,
  };
}
