import { getSingleton, putSingleton } from "../db/repo";
import { STORE } from "../db/schema";

/**
 * The number printed on a receipt that was rung with no server.
 *
 * ── Why a till never mints a real invoice number ────────────────────────
 *
 * The server's sequence is one counter for the whole shop. Two tablets offline
 * would both take "INV-1043", and on reconnect the shop would have two
 * different sales wearing the same number — in the books, on two customers'
 * receipts, and in every report built on top. There is no repair for that which
 * does not involve reprinting somebody's paperwork.
 *
 * So an offline till prints something that CANNOT collide and is visibly not an
 * invoice number:
 *
 *   OFF-{register}-{device}-{seq}
 *
 * The register and device segments make it unique across the shop without
 * anyone coordinating; `seq` makes it unique on the device. On sync the server
 * assigns the real number and keeps BOTH, because the slip in the customer's
 * bag is the only reference they have.
 *
 * ── Why the counter is persisted before it is used ──────────────────────
 *
 * A number handed out and then lost to a crash is a number the next sale takes
 * again — two receipts, one identity, on the same till. The counter is written
 * first and read back; a crash between the two costs a skipped number, which
 * costs nothing.
 */

/** Four characters of a uuid are plenty to separate the tills in one shop. */
const DEVICE_SEGMENT = 4;

interface Counter {
  seq: number;
}

/** `Lane 1` → `LANE1`. Kept short and printable; a slip is 32 characters wide. */
function segment(value: string | null, fallback: string): string {
  if (value === null || value.trim() === "") return fallback;

  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "");

  return cleaned === "" ? fallback : cleaned.slice(0, 6);
}

export async function nextSequence(): Promise<number> {
  const current = await getSingleton<Counter>(STORE.RECEIPT_COUNTER);

  // ── THE HIGHER OF WHAT WE REMEMBER AND WHAT THE SHOP HAS SEEN ────────
  //
  // The counter lives in IndexedDB; the device id it is printed beside lives
  // in localStorage. A browser can evict one and keep the other — this app
  // already warns about eviction — and the till then restarts at 1 under the
  // same device segment, minting slip numbers the shop already has. Every one
  // of those used to be refused by the server's unique index and retried for
  // ever; the sale is no longer lost over it, but two customers holding the
  // same printed number is still a mess.
  //
  // So the catalog pull brings back how far this device had got, and the
  // counter never goes backwards. A server too old to answer, or a device that
  // has never sold offline, sends null and changes nothing.
  const settings = await getSingleton<{ offline_sequence?: number | null }>(STORE.SETTINGS);
  const known = Number(settings?.offline_sequence ?? 0);
  const mine = Number(current?.seq ?? 0);

  const next = Math.max(mine, Number.isFinite(known) ? known : 0) + 1;

  // Written BEFORE it is returned. See the note above: a crash here skips a
  // number, and a crash the other way round reuses one.
  await putSingleton(STORE.RECEIPT_COUNTER, { seq: next });

  return next;
}

export async function nextOfflineNumber(
  registerName: string | null,
  deviceId: string,
): Promise<string> {
  const seq = await nextSequence();

  return [
    "OFF",
    segment(registerName, "TILL"),
    await deviceSegment(deviceId),
    String(seq).padStart(6, "0"),
  ].join("-");
}

/**
 * THE FOUR CHARACTERS THAT SAY WHICH TILL.
 *
 * Allocated by the server when the device registers, and kept on the device so
 * a till with no line can still mint a number.
 *
 * It used to be the first four characters of the random id the browser minted
 * for itself, with nothing anywhere checking whether another till already had
 * them. Four characters is 65,536 values: a shop running fifty tills had about
 * a one-in-fifty chance that two of them shared a segment, and from their first
 * sale each they would print identical slip numbers for different customers.
 * A hash where an allocation belongs.
 *
 * The fallback is what it always did, and it is only reached by a till that has
 * never once reached the server — a tablet unboxed during an outage. Its
 * numbers are no worse than they used to be, and it takes an allocated code the
 * first time it gets a line.
 */
async function deviceSegment(deviceId: string): Promise<string> {
  try {
    const device = await getSingleton<{ code?: string | null }>(STORE.DEVICE);
    const code = device?.code;

    if (typeof code === "string" && code.length > 0) {
      return code.toUpperCase().slice(0, DEVICE_SEGMENT);
    }
  } catch {
    // No database, or a browser refusing one. Fall through: a slip with a
    // guessed segment beats no slip at all.
  }

  return deviceId.replace(/-/g, "").slice(0, DEVICE_SEGMENT).toUpperCase();
}

/** Is this one of ours? Used to tell a slip from an invoice when searching. */
export function isOfflineNumber(value: string): boolean {
  return /^OFF-[A-Z0-9]{1,6}-[A-Z0-9]{4}-\d{6}$/.test(value);
}
