/**
 * WHAT A `datetime-local` BOX MEANS.
 *
 * It holds a wall-clock time with no zone — "2026-10-07T17:00" — and the
 * server, which keeps time in UTC, reads a time with no zone as UTC. So a car
 * promised back at five in the afternoon in Lahore was stored as five o'clock
 * UTC, which is ten at night in Lahore: the board said 10 pm, the car was
 * "due" for five hours after it was late, and the overdue flag came on five
 * hours after the customer had started ringing.
 *
 * The box means a moment on THIS device's clock. Send that moment.
 */
export function instantOf(local: string | null | undefined): string | undefined {
  if (!local) return undefined;
  const at = new Date(local);

  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}
