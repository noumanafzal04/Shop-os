import type { ReportedVariance } from "./varianceService";

/**
 * Nine rows saying the same thing are one finding, not nine.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 *
 * The first real run of the shadow check produced nine variances. Every one of
 * them read:
 *
 *   discount: server Rs 106.00, till Rs 0.00
 *   total:    server Rs 954.00, till Rs 1,060.00
 *
 * — the same defect, on nine carts, differing only in the amount. Listed one
 * per row, a reader has to compare nine blocks of numbers before noticing that
 * there is only one thing wrong. On a shop trading all day it would be nine
 * hundred, and the pattern would be invisible under its own evidence.
 *
 * So variances are grouped by their SHAPE — which fields disagreed, and which
 * side was high — and the group is what gets shown. The individual carts stay
 * available underneath, because reproducing one is how the defect gets fixed.
 *
 * ── The shape is the fields, not the amounts ────────────────────────────
 *
 * Two carts where the till missed a 10% promotion are the same finding whether
 * the cart was Rs 800 or Rs 2,380. Grouping on the amount would put every cart
 * in its own group and achieve nothing.
 */

export interface VarianceGroup {
  /** Stable key: the fields that disagreed, and the direction, joined. */
  key: string;
  /** Which fields disagreed, in the order the server reported them. */
  fields: string[];
  /** How many carts showed exactly this shape. */
  count: number;
  /** Smallest and largest money difference across the group, by absolute size. */
  smallest: number;
  largest: number;
  /** The carts themselves, newest first — for anyone reproducing it. */
  examples: ReportedVariance[];
}

/**
 * The direction matters as much as the field.
 *
 * "The till charged MORE than the server" and "the till charged LESS" are
 * different defects with different consequences, and merging them would hide
 * whichever was rarer.
 */
function shapeOf(variance: ReportedVariance): string {
  return variance.differences
    .map((d) => `${d.field}:${d.by > 0 ? "high" : "low"}`)
    .join("|");
}

/** The biggest single money difference in a variance, ignoring sign. */
function weight(variance: ReportedVariance): number {
  return variance.differences.reduce((worst, d) => Math.max(worst, Math.abs(d.by)), 0);
}

export function groupVariances(variances: ReportedVariance[]): VarianceGroup[] {
  const groups = new Map<string, VarianceGroup>();

  for (const variance of variances) {
    const key = shapeOf(variance);
    const size = weight(variance);
    const existing = groups.get(key);

    if (existing === undefined) {
      groups.set(key, {
        key,
        fields: variance.differences.map((d) => d.field),
        count: 1,
        smallest: size,
        largest: size,
        examples: [variance],
      });
      continue;
    }

    existing.count += 1;
    existing.smallest = Math.min(existing.smallest, size);
    existing.largest = Math.max(existing.largest, size);
    existing.examples.push(variance);
  }

  // Commonest first. The shape that happened most is the one worth fixing
  // first, and a long tail of one-offs must not push it down the screen.
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/**
 * The finding in a sentence, in the terms the shop reads.
 *
 * Deliberately describes what the TILL did, not what the difference was: an
 * owner reading "total: high" learns nothing, while "the till charged more
 * than the server" says which way a customer would have been wrong.
 */
export function describe(group: VarianceGroup): string {
  const chargedMore = group.key.includes("total:high");
  const missedDiscount = group.fields.includes("discount");

  if (missedDiscount && chargedMore) {
    return "The till applied no discount where the server did, so it would have charged more.";
  }

  if (missedDiscount) {
    return "The till and the server disagreed about the discount.";
  }

  if (group.fields.includes("tax")) {
    return "The till worked out a different amount of tax.";
  }

  return chargedMore
    ? "The till's total came out higher than the server's."
    : "The till's total came out lower than the server's.";
}
