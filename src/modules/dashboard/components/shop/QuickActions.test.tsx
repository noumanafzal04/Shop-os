import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { capabilitiesFrom } from "./capabilities";
import { QuickActions } from "./QuickActions";

/**
 * WHAT A SHOP DOES FIRST IS AT THE TOP OF THE PAGE.
 *
 * The shortcuts were nine pills at the foot of the dashboard. Four of them
 * are tiles under the hero now and the rest stay where they were — and the
 * one thing that must stay true through that split is that nothing is lost
 * between the two halves, and nothing is offered twice.
 */

const everything = { pos: true, dine_in: true, marketplace: true, products: true, inventory: true, purchasing: true, expenses: true };
type Visit = (path: string) => boolean;
const all: Visit = () => true;

const hrefs = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"));

const draw = (show: "all" | "top" | "rest" | undefined, features: Record<string, boolean>, visit: Visit = all) =>
  render(
    <MemoryRouter>
      <QuickActions caps={capabilitiesFrom(features, "food", visit)} show={show} />
    </MemoryRouter>,
  );

describe("the row under the hero", () => {
  it("is the four a restaurant reaches for first, in that order", () => {
    draw("top", everything);

    const row = screen.getByRole("navigation", { name: "Quick actions" });
    expect(hrefs(row)).toEqual(["/tenant/pos", "/tenant/dine-in", "/tenant/orders", "/tenant/expenses"]);
    // Each says what pressing it gets you, not only its name.
    expect(within(row).getByText("Ring a sale at the till")).toBeInTheDocument();
  });

  it("for a books-only business, leads with what IT does", () => {
    draw("top", { expenses: true });

    expect(hrefs(screen.getByRole("navigation", { name: "Quick actions" })))
      .toEqual(["/tenant/expenses", "/tenant/reports", "/tenant/cashbook"]);
  });

  it("offers nothing this person cannot open", () => {
    // A cashier: the till and nothing else.
    draw("top", everything, (path) => path === "/tenant/pos");

    expect(hrefs(screen.getByRole("navigation", { name: "Quick actions" }))).toEqual(["/tenant/pos"]);
  });

  it("draws nothing at all when there is nothing to offer", () => {
    const { container } = draw("top", everything, () => false);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the two halves are the whole, once", () => {
  it("top and rest between them offer exactly what 'all' offers", () => {
    const whole = hrefs(draw("all", everything).container);
    const top = hrefs(draw("top", everything).container);
    const rest = hrefs(draw("rest", everything).container);

    // The denominator: a shop with everything has more than fits in one row.
    expect(whole.length).toBeGreaterThan(4);
    expect(top).toHaveLength(4);
    expect([...top, ...rest].sort()).toEqual([...whole].sort());
    // Nothing in both.
    expect(top.filter((href) => rest.includes(href))).toEqual([]);
  });

  it("with four or fewer there is no second half to draw", () => {
    const { container } = draw("rest", { pos: true });

    expect(container).toBeEmptyDOMElement();
  });
});
