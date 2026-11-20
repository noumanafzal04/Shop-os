/**
 * THE RULES BEHIND "ADD AN ADDRESS" — kept out of the screen so they can be
 * tested without a map.
 *
 * foodpanda's flow: drop the pin on a map (or search, or use where you are),
 * read the street the pin landed on, add the house / flat / floor, give it a
 * name — Home, Work, or one of your own — and save.
 *
 * The server keeps one `address` line (max 500) and a `label` (max 40). The
 * house details and the street the map found are written into that one line
 * as "details · street", and split back the same way when the address is
 * edited, so no server change was needed.
 */

export const LABEL_KINDS = ["Home", "Work", "Other"] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];

/** Between the house details and the street, in the saved line. */
export const SEP = " · ";
export const ADDRESS_MAX = 500;
export const LABEL_MAX = 40;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The one line the server keeps. A SEP typed into the details is flattened so the split stays exact. */
export function composeAddress(details: string | null | undefined, place: string | null | undefined): string {
  const d = clean(details)
    .split(SEP.trim())
    .map((p) => p.trim())
    .filter(Boolean)
    .join(", ");
  const p = clean(place);
  const line = d && p ? `${d}${SEP}${p}` : d || p;
  return line.slice(0, ADDRESS_MAX);
}

/** The other way round, for editing a saved address. A line with no SEP is all street. */
export function splitAddress(address: string | null | undefined): { details: string; place: string } {
  const line = clean(address);
  const at = line.indexOf(SEP);
  if (at < 0) return { details: "", place: line };
  return { details: line.slice(0, at).trim(), place: line.slice(at + SEP.length).trim() };
}

/** Which chip a saved label belongs to. "home" and "HOME" are Home; any other name is Other. */
export function labelKind(label: string | null | undefined): LabelKind {
  const l = clean(label).toLowerCase();
  if (l === "home") return "Home";
  if (l === "work" || l === "office") return "Work";
  return "Other";
}

/** The label sent to the server. Other with no name typed is "Other". */
export function finalLabel(kind: LabelKind, custom: string | null | undefined): string {
  if (kind !== "Other") return kind;
  return (clean(custom) || "Other").slice(0, LABEL_MAX);
}

/** The name an Other chip shows when editing ("Ammi's house"), empty for Home/Work. */
export function customName(label: string | null | undefined): string {
  const l = clean(label);
  return labelKind(l) === "Other" && l.toLowerCase() !== "other" ? l : "";
}

export interface DraftAddress {
  lat: number | null;
  lng: number | null;
  place: string | null;
  details: string;
}

/**
 * Ready to save: the pin is set AND there is something to read. When the
 * street could not be found (no key, no network) the house details carry it.
 */
export function canSave(d: DraftAddress): boolean {
  if (d.lat == null || d.lng == null || !Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return false;
  return composeAddress(d.details, d.place).length > 0;
}

/** Metres between two points (haversine). */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * ONE LOOKUP PER PLACE. A map fires "moved" for every nudge; the street is
 * asked again only when the pin moved this far from the last place asked.
 */
export const LOOKUP_STEP_M = 15;

export function needsLookup(
  last: { lat: number; lng: number } | null,
  next: { lat: number; lng: number },
  step = LOOKUP_STEP_M,
): boolean {
  if (!last) return true;
  return metresBetween(last, next) >= step;
}

/** A key ~11 m wide, for remembering streets already looked up this session. */
export const pinKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;
