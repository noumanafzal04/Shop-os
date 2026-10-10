import { describe, expect, it } from "vitest";

import { eventWord, thingCalled } from "./words";

describe("what the audit trail's words are called on a screen", () => {
  it("never calls a customer's business a tenant", () => {
    expect(thingCalled("Tenant")).toBe("Shop settings");
    expect(thingCalled("Tenant", "business")).toBe("Business settings");
    expect(thingCalled("Tenant", "business")).not.toMatch(/tenant|shop/i);
  });

  it("calls an account a staff member, not a user", () => {
    expect(thingCalled("User")).toBe("Staff member");
  });

  it("names what the books changed", () => {
    expect(thingCalled("RecurringExpense")).toBe("Recurring expense");
    expect(thingCalled("RecurringIncome")).toBe("Recurring income");
    expect(thingCalled("ExpenseBudget")).toBe("Budget");
    expect(thingCalled("BusinessDay")).toBe("Trading day");
  });

  it("spaces out a model nobody has named, rather than printing code", () => {
    expect(thingCalled("ProductBatch")).toBe("Product batch");
    expect(thingCalled("Expense")).toBe("Expense");
  });

  it("has a word for nothing", () => {
    expect(thingCalled(undefined)).toBe("Record");
    expect(thingCalled(null)).toBe("Record");
  });

  it("says what happened as a person would", () => {
    expect(eventWord("created")).toBe("added");
    expect(eventWord("updated")).toBe("changed");
    expect(eventWord("deleted")).toBe("removed");
    expect(eventWord("reopened")).toBe("opened again");
    // A verb it has not met is left as it is; none at all is a change.
    expect(eventWord("archived")).toBe("archived");
    expect(eventWord(undefined)).toBe("changed");
  });
});
