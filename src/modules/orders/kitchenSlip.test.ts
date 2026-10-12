import { beforeEach, describe, expect, it, vi } from "vitest";

import { dineInService } from "../dinein/services/dineInService";
import { printTheSlip, slipSays } from "./kitchenSlip";

const SENT = { ticket_id: "t1", ticket_number: "ORD-000007", kots: [{ id: "k1", kot_number: 1, station: "Kitchen" }, { id: "k2", kot_number: 2, station: "Bar" }] };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("the kitchen's slip for an order", () => {
  it("prints every station's slip where the kitchen works off paper", async () => {
    const print = vi.spyOn(dineInService, "printKots").mockResolvedValue();

    expect(await printTheSlip(SENT, true)).toBe("printed");
    expect(print).toHaveBeenCalledWith("t1", SENT.kots);
  });

  it("prints nothing where the kitchen works off its screen — and says it is there", async () => {
    const print = vi.spyOn(dineInService, "printKots").mockResolvedValue();

    expect(await printTheSlip(SENT, false)).toBe("on the screen");
    expect(print).not.toHaveBeenCalled();
  });

  it("has nothing to print when the step sent nothing — a second press, an order of packets", async () => {
    const print = vi.spyOn(dineInService, "printKots").mockResolvedValue();

    expect(await printTheSlip(null, true)).toBe("nothing sent");
    expect(await printTheSlip(undefined, true)).toBe("nothing sent");
    expect(await printTheSlip({ ...SENT, kots: [] }, true)).toBe("nothing sent");
    expect(print).not.toHaveBeenCalled();
  });

  it("a slip that would not print is said, not thrown — the order is still on the screen", async () => {
    vi.spyOn(dineInService, "printKots").mockRejectedValue(new Error("no printer"));

    expect(await printTheSlip(SENT, true)).toBe("did not print");
  });

  it("tells whoever pressed the button what happened, and says nothing when nothing did", () => {
    expect(slipSays("printed", "ORD-7")).toBe("ORD-7 is with the kitchen — its slip has been sent to the printer.");
    expect(slipSays("on the screen", "ORD-7")).toBe("ORD-7 is on the kitchen's screen.");
    expect(slipSays("did not print", "ORD-7")).toBe("ORD-7 is on the kitchen's screen, but its slip did not print.");
    expect(slipSays("nothing sent", "ORD-7")).toBeNull();
  });
});
