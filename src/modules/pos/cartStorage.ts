/**
 * The open cart, kept on the device so a refresh isn't a lost customer.
 *
 * Half a trolley rung up and then a stray F5, a tab crash, or a tablet that
 * slept — today all of that means starting the sale again with the customer
 * watching. Parking the lines in localStorage costs nothing and is safe to do
 * because a cart line is only an INTENT: product, quantity, unit. Every price,
 * discount and tax is computed by the server at checkout, so a restored cart
 * can never carry a stale or tampered price into a sale.
 *
 * Scoped per lane, because lane 2's half-finished trolley is not lane 5's.
 */

const KEY = "shopos-pos-cart";

/** Older than this and it's yesterday's trolley, not a refresh. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface Parked<T> {
  lines: T[];
  savedAt: number;
  /** Who was at the till when it was parked — shown if that changed. */
  userId: string | null;
  userName: string | null;
}

const keyFor = (registerId: string | null) => `${KEY}:${registerId ?? "default"}`;

export function parkCart<T>(
  registerId: string | null,
  lines: T[],
  user: { id: string; name: string } | null,
): void {
  try {
    if (lines.length === 0) {
      localStorage.removeItem(keyFor(registerId));
      return;
    }
    const payload: Parked<T> = {
      lines,
      savedAt: Date.now(),
      userId: user?.id ?? null,
      userName: user?.name ?? null,
    };
    localStorage.setItem(keyFor(registerId), JSON.stringify(payload));
  } catch {
    // A full or disabled localStorage must never stop a sale.
  }
}

export function readParkedCart<T>(registerId: string | null): Parked<T> | null {
  try {
    const raw = localStorage.getItem(keyFor(registerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Parked<T>;
    if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(keyFor(registerId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearParkedCart(registerId: string | null): void {
  try {
    localStorage.removeItem(keyFor(registerId));
  } catch {
    /* ignore */
  }
}
