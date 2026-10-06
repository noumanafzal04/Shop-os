import type { Floor, FloorTab } from "./services/dineInService";

/**
 * WHAT A TABLE NEEDS FROM SOMEBODY, RIGHT NOW.
 *
 * The floor drew two states — free and occupied — and occupied covers
 * everything from "just sat down" to "the food has been on the pass for six
 * minutes". Those are not one state to a waiter: one wants a menu and the
 * other wants legs.
 *
 * ONE state per table, and the order below is the order of urgency — a table
 * with food ready AND a new round not yet sent is a table whose food is going
 * cold, and that is what its tile says.
 */
export type TableState = "free" | "ready" | "unsent" | "cooking" | "eating" | "seated";

export function stateOf(tab: FloorTab | null): TableState {
  if (tab === null) return "free";
  // Cooked, and nobody has carried it. Nothing outranks this.
  if (tab.ready > 0) return "ready";
  // Ordered, and the kitchen has not been told. The commonest thing a waiter
  // forgets, and the table is waiting on food nobody is making.
  if (tab.unsent > 0) return "unsent";
  if (tab.cooking > 0) return "cooking";
  // Something was ordered and all of it has gone out: they are eating, and
  // the next thing this table needs is its bill.
  return tab.lines > 0 ? "eating" : "seated";
}

export const STATE_LABEL: Record<TableState, string> = {
  free: "Free",
  ready: "Food ready",
  unsent: "Order not sent",
  cooking: "In kitchen",
  eating: "Eating",
  seated: "Just seated",
};

/**
 * How long a tab has been open: "8m", "1h 20m", "2d 3h".
 *
 * Never seconds — nobody runs a floor to the second — and days where there
 * are days, because "51h" on a tile does not read as "since the day before
 * yesterday" and that is exactly the tile that most needs to.
 */
export function sinceLabel(openedAt: string | null, now: number): string {
  if (!openedAt) return "";
  const opened = new Date(openedAt).getTime();
  if (Number.isNaN(opened)) return "";

  const minutes = Math.max(0, Math.floor((now - opened) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;

  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export interface FloorSummary {
  tables: number;
  free: number;
  occupied: number;
  /** Guests somebody recorded. A tab opened without a count adds nothing — never a guess. */
  guests: number;
  /** Tabs (tables AND takeaway) with food on the pass. */
  ready: number;
  /** Tabs with an order nobody has sent. */
  unsent: number;
  /** Still to be collected, across every open tab. */
  toPay: number;
  /** Tabs an earlier service left open. */
  earlier: number;
}

/** Every open tab on the floor — at a table or not. */
function openTabs(floor: Floor): FloorTab[] {
  return [
    ...floor.tables.map((t) => t.open_ticket).filter((t): t is FloorTab => t !== null),
    ...floor.takeaway,
  ];
}

export function summarise(floor: Floor): FloorSummary {
  const tabs = openTabs(floor);
  const occupied = floor.tables.filter((t) => t.open_ticket !== null).length;

  return {
    tables: floor.tables.length,
    free: floor.tables.length - occupied,
    occupied,
    guests: tabs.reduce((n, t) => n + (t.guest_count ?? 0), 0),
    ready: tabs.filter((t) => t.ready > 0).length,
    unsent: tabs.filter((t) => t.ready === 0 && t.unsent > 0).length,
    // In paisa and back, so forty tabs of .10 and .20 do not sum to a float.
    toPay: tabs.reduce((n, t) => n + Math.round(t.to_pay * 100), 0) / 100,
    earlier: tabs.filter((t) => t.from_earlier).length,
  };
}
