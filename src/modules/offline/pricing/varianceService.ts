import { apiGet, apiPost } from "../../../common/api/client";
import { remove } from "../db/repo";
import { STORE } from "../db/schema";
import { deviceId } from "../device/deviceId";
import { readVariances } from "./runShadowCheck";
import type { PricingVariance } from "./shadow";

/** One finding as the shop's owner reads it back. */
export interface ReportedVariance {
  id: string;
  sale_id: string | null;
  found_at: string | null;
  device: { id: string; name: string | null } | null;
  server: Record<string, number>;
  local: Record<string, number>;
  differences: Array<{ field: string; server: number; local: number; by: number }>;
  cart: unknown;
}

/** How many a single request carries. Matched to the server's own ceiling. */
const BATCH = 100;

export const varianceService = {
  report: (variances: PricingVariance[]) =>
    apiPost<{ stored: number }>("/pos/pricing-variances", {
      device_id: deviceId(),
      variances: variances.map((v) => ({
        sale_id: v.saleId,
        at: v.at,
        server: v.server,
        local: v.local,
        differences: v.differences,
        cart: v.cart,
      })),
    }),

  list: () => apiGet<{ total: number; variances: ReportedVariance[] }>("/pricing-variances"),
};

/**
 * Send what this till has found, and forget it locally once it lands.
 *
 * ── Why local rows are deleted only after the server confirms ───────────
 *
 * The same rule the catalog cursor follows, for the same reason. Delete first
 * and a failed request loses a finding permanently, silently, with nothing left
 * to retry — and a finding lost is a bug that stays in the engine. Delete after
 * and a lost acknowledgement costs a re-send, which the server absorbs: it
 * upserts on `(tenant, sale)`, so the same cart can never be counted twice.
 *
 * That idempotence is what makes the timid ordering free.
 *
 * Never throws. This is diagnostics riding along with a sync; a till must not
 * fail to open its catalog because a variance report did not go.
 */
export async function flushVariances(): Promise<{ sent: number }> {
  try {
    const pending = await readVariances();
    if (pending.length === 0) return { sent: 0 };

    let sent = 0;
    for (let from = 0; from < pending.length; from += BATCH) {
      const batch = pending.slice(from, from + BATCH);

      await varianceService.report(batch);

      // Only now. See the note above.
      for (const variance of batch) {
        await remove(STORE.PRICING_VARIANCES, variance.saleId);
      }
      sent += batch.length;
    }

    return { sent };
  } catch {
    // Offline, refused, or the shop is on a version that has no such endpoint.
    // The rows stay put and go with the next sync.
    return { sent: 0 };
  }
}
