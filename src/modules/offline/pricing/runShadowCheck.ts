import { get, getAll, getSingleton, putMany, remove } from "../db/repo";
import { STORE } from "../db/schema";
import type { CatalogItem, CatalogPromotion, CatalogTaxGroup } from "../sync/catalogService";
import { readMeta } from "../sync/applyPull";
import type { CartLine, PriceLevel } from "./priceCart";
import { comparePricing, type PricingVariance, type ServerTotals } from "./shadow";
import { bumpTally } from "./shadowTally";

/**
 * Running the shadow check against a sale the server just completed.
 *
 * ── Why it prices from the LOCAL CATALOG and not from the cart ──────────
 *
 * The obvious shortcut is to price the cart lines the POS already holds. It is
 * also the wrong test. Those lines carry a partly-derived view — a display
 * estimate rather than the raw catalog fields — so rebuilding the engine's
 * input from them is lossy, and every loss would surface as a disagreement that
 * is not real. A shadow check that cries wolf is worse than none, because the
 * genuine finding gets lost in the noise.
 *
 * More importantly, pricing from the local catalog is what the till will
 * ACTUALLY do in Phase 3. So this exercises the real path end to end: the
 * projection's accuracy and the engine's arithmetic, together. A price that is
 * wrong because the catalog row is stale is exactly as much of a problem as one
 * that is wrong because the arithmetic is, and only this arrangement finds both.
 *
 * ── Skipping is not agreeing ────────────────────────────────────────────
 *
 * A till that has not finished its first catalog pull cannot price anything,
 * and reporting that as a disagreement would fill the report with the till's
 * own youth. When any line is unknown locally, the check is SKIPPED and says so
 * — never silently counted as a match, which would be the more flattering lie.
 */

/** What the caller hands over: one line of the sale, as the POS rang it. */
export interface ShadowLine {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  price_level?: PriceLevel;
  /** Per-line discount as the cashier keyed it. */
  discountValue?: number;
  discountMode?: "amt" | "pct";
  /** Sum of the chosen modifiers' deltas, per unit. */
  modifierDelta?: number;
}

export type ShadowOutcome =
  | { status: "matched" }
  | { status: "skipped"; reason: string }
  | { status: "differed"; variance: PricingVariance };

/** Keep a bounded, useful window rather than an unbounded log. */
export const MAX_VARIANCES = 200;

/**
 * Price the sale locally, compare, record any disagreement — and count it.
 *
 * Never throws and never blocks. It runs after the customer has paid and after
 * the receipt is on screen; a shadow check that interrupted a counter would be
 * the worst possible trade for information nobody asked for.
 *
 * The tally is bumped HERE rather than by the caller, and that is the whole
 * reason this wrapper exists. A caller that forgets costs the denominator, and
 * a denominator missing is what turns "we found nothing" from evidence into
 * silence — the one confusion this exercise cannot afford.
 */
export async function runShadowCheck(
  saleId: string,
  lines: ShadowLine[],
  server: ServerTotals,
  cartDiscount: number,
): Promise<ShadowOutcome> {
  const outcome = await evaluate(saleId, lines, server, cartDiscount);

  await bumpTally(outcome.status, outcome.status === "skipped" ? outcome.reason : undefined);

  return outcome;
}

