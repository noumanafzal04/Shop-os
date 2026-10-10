import { describe, expect, it } from "vitest";

import { pricedOddly, reachSays } from "./addOnReach";

describe("where a price typed in the add-on list will ever be charged", () => {
  it("in every plan and past nobody's: the line says its price reaches nobody", () => {
    expect(reachSays({ plans: [], shops: 0, named: [] })).toEqual({
      kind: "never",
      says: "In every plan on offer, and no shop has it as an add-on — a price here is charged to nobody.",
    });
  });

  it("in every plan and STILL on a bill: it is not called free of charge, and the shop is named", () => {
    // Products, Rs 25,000, and one business that only keeps books which had
    // been given it. The first version of this line said "charged to nobody".
    const said = reachSays({ plans: [], shops: 1, named: ["QA Finance 1006-172224"] });

    expect(said?.kind).toBe("anyway");
    expect(said?.says).toBe(
      "In every plan on offer, yet QA Finance 1006-172224 has it as an add-on — its trade does not usually take it, or its plan is no longer offered. " +
        "A price here goes on its bill unless it has one of its own.",
    );
    expect(said?.says).not.toContain("nobody");
  });

  it("names them while all of them can be named, and counts them once they cannot", () => {
    expect(reachSays({ plans: [], shops: 2, named: ["Alpha", "Bravo"] })?.says).toBe(
      "In every plan on offer, yet Alpha and Bravo have it as an add-on — their trade does not usually take it, or their plan is no longer offered. " +
        "A price here goes on their bills unless they have one of their own.",
    );
    expect(reachSays({ plans: [], shops: 3, named: ["Alpha", "Bravo", "Charlie"] })?.says).toContain(
      "yet Alpha, Bravo and Charlie have it as an add-on",
    );
    // Seven shops and three names: the names would stand for the other four.
    const seven = reachSays({ plans: [], shops: 7, named: ["Alpha", "Bravo", "Charlie"] })?.says;
    expect(seven).toContain("yet 7 shops have it as an add-on");
    expect(seven).not.toContain("Alpha");
  });

  it("a server that sends no names is still not told nobody is charged", () => {
    const said = reachSays({ plans: [], shops: 2 });

    expect(said?.kind).toBe("anyway");
    expect(said?.says).toContain("yet 2 shops have it as an add-on");
    expect(reachSays({ plans: [], shops: 1 })?.says).toContain("yet 1 shop has it as an add-on");
  });

  it("says which plans it is an add-on on, and that nobody has taken it yet", () => {
    expect(reachSays({ plans: ["Basic", "Standard"], shops: 0 })).toEqual({
      kind: "somewhere",
      says: "An add-on on Basic, Standard · no shop has taken it yet.",
    });
  });

  it("says who a change to the price reaches at once", () => {
    expect(reachSays({ plans: ["Basic"], shops: 1, named: ["Alpha"] })?.says).toBe("An add-on on Basic · 1 shop has it as an add-on now.");
    expect(reachSays({ plans: ["Basic"], shops: 12 })?.says).toBe("An add-on on Basic · 12 shops have it as an add-on now.");
  });

  it("names three plans and counts the rest", () => {
    expect(reachSays({ plans: ["Basic", "Standard", "Pro", "Karahi House", "Clinic"], shops: 0 })?.says)
      .toBe("An add-on on Basic, Standard, Pro and 2 more · no shop has taken it yet.");
  });

  it("says nothing until the answer has arrived", () => {
    expect(reachSays(undefined)).toBeNull();
  });
});

describe("a price that does something its box does not suggest", () => {
  const never = reachSays({ plans: [], shops: 0 });
  const anyway = reachSays({ plans: [], shops: 1, named: ["Alpha"] });
  const somewhere = reachSays({ plans: ["Basic"], shops: 4 });

  it("is a price charged to nobody, or to a shop nobody would look at", () => {
    expect(pricedOddly(never, 25000)).toBe(true);
    expect(pricedOddly(anyway, 25000)).toBe(true);
  });

  it("is not an ordinary add-on's price", () => {
    expect(pricedOddly(somewhere, 500)).toBe(false);
  });

  it("is nothing while the box is free, half-typed, or unanswered", () => {
    expect(pricedOddly(never, 0)).toBe(false);
    expect(pricedOddly(anyway, 0)).toBe(false);
    expect(pricedOddly(anyway, Number(""))).toBe(false);
    expect(pricedOddly(anyway, Number("abc"))).toBe(false);
    expect(pricedOddly(null, 25000)).toBe(false);
  });
});
