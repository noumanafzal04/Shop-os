/**
 * What this till may ring with no server — decided at the counter.
 *
 * The server enforces all of this again on sync (`OfflinePolicy`), and that is
 * the boundary. This is not a weaker copy of it: it answers a different
 * question at a different moment.
 *
 *   the server asks   "may I record this?"        — after the fact, once
 *   this asks         "may I take this money?"    — before the fact, in front
 *                                                   of a customer
 *
 * Getting the second one wrong is the expensive failure. A cashier who is
 * allowed to complete a sale the shop will later flag has already given the
 * goods away; there is nobody to ask, and the customer has gone. Every refusal
 * here has to arrive BEFORE the drawer opens, and has to say why in words the
 * person at the counter can act on.
 */

/** One line of the cart, as much of it as this decision needs. */
export interface OfflineLine {
  name: string;
  /** From the catalog projection — the server's own verdict, carried down. */
  offline_ok?: boolean;
}

export interface OfflineCart {
  lines: OfflineLine[];
  paymentMethod: string | null;
  orderType?: string | null;
  redeemPoints?: number;
  couponCode?: string | null;
}

/** Tenders a single till can settle alone. Mirrors `OfflinePolicy::TENDERS`. */
export const OFFLINE_TENDERS = ["cash", "card", "bank_transfer", "other", "split"];

export interface Refusal {
  /** What the cashier is told. A reason, never "not allowed". */
  reason: string;
  /** What they can do instead, when there is something. */
  fix?: string;
}

/**
 * Every reason this cart cannot be rung offline — all of them, not the first.
 *
 * A cashier who fixes the tender and is then told about the medicine has been
 * interrupted twice for one decision. They should see the whole picture and
 * decide once.
 */
export function refusalsFor(cart: OfflineCart): Refusal[] {
  const refusals: Refusal[] = [];

  const blocked = cart.lines.filter((l) => l.offline_ok === false);
  for (const line of blocked) {
    refusals.push({
      reason: `${line.name} can't be sold while the internet is down.`,
      fix: "Take it off the bill, or wait for the connection.",
    });
  }

  if (cart.paymentMethod !== null && !OFFLINE_TENDERS.includes(cart.paymentMethod)) {
    refusals.push({
      reason:
        cart.paymentMethod === "credit"
          ? "Khata needs the connection — a customer's balance is shared between tills."
          : `${cart.paymentMethod} can't be settled while the internet is down.`,
      fix: "Take cash or card instead.",
    });
  }

  if (cart.orderType === "dine_in") {
    refusals.push({
      reason: "A table's bill is shared between tills, so it needs the connection.",
    });
  }

  if ((cart.redeemPoints ?? 0) > 0) {
    refusals.push({
      reason: "Points can't be spent while the internet is down — the balance is shared.",
      fix: "Ring it without points; the points earned will still be added later.",
    });
  }

  if (cart.couponCode !== null && cart.couponCode !== undefined && cart.couponCode !== "") {
    refusals.push({
      reason: "A coupon's remaining uses can only be checked by the server.",
    });
  }

  return refusals;
}

export function canSellOffline(cart: OfflineCart): boolean {
  return refusalsFor(cart).length === 0;
}

/**
 * This shop has not been given offline selling.
 *
 * The kill switch, as the cashier meets it. It is off until an admin turns it
 * on, because a shop earns it by running shadow mode over its OWN carts until
 * the pricing mirror has been proved on them — not on somebody else's.
 *
 * Worded so nobody at the counter goes looking for a setting they cannot see.
 * The shop cannot switch this on for itself, so "ask support" is the only true
 * next step, and the sentence says so.
 */
export const OFFLINE_SELLING_OFF: Refusal = {
  reason: "This shop's tills aren't set up to sell without a connection yet.",
  fix: "Take cash at the counter and ring it once you are back online, or ask support to turn offline selling on for this shop.",
};

/**
 * This till has been out of contact past the shop's own ceiling.
 *
 * Not the same tool as `offline_days`, which MARKS a sale for the owner to look
 * at afterwards. This one refuses, and only shops that asked for it have one at
 * all — for most, a fourth day without internet is not worse than a closed
 * counter, and a ceiling nobody chose would be this software deciding otherwise
 * on their behalf.
 *
 * The fix names the actual fix. A cashier told only "no" will try again, and
 * again, with a queue of customers behind them.
 */
export const OFFLINE_TOO_LONG: Refusal = {
  reason: "This till has been without internet for longer than the shop allows, so it can't start a new sale.",
  fix: "Get this device back online for a moment — its queued sales will send and it can sell again straight away.",
};

/**
 * This shop runs a promotion the till cannot work out.
 *
 * The safety net behind the promotion mirror, and it matters more than the
 * mirror does. A promotion the engine does not understand is not a smaller
 * discount — it is a receipt that is WRONG on every cart the promotion touches,
 * discovered by a customer days later with no way to check.
 *
 * The whole offline design says a till may only do what it can decide
 * correctly, alone. A promotion it cannot evaluate is the clearest possible
 * case of something it cannot, so the answer is no — for the shop, not for the
 * cart, because no cart can be rearranged to fix it.
 */
export const PROMOTION_TOO_NEW: Refusal = {
  reason: "This shop is running an offer this till doesn't know how to work out, so it can't price a sale correctly without the internet.",
  fix: "Take cash at the counter and ring it once you are back online.",
};

/**
 * Money going back OUT always needs the server.
 *
 * A refund is not a sale in reverse. It restocks, it reverses loyalty points
 * and it can credit a khata — every one a shared figure another till could be
 * moving at the same moment. It is the clearest case of the rule the whole
 * offline design turns on, so unlike a sale there is no cart to inspect: the
 * answer is always no.
 *
 * Offline the request fails on its own, so this is not what STOPS a refund.
 * What is missing without it is the REASON, and the moment it arrives — after a
 * cashier has already told a customer they will get their money back.
 *
 * The words matter as much as the refusal. "Not allowed" sends someone looking
 * for a setting; naming the thing to actually do sends them to the counter.
 */
export const MONEY_BACK_OFFLINE: Record<"refund" | "exchange", Refusal> = {
  refund: {
    reason:
      "A refund puts stock back, reverses any points and can credit a khata — all figures another till could be changing at the same moment.",
    fix: "Take the customer's details and refund it once you are back online.",
  },
  exchange: {
    reason:
      "An exchange is a refund and a sale together, so it moves stock both ways and can settle a difference against a khata.",
    fix: "Do it once you are back online.",
  },
};
