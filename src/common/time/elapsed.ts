/**
 * HOW LONG SOMETHING HAS BEEN WAITING, at the scale a queue is actually run on.
 *
 * `admin/components/waitingTime.ts` answers the same question in DAYS, which is
 * right for a shop request — nothing about it changes within an afternoon. An
 * order queue is minutes: a pending order forty minutes old is the entire job,
 * and "less than a day" says nothing at all about it.
 *
 * Two functions and one rule between them, rather than a phrase assembled at
 * each call site. The day that stopped being true, the shop-requests screen was
 * rendering "less than a days" on the only day most requests are ever seen.
 */

/** Whole minutes since `iso`. Negative clamps to 0 — a clock a little ahead of
 *  the server must not read as an order placed in the future. */
export function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

/**
 * "just now" · "12m" · "1h 05m" · "3h" · "2d"
 *
 * Short on purpose: it sits on a card beside the order number and is read at a
 * glance, not parsed. Past a day the minutes stop mattering — an order that old
 * is not being worked, it is being investigated.
 */
export function elapsedLabel(iso: string): string {
  const minutes = minutesSince(iso);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;

    return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, "0")}m`;
  }

  const days = Math.floor(hours / 24);

  return `${days}d`;
}

/**
 * How worried to be, as three states rather than a number.
 *
 * The thresholds are deliberately about the STAGE, not the order: fifteen
 * minutes unconfirmed is late, fifteen minutes out for delivery is normal. A
 * single ceiling for everything would either shout on every delivery or say
 * nothing about the one that has not been acknowledged.
 *
 * `settled` = completed or cancelled: nobody is waiting, so nothing is late,
 * however long the row has been on the screen.
 */
export function urgencyOf(
  iso: string,
  stage: string,
): "calm" | "warm" | "late" {
  if (stage === "completed" || stage === "cancelled") return "calm";

  const minutes = minutesSince(iso);
  const [warm, late] = THRESHOLDS[stage] ?? [30, 60];

  if (minutes >= late) return "late";
  if (minutes >= warm) return "warm";

  return "calm";
}

/**
 * Minutes at a stage before it reads as warm, then late.
 *
 * These are not configurable, and that is a decision rather than an omission: a
 * per-shop setting for "when is an order late" is a number nobody would ever
 * set, and a wrong default that can be changed is not better than a plain one
 * that cannot.
 */
const THRESHOLDS: Record<string, [number, number]> = {
  // Nobody has even said yes yet. This is the one that loses customers.
  pending: [5, 15],
  confirmed: [15, 30],
  preparing: [20, 45],
  // Cooked and sitting on the pass, or bagged and waiting to be collected.
  ready: [15, 40],
  out_for_delivery: [30, 60],
};
