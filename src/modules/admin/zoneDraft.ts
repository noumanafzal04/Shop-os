/**
 * A SERVICE ZONE BEING DRAWN — everything about it that is not the map.
 *
 * The admin draws where the platform serves: a circle (a centre and a radius
 * in metres) or a shape (corners clicked one by one — in a small town, along
 * the main road rather than round a whole district of lanes). The server
 * refuses a shape under three corners and a circle outside 50 m … 100 km; this
 * says the same thing before the button, in the same words.
 */
export type ZoneKind = "circle" | "polygon";

export type Corner = [number, number]; // [lat, lng]

export interface ServiceZone {
  id: string;
  name: string;
  city_id: string | null;
  city?: { id: string; name: string } | null;
  kind: ZoneKind;
  center_lat: number | null;
  center_lng: number | null;
  radius_m: number | null;
  points: Corner[] | null;
  is_active: boolean;
}

export interface ZoneSummary {
  zones_active: number;
  online_shops: number;
  online_shops_outside: number;
}

export interface ZoneDraft {
  id?: string;
  name: string;
  city_id: string | null;
  kind: ZoneKind;
  center: { lat: number; lng: number } | null;
  radius_m: number;
  points: Corner[];
  is_active: boolean;
}

export const MIN_RADIUS_M = 50;
export const MAX_RADIUS_M = 100_000;
export const MIN_CORNERS = 3;
/** A new circle starts at a kilometre — a neighbourhood — and is dragged from there. */
export const DEFAULT_RADIUS_M = 1000;

export const newCircleDraft = (center: { lat: number; lng: number } | null = null): ZoneDraft => ({
  name: "", city_id: null, kind: "circle", center, radius_m: DEFAULT_RADIUS_M, points: [], is_active: true,
});

export const newShapeDraft = (): ZoneDraft => ({
  name: "", city_id: null, kind: "polygon", center: null, radius_m: DEFAULT_RADIUS_M, points: [], is_active: true,
});

export function draftFromZone(z: ServiceZone): ZoneDraft {
  return {
    id: z.id,
    name: z.name,
    city_id: z.city_id,
    kind: z.kind,
    center: z.center_lat !== null && z.center_lng !== null ? { lat: Number(z.center_lat), lng: Number(z.center_lng) } : null,
    radius_m: z.radius_m ?? DEFAULT_RADIUS_M,
    points: (z.points ?? []).map(([lat, lng]) => [Number(lat), Number(lng)] as Corner),
    is_active: z.is_active,
  };
}

/** A radius as a person types it: whole metres, inside the server's range. */
export function clampRadius(metres: number): number {
  if (!Number.isFinite(metres)) return DEFAULT_RADIUS_M;

  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(metres)));
}

/** Why this draft cannot be saved yet — the server's own reasons — or null. */
export function whyNotSave(d: ZoneDraft): string | null {
  if (d.name.trim() === "") return "Give the zone a name — the area or the road it covers.";
  if (d.kind === "circle") {
    if (d.center === null) return "Click the map where the circle's centre goes.";
    if (d.radius_m < MIN_RADIUS_M || d.radius_m > MAX_RADIUS_M) return "A circle runs from 50 metres to 100 km.";

    return null;
  }

  return d.points.length < MIN_CORNERS ? "A shape needs at least 3 corners." : null;
}

/** What the server is sent: the drawn shape's own fields only. */
export function zonePayload(d: ZoneDraft): Record<string, unknown> {
  const common = { name: d.name.trim(), city_id: d.city_id, kind: d.kind, is_active: d.is_active };

  return d.kind === "circle"
    ? { ...common, center_lat: d.center?.lat, center_lng: d.center?.lng, radius_m: d.radius_m }
    : { ...common, points: d.points };
}

/** "762 m" under a kilometre, "1.2 km" over it. */
export function distanceLabel(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(Math.round(metres / 100) / 10).toLocaleString("en")} km`;
}

/** The line a zone reads as in the list. */
export function describeZone(z: Pick<ServiceZone, "kind" | "radius_m" | "points">): string {
  return z.kind === "circle"
    ? `Circle · ${distanceLabel(z.radius_m ?? 0)}`
    : `Shape · ${(z.points ?? []).length} corners`;
}

/** The sentence over the map, or null when nothing outside is worth saying. */
export function outsideWarning(s: ZoneSummary | undefined): string | null {
  if (!s || s.zones_active === 0) return null;
  if (s.online_shops_outside === 0) return null;

  return s.online_shops_outside === 1
    ? "1 online shop is outside every active zone — customers cannot see it."
    : `${s.online_shops_outside} online shops are outside every active zone — customers cannot see them.`;
}
