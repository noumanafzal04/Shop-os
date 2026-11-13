import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Switch from "../../../components/form/switch/Switch";
import Alert from "../../../components/ui/alert/Alert";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { ApiError } from "../../../common/types/api";
import { CityPicker } from "../../../common/geo/CityPicker";
import { getGeocoder, tileLayer, type GeoPlace } from "../../../common/maps/geocoding";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "../../../config/maps";
import { Card, Empty, PageHeader } from "../components/kit";
import { zonesService, type ZoneShop } from "../services/zonesService";
import {
  clampRadius, describeZone, distanceLabel, draftFromZone, newCircleDraft, newShapeDraft, outsideWarning, whyNotSave, zonePayload,
  type Corner, type ServiceZone, type ZoneDraft,
} from "../zoneDraft";

const MapGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M9 4v13.5M15 6.5V20" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);

const ZONE = { active: "#03444a", inactive: "#8a949b", draft: "#0f8f93" };

const dot = (label: string | number, colour: string) =>
  L.divIcon({
    className: "service-zone-handle",
    html: `<span style="display:grid;place-items:center;width:24px;height:24px;border-radius:9999px;background:${colour};color:#fff;font:600 11px/1 system-ui;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${label}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

const geocoder = getGeocoder();

/**
 * SERVICE ZONES — WHERE THE PLATFORM SERVES.
 *
 * The admin draws circles (a centre and a radius) or shapes (corners clicked
 * one by one — in a small town, along the main roads rather than round a
 * district of lanes). A shop is listed online only inside an active zone; a
 * delivery goes only to a pin inside one. Nothing is fenced until a zone is
 * active, and every save says how many online shops it leaves outside.
 */
export default function AdminServiceZonesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const zones = useQuery({
    queryKey: ["admin", "service-zones"],
    queryFn: async () => (await zonesService.list()).data,
  });
  const rows = useMemo(() => zones.data?.zones ?? [], [zones.data]);

  const [draft, setDraft] = useState<ZoneDraft | null>(null);
  const draftRef = useRef<ZoneDraft | null>(null);
  draftRef.current = draft;

  const refreshAfter = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "service-zones"] });
    toast.success(message);
  };
  const failed = (fallback: string) => (e: unknown) =>
    toast.error(e instanceof ApiError ? e.firstFieldError() ?? e.message : fallback);

  const save = useMutation({
    mutationFn: (d: ZoneDraft) => (d.id ? zonesService.update(d.id, zonePayload(d)) : zonesService.create(zonePayload(d))),
    onSuccess: (_res, d) => {
      setDraft(null);
      refreshAfter(`Zone "${d.name.trim()}" saved`);
    },
    onError: failed("Couldn't save the zone."),
  });
  const toggle = useMutation({
    mutationFn: (z: ServiceZone) => zonesService.update(z.id, { is_active: !z.is_active }),
    onSuccess: (_res, z) => refreshAfter(z.is_active ? `"${z.name}" switched off` : `"${z.name}" switched on`),
    onError: failed("Couldn't change the zone."),
  });
  const remove = useMutation({
    mutationFn: (z: ServiceZone) => zonesService.remove(z.id),
    onSuccess: (_res, z) => refreshAfter(`"${z.name}" removed`),
    onError: failed("Couldn't remove the zone."),
  });

  // ── The map ────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const zonesLayer = useRef<L.LayerGroup | null>(null);
  const shopsLayer = useRef<L.LayerGroup | null>(null);
  const draftLayer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], DEFAULT_MAP_ZOOM);
    const tiles = tileLayer();
    L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: tiles.maxZoom }).addTo(map);
    zonesLayer.current = L.layerGroup().addTo(map);
    shopsLayer.current = L.layerGroup().addTo(map);
    draftLayer.current = L.layerGroup().addTo(map);

    // A click places the circle's centre, or the shape's next corner.
    map.on("click", (e: L.LeafletMouseEvent) => {
      const d = draftRef.current;
      if (!d) return;
      if (d.kind === "circle") setDraft({ ...d, center: { lat: e.latlng.lat, lng: e.latlng.lng } });
      else setDraft({ ...d, points: [...d.points, [e.latlng.lat, e.latlng.lng]] });
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // The saved zones — all but the one being edited, which the draft draws.
  useEffect(() => {
    const layer = zonesLayer.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    const bounds = L.latLngBounds([]);
    for (const z of rows) {
      if (draft?.id === z.id) continue;
      const style = {
        color: z.is_active ? ZONE.active : ZONE.inactive,
        weight: 2,
        fillOpacity: z.is_active ? 0.15 : 0.05,
        dashArray: z.is_active ? undefined : "6 6",
      };
      const shape = z.kind === "circle" && z.center_lat !== null && z.center_lng !== null && z.radius_m !== null
        ? L.circle([Number(z.center_lat), Number(z.center_lng)], { ...style, radius: z.radius_m })
        : z.points && z.points.length >= 3
          ? L.polygon(z.points.map(([a, b]) => [Number(a), Number(b)] as L.LatLngTuple), style)
          : null;
      if (!shape) continue;
      shape.bindTooltip(`${z.name}${z.is_active ? "" : " (off)"}`, { sticky: true });
      shape.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (!draftRef.current) setDraft(draftFromZone(z));
      });
      shape.addTo(layer);
      bounds.extend(shape.getBounds());
    }
    if (!fitted.current && bounds.isValid()) {
      map.fitBounds(bounds.pad(0.2));
      fitted.current = true;
    }
  }, [rows, draft?.id]);

  // Online shops as dots: green inside a zone, red outside — the cost of a
  // zone drawn too tight, visible while it is being drawn.
  useEffect(() => {
    const layer = shopsLayer.current;
    if (!layer) return;
    layer.clearLayers();
    const fenced = (zones.data?.summary.zones_active ?? 0) > 0;
    const pins = L.latLngBounds([]);
    for (const s of (zones.data?.shops ?? []) as ZoneShop[]) {
      pins.extend([Number(s.latitude), Number(s.longitude)]);
      const colour = !fenced ? "#5f6b73" : s.in_service_zone ? "#157f3c" : "#b42318";
      L.circleMarker([Number(s.latitude), Number(s.longitude)], { radius: 5, color: "#fff", weight: 1.5, fillColor: colour, fillOpacity: 1 })
        .bindTooltip(`${s.business_name}${fenced && !s.in_service_zone ? " — outside every zone" : ""}`)
        .addTo(layer);
    }
    // No zone drawn yet: open where the shops are, not on the whole country.
    if (!fitted.current && (zones.data?.zones.length ?? 0) === 0 && pins.isValid()) {
      mapRef.current?.fitBounds(pins.pad(0.3), { maxZoom: 15 });
      fitted.current = true;
    }
  }, [zones.data]);

  // The zone being drawn, with handles to drag.
  useEffect(() => {
    const layer = draftLayer.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    if (!draft) return;
    const style = { color: ZONE.draft, weight: 2.5, fillOpacity: 0.2 };

    if (draft.kind === "circle" && draft.center) {
      const centre = L.latLng(draft.center.lat, draft.center.lng);
      L.circle(centre, { ...style, radius: draft.radius_m }).addTo(layer);
      const mid = L.marker(centre, { icon: dot("●", ZONE.draft), draggable: true }).addTo(layer);
      mid.on("dragend", () => {
        const p = mid.getLatLng();
        setDraft((d) => (d ? { ...d, center: { lat: p.lat, lng: p.lng } } : d));
      });
      // The edge handle sits due east; dragging it sets the radius.
      const east = L.latLng(centre.lat, centre.lng + draft.radius_m / (111_320 * Math.cos((centre.lat * Math.PI) / 180)));
      const edge = L.marker(east, { icon: dot("↔", ZONE.draft), draggable: true }).addTo(layer);
      edge.on("dragend", () => {
        const r = clampRadius(map.distance(centre, edge.getLatLng()));
        setDraft((d) => (d ? { ...d, radius_m: r } : d));
      });
    }

    if (draft.kind === "polygon" && draft.points.length > 0) {
      const latlngs = draft.points.map(([a, b]) => [a, b] as L.LatLngTuple);
      (draft.points.length >= 3 ? L.polygon(latlngs, style) : L.polyline(latlngs, style)).addTo(layer);
      draft.points.forEach(([a, b], i) => {
        const corner = L.marker([a, b], { icon: dot(i + 1, ZONE.draft), draggable: true }).addTo(layer);
        corner.on("dragend", () => {
          const p = corner.getLatLng();
          setDraft((d) => (d ? { ...d, points: d.points.map((c, j): Corner => (j === i ? [p.lat, p.lng] : c)) } : d));
        });
      });
    }
  }, [draft]);

  // ── Search a place ─────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoPlace[]>([]);
  useEffect(() => {
    const text = query.trim();
    if (text.length < 3) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      geocoder.autocomplete(text).then(setResults, () => setResults([]));
    }, 350);

    return () => clearTimeout(timer);
  }, [query]);
  const goTo = (p: GeoPlace) => {
    mapRef.current?.setView([p.lat, p.lng], 15);
    setResults([]);
    setQuery(p.formatted);
  };

  const blocked = draft ? whyNotSave(draft) : null;
  const warning = outsideWarning(zones.data?.summary);

  return (
    <>
      <PageMeta title="Service zones" area="Admin" description="Where shops trade online and where orders are delivered" />
      <PageHeader
        icon={<MapGlyph />}
        tone="brand"
        title="Service zones"
        subtitle="Where shops may sell online and where orders may be delivered. Nothing is fenced until a zone is switched on."
      />

      {zones.data && (
        <div className="mb-4 flex flex-wrap gap-2 text-theme-sm" data-testid="zone-summary">
          <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700 dark:bg-white/[0.06] dark:text-gray-200">
            {zones.data.summary.zones_active} active {zones.data.summary.zones_active === 1 ? "zone" : "zones"}
          </span>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700 dark:bg-white/[0.06] dark:text-gray-200">
            {zones.data.summary.online_shops} online {zones.data.summary.online_shops === 1 ? "shop" : "shops"}
          </span>
        </div>
      )}
      {warning && <div className="mb-4"><Alert variant="warning" title="Shops outside the map" message={warning} /></div>}

      <Card className="mb-5">
        <div className="space-y-3 p-4 sm:p-5">
          <div className="relative">
            <Input placeholder="Search for a place or address" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search for a place or address" />
            {results.length > 0 && (
              <ul className="absolute z-[1000] mt-1 max-h-64 w-full overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                {results.map((p, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => goTo(p)} className="w-full px-4 py-2.5 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5">
                      {p.formatted}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!draft ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setDraft(newCircleDraft())}>+ Add circle zone</Button>
                <Button size="sm" variant="outline" onClick={() => setDraft(newShapeDraft())}>+ Add shape zone</Button>
              </>
            ) : (
              <>
                {draft.kind === "polygon" && (
                  <Button size="sm" variant="outline" disabled={draft.points.length === 0} onClick={() => setDraft({ ...draft, points: draft.points.slice(0, -1) })}>
                    Undo point
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              </>
            )}
          </div>
          <p className="text-theme-sm text-gray-500 dark:text-gray-400" data-testid="zone-hint">
            {!draft
              ? "Click a zone on the map to change it. In a small town, a shape traced along the main roads keeps riders off lanes they cannot reach."
              : draft.kind === "circle"
                ? draft.center
                  ? "Drag the centre to move it, or the ↔ handle to change the radius — or type it below."
                  : "Click the map where the circle's centre goes."
                : `Click the map to place each corner (${draft.points.length} so far). Add at least 3, then save. Drag a numbered corner to adjust it.`}
          </p>

          <div ref={containerRef} data-testid="zone-map" className={`h-[28rem] w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 ${draft ? "cursor-crosshair" : ""}`} />

          {draft && (
            <div className="grid gap-4 rounded-xl border border-brand-200 bg-brand-25 p-4 sm:grid-cols-2 dark:border-brand-500/30 dark:bg-brand-500/5" data-testid="zone-form">
              <div>
                <Label htmlFor="zone-name">Zone name</Label>
                <Input id="zone-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Gulberg, or Main Bazaar road" />
              </div>
              <div>
                <CityPicker value={draft.city_id ?? ""} onChange={(id) => setDraft({ ...draft, city_id: id || null })} placeholder="Which city (optional)" />
              </div>
              {draft.kind === "circle" && (
                <div>
                  <Label htmlFor="zone-radius">Radius (metres)</Label>
                  <Input
                    id="zone-radius"
                    type="number"
                    min="50"
                    max="100000"
                    value={String(draft.radius_m)}
                    onChange={(e) => setDraft({ ...draft, radius_m: Number(e.target.value) || 0 })}
                  />
                  <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">{distanceLabel(draft.radius_m)} across from the centre.</p>
                </div>
              )}
              <div className="flex items-end">
                <Switch label="Active — shops and deliveries are fenced by it" checked={draft.is_active} onChange={(on) => setDraft({ ...draft, is_active: on })} />
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <Button size="sm" disabled={blocked !== null || save.isPending} onClick={() => save.mutate(draft)}>
                  {save.isPending ? "Saving…" : draft.id ? "Save changes" : draft.kind === "polygon" ? `Save shape (${draft.points.length})` : "Save circle"}
                </Button>
                {blocked && <span className="text-theme-sm text-warning-700 dark:text-warning-400">{blocked}</span>}
              </div>
            </div>
          )}
        </div>
      </Card>

      {zones.isLoading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
      ) : rows.length === 0 ? (
        <ListEmpty from={zones} what="the service zones">
          <Card>
            <Empty
              icon={<MapGlyph />}
              title="No zones yet — every shop and every address is served"
              hint="Draw the first circle or shape where the platform should serve. Shops outside it stop showing to customers the moment it is switched on."
            />
          </Card>
        </ListEmpty>
      ) : (
        <Card>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="zone-list">
            {rows.map((z) => (
              <li key={z.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span aria-hidden="true" className="size-3 rounded-full" style={{ background: z.is_active ? ZONE.active : ZONE.inactive }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-theme-sm font-semibold text-gray-800 dark:text-white/90">{z.name}</p>
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                    {describeZone(z)}{z.city ? ` · ${z.city.name}` : ""}
                  </p>
                </div>
                <Switch label={z.is_active ? "On" : "Off"} checked={z.is_active} disabled={toggle.isPending} onChange={() => toggle.mutate(z)} />
                <button type="button" className={ROW_ACTION} disabled={draft !== null} onClick={() => setDraft(draftFromZone(z))}>Edit</button>
                <button
                  type="button"
                  className={ROW_ACTION_DANGER}
                  onClick={async () => {
                    if (await confirm({ title: `Remove "${z.name}"?`, message: "Shops and addresses it covered are served only if another zone covers them.", confirmLabel: "Remove", tone: "danger" })) remove.mutate(z);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
