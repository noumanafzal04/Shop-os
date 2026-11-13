import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import type { ServiceZone, ZoneSummary } from "../zoneDraft";

/** An online shop's pin, for the map — green inside a zone, red outside. */
export interface ZoneShop {
  id: string;
  business_name: string;
  latitude: number;
  longitude: number;
  in_service_zone: boolean;
}

export interface ZonesAnswer {
  zones: ServiceZone[];
  summary: ZoneSummary;
  shops?: ZoneShop[];
}

export const zonesService = {
  list: () => apiGet<ZonesAnswer>("/admin/service-zones"),
  create: (body: Record<string, unknown>) =>
    apiPost<{ zone: ServiceZone; summary: ZoneSummary }>("/admin/service-zones", body),
  update: (id: string, body: Record<string, unknown>) =>
    apiPut<{ zone: ServiceZone; summary: ZoneSummary }>(`/admin/service-zones/${id}`, body),
  remove: (id: string) => apiDelete<{ summary: ZoneSummary }>(`/admin/service-zones/${id}`),
};
