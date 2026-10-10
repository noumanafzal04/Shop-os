import type { PaymentStatus } from "../auth/types";

/**
 * WHAT A SHOP'S ROW SAYS ABOUT ITS MONEY.
 *
 * The server sorts every shop into a bucket, and "paid" used to be the one for
 * "not behind on anything" — which included a shop that had never been billed.
 * A shop kept from a demo an hour ago, on no plan, having paid nothing, was
 * labelled "paid" in green beside the words "no plan". Those are the shops an
 * admin most needs to act on, and the list said there was nothing to do.
 *
 * The WORD was put right here first. The bucket followed: the server now sorts
 * such a shop into `no_plan`, so "Paid 40" is forty shops that have paid, and
 * the filter and the row say the same thing about the same shop.
 */
export type ChipColor = "success" | "warning" | "error" | "light";

const BY_STATUS: Record<PaymentStatus, { label: string; color: ChipColor }> = {
  paid: { label: "paid", color: "success" },
  grace: { label: "in grace", color: "warning" },
  unpaid: { label: "unpaid", color: "error" },
  no_plan: { label: "not priced yet", color: "warning" },
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

  // A server from before the bucket existed files a shop on no plan under
  // "paid". It is the same shop: nothing asked of it, nothing paid.
  if (shop.payment_status === "paid" && !shop.plan) return BY_STATUS.no_plan;

  return shop.payment_status ? BY_STATUS[shop.payment_status] : { label: "—", color: "light" };
}
