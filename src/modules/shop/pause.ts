/**
 * "BUSY" — the shop pauses online orders for a while.
 *
 * Foodpanda's vendor app calls it closing temporarily. A power cut, no gas, a
 * rush the kitchen cannot take — the shop stops new orders for a set time and
 * opens again BY ITSELF when it runs out. There is no "until I turn it back
 * on": a pause forgotten at closing time would keep the shop shut for days.
 */
export type PauseChoice = { key: string; label: string; body: { minutes: number } | { rest_of_day: true } };

export const PAUSE_CHOICES: PauseChoice[] = [
  { key: "15", label: "15 minutes", body: { minutes: 15 } },
  { key: "30", label: "30 minutes", body: { minutes: 30 } },
  { key: "60", label: "1 hour", body: { minutes: 60 } },
  { key: "120", label: "2 hours", body: { minutes: 120 } },
  { key: "day", label: "Rest of today", body: { rest_of_day: true } },
];

/** The live pause end, or null — a time already past is no pause at all. */
export function activePause(until: unknown, now: Date = new Date()): Date | null {
  if (typeof until !== "string" || until === "") return null;
  const t = new Date(until);
  if (Number.isNaN(t.getTime())) return null;
  return t.getTime() > now.getTime() ? t : null;
}

/** "back at 7:45 PM", or "back tomorrow" when it runs past midnight here. */
export function backAt(until: Date, now: Date = new Date()): string {
  const sameDay = until.toDateString() === now.toDateString();
  const late = until.getHours() === 23 && until.getMinutes() >= 59;
  if (!sameDay || late) return "back tomorrow";
  const h = until.getHours() % 12 || 12;
  const m = String(until.getMinutes()).padStart(2, "0");
  return `back at ${h}:${m} ${until.getHours() < 12 ? "AM" : "PM"}`;
}

/** Minutes left, rounded up — "12 min left". */
export function minutesLeft(until: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 60_000));
}
