import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ShowingSome } from "./StockReportTabs";

/**
 * A capped table has to admit it is capped.
 *
 * The server sends the top 200 holdings and totals over every one of the
 * 569 — but the screen used to draw the 200 and stop, so the longest list a
 * shop had read as the complete list. The two failure modes are opposites:
 * saying nothing when rows were dropped, and nagging about a cap on a shop
 * whose whole shelf fits.
 */
afterEach(cleanup);

describe("the line that says the table is not the whole shelf", () => {
  it("names both numbers when rows were left off", () => {
    render(<ShowingSome shown={200} total={569} />);

    const note = screen.getByText(/showing the top/i);
    expect(note.textContent).toContain("200");
    expect(note.textContent).toContain("569");
  });

  it("says nothing at all when every line is on screen", () => {
    const { container } = render(<ShowingSome shown={12} total={12} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing before the report has answered", () => {
    const { container } = render(<ShowingSome shown={0} total={0} />);

    expect(container).toBeEmptyDOMElement();
  });
});
