import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import Select from "./Select";

/**
 * THE RETAIL FLOW, #4 (2026-10-21): "Round cash bills to" listed "Nothing —
 * exact to the paisa" twice — the placeholder, disabled, then the real choice.
 */
const ROUNDING = [
  { value: "0", label: "Nothing — exact to the paisa" },
  { value: "1", label: "Nearest Rs 1" },
];

describe("a select that always holds one of its choices", () => {
  it("lists each choice once, with no dead line above them", () => {
    render(<Select aria-label="Round cash bills to" value="0" options={ROUNDING} placeholder={null} onChange={() => {}} />);

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Nothing — exact to the paisa", "Nearest Rs 1"]);
  });

  it("still opens with its placeholder where one is asked for", () => {
    render(<Select aria-label="Kind" options={ROUNDING} onChange={() => {}} />);

    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Select an option");
  });
});
