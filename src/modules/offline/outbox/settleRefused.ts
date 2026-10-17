import { apiPost } from "../../../common/api/client";
import { ApiError } from "../../../common/types/api";
import { put } from "../db/repo";
import { STORE } from "../db/schema";
import {
  allRows,
  belongsHere,
  OUTBOX_STATUS,
  refusedTotal,
  settlementOwed,
  type OutboxRow,
  type Settlement,
} from "./outbox";

/**
 * SAYING WHAT BECAME OF A REFUSED SALE (B49).
 *
 * The money is in the drawer and the shop has no sale for it. A person at the
 * till settles it — rung again as a named sale, or dealt with another way and
 * said how — and that is written HERE first, then sent.
 *
 * Here first, because the till is where the danger is: a slip still listed as
 * refused after it was rung again is a slip somebody rings a second time. So
 * the row leaves the refused list the moment it is settled, whether or not the
 * server can be told now; a settlement it has not heard is counted with the
 * queue and sent with it, like a sale.
 */

/** The usual ways a refused sale is dealt with — a tap fills the note, which can still be edited. */
export const DEALT_WITH = [
  "Money handed back to the customer",
  "Written in the sales book by hand",
  "Already rung again as another sale",
] as const;

export const refusedSalesApi = {
  settle: (op: string, body: Record<string, unknown>) =>
    apiPost<{ id: string; settled_as: string }>(`/pos/refused-sales/${op}/settle`, body),
};

function wire(row: OutboxRow, s: Settlement): Record<string, unknown> {
  return {
    how: s.how,
    note: s.note,
    sale_id: s.saleId,
    settled_by: s.by,
    // The till's own copy: a sale refused before the shop kept refusals is
    // written from it the first time it is settled.
    offline_number: row.offlineNumber,
    sold_at: row.at,
    till_total: refusedTotal(row),
    reason: row.error,
  };
}

/**
 * The server read it and gave its answer, which sending again will not change.
 * The link, the server falling over, a sign-in that lapsed, a throttle — those
 * are not answers, and the settlement waits for the next sync.
 */
const answered = (error: unknown): boolean =>
  error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 403, 408, 419, 429].includes(error.status);

export async function settleRefused(
  row: OutboxRow,
  said: { how: Settlement["how"]; note?: string | null; saleId?: string | null; invoiceNumber?: string | null; by: string | null },
): Promise<Settlement> {
  const settlement: Settlement = {
    how: said.how,
    note: said.note?.trim() || null,
    saleId: said.saleId ?? null,
    invoiceNumber: said.invoiceNumber ?? null,
    by: said.by,
    at: new Date().toISOString(),
    sent: false,
    error: null,
  };
  const settled: OutboxRow = { ...row, status: OUTBOX_STATUS.RESOLVED, settlement };
  await put(STORE.OUTBOX, settled);

  return sendSettlement(settled);
}

export async function sendSettlement(row: OutboxRow): Promise<Settlement> {
  const settlement = row.settlement as Settlement;
  let next: Settlement;
  try {
    await refusedSalesApi.settle(row.op, wire(row, settlement));
    next = { ...settlement, sent: true, error: null };
  } catch (error) {
    if (!answered(error)) return settlement;
    // Taken as sent: the server has an answer of its own — this slip settled
    // another way already, say. Kept on the row so the till can say so.
    next = { ...settlement, sent: true, error: (error as ApiError).message };
  }
  await put(STORE.OUTBOX, { ...row, settlement: next });

  return next;
}

/** Every settlement the server has not heard, for this shop only — sent after the sales. */
export async function sendOwedSettlements(tenantId: string | null): Promise<number> {
  const owed = (await allRows()).filter((r) => settlementOwed(r) && belongsHere(r, tenantId));
  let sent = 0;
  for (const row of owed) {
    // One that did not go means the line did not: the rest wait with it.
    if (!(await sendSettlement(row)).sent) break;
    sent += 1;
  }

  return sent;
}
