import { shopDate } from "../../common/format/date";

/**
 * WHAT A LOT SAYS ABOUT ITS DATE (mart #MT3).
 *
 * The Batches sheet listed "OPENING · 8 left" and "PO-000001 · 40 left": the
 * lot that expires in 13 days looked exactly like the one nobody had dated,
 * on the one screen that exists for the dates. Every lot now says which it is.
 */
export function lotExpiry(expiry: string | null | undefined): string {
  return expiry ? `expires ${shopDate(expiry.slice(0, 10))}` : "no expiry date";
}
