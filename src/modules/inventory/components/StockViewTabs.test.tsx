import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StockViewTabs } from "./StockViewTabs";
import { movementChange, movementWhat } from "../movementWords";

/**
 * THE STOCK SCREEN'S THREE QUESTIONS (the user, 2026-10-16: "inventory page
 * ka UI acha ni hai"). How much, what is low, what is gone — each a count and
 * a way into its rows.
 */
describe("the stock filter", () => {
  it("say — for a count that has not arrived, never 0", () => {
    // "0 out of stock" is a claim about the shelf; a failed request knows
    // nothing about the shelf.
    render(<StockViewTabs view="all" counts={{ all: 540, low: null, out: 0 }} onPick={() => {}} />);

    expect(screen.getByTestId("stock-view-all").textContent).toContain("540");
    expect(screen.getByTestId("stock-view-low").textContent, "an unknown count was shown as nought").toContain("—");
    expect(screen.getByTestId("stock-view-low").textContent).not.toMatch(/\b0\b/);
    expect(screen.getByTestId("stock-view-out").textContent).toContain("0");
  });

  it("mark the open one, and open the one pressed", () => {
    const onPick = vi.fn();
    render(<StockViewTabs view="low" counts={{ all: 1, low: 2, out: 3 }} onPick={onPick} />);

    expect(screen.getByTestId("stock-view-low").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("stock-view-all").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByTestId("stock-view-out"));
    expect(onPick).toHaveBeenCalledWith("out");
  });

  it("keep the help pages' name for the reorder list", () => {
    // Help → "Inventory → Needs reordering". A topic renamed is a help page wrong.
    render(<StockViewTabs view="all" counts={{ all: 1, low: 2, out: 3 }} onPick={() => {}} />);
    expect(screen.getByTestId("stock-view-low").textContent).toContain("Needs reordering");
  });
});

describe("a line of stock history", () => {
  it("is signed the way a shopkeeper reads it, without the wire's three decimals", () => {
    expect(movementChange("6.000")).toBe("+6");
    expect(movementChange(-2)).toBe("−2");
    expect(movementChange("2.500")).toBe("+2.5");
    expect(movementChange(0)).toBe("±0");
  });

  it("says what happened — in its own words when it has them", () => {
    expect(movementWhat({ type: "in", quantity_change: 24, reason: "Opening stock" })).toBe("Opening stock");
    expect(movementWhat({ type: "in", quantity_change: 6, reason: null })).toBe("Stock in");
    expect(movementWhat({ type: "out", quantity_change: -1, reason: null })).toBe("Stock out");
    expect(movementWhat({ type: "set", quantity_change: -3, reason: null })).toBe("Recount");
  });
});
