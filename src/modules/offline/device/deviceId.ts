import { uuid } from "../../../common/uuid";

/**
 * This browser's stable identity, minted once and kept forever.
 *
 * A register is a PLACE ("Lane 1"); this is the THING. The queue of unsent
 * offline sales lives on the thing, so "how long has this been out of contact"
 * and "whose unsent sales are these" are questions only a device id can answer.
 *
 * ── Why localStorage and not IndexedDB ──────────────────────────────────
 *
 * The id has to be readable BEFORE the database opens — the very first thing a
 * boot does is announce itself, and if opening the database failed we still
 * want to know which till failed. localStorage is synchronous and survives
 * everything IndexedDB survives.
 *
 * ── Why the client mints it ─────────────────────────────────────────────
 *
 * Registration is then idempotent with no round trip: the same id simply
 * arrives again and touches the existing row. A server-issued id would need a
 * "do you already know me" call that cannot be made offline, which is the one
 * time it would matter.
 *
 * It is an identifier, NOT a credential. Anyone can invent a UUID; what makes a
 * request trustworthy is still the signed-in session behind it.
 */

const KEY = "shopos-device-id";

/** Minimal shape of a UUID, so a corrupted or hand-edited value is replaced. */
const LOOKS_LIKE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read this device's id, minting one the first time.
 *
 * Never throws. A browser with localStorage disabled still gets a working id —
 * it just gets a new one per page load, which registers as a new till and is
 * strictly better than a boot that crashes.
 */
export function deviceId(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && LOOKS_LIKE_UUID.test(stored)) {
      return stored;
    }

    const minted = uuid();
    localStorage.setItem(KEY, minted);

    return minted;
  } catch {
    // Private mode, a disabled storage policy, a quota already full. An
    // ephemeral id keeps the till usable; it cannot keep it recognisable.
    return uuid();
  }
}

/** Has this browser ever been given an id? Used to tell a new till from a known one. */
export function hasDeviceId(): boolean {
  try {
    const stored = localStorage.getItem(KEY);

    return stored !== null && LOOKS_LIKE_UUID.test(stored);
  } catch {
    return false;
  }
}

/**
 * Forget this device's identity.
 *
 * Only for handing a tablet to a different shop, and deliberately NOT called on
 * sign-out: the same tablet with the same cashier signing back in is the same
 * till, and a new id every morning would make the offline history meaningless.
 */
export function forgetDeviceId(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget if it could never be written.
  }
}
