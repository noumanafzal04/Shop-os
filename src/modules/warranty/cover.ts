/**
 * How the warranty desk SAYS what it knows.
 *
 * The server sent the difference between two instants and the screen printed
 * it: "365.9999999999884 days left", read out to a customer across a counter.
 * It is a count of days. And the last of them is the last — "0 days left"
 * beside a green "Under warranty" reads as a contradiction to somebody
 * deciding whether to take a phone in.
 */
export function daysLeft(days: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(days) ? days : 0));
  if (whole === 0) return "Last day of cover";

  return `${whole} day${whole === 1 ? "" : "s"} left`;
}

/**
 * A date for the desk.
 *
 * A warranty's last day arrives as a bare date ("2027-10-07"), and a bare
 * date handed to `new Date` is midnight in UTC — the 6th, in any browser west
 * of Greenwich. It is a date on a card: read as the day it names.
 */
export function deskDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
