import { describe, expect, it } from "vitest";

import { boardWords, hasJobBoard } from "./words";

/**
 * A job card is work TAKEN IN — lines accumulate, nobody knows the price when
 * it arrives, and it becomes an invoice when the customer collects. That is a
 * workshop, and it is equally a laundry, a tailor and a repair counter.
 *
 * The document was never fenced to automotive; only the screen was. So a dry
 * cleaner could create the exact record it needs through the API and had
 * nowhere to look at it.
 */
describe("who runs a board of work taken in", () => {
  it("a workshop does", () => {
    expect(hasJobBoard("automotive")).toBe(true);
  });

  it("so does a laundry, a tailor, a cobbler — every services shop", () => {
    expect(hasJobBoard("services")).toBe(true);
  });

  it("a shop that sells off a shelf does not", () => {
    // A grocer hands the goods over at the counter. There is no middle state
    // to put on a board, and a permanently empty board is a menu item people
    // learn to skip.
    for (const trade of ["mart", "pharmacy", "retail", "food", "petroleum", "finance"]) {
      expect(hasJobBoard(trade), `${trade} should have no job board`).toBe(false);
    }
  });

  it("an untyped tenant gets no board rather than a guess", () => {
    expect(hasJobBoard(null)).toBe(false);
    expect(hasJobBoard(undefined)).toBe(false);
  });
});

describe("the words change, the board does not", () => {
  it("a workshop talks about cars and the bay", () => {
    const w = boardWords("automotive");

    expect(w.unit).toBe("car");
    expect(w.stages[0]).toBe("In the bay");
    // The plate IS the job here, and it carries the car's whole history.
    expect(w.tracksVehicle).toBe(true);
  });

  it("a services shop talks about jobs, and is never asked for a registration", () => {
    const w = boardWords("services");

    expect(w.unit).toBe("job");
    expect(w.stages[0]).toBe("Taken in");
    // Asking a tailor for a car's registration is how a screen loses a trade.
    expect(w.tracksVehicle).toBe(false);
  });

  it("both boards have the same three stages, in the same order", () => {
    // Vocabulary, not behaviour. Two trades doing the same thing must not
    // drift into two half-maintained flows.
    expect(boardWords("automotive").stages).toHaveLength(3);
    expect(boardWords("services").stages).toHaveLength(3);
    expect(boardWords("automotive").stages[2]).toBe(boardWords("services").stages[2]);
  });
});
