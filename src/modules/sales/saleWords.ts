import type { SaleChannel, SaleStatus } from "./services/salesService";

/**
 * WHAT A SALE'S CODES ARE CALLED, in one place.
 *
 * Two screens read these — the row and the detail — and the day they each
 * spell `partially_refunded` their own way is the day one of them says "Part
 * refund" and the other "Partially Refunded" about the same sale. This
 * codebase has the scar under the name "page rule, one copy".
 *
 * The words are the SHOPKEEPER's, not the column's. "Part refund" is what
 * somebody says out loud; `partially_refunded` is what the database calls it.
 */

export const STATUS_LABEL: Record<SaleStatus, string> = {
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  partially_refunded: "Part refund",
};

/**
 * How loud each status is allowed to be.
 *
 * `bad` is a refusal — money went back out, or the sale never happened.
 * `warn` is "something is different about this one". Completed has no tone
 * at all: it is every other row, and a colour on the normal case is a colour
 * that means nothing.
 */
export const STATUS_TONE: Record<SaleStatus, "none" | "warn" | "bad"> = {
  completed: "none",
  cancelled: "bad",
  refunded: "bad",
  partially_refunded: "warn",
};

/**
 * Where the sale came from — all five of the server's `SaleChannel`.
 *
 * A full `Record`, not a `Partial`: the compiler then fails the day the enum
 * gains a sixth, which is the only warning this app will get. The call sites
 * still keep a `?? channel` fallback, because the APK in somebody's hand was
 * built before that sixth existed and has to render SOMETHING — a raw code
 * is ugly and readable; an empty cell is a row that looks broken.
 *
 * The first draft of this was a `Partial` with four entries, two of them
 * guessed. It compiled, and the ledger showed "walk_in" and "whatsapp" on
 * most of its rows — a fallback doing the work a translation should.
 */
export const CHANNEL_LABEL: Record<SaleChannel, string> = {
  walk_in: "Walk-in",
  pos: "Counter",
  phone: "Phone",
  whatsapp: "WhatsApp",
  online: "Online",
};

/** How it was paid. Same fallback rule as the channel, for the same reason. */
export const PAYMENT_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  credit: "On credit",
  wallet: "Wallet",
  split: "Split",
};
