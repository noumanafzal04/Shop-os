/**
 * WHAT THE TRACKING MAP FRAMES — kept out of the component so it can be tested
 * without a map.
 *
 * With the rider and the door both known, the map frames both with a margin
 * (foodpanda's view: the bike and the house in one picture). With only the
 * rider, it centres on them at street level. Never zoomed in past street level
 * — two pins 20 m apart should not fill the screen with one roof.
 */
export interface Pin {
  lat: number;
  lng: number;
}

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Street level: about 500 m across. */
export const MIN_DELTA = 0.005;
/** Room around the two pins so neither sits on the map's edge. */
export const MARGIN = 1.6;

export const isPin = (p: Partial<Pin> | null | undefined): p is Pin =>
  !!p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng);

export function trackingRegion(rider: Pin | null, home: Pin | null): Region | null {
  const pins = [rider, home].filter(isPin);
  if (pins.length === 0) return null;
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(MIN_DELTA, (maxLat - minLat) * MARGIN),
    longitudeDelta: Math.max(MIN_DELTA, (maxLng - minLng) * MARGIN),
  };
}
