/**
 * Asking the browser not to throw the till's sales away.
 *
 * This is the single largest risk in the whole offline design, and the one that
 * is easiest to miss because nothing warns you. By default a browser treats
 * IndexedDB as **best-effort**: under storage pressure it evicts whole origins
 * without asking and without an event. If that happens to a till holding
 * unsent sales, those sales are gone — money that already crossed a counter,
 * with no record anywhere.
 *
 * `navigator.storage.persist()` moves the origin to durable storage, which a
 * browser will not evict automatically. Chrome grants it silently to an
 * installed PWA or a site the user engages with; Firefox prompts; Safari uses
 * its own rules. It can be refused, and a refusal is not an error — it is
 * information the shop needs BEFORE it starts selling, which is why the answer
 * is surfaced rather than logged.
 *
 * Nothing here throws. A browser too old to know these APIs simply reports
 * "unknown", and the till behaves as it does today.
 */

export type PersistState = "persisted" | "not-persisted" | "unsupported";

export interface StorageHealth {
  /** Will the browser hold onto this origin's data? */
  state: PersistState;
  /** Bytes currently used by this origin, when the browser will say. */
  usage: number | null;
  /** Bytes this origin may use, when the browser will say. */
  quota: number | null;
  /** Fraction of the quota in use, 0–1. Null when either side is unknown. */
  used: number | null;
}

/** Is this browser able to hold data durably at all? */
export function storageApiAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.storage?.persist === "function";
}

/**
 * Ask for durable storage, returning what the browser decided.
 *
 * Safe to call on every boot: `persisted()` is checked first, so an origin that
 * already has it never re-asks and no user is ever prompted twice.
 */
export async function requestPersistentStorage(): Promise<PersistState> {
  if (!storageApiAvailable()) return "unsupported";

  try {
    if (await navigator.storage.persisted()) return "persisted";

    return (await navigator.storage.persist()) ? "persisted" : "not-persisted";
  } catch {
    // Some browsers throw rather than resolve false in a blocked context.
    return "unsupported";
  }
}

/** How much room the till has, when the browser is willing to say. */
export async function storageEstimate(): Promise<Pick<StorageHealth, "usage" | "quota" | "used">> {
  const unknown = { usage: null, quota: null, used: null };

  if (typeof navigator === "undefined" || typeof navigator.storage?.estimate !== "function") {
    return unknown;
  }

  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof usage !== "number" || typeof quota !== "number" || quota <= 0) {
      return unknown;
    }

    return { usage, quota, used: usage / quota };
  } catch {
    return unknown;
  }
}

/** Both answers in one call — what the boot sequence actually wants. */
export async function checkStorage(): Promise<StorageHealth> {
  const [state, estimate] = await Promise.all([requestPersistentStorage(), storageEstimate()]);

  return { state, ...estimate };
}

/**
 * Room is running out — start warning before it matters, not after.
 *
 * 0.9 rather than 0.99 on purpose: the warning has to arrive while there is
 * still space to finish the day's sales, and a till that discovers it is full
 * mid-queue has already lost.
 */
export const NEARLY_FULL = 0.9;

export function isNearlyFull(health: StorageHealth): boolean {
  return health.used !== null && health.used >= NEARLY_FULL;
}

/**
 * Should the shop be told something before a shift opens?
 *
 * Returns the sentence to show, or null when all is well. Written as one
 * function so the wording lives in exactly one place — the same warning belongs
 * on the shift screen, on the settings page and in a support answer.
 */
export function storageWarning(health: StorageHealth): string | null {
  if (health.state === "not-persisted") {
    return "This device hasn't given ShopOS permanent storage. If the browser runs low on space it can delete sales that haven't reached the server yet. Install ShopOS to the home screen, or keep this till online.";
  }

  if (isNearlyFull(health)) {
    return "This device is almost out of storage. Free some space before the next shift — a till with no room can lose sales that haven't been sent.";
  }

  // "unsupported" is deliberately silent. An older browser cannot act on the
  // warning, and a message nobody can do anything about is noise that trains
  // people to dismiss the one that matters.
  return null;
}
