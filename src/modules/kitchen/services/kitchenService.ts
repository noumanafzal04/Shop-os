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
  /**
   * What a cook calls out: a table's name for a table, and for a takeaway the
   * CUSTOMER's name — a café pass showing the word "Takeaway" twelve times over
   * has nothing on it to shout.
   */
  table_name: string | null;
  order_type: "dine_in" | "takeaway" | null;
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
  /**
   * What THIS service's board is not showing: tickets still owed from before
   * it began. Counted rather than hidden, so the screen can offer to show or
   * clear them. Optional only because an older server does not send it.
   */
  older?: { count: number; oldest_fired_at: string | null };
  service_began?: string;
  /** The instant the ages were computed against, so the screen can tick on. */
  server_time: string;
}

export type BumpStatus = "preparing" | "ready" | "served";

/**
 * Which pile of tickets the screen is looking at.
 *
 *   board   what this service still owes — the default, and the only one a
 *           cook works from.
 *   served  the same, plus what has gone out this service.
 *   older   what an earlier service left behind, and nothing else.
 */
export type BoardView = "board" | "served" | "older";

/** `older` = left from an earlier service; `board` = everything on tonight's. */
export type ClearScope = "older" | "board";

export const kitchenService = {
  board: (view: BoardView = "board") =>
    apiGet<KitchenBoard>("/restaurant/kitchen", {
      params: {
        include_served: view === "served" ? 1 : undefined,
        older: view === "older" ? 1 : undefined,
      },
    }),

  bump: (kotId: string, status: BumpStatus) =>
    apiPost<KotCard>(`/restaurant/kitchen/kot/${kotId}/bump`, { status }),

  /** Take tickets off the board in one go. Marked cleared — never served. */
  clear: (scope: ClearScope, station?: string) =>
    apiPost<{ cleared: number }>("/restaurant/kitchen/clear", { scope, station: station || undefined }),
};
