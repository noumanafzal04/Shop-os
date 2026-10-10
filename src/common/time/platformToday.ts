/**
 * THE PLATFORM'S OWN DATE.
 *
 * Platform figures — the billing ledger, the audit trail, commission, the
 * console's dashboard — are cut on the server's calendar, which is UTC. The
 * person reading them is in Pakistan, five hours ahead: from midnight until
 * five in the morning their laptop is already on a date the server has not
 * reached.
 *
 * So "Today", picked on a console screen at 1 am on the 11th, asked the server
 * for the 11th — a day with nothing in it yet — while everything that had
 * happened "today" by the server's reckoning sat under the 10th. The dashboard
 * was given the server's date when it gained its period; the three other
 * screens with a date on them went on reading the laptop's.
 *
 * This is the UTC calendar date as a local-midnight `Date`, which is the
 * shape every date control here works in. A shop's screens never use it: a
 * shop's day is its own (`shopDay`).
 */
export function platformToday(now: Date = new Date()): Date {
  return new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}
