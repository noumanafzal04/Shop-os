/**
 * MONEY BACK OUT OF A DRAWER, WITH A SUPERVISOR'S YES — what the sheet sends.
 *
 * The owner (2026-10-14, B01): a refund leaves the cashier's own drawer, and a
 * supervisor approves it with their PIN. Two ways in:
 *   - a cashier starts it at their own till (`needsApproval`) and the
 *     supervisor types their PIN on the cashier's screen;
 *   - a supervisor with no drawer of their own names the cashier's drawer the
 *     notes come out of, and types their OWN PIN.
 * The server checks it all again (SupervisorApproval); this only says what to
 * send, and whether the sheet can be sent yet.
 */
export interface ApprovalState {
  /** Another cashier's open drawer here, or "" for none chosen. */
  drawerId: string;
  approverId: string;
  pin: string;
}

export const NO_APPROVAL: ApprovalState = { drawerId: "", approverId: "", pin: "" };

/** Whether this refund asks for a supervisor's PIN at all. */
export const asksForApproval = (state: ApprovalState, needsApproval: boolean): boolean => needsApproval || state.drawerId !== "";

/** Ready to send: nothing asked, or somebody chosen and a PIN typed. */
export const approvalReady = (state: ApprovalState, needsApproval: boolean): boolean =>
  !asksForApproval(state, needsApproval) || (state.approverId !== "" && /^\d{4,6}$/.test(state.pin));

/** The part of the request it adds: the drawer, and the yes. */
export function approvalPayload(
  state: ApprovalState,
  needsApproval: boolean,
): { cash_session_id?: string; approval?: { user_id: string; pin: string } } {
  if (!asksForApproval(state, needsApproval)) return {};

  return {
    ...(state.drawerId !== "" ? { cash_session_id: state.drawerId } : {}),
    approval: { user_id: state.approverId, pin: state.pin },
  };
}
