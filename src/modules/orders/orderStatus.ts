import type { ThemeColors } from "../../theme";
import type { OrderStatus } from "./hooks/useOrders";

/**
 * WHAT A STATUS MEANS, IN ONE PLACE.
 *
 * ── The two things this replaces ──────────────────────────────────────
 *
 * The orders list carried a `STATUS_STYLE` map of literal hexes — `#eff8ff`
 * with `#175cd3` on it for four of the seven states. Two problems, and the
 * second is the one that mattered:
 *
 *   · There is no blue in this app. The palette is a red-orange, an amber, a
 *     green and warm greys, chosen together; a Tailwind blue dropped into it
 *     belongs to a different design.
 *   · Those hexes are the SAME in both themes. A pale blue-white badge on a
 *     near-black card is a hole punched in the page, and dark mode is the one
 *     place a status badge cannot be checked by looking at the light screen.
 *
 * The theme already names the whole ramp — `warning`, `info`, `success`,
 * `error`, each with a ground and each with a dark-mode value that was
 * designed rather than inverted. This maps onto that.
 *
 * ── And the words ─────────────────────────────────────────────────────
 *
 * The badge printed the database column with its underscores swapped for
 * spaces: "out for delivery", "pending". Those are field values, not answers.
 * Somebody looking at this list wants to know whether their food is coming,
 * and "On the way" says it where "out for delivery" makes them translate.
 *
 * `pending` is the sharpest case. It does not mean "we are working on it" — it
 * means the shop has not accepted the order yet, which is the one state where
 * somebody might want to ring them.
 */

export type StatusTone = "waiting" | "live" | "done" | "off";

export interface StatusLook {
  /** Short enough for a badge. */
  label: string;
  tone: StatusTone;
  /** Whether the order is still moving — the thing that decides its section. */
  live: boolean;
}

/**
 * The journey, in the order it happens.
 *
 * `cancelled` is not on it: it is not a stage, it is the trip ending. A
 * progress track that gave cancellation a position would draw a cancelled
 * order as one step from delivered.
 */
export const ORDER_STEPS: OrderStatus[] = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
];

/** How far along, 0-based — or null for an order that is not on the journey. */
export function stepOf(status: OrderStatus, fulfillment: "delivery" | "pickup"): number | null {
  if (status === "cancelled") return null;
  const steps = stepsFor(fulfillment);
  const at = steps.indexOf(status);
  return at === -1 ? null : at;
}

/**
 * The stages THIS order actually passes through.
 *
 * A collection order never goes out for delivery, so a five-of-six bar that
 * stops at "Ready" for ever would look stuck at the exact moment the order is
 * finished and waiting on the customer.
 */
export function stepsFor(fulfillment: "delivery" | "pickup"): OrderStatus[] {
  return fulfillment === "delivery"
    ? ORDER_STEPS
    : ORDER_STEPS.filter((s) => s !== "out_for_delivery");
}

export function statusLook(
  status: OrderStatus,
  fulfillment: "delivery" | "pickup" = "delivery",
): StatusLook {
  switch (status) {
    case "pending":
      // Not "we are working on it" — nobody has accepted it yet.
      return { label: "Waiting for the shop", tone: "waiting", live: true };
    case "confirmed":
      return { label: "Accepted", tone: "live", live: true };
    case "preparing":
      return { label: "Being prepared", tone: "live", live: true };
    case "ready":
      return {
        label: fulfillment === "delivery" ? "Ready for pick-up" : "Ready to collect",
        tone: "live",
        live: true,
      };
    case "out_for_delivery":
      return { label: "On the way", tone: "live", live: true };
    case "completed":
      return {
        label: fulfillment === "delivery" ? "Delivered" : "Collected",
        tone: "done",
        live: false,
      };
    case "cancelled":
      return { label: "Cancelled", tone: "off", live: false };
    default:
      // An unknown status is a server that has moved on. Say so plainly rather
      // than falling through to "pending", which would tell somebody their
      // delivered order is still waiting.
      return { label: String(status).replace(/_/g, " "), tone: "waiting", live: false };
  }
}

/** The badge's ground and ink, from the theme rather than from a literal. */
export function statusColors(tone: StatusTone, c: ThemeColors): { bg: string; fg: string } {
  switch (tone) {
    case "waiting":
      return { bg: c.warningBg, fg: c.warning };
    case "live":
      return { bg: c.infoBg, fg: c.info };
    case "done":
      return { bg: c.successBg, fg: c.success };
    case "off":
      return { bg: c.errorBg, fg: c.error };
  }
}

/**
 * When it was placed, as somebody would say it.
 *
 * The orders list showed no date at all — every card was an order number, a
 * shop and a total, which is fine for the one you placed twenty minutes ago
 * and useless for telling last Tuesday's from the Tuesday before. Times only
 * for today and yesterday, because "3:14 pm" three weeks ago is precision
 * nobody asked for.
 */
export function placedAt(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);

  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${d.toLocaleDateString(undefined, { weekday: "long" })}, ${time}`;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    // A year only when it is not this one — "12 Mar 2026" on every row from
    // last month is a column of noise.
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
