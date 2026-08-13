/**
 * When this till last actually reached its server.
 *
 * The offline policy is measured against this and nothing else. It cannot live
 * in memory, because the question that matters — "how long has this tablet been
 * out of contact?" — is asked hardest on a COLD boot with no network, where
 * memory is empty and the server cannot be asked.
 *
 * localStorage rather than IndexedDB for the same reason the device id is
 * there: it must be readable before the database opens, and it is one number.
 *
 * Written by the axios interceptor that already marks the connection reachable,
 * so there is one moment in the code that means "we touched the server" and it
 * updates both.
 */

const KEY = "shopos-last-server-contact";

/** We just heard from the server. */
export function markServerContact(at: number = Date.now()): void {
  try {
    localStorage.setItem(KEY, String(at));
  } catch {
    // Storage refused. The till still works; it just cannot prove how long it
    // has been out, and `hoursSinceContact` will say it does not know.
  }
}

/** Epoch ms of the last successful request, or null if there has never been one. */
export function lastServerContact(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;

    const at = Number(raw);

    // A value from the future is a clock that was wound back, not a contact.
    // Trusting it would report a negative age and read as green forever.
    return Number.isFinite(at) && at > 0 && at <= Date.now() ? at : null;
  } catch {
    return null;
  }
}

/**
 * Hours since the last successful request.
 *
 * Null means "never heard from the server on this device", which is NOT the
 * same as "out of contact for a long time" — a brand new tablet has no history,
 * and treating it as maximally stale would refuse a shop on its first morning.
 */
export function hoursSinceContact(now: number = Date.now()): number | null {
  const at = lastServerContact();
  if (at === null) return null;

  return Math.max(0, (now - at) / 3_600_000);
}

/** Only for handing a tablet to a different shop. */
export function forgetServerContact(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget if it could never be written.
  }
}
