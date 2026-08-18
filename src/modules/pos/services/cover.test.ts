import { describe, expect, it } from "vitest";
import { isCover, isTraining, ringableSessionId, type ActiveCover, type CashSession, type SessionState } from "./posService";

/**
 * `/pos/session` answers with one of three things: my own drawer, the drawer
 * I'm covering, or nothing. They are NOT the same shape, and the difference is
 * the whole point of relief cover — a cover carries the shift id to ring
 * against and none of the figures the cashier will be measured on.
 *
 * The till branches on `isCover` to decide what it may show and what it may
 * offer, so getting this narrowing wrong would either hand a reliever the
 * cashier's expected cash or leave them unable to ring at all.
 */

const drawer: CashSession = {
  id: "sess-1",
  status: "open",
  opening_float: 3000,
  cash_sales: 0,
  expected_cash: 3000,
  counted_cash: null,
  variance: null,
  sales_count: 0,
  sales_total: 0,
  opened_at: "2026-08-07T09:00:00+05:00",
  closed_at: null,
  register_id: "lane-1",
};

const cover: ActiveCover = {
  id: "cover-1",
  covering: true,
  session_id: "sess-1",
  cashier_name: "Ayesha",
  register: { id: "lane-1", name: "Lane 1", code: null },
  started_at: "2026-08-07T13:20:00+05:00",
  ended_at: null,
  reason: "Prayer break",
  mine: { sales_count: 2, sales_total: 1000, cash_taken: 1000 },
};

/** What the till rings a sale against, in each of the three states. */
const shiftToRingAgainst = (s: SessionState): string | null =>
  isCover(s) ? s.session_id : (s?.id ?? null);

describe("session state", () => {
  it("recognises a cover", () => {
    expect(isCover(cover)).toBe(true);
  });

  it("does not mistake my own drawer for one", () => {
    expect(isCover(drawer)).toBe(false);
  });

  it("handles having no shift at all", () => {
    expect(isCover(null)).toBe(false);
    expect(shiftToRingAgainst(null)).toBeNull();
  });

  /**
   * The one that matters: a reliever's sale must carry the CASHIER's shift id,
   * not the cover's own id. Sending `cover.id` would 422 on every sale.
   */
  it("rings a reliever's sale against the drawer they are standing at", () => {
    expect(shiftToRingAgainst(cover)).toBe("sess-1");
    expect(shiftToRingAgainst(cover)).not.toBe(cover.id);
  });

  it("rings my own sale against my own drawer", () => {
    expect(shiftToRingAgainst(drawer)).toBe("sess-1");
  });

  /**
   * A cover carries nothing the cashier is measured against. If these ever
   * appear, the server started sending a reliever the drawer's figures.
   */
  it("tells a reliever nothing about what the drawer holds", () => {
    expect(cover).not.toHaveProperty("opening_float");
    expect(cover).not.toHaveProperty("expected_cash");
    expect(cover).not.toHaveProperty("variance");
  });

  it("still tells them whose drawer it is, because they must not forget", () => {
    expect(cover.cashier_name).toBe("Ayesha");
  });
});

/**
 * Training rides on the same three-state answer, and the flag belongs to the
 * DRAWER rather than the person standing at it. That is the whole rule, and
 * getting it wrong in either direction is bad: a real till wearing the banner
 * teaches a cashier to ignore it, and a practice till without one takes real
 * money for sales nobody recorded.
 */
describe("isTraining", () => {
  it("is false for an ordinary drawer", () => {
    expect(isTraining(drawer)).toBe(false);
  });

  it("is false when nobody has a shift open", () => {
    expect(isTraining(null)).toBe(false);
  });

  it("marks my own practice drawer", () => {
    expect(isTraining({ ...drawer, is_training: true })).toBe(true);
  });

  /** Covering a practice drawer is practising, whoever is standing there. */
  it("marks a cover of a practice drawer", () => {
    expect(isTraining({ ...cover, is_training: true })).toBe(true);
    expect(isTraining(cover)).toBe(false);
  });

  /**
   * A server that has never heard of training sends no flag at all. Absent
   * must read as "real" — the alternative dresses every live till in a banner
   * saying its takings do not count.
   */
  it("treats a missing flag as a real shift", () => {
    expect(isTraining({ ...drawer, is_training: undefined })).toBe(false);
  });
});

describe("which drawer a sale is rung into", () => {
  it("rings into the covered cashier's drawer, not the reliever's own", () => {
    // The whole point of relief cover: someone else takes the till and RINGS
    // under the drawer that is already open on it.
    expect(ringableSessionId(cover)).toBe("sess-1");
  });

  it("rings into my own drawer when I have one", () => {
    expect(ringableSessionId(drawer)).toBe("sess-1");
  });

  it("refuses when there is no drawer at all", () => {
    expect(ringableSessionId(null)).toBeNull();
  });

  it("refuses a drawer that has been closed", () => {
    // A counted drawer is not a shift to sell into — and this is the case a
    // remembered shift on the device could produce after a reload.
    expect(ringableSessionId({ ...drawer, status: "closed" })).toBeNull();
  });

  it("is not the same question as 'do I have a drawer of my own'", () => {
    // Asking THAT question is what left a reliever unable to ring: `open` is
    // null under cover by design, so every selling gate built on it refused.
    // Reconcile actions must keep asking it — a cover may sell and must never
    // count the drawer.
    const isMyOwn = (s: SessionState) => s !== null && !isCover(s);

    expect(isMyOwn(cover)).toBe(false);
    expect(ringableSessionId(cover)).not.toBeNull();
  });
});
