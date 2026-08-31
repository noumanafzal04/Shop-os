import { apiGet, apiPost } from "../../../common/api/client";

/** Mirrors KitchenController::row(). A kitchen payload carries NO money. */
export interface KotCard {
  id: string;
  kot_number: number;
  station: string | null;
  status: "fired" | "preparing" | "ready" | "served";
  notes: string | null;
  fired_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  /** Age at the moment the server built the payload — see `server_time`. */
  age_seconds: number;
  ticket_number: string | null;
  table_name: string | null;
  guest_count: number | null;
  items?: Array<{
    name: string;
    quantity: number;
    modifiers: Array<{ group: string | null; name: string | null }>;
    note: string | null;
  }>;
}

export interface KitchenBoard {
  kots: KotCard[];
  /** Every station on the board, unfiltered — so the tabs survive picking one. */
  stations: string[];
  /** The instant the ages were computed against, so the screen can tick on. */
  server_time: string;
}

export type BumpStatus = "preparing" | "ready" | "served";

export const kitchenService = {
  board: (params: { station?: string; include_served?: boolean } = {}) =>
    apiGet<KitchenBoard>("/restaurant/kitchen", {
      params: {
        station: params.station || undefined,
        include_served: params.include_served ? 1 : undefined,
      },
    }),

  bump: (kotId: string, status: BumpStatus) =>
    apiPost<KotCard>(`/restaurant/kitchen/kot/${kotId}/bump`, { status }),
};
