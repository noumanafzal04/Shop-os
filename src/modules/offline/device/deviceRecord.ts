import { getSingleton, putSingleton } from "../db/repo";
import { STORE } from "../db/schema";

/**
 * What this till keeps about itself.
 *
 * One row, and two facts in it that have nothing to do with each other except
 * that both are about this device and both must survive a reload:
 *
 *   code        the four characters the server allocated for this till's
 *               offline slips (`receiptNumber.ts` reads it with no line)
 *   announced   when the server last heard from this till, and for WHICH
 *               shop — so a reload a minute later does not announce it again
 *               (`touch.ts`), and a till handed to another shop announces
 *               itself to that one at once
 *
 * Written a field at a time (`patchDevice`), because the two are learned at
 * different moments and a write of one must not blank the other.
 */
export interface DeviceRecord {
  code?: string | null;
  announced?: { shop: string; at: number } | null;
}

export async function readDevice(): Promise<DeviceRecord> {
  return (await getSingleton<DeviceRecord>(STORE.DEVICE)) ?? {};
}

export async function patchDevice(patch: Partial<DeviceRecord>): Promise<void> {
  await putSingleton(STORE.DEVICE, { ...(await readDevice()), ...patch });
}
