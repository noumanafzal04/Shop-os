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
  const next = (current?.seq ?? 0) + 1;

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
    deviceId.replace(/-/g, "").slice(0, DEVICE_SEGMENT).toUpperCase(),
    String(seq).padStart(6, "0"),
  ].join("-");
}

/** Is this one of ours? Used to tell a slip from an invoice when searching. */
export function isOfflineNumber(value: string): boolean {
  return /^OFF-[A-Z0-9]{1,6}-[A-Z0-9]{4}-\d{6}$/.test(value);
}
