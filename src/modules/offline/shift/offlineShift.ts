import { uuid } from "../../../common/uuid";
import type { CashSession } from "../../pos/services/posService";
import { shopNow } from "../clock";
import { mirrorShift, mirroredShift } from "./shiftMirror";
import { enqueueShiftOp, newShiftOp } from "./shiftQueue";

/**
 * Opening, moving and counting a drawer with no server.
 *
 * ── Why a till may do this at all ───────────────────────────────────────
 *
 * The offline module was built so a shop can trade through an outage and then
 * gated behind a shift, which needed the server. A shop whose line was already
 * down at opening time could not start one — on the morning the feature exists
 * for — and a shift that ran through an outage could not be counted out until
 * the line came back, which is the shop's own control over its own cash.
 *
 * ── The times here are the SHOP's, not the tablet's ─────────────────────
 *
 * `shopNow()` is this device's clock with its measured drift applied. A shift
 * stamped from an uncorrected tablet three days slow would file a whole day's
 * takings into a trading day that had already been counted and banked.
 */

/** A local session row, shaped exactly like the one the server would send. */
function localSession(
  id: string,
  openedAt: string,
  openingFloat: number,
  registerId: string | null,
  training: boolean,
): CashSession {
  return {
    id,
    status: "open",
    opening_float: openingFloat,
    // Placeholders, and deliberately not computed here. Every figure below is
    // the server's arithmetic over what it holds, and a till that guessed them
    // would be presenting a number a shop acts on. Nothing at the counter reads
    // them: the POS takes only the id, the practice flag, the lane and the
    // float off this row.
    cash_sales: 0,
    expected_cash: openingFloat,
    counted_cash: null,
    variance: null,
    sales_count: 0,
    sales_total: 0,
    opened_at: openedAt,
    closed_at: null,
    register_id: registerId,
    is_training: training,
  };
}

/**
 * Start a shift with no server.
 *
 * The id is minted HERE, because the sales rung into this shift will name it
 * long before it reaches anybody. A uuid does not collide, so this needs no
 * `OFF-…` scheme — that exists because an invoice NUMBER is a position in one
 * shop-wide sequence and two tills would take the same one. An id is not a
 * sequence.
 */
export async function openShiftOffline(
  openingFloat: number,
  registerId: string | null,
  training: boolean,
  tenantId: string | null,
  denominations?: Record<string, number> | null,
): Promise<CashSession> {
  const id = uuid();
  const at = (await shopNow()).toISOString();

  await enqueueShiftOp(
    newShiftOp(uuid(), "open", at, id, {
      opening_float: openingFloat,
      register_id: registerId,
      is_training: training,
      denominations: denominations ?? undefined,
    }, tenantId),
  );

  const session = localSession(id, at, openingFloat, registerId, training);

  // Mirrored immediately, so the till can sell into it and still knows which
  // shift it is standing at after a reload — which is the whole reason this
  // path exists.
  await mirrorShift(session, tenantId);

  return session;
}

/** Cash in or out of the drawer, recorded for later. */
export async function recordMovementOffline(
  type: string,
  amount: number | null,
  reason: string | null,
  note: string | null,
  tenantId: string | null,
): Promise<void> {
  const session = await mirroredShift(tenantId);

  // No shift means no drawer, and inventing one would file the money against a
  // till that does not exist. The caller shows the same refusal it would show
  // online.
  if (session === null) throw new Error("Open a shift before recording cash movements.");

  const at = (await shopNow()).toISOString();

  await enqueueShiftOp(
    newShiftOp(uuid(), "movement", at, session.id, {
      type,
      amount,
      reason,
      note,
    }, tenantId),
  );
}

/**
 * Count the drawer out with no server.
 *
 * Only `counted_cash` travels, because it is the only figure a cashier owns.
 * Everything it is measured against — expected cash, the variance, the day's
 * takings — is the shop's own arithmetic and is computed on arrival, once the
 * sales inside the shift have landed. That ordering is why the close is flushed
 * after the sale queue rather than with the opens.
 */
export async function closeShiftOffline(
  counted: number,
  notes: string | null,
  tenantId: string | null,
  denominations?: Record<string, number> | null,
  declared?: Record<string, number> | null,
): Promise<void> {
  const session = await mirroredShift(tenantId);

  if (session === null) throw new Error("You have no open shift to close.");

  const at = (await shopNow()).toISOString();

  await enqueueShiftOp(
    newShiftOp(uuid(), "close", at, session.id, {
      counted_cash: counted,
      notes,
      denominations: denominations ?? undefined,
      declared_tenders: declared ?? undefined,
    }, tenantId),
  );

  // The drawer has been counted, so this till must stop selling into it — the
  // same as any other close. The QUEUED close is what will reach the server;
  // clearing the mirror only stops the till standing at a drawer that is shut.
  await mirrorShift(null, tenantId);
}
