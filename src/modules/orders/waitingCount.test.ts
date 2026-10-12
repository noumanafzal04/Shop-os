import { describe, expect, it } from "vitest";

import { HEAL_AFTER, heardAt, isNews, keptFor, newestOrderNews, ownerOf } from "./waitingCount";

/**
 * When the count beside "Orders" is asked for again — the rules, with no
 * screen and no server. `useOrdersWaiting.test.tsx` holds them to the hook.
 */

describe("a kept count is somebody's", () => {
  it("is nobody's until a person is signed in to a shop", () => {
    expect(ownerOf(null, "u1")).toBeNull();
    expect(ownerOf("t1", undefined)).toBeNull();
    expect(ownerOf("t1", "u1")).toBe("t1:u1");
  });

  it("is handed back to its owner and to nobody else — not the next shop, not the next person at the same counter", () => {
    const kept = { owner: "t1:u1", count: { new: 1, being_worked: 4, at: 10 } };

    expect(keptFor(kept, "t1:u1")).toBe(kept);
    expect(keptFor(kept, "t2:u1"), "one shop's count was shown in another").toBeNull();
    expect(keptFor(kept, "t1:u2"), "one person's count was shown to the next").toBeNull();
    expect(keptFor(kept, null)).toBeNull();
    expect(keptFor(null, "t1:u1")).toBeNull();
  });
});

describe("how old a kept count is", () => {
  it("is as old as it is", () => {
    expect(heardAt({ new: 0, being_worked: 2, at: 1_000 }, 5_000)).toBe(1_000);
  });

  it("is never from the future: a clock put back must not keep a count fresh for the difference", () => {
    expect(heardAt({ new: 0, being_worked: 2, at: 9_000_000 }, 5_000)).toBe(5_000);
  });

  it("is trusted for two minutes — a quarter as often as it used to be asked", () => {
    expect(HEAL_AFTER).toBe(120_000);
  });
});

describe("what the bell says about orders", () => {
  const bell = [
    { id: "n9", type: "stock.low" },
    { id: "n8", type: "order.placed" },
    { id: "n7", type: "order.rider_declined" },
  ];

  it("cannot be told before the bell has answered", () => {
    expect(newestOrderNews(undefined)).toBeUndefined();
  });

  it("is the newest notification about an order, whatever else rang after it", () => {
    expect(newestOrderNews(bell)).toBe("n8");
  });

  it("is nothing — which is an answer — when nothing on the bell is about an order", () => {
    expect(newestOrderNews([{ id: "n9", type: "stock.low" }])).toBeNull();
    expect(newestOrderNews([])).toBeNull();
  });
});

describe("whether to ask again", () => {
  it("does not ask before the bell has answered", () => {
    expect(isNews("n8", undefined)).toBe(false);
    expect(isNews(undefined, undefined)).toBe(false);
  });

  it("does not ask the first time the bell is heard: there is nothing to compare it with", () => {
    expect(isNews(undefined, "n8")).toBe(false);
    expect(isNews(undefined, null)).toBe(false);
  });

  it("does not ask while the bell says what it said", () => {
    expect(isNews("n8", "n8")).toBe(false);
    expect(isNews(null, null)).toBe(false);
  });

  it("asks when the bell says something new about an order", () => {
    expect(isNews("n8", "n9")).toBe(true);
    // The first order ever, on a bell that had none.
    expect(isNews(null, "n1")).toBe(true);
  });

  it("asks once when the last order news falls off the bell's first page — and then is settled", () => {
    expect(isNews("n8", null)).toBe(true);
    expect(isNews(null, null)).toBe(false);
  });
});
