import { useEffect, useSyncExternalStore } from "react";

import { queueTally } from "../db/repo";
import { ensureDatabaseBelongsTo } from "../db/tillOwner";
import { readMeta } from "../sync/applyPull";
import { PROJECTIONS } from "../sync/catalogService";

/**
 * IS THIS COMPUTER A TILL? (L3, 2026-10-17)
 *
 * The till keeps the shop's whole shelf on the device so it can sell with the
 * line down, and it used to start doing so on whichever shop screen a person
 * opened first. Measured on the grocery shop (6,000 items): an owner signing
 * in on the office laptop, or on their phone, to look at Products was handed
 * 4.5 MB — the bootstrap and five more pages of the till's catalogue — and the
 * device was announced as one of the shop's tills. Neither is a till.
 *
 * A device becomes a till when the till is opened on it (`PosPage`), or when
 * somebody presses "Save everything on this device" in Settings. From then on
 * every screen keeps it current, as before, so a till left on another screen
 * still hears about a price changed at the office.
 *
 * And a device that is ALREADY a till stays one: one that holds a catalogue
 * for this shop, or owes the server a sale or a drawer event, is a till from
 * before this rule and is marked as one the first time it is asked. Nothing
 * that sold yesterday stops syncing today.
 *
 * Kept per shop. A laptop that is one shop's till is not the next shop's.
 */
const KEY = "shopos-till-here";

/** For a browser that refuses storage: this tab still knows. */
let markedInThisTab: string | null = null;
const listeners = new Set<() => void>();

function marked(shop: string): boolean {
  try {
    if (localStorage.getItem(KEY) === shop) return true;
  } catch {
    // Blocked storage: what this tab was told is all there is.
  }

  return markedInThisTab === shop;
}

/** Said by the till as it opens, and by a person asking this device to be ready. */
export function markTillHere(shop: string | null): void {
  if (shop === null || marked(shop)) return;
  try {
    localStorage.setItem(KEY, shop);
  } catch {
    // Blocked storage: the tab still knows, and the till marks it again next time.
    markedInThisTab = shop;
  }
  for (const listener of listeners) listener();
}

/** A till from before this rule: it holds this shop's shelf, or owes the server work. */
async function alreadyATill(shop: string): Promise<boolean> {
  try {
    // Whose shelf is this? A device handed to another shop holds the last
    // shop's catalogue, and that does not make it this shop's till.
    await ensureDatabaseBelongsTo(shop);
    if ((await queueTally()).owed > 0) return true;
    const meta = await readMeta();

    return PROJECTIONS.some((projection) => meta.cursors[projection]);
  } catch {
    // No database at all: nothing was ever kept here, so nothing is owed.
    return false;
  }
}

/** This tab's till, and a till opened in another tab of the same browser. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useTillIsHere(shop: string | null): boolean {
  const here = useSyncExternalStore(subscribe, () => shop !== null && marked(shop));

  useEffect(() => {
    if (shop === null || here) return;
    void alreadyATill(shop).then((yes) => {
      if (yes) markTillHere(shop);
    });
  }, [shop, here]);

  return here;
}
