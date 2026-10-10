import type { PaymentStatus } from "../auth/types";

/**
 * WHAT A SHOP'S ROW SAYS ABOUT ITS MONEY.
 *
 * The server sorts every shop into one of four buckets, and "paid" is the one
 * for "not behind on anything" — which rightly includes a shop that has never
 * been billed: it cannot be behind on a bill it was never given.
 *
 * As a BUCKET that is correct. As a WORD on a row it is wrong: a shop kept
 * from a demo an hour ago, on no plan, having paid nothing, was labelled
 * "paid" in green beside the words "no plan". Those are the shops an admin
 * most needs to act on — they are waiting to be given a plan — and the list
 * was telling them there was nothing to do.
 *
 * So the row says what is true of the shop, in the words the plan filter
 * already uses for it.
 */
export type ChipColor = "success" | "warning" | "error" | "light";

const BY_STATUS: Record<PaymentStatus, { label: string; color: ChipColor }> = {
  paid: { label: "paid", color: "success" },
  grace: { label: "in grace", color: "warning" },
  unpaid: { label: "unpaid", color: "error" },
  suspended: { label: "suspended", color: "light" },
};

export function paymentChip(shop: {
  deleted_at?: string | null;
  payment_status?: PaymentStatus | null;
  plan?: unknown | null;
}): { label: string; color: ChipColor } {
  // A deleted business has no payment state worth showing — it is not being
  // chased, and the row exists only so an admin can put it back.
  if (shop.deleted_at) return { label: "deleted", color: "light" };

  // Switched off is switched off, whatever it was or was not paying.
  if (shop.payment_status === "suspended") return BY_STATUS.suspended;

  // On no plan: nothing has been asked of it, so nothing has been paid.
  if (!shop.plan) return { label: "not priced yet", color: "warning" };

  return shop.payment_status ? BY_STATUS[shop.payment_status] : { label: "—", color: "light" };
}
