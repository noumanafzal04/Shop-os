import { shopDateOf, shopToday } from "../shopDay";

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
