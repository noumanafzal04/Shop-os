import type { ShadowChecks } from "./varianceService";

/**
 * The single sentence an owner is looking for: are my tills ready to price on
 * their own?
 *
 * ── Why "checked nothing" is tested before "found nothing" ──────────────
 *
 * An empty findings list is produced identically by two very different shops:
 *
 *   the engine agreed on 1,284 real carts    ← ready
 *   no till ever checked anything            ← not ready, and looks the same
 *
 * The second is the quieter of the two — nothing to see is exactly what it
 * looks like — so it is answered FIRST. A shop that has checked nothing is told
 * so plainly rather than shown a clean sheet it did not earn.
 */
export interface Verdict {
  tone: "success" | "warning" | "error";
  headline: string;
  detail: string;
}

export function verdict(checks: ShadowChecks, total: number): Verdict {
  if (checks.checked === 0) {
    return {
      tone: "warning",
      headline: "Nothing checked yet",
      detail:
        checks.tills === 0
          ? "No till has opened the POS yet. The check runs on its own, on every sale — there is nothing to switch on."
          : "Your tills have not rung a sale that could be checked. Zero disagreements below means nothing until they have.",
    };
  }

  if (total > 0) {
    return {
      tone: "error",
      headline: `${total.toLocaleString()} ${total === 1 ? "cart priced" : "carts priced"} differently`,
      detail:
        "The offline engine and the server did not agree. Every customer was charged the server's price, so nothing was mis-billed — but a till must not sell on its own until this is nil.",
    };
  }

  return {
    tone: "success",
    headline: "No disagreements",
    detail: `The offline engine matched the server on every one of ${checks.checked.toLocaleString()} carts it could price.`,
  };
}

/**
 * The share of skipped checks past which the skips are themselves the finding.
 *
 * Nine carts in ten skipped for "an item is not in the local catalog yet" means
 * the till's copy of the catalog is incomplete — invisible if skips were folded
 * into the checked total and never mentioned again.
 */
export const SKIP_CONCERN = 0.2;
