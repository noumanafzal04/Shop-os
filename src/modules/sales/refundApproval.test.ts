import { describe, expect, it } from "vitest";

import { NO_APPROVAL, approvalPayload, approvalReady, asksForApproval } from "./refundApproval";

describe("a refund out of a drawer, with a supervisor's yes (the owner, B01)", () => {
  it("asks nothing of a supervisor refunding from their own drawer", () => {
    expect(asksForApproval(NO_APPROVAL, false)).toBe(false);
    expect(approvalPayload(NO_APPROVAL, false)).toEqual({});
    expect(approvalReady(NO_APPROVAL, false)).toBe(true);
  });

  it("asks a cashier for a supervisor and their PIN — and sends the yes, not a drawer", () => {
    expect(approvalReady(NO_APPROVAL, true)).toBe(false);
    const typed = { drawerId: "", approverId: "saad", pin: "2580" };
    expect(approvalReady(typed, true)).toBe(true);
    expect(approvalPayload(typed, true)).toEqual({ approval: { user_id: "saad", pin: "2580" } });
  });

  it("naming another cashier's drawer asks for a PIN, and sends the drawer with it", () => {
    const named = { drawerId: "bilals-drawer", approverId: "saad", pin: "" };
    expect(asksForApproval(named, false)).toBe(true);
    expect(approvalReady(named, false)).toBe(false);
    expect(approvalPayload({ ...named, pin: "2580" }, false)).toEqual({
      cash_session_id: "bilals-drawer",
      approval: { user_id: "saad", pin: "2580" },
    });
  });

  it("a PIN is four to six digits — anything else is not sent", () => {
    expect(approvalReady({ drawerId: "", approverId: "saad", pin: "25" }, true)).toBe(false);
    expect(approvalReady({ drawerId: "", approverId: "saad", pin: "25a0" }, true)).toBe(false);
  });
});
