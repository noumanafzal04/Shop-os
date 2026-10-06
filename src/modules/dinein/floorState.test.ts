import { describe, expect, it } from "vitest";
import { sinceLabel, stateOf, summarise } from "./floorState";
import type { Floor, FloorTab } from "./services/dineInService";

const tab = (over: Partial<FloorTab> = {}): FloorTab => ({
  id: "t", ticket_number: "T-1", order_type: "dine_in", status: "open",
  opened_at: "2026-10-06T15:00:00.000Z", guest_count: 2, customer_name: null,
  waiter_id: null, waiter: null,
  to_pay: 0, lines: 0, unsent: 0, ready: 0, cooking: 0, part_paid: false, from_earlier: false,
  ...over,
});

const table = (name: string, open: FloorTab | null) => ({
  id: name, name, area: null, seats: 4, sort_order: 0, is_active: true, open_ticket: open,
});

describe("what a table needs from somebody", () => {
  it("is free with no tab, and just seated with a tab and no order", () => {
    expect(stateOf(null)).toBe("free");
    expect(stateOf(tab())).toBe("seated");
  });

  it("follows an order from the pad to the plate", () => {
    expect(stateOf(tab({ lines: 2, unsent: 2 }))).toBe("unsent");
    expect(stateOf(tab({ lines: 2, cooking: 1 }))).toBe("cooking");
    expect(stateOf(tab({ lines: 2, ready: 1 }))).toBe("ready");
    expect(stateOf(tab({ lines: 2 }))).toBe("eating");
  });

  it("says the most urgent thing when two are true", () => {
    // Food on the pass AND a second round nobody has sent: the food is going
    // cold now, and the round can wait the thirty seconds it takes to run it.
    expect(stateOf(tab({ lines: 4, ready: 1, unsent: 2, cooking: 1 }))).toBe("ready");
    // A round not sent while the first is still cooking: the kitchen does not
    // know about half this table's order.
    expect(stateOf(tab({ lines: 4, unsent: 2, cooking: 1 }))).toBe("unsent");
  });
});

describe("how long a tab has been open", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const opened = "2026-10-06T15:00:00.000Z";

  it("reads in the unit a floor is run in", () => {
    expect(sinceLabel(opened, at("2026-10-06T15:00:20.000Z"))).toBe("just now");
    expect(sinceLabel(opened, at("2026-10-06T15:08:59.000Z"))).toBe("8m");
    expect(sinceLabel(opened, at("2026-10-06T16:05:00.000Z"))).toBe("1h 05m");
  });

  it("counts days once there are days", () => {
    // 51 hours. "51h" is not a thing anybody reads as "the day before yesterday".
    expect(sinceLabel(opened, at("2026-10-08T18:00:00.000Z"))).toBe("2d 3h");
  });

  it("says nothing rather than something wrong", () => {
    expect(sinceLabel(null, Date.now())).toBe("");
    expect(sinceLabel("not a date", Date.now())).toBe("");
    // A clock a few seconds behind the server's must not print a negative.
    expect(sinceLabel(opened, at("2026-10-06T14:59:50.000Z"))).toBe("just now");
  });
});

describe("the floor in one line", () => {
  const floor: Floor = {
    tables: [
      table("T1", tab({ guest_count: 4, to_pay: 2410.1, lines: 3, cooking: 2 })),
      table("T2", tab({ guest_count: 2, to_pay: 1100.2, lines: 2, ready: 1, unsent: 1 })),
      table("T3", null),
      table("T4", tab({ guest_count: null, to_pay: 300, lines: 1, unsent: 1, from_earlier: true })),
    ],
    takeaway: [tab({ order_type: "takeaway", guest_count: null, to_pay: 1650, lines: 2, ready: 1 })],
    service_began: "2026-10-06T00:00:00.000Z",
    server_time: "2026-10-06T15:30:00.000Z",
  };

  it("counts tables, and guests only where somebody recorded them", () => {
    const s = summarise(floor);

    expect(s.tables).toBe(4);
    expect(s.occupied).toBe(3);
    expect(s.free).toBe(1);
    // 4 + 2. T4 and the takeaway were opened without a count: nothing, not a guess.
    expect(s.guests).toBe(6);
  });

  it("adds what is owed across tables AND takeaway, to the paisa", () => {
    // 2410.10 + 1100.20 + 300 + 1650 — which a float sum gets wrong.
    expect(summarise(floor).toPay).toBe(5460.3);
  });

  it("counts each tab once, under the most urgent thing true of it", () => {
    const s = summarise(floor);

    // T2 and the takeaway. T2 also has an unsent round and is NOT counted
    // again under "not sent" — its tile says "Food ready".
    expect(s.ready).toBe(2);
    expect(s.unsent).toBe(1);
    expect(s.earlier).toBe(1);
  });
});
