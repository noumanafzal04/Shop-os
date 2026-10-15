import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import OwesCell from "./OwesCell";

/** A customer's row says what they owe and how close they are to their limit (L16). */

vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number | string) => `Rs ${Number(n).toLocaleString("en-US")}` }));

const cell = (credit_balance: string | number, credit_limit: string | number | null = null) =>
  render(<OwesCell customer={{ credit_balance, credit_limit }} />).container;

describe("what a customer owes, on their row", () => {
  it("says the amount owed, and how far into the limit", () => {
    const half = cell("5000", "10000");
    expect(half).toHaveTextContent("Rs 5,000");
    expect(half).toHaveTextContent("of Rs 10,000");
    expect(half).not.toHaveTextContent(/limit/i);
    expect(half.querySelector("[style]")).toHaveStyle({ width: "50%" });
  });

  it("marks near the limit from 80%, and over it past 100% — the bar stops at full", () => {
    expect(cell("8000", "10000")).toHaveTextContent("Near limit");
    expect(cell("7999", "10000")).not.toHaveTextContent("Near limit");
    const over = cell("12000", "10000");
    expect(over).toHaveTextContent("Over limit");
    expect(over.querySelector("[style]")).toHaveStyle({ width: "100%" });
  });

  it("says an advance as an advance, and nothing for a clear account", () => {
    expect(cell("-300")).toHaveTextContent("Advance Rs 300");
    expect(cell("0")).toHaveTextContent("—");
    expect(cell("2500")).not.toHaveTextContent("of Rs");
  });
});
