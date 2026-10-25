import { shopDateOf, shopToday } from "../shopDay";
import { shopDate } from "./date";

/**
 * HOW LONG AGO, IN THE SHOP'S DAYS — "today", "yesterday", "38 days ago".
 *
 * Counted between business dates (the day turns at the shop's hour), never by
 * subtracting timestamps: a payment at 23:50 is "yesterday" at 00:10 only if
 * the shop's day has turned.
 */
export function daysSince(moment: string, now: Date = new Date()): number {
  const utc = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);

    return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  };

  return Math.round((utc(shopToday(now)) - utc(shopDateOf(new Date(moment)))) / 86_400_000);
}

export function sinceWords(moment: string | null | undefined, now: Date = new Date()): string | null {
  if (!moment) return null;
  const days = daysSince(moment, now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";

  return `${days} days ago`;
}

/**
 * The TRADING day a moment belongs to, written the shop's way.
 *
 * A khata charge rung at 03:04 on the 25th, in a shop whose day turns at
 * 05:00, belongs to the 24th — the day every report files it under. Printed
 * as a bare wall date it read "25 Oct", so a dealer's statement put the
 * charge on a day the shop's own day-book showed no sale (wholesale #W3).
 */
export function tradingDay(moment: string): string {
  return shopDate(shopDateOf(new Date(moment)));
}
