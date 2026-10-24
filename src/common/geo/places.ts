import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../api/client";

/**
 * Where a shop can be: country → province → city.
 *
 * Reference data from the open countries-states-cities dataset (Pakistan: 7
 * provinces, 458 cities, each with its coordinates). It changes perhaps once
 * a year, so each list is asked once per session and kept — and the server
 * lets the browser keep it for a day, so a reload asks nobody either.
 */
export interface Country {
  id: number;
  name: string;
  iso2: string;
  phone_code: string | null;
  currency: string | null;
}

export interface Province {
  id: number;
  country_id: number;
  name: string;
  type: string | null;
}

export interface PlaceCity {
  id: string;
  name: string;
  /** Null for a city made before provinces existed and never joined to one. */
  province_id: number | null;
  country_id: number | null;
  latitude: number | null;
  longitude: number | null;
}

const KEEP = { staleTime: Infinity, gcTime: Infinity } as const;

export function useCountries() {
  return useQuery({
    queryKey: ["geo", "countries"],
    queryFn: async () => (await apiGet<Country[]>("/countries")).data,
    ...KEEP,
  });
}

export function useProvinces() {
  return useQuery({
    queryKey: ["geo", "provinces"],
    queryFn: async () => (await apiGet<Province[]>("/provinces")).data,
    ...KEEP,
  });
}

/**
 * Every active city. One list for every screen — the shop's setup, its
 * settings, the admin's forms, the marketplace's names — under the key all of
 * them already shared.
 */
export function useCities() {
  return useQuery({
    queryKey: ["cities"],
    queryFn: async () => (await apiGet<PlaceCity[]>("/cities")).data,
    ...KEEP,
  });
}

/** A name as a person types it: no accent marks, no case, no stray spaces. */
const plain = (text: string) =>
  text.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[‘’]/g, "'").trim().toLowerCase();

const NEAR_KM = 40;

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * The city a map pin is in.
 *
 * The map's own answer names a place ("Lahore", "Lahore Cantonment",
 * "Lāhore District") and this looked for any city whose name was INSIDE it.
 * With eight cities that was harmless; with 458 a short name hides inside a
 * long one — "Uch" is in "Kuchlak" — and the shop was filed in the wrong town.
 * So: the exact name, written plainly; failing that, the nearest city to the
 * pin, if one is close enough to be the same place; failing that, nothing,
 * and the person picks.
 */
export function cityForPin(
  cities: PlaceCity[],
  placeName: string | null | undefined,
  at: { lat: number; lng: number } | null,
): PlaceCity | null {
  const wanted = plain(placeName ?? "");
  if (wanted !== "") {
    const named = cities.find((c) => plain(c.name) === wanted);
    if (named) return named;
  }
  if (at === null) return null;

  let best: PlaceCity | null = null;
  let bestKm = NEAR_KM;
  for (const c of cities) {
    if (c.latitude === null || c.longitude === null) continue;
    const d = km(at, { lat: c.latitude, lng: c.longitude });
    if (d < bestKm) {
      best = c;
      bestKm = d;
    }
  }
  return best;
}
