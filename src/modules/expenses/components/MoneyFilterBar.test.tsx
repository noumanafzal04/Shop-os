import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MoneyFilters } from "../services/moneyFilters";
import { MoneyFilterBar } from "./MoneyFilterBar";

const money = (n: number | string) => `Rs ${n}`;
const CATEGORIES = [{ value: "rent", label: "Rent" }, { value: "net", label: "Internet" }];
const METHODS = [{ value: "cash", label: "Cash" }, { value: "bank_transfer", label: "Bank transfer" }];
const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };

function draw(filters: MoneyFilters, periodIsGiven = false) {
  const onChange = vi.fn();

  render(
    <MoneyFilterBar
      filters={filters}
      onChange={onChange}
      categories={CATEGORIES}
      methods={METHODS}
      money={money}
      periodIsGiven={periodIsGiven}
    />,
  );

  return onChange;
}

describe("a list anybody may look at for any dates", () => {
  it("shows the range as a chip that can be taken off", async () => {
    const onChange = draw({ ...OCTOBER, page: 1 });

    await userEvent.click(screen.getByRole("button", { name: "Remove filter 1 – 31 Oct" }));

    expect(onChange).toHaveBeenCalledWith({ from: "", to: "", page: 1 });
  });

  it("clearing all takes the dates with everything else", async () => {
    const onChange = draw({ ...OCTOBER, search: "rent", category_id: ["rent"], sort: "amount", dir: "asc", page: 4 });

    await userEvent.click(screen.getAllByRole("button", { name: "Clear all" })[0]);

    // Only the order the list is in survives.
    expect(onChange).toHaveBeenCalledWith({ page: 1, sort: "amount", dir: "asc" });
  });

  it("counts a range as one filter on the button", () => {
    draw({ ...OCTOBER, page: 1 });

    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveTextContent("Filters1");
  });
});

describe("a screen that is always about a period", () => {
  it("does not offer to take its own period away", () => {
    draw({ ...OCTOBER, page: 1 }, true);

    expect(screen.queryByRole("button", { name: /Remove filter 1 – 31 Oct/ })).not.toBeInTheDocument();
    // Nothing is narrowing it, so nothing is "showing" and there is nothing to clear.
    expect(screen.queryByText("Showing")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveTextContent(/^Filters$/);
  });

  it("clearing all keeps the period and drops the rest", async () => {
    const onChange = draw({ ...OCTOBER, search: "invoice 114", category_id: ["rent"], payment_method: ["cash"], page: 3 }, true);

    await userEvent.click(screen.getAllByRole("button", { name: "Clear all" })[0]);

    expect(onChange).toHaveBeenCalledWith({ page: 1, sort: undefined, dir: undefined, ...OCTOBER });
  });

  it("still shows, and can remove, what IS narrowing it", async () => {
    const onChange = draw({ ...OCTOBER, category_id: ["rent"], page: 1 }, true);

    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveTextContent("Filters1");
    await userEvent.click(screen.getByRole("button", { name: "Remove filter Rent" }));

    expect(onChange).toHaveBeenCalledWith({ ...OCTOBER, category_id: [], page: 1 });
  });
});
