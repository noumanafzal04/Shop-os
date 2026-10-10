import { describe, expect, it } from "vitest";

import { ALL_BRANCHES, branchRows, findBranches, step } from "./branchMenu";
import type { Branch } from "./services/branchService";

const branch = (over: Partial<Branch>): Branch => ({
  id: "b", name: "Branch", code: null, is_default: false, is_active: true,
  address: null, phone: null, city_id: null, city: null, latitude: null, longitude: null, ...over,
});

describe("the branch menu's rows", () => {
  it("opens with the head-office view, and says what choosing it means", () => {
    const rows = branchRows([branch({ id: "1", name: "Saddar" })]);

    expect(rows[0]).toEqual(ALL_BRANCHES);
    expect(rows[0].note).toBe("Head office — every branch together");
  });

  it("does not tag the default branch with its own name", () => {
    // "Main — Main" was what the menu said.
    const [, main] = branchRows([branch({ id: "1", name: "Main", is_default: true })]);

    expect(main.tag).toBe("Default");
  });

  it("calls a default branch with a name of its own the main branch", () => {
    const [, gulberg] = branchRows([branch({ id: "1", name: "Gulberg", is_default: true })]);

    expect(gulberg.tag).toBe("Main branch");
  });

  it("says where a branch is, so two with near names can be told apart", () => {
    const rows = branchRows([
      branch({ id: "1", name: "Saddar", city: { id: "c", name: "Karachi" } }),
      branch({ id: "2", name: "Saddar 2", address: "  12 Mall Road  " }),
      branch({ id: "3", name: "Nowhere", address: "   " }),
    ]);

    expect(rows[1].note).toBe("Karachi");
    expect(rows[2].note).toBe("12 Mall Road");
    expect(rows[3].note).toBeNull();
  });

  it("marks a branch that is closed — and that is the one tag it gets", () => {
    const [, shut] = branchRows([branch({ id: "1", name: "Main", is_default: true, is_active: false })]);

    expect(shut.tag).toBe("Closed");
  });
});

describe("finding a branch in a long list", () => {
  const rows = branchRows([
    branch({ id: "1", name: "Saddar", city: { id: "c", name: "Karachi" } }),
    branch({ id: "2", name: "Gulberg", city: { id: "l", name: "Lahore" } }),
  ]);

  it("leaves everything while nothing is typed", () => {
    expect(findBranches(rows, "  ")).toHaveLength(3);
  });

  it("finds by name or by where it is, whatever the case", () => {
    expect(findBranches(rows, "gul").map((r) => r.name)).toEqual(["Gulberg"]);
    expect(findBranches(rows, "KARACHI").map((r) => r.name)).toEqual(["Saddar"]);
  });

  it("does not offer the head-office view as a match for a typed word", () => {
    // Typing "all" is looking for a branch called that, not for every branch.
    expect(findBranches(rows, "branch")).toEqual([]);
  });
});

describe("moving through the menu with the arrow keys", () => {
  it("wraps at both ends", () => {
    expect(step(0, 3, 1)).toBe(1);
    expect(step(2, 3, 1)).toBe(0);
    expect(step(0, 3, -1)).toBe(2);
  });

  it("steps onto an end from nothing lit, and nowhere in an empty list", () => {
    expect(step(-1, 3, 1)).toBe(0);
    expect(step(-1, 3, -1)).toBe(2);
    expect(step(0, 0, 1)).toBe(-1);
  });
});
