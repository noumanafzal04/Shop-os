import { describe, expect, it } from "vitest";
import { boardTally, callLink, cardMoves, isLate, isOverdue } from "./board";

const now = new Date("2026-10-24T12:00:00Z");
const job = (work_status: "received" | "in_progress" | "ready", promised_at: string | null = null) => ({ work_status, promised_at });

describe("the board in four numbers", () => {
  it("counts each stage, and the late ones the shop still owes", () => {
    const jobs = [
      job("received"), job("received", "2026-10-24T10:00:00Z"),
      job("in_progress", "2026-10-25T10:00:00Z"), job("in_progress", "2026-10-23T10:00:00Z"),
      // Ready and past its time: waiting on its owner, not late on the shop.
      job("ready", "2026-10-23T10:00:00Z"),
    ];
    expect(boardTally(jobs, now)).toEqual({ received: 2, in_progress: 2, ready: 1, overdue: 2 });
  });

  it("is late only past a promised time", () => {
    expect(isOverdue({ promised_at: null }, now)).toBe(false);
    expect(isOverdue({ promised_at: "2026-10-24T13:00:00Z" }, now)).toBe(false);
    expect(isOverdue({ promised_at: "2026-10-24T11:00:00Z" }, now)).toBe(true);
  });

  it("is late on the shop only while it is not ready", () => {
    expect(isLate(job("in_progress", "2026-10-24T11:00:00Z"), now)).toBe(true);
    expect(isLate(job("ready", "2026-10-24T11:00:00Z"), now)).toBe(false);
    expect(isLate(job("received"), now)).toBe(false);
  });
});

describe("what a card offers", () => {
  it("one step forward and one back — ready's next step is the bill", () => {
    expect(cardMoves("received")).toEqual({ next: "in_progress", back: null });
    expect(cardMoves("in_progress")).toEqual({ next: "ready", back: "received" });
    expect(cardMoves("ready")).toEqual({ next: null, back: "in_progress" });
  });
});

describe("a number the board can ring", () => {
  it("dials the digits, and nothing for no number", () => {
    expect(callLink("0300-123 4567")).toBe("tel:03001234567");
    expect(callLink("+92 300 1234567")).toBe("tel:+923001234567");
    expect(callLink("")).toBeNull();
    expect(callLink(null)).toBeNull();
  });
});