/** The check itself. Split out only so the tally above cannot be skipped. */
async function evaluate(
  saleId: string,
  lines: ShadowLine[],
  server: ServerTotals,
  cartDiscount: number,
): Promise<ShadowOutcome> {
  try {
    if (lines.length === 0) return { status: "skipped", reason: "no lines" };

    const settings = await getSingleton<Record<string, unknown>>(STORE.SETTINGS);
    if (settings === undefined) {
      return { status: "skipped", reason: "the till has not pulled its settings yet" };
    }

    const taxGroups = new Map(
      (await getAll<CatalogTaxGroup>(STORE.TAX_CONFIG)).map((g) => [g.id, g.rate]),
    );

    const priced: CartLine[] = [];
    for (const line of lines) {
      const item = await get<CatalogItem>(STORE.CATALOG, line.product_id);
      if (item === undefined) {
        // Not a disagreement — a gap in what this till has been told.
        return { status: "skipped", reason: "an item is not in the local catalog yet" };
      }

      // A variant carries its own price, and the engine prices what is being
      // sold rather than the product it belongs to.
      const variant = line.variant_id
        ? item.variants.find((v) => v.id === line.variant_id)
        : undefined;
      if (line.variant_id && variant === undefined) {
        return { status: "skipped", reason: "a variant is not in the local catalog yet" };
      }

      priced.push({
        item: {
          // Which product and category — the promotion rules scope by one or
          // the other, and a line that cannot say what it is matches nothing.
          id: item.id,
          category_id: item.category_id,
          price: variant ? variant.price : item.price,
          // A sale price is product-level and does not apply to a variant,
          // which is the server's rule and not an approximation of it.
          discount_price: variant ? null : item.discount_price,
          wholesale_price: variant ? null : item.wholesale_price,
          price_tiers: variant ? null : item.price_tiers,
          tax_rate: item.tax_rate,
          tax_group_rate: item.tax_group_id ? (taxGroups.get(item.tax_group_id) ?? null) : null,
        },
        quantity: line.quantity,
        priceLevel: line.price_level ?? "retail",
        modifierDelta: line.modifierDelta ?? 0,
        lineDiscountPct: line.discountMode === "pct" ? (line.discountValue ?? null) : null,
        lineDiscount: line.discountMode === "amt" ? (line.discountValue ?? null) : null,
      });
    }

    const variance = comparePricing(
      saleId,
      priced,
      {
        default_tax_rate: Number(settings.default_tax_rate ?? 0),
        tax_inclusive: Boolean(settings.tax_inclusive),
        promotions: await getAll<CatalogPromotion>(STORE.PROMOTIONS),
        // SERVER time, drift applied — never the tablet's own clock. A slow
        // tablet would otherwise run a flash sale that ended on Tuesday, and
        // the whole point of a mirror is that it cannot disagree with the
        // server about anything, least of all what day it is.
        now: new Date(Date.now() + (await readMeta()).clockSkewMs),
        timezone: String(settings.timezone ?? "Asia/Karachi"),
      },
      cartDiscount,
      server,
    );

    if (variance === null) return { status: "matched" };

    await recordVariance(variance);

    return { status: "differed", variance };
  } catch (error) {
    // Anything at all — a closed database, an evicted store, a shape that
    // changed. The sale is already done and the customer has already paid.
    return { status: "skipped", reason: error instanceof Error ? error.message : "unknown" };
  }
}

/**
 * Keep a variance, oldest dropped first past the cap.
 *
 * Bounded because this is diagnostics, not accounting: an unbounded log on a
 * till whose engine is systematically wrong would fill the device that is
 * supposed to be holding unsent sales, which is the one thing storage must
 * never be spent on.
 */
export async function recordVariance(variance: PricingVariance): Promise<void> {
  await putMany(STORE.PRICING_VARIANCES, [variance]);

  const all = await getAll<PricingVariance>(STORE.PRICING_VARIANCES);
  if (all.length <= MAX_VARIANCES) return;

  const oldestFirst = all.slice().sort((a, b) => a.at.localeCompare(b.at));
  for (const stale of oldestFirst.slice(0, all.length - MAX_VARIANCES)) {
    await remove(STORE.PRICING_VARIANCES, stale.saleId);
  }
}

/** Everything this till has found, newest first. */
export async function readVariances(): Promise<PricingVariance[]> {
  const all = await getAll<PricingVariance>(STORE.PRICING_VARIANCES);

  return all.slice().sort((a, b) => b.at.localeCompare(a.at));
}
