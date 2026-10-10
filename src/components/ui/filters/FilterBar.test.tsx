import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FilterBar } from "./FilterBar";

const bar = (results: { count: number | undefined; noun: string; loading?: boolean }) =>
  render(
    <FilterBar applied={[]} onClearAll={() => undefined} results={results}>
      <span>filters</span>
    </FilterBar>,
  );

describe("how many the list holds, at the end of its filter bar", () => {
  it("says it is counting while it is", () => {
    bar({ count: undefined, noun: "customers", loading: true });

    expect(screen.getByText("Counting…")).toBeInTheDocument();
  });

  it("says the count once there is one — nought included", () => {
    bar({ count: 1280, noun: "customers", loading: false });
    expect(screen.getByText("1,280 customers")).toBeInTheDocument();

    bar({ count: 0, noun: "coupons", loading: false });
    expect(screen.getByText("0 coupons")).toBeInTheDocument();
  });

  it("says nothing when the list did not load — it is not counting, and there is no count", () => {
    // It read "Counting…" for ever, beside "The customer list could not be loaded."
    bar({ count: undefined, noun: "customers", loading: false });

    expect(screen.queryByText("Counting…")).toBeNull();
    expect(screen.queryByText(/customers/)).toBeNull();
  });
});
