import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getGeocoder, tileLayer, type GeoPlace } from "../../common/maps/geocoding";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, PINNED_MAP_ZOOM, mapsConfigured } from "../../config/maps";

export interface PickedLocation {
  lat: number;
  lng: number;
  /** The resolved place (address, city…) — null while reverse geocoding. */
  place: GeoPlace | null;
}

interface MapPickerProps {
  value: { lat: number; lng: number } | null;
  onChange: (loc: PickedLocation) => void;
  heightClass?: string;
}

// Brand-coloured teardrop pin as inline SVG — a divIcon avoids Leaflet's
// classic bundler problem where the default marker PNGs 404.
const brandPin = L.divIcon({
  className: "shopos-map-pin",
  html: `<svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 39c1.7-2 12-14.3 12-23A12 12 0 1 0 4 16c0 8.7 10.3 21 12 23Z" fill="#465fff" stroke="#fff" stroke-width="2"/>
    <circle cx="16" cy="16" r="4.5" fill="#fff"/>
  </svg>`,
  iconSize: [32, 40],
  iconAnchor: [16, 38],
});

const geocoder = getGeocoder();

/**
 * Pin-drop location picker: search an address, drag the pin, or use the
 * device GPS. Every move reverse-geocodes so the parent gets lat/lng AND a
 * resolved city/address in one callback. Provider-agnostic (see geocoding.ts).
 */
export default function MapPicker({ value, onChange, heightClass = "h-72" }: MapPickerProps) {
  // Hooks first — this component returns early when maps are unconfigured, and
  // an early return above a hook changes the hook order between renders.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  // ── Init the map once ────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const start = value ?? DEFAULT_MAP_CENTER;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true })
      .setView([start.lat, start.lng], value ? PINNED_MAP_ZOOM : DEFAULT_MAP_ZOOM);

    const tiles = tileLayer();
    L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: tiles.maxZoom }).addTo(map);

    // Dropping / dragging the pin resolves the address for the parent.
    const place = async (lat: number, lng: number) => {
      setMarker(lat, lng);
      onChangeRef.current({ lat, lng, place: null });
      try {
        const resolved = await geocoder.reverse(lat, lng);
        onChangeRef.current({ lat, lng, place: resolved });
      } catch {
        /* reverse geocode is best-effort — coordinates already emitted */
      }
    };

    map.on("click", (e: L.LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng));

    mapRef.current = map;
    if (value) setMarker(value.lat, value.lng);

    // Leaflet needs a re-measure once its container has real dimensions.
    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker in sync if the parent sets coordinates externally (e.g.
  // Settings loading a saved pin after mount). Recenter only when the pin
  // FIRST appears this way — never yank the view during a click/drag.
  useEffect(() => {
    if (!mapRef.current || !value) return;
    const firstPin = !markerRef.current;
    setMarker(value.lat, value.lng);
    if (firstPin) mapRef.current.setView([value.lat, value.lng], PINNED_MAP_ZOOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  function setMarker(lat: number, lng: number) {
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      const marker = L.marker([lat, lng], { icon: brandPin, draggable: true }).addTo(map);
      marker.on("dragend", async () => {
        const { lat: dLat, lng: dLng } = marker.getLatLng();
        onChangeRef.current({ lat: dLat, lng: dLng, place: null });
        try {
          const resolved = await geocoder.reverse(dLat, dLng);
          onChangeRef.current({ lat: dLat, lng: dLng, place: resolved });
        } catch {
          /* best-effort */
        }
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng([lat, lng]);
    }
  }

  // ── Address autocomplete (debounced) ─────────────────────────────────
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const bias = mapRef.current
      ? { lat: mapRef.current.getCenter().lat, lng: mapRef.current.getCenter().lng }
      : undefined;
    const t = setTimeout(async () => {
      try {
        setResults(await geocoder.autocomplete(q, bias));
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const choose = (p: GeoPlace) => {
    setQuery(p.formatted);
    setOpen(false);
    setResults([]);
    const map = mapRef.current;
    if (map) map.setView([p.lat, p.lng], PINNED_MAP_ZOOM);
    setMarker(p.lat, p.lng);
    onChangeRef.current({ lat: p.lat, lng: p.lng, place: p });
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const map = mapRef.current;
        if (map) map.setView([lat, lng], PINNED_MAP_ZOOM);
        setMarker(lat, lng);
        onChangeRef.current({ lat, lng, place: null });
        try {
          onChangeRef.current({ lat, lng, place: await geocoder.reverse(lat, lng) });
        } catch {
          /* best-effort */
        }
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  // No map key in this build. Say so, rather than rendering a search box that
  // never returns anything and a grey square where the map should be — which
  // is indistinguishable from broken software and was reported as exactly that.
  if (!mapsConfigured) {
    return (
      <div className={`flex ${heightClass} flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center dark:border-gray-700 dark:bg-white/[0.02]`}>
        <p className="text-theme-sm font-medium text-gray-700 dark:text-gray-300">
          Map search is not set up on this installation
        </p>
        <p className="max-w-sm text-theme-xs text-gray-500 dark:text-gray-400">
          Your address fields below still work and still save. Pinning a location on the map
          needs a map key — ask whoever set up your ShopOS to add one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Search + GPS */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            // A raw input rather than the shared <Input>, so the automatic
            // label fallback never runs on it — and there is no visible label
            // either, only the placeholder.
            aria-label="Search for your shop address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search your shop address…"
            className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-xs text-gray-400">…</span>
          )}
          {open && results.length > 0 && (
            <ul className="absolute z-[1000] mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-theme-lg dark:border-gray-700 dark:bg-gray-900">
              {results.map((r, i) => (
                <li key={`${r.lat},${r.lng},${i}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(r)}
                    className="block w-full px-3 py-2 text-left text-theme-sm text-gray-700 hover:bg-brand-50 dark:text-gray-200 dark:hover:bg-brand-500/10"
                  >
                    {r.formatted}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-theme-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          title="Use my current location"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4"><circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.6" /><path d="M10 1.5v2.5M10 16v2.5M18.5 10H16M4 10H1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          {locating ? "Locating…" : "Locate me"}
        </button>
      </div>

      {/* Map */}
      <div ref={containerRef} className={`${heightClass} w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700`} />
      <p className="text-theme-xs text-gray-400">Search, tap the map, or drag the pin to set your exact shop location.</p>
    </div>
  );
}
