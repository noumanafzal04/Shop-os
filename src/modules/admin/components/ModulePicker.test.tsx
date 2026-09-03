import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ModulePicker } from "./ModulePicker";
import type { ModuleInfo } from "../services/adminService";

/**
 * The one screen an admin decides a shop's whole shape on.
 *
 * A flat list of nineteen switches is its own kind of unusable, and a switch
 * that silently moves four others is the thing an admin cannot undo from
 * memory. Both are what this file holds.
 */

const CATALOG: ModuleInfo[] = [
  { key: "products", label: "Products", description: "A catalog.", group: "Selling", depends: [] },
  { key: "pos", label: "Point of Sale", description: "The till.", group: "Selling", depends: [] },
  { key: "inventory", label: "Inventory", description: "Stock tracking.", group: "Stock", depends: ["products"] },
  { key: "purchasing", label: "Suppliers & Purchases", description: "Orders and payables.", group: "Stock", depends: ["inventory"] },
  { key: "disposals", label: "Disposals", description: "Stock that left unsold.", group: "Stock", depends: ["inventory"] },
];

function show(value: Record<string, boolean>, extra: Partial<Parameters<typeof ModulePicker>[0]> = {}) {
  const onChange = vi.fn();
  render(<ModulePicker catalog={CATALOG} value={value} onChange={onChange} {...extra} />);

  return onChange;
}

describe("the sections", () => {
  it("groups the switches the way the registry does", () => {
    show({});

    expect(screen.getByText("Selling")).toBeInTheDocument();
    expect(screen.getByText("Stock")).toBeInTheDocument();
  });

  it("says how much of each section is on, so the shape reads at a glance", () => {
    show({ products: true, pos: true, inventory: true });

    // Selling: 2 of 2. Stock: 1 of 3.
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });

  it("names every switch, because the label sits outside the control", () => {
    // Nineteen identical buttons announced as "button" is nineteen ways to
    // switch off the wrong module.
    show({});

    for (const m of CATALOG) {
      expect(screen.getByRole("switch", { name: m.label })).toBeInTheDocument();
    }
  });

  it("says which switch is on", () => {
    show({ products: true });

    expect(screen.getByRole("switch", { name: "Products" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Point of Sale" })).toHaveAttribute("aria-checked", "false");
  });
});

describe("a press that moves other switches", () => {
  it("pulls the whole chain up rather than refusing", () => {
    // The old screens greyed the row out until its dependency was on and left
    // the admin to work out which of nineteen switches to find first.
    const onChange = show({});

    return userEvent.click(screen.getByRole("switch", { name: "Suppliers & Purchases" })).then(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
      const next = onChange.mock.calls[0][0];
      expect(next.purchasing).toBe(true);
      expect(next.inventory).toBe(true);
      expect(next.products).toBe(true);
    });
  });

  it("says before the press what else it will switch on — the whole chain", () => {
    show({});

    // Suppliers & Purchases needs Inventory, which needs Products. A hint
    // naming only the direct dependency would understate the press, and the
    // note AFTER it would then say something the note before it did not.
    // Purchasing and Disposals both stand on that chain, so both rows say it.
    expect(
      screen.getAllByText("Switching this on also switches on Products and Inventory."),
    ).toHaveLength(2);

    // And Inventory itself names only what IT stands on.
    expect(
      screen.getByText("Switching this on also switches on Products."),
    ).toBeInTheDocument();
  });

  it("says after the press what else moved", async () => {
    // Rendered from the picker's own state, so this is asserted on a press
    // whose result the parent has not applied — which is exactly the moment an
    // admin needs to be told.
    render(
      <ModulePicker
        catalog={CATALOG}
        value={{ products: true, inventory: true, purchasing: true, disposals: true }}
        onChange={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("switch", { name: "Inventory" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      /Also switched off: Suppliers & Purchases, Disposals/,
    );
  });

  it("stays quiet when nothing else moved", async () => {
    render(<ModulePicker catalog={CATALOG} value={{ products: true }} onChange={() => {}} />);

    await userEvent.click(screen.getByRole("switch", { name: "Point of Sale" }));

    // A screen that announced a ripple every time would train an admin to stop
    // reading it.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("against what the trade usually gets", () => {
  it("marks the switches that are a decision for this shop", () => {
    show(
      { products: true, pos: true, disposals: true, inventory: true },
      { defaults: { products: true, pos: true, inventory: true } },
    );

    expect(screen.getByText("granted")).toBeInTheDocument();
  });

  it("marks one that was taken away", () => {
    show({ products: true }, { defaults: { products: true, pos: true } });

    expect(screen.getByText("removed")).toBeInTheDocument();
  });

  it("offers a way back, and settles the map on the way", async () => {
    const onChange = vi.fn();
    render(
      <ModulePicker
        catalog={CATALOG}
        value={{ products: true }}
        onChange={onChange}
        // A proposal that is not self-consistent: purchasing with no inventory.
        defaults={{ products: true, purchasing: true }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Back to the usual set/ }));

    const next = onChange.mock.calls[0][0];
    expect(next.purchasing).toBe(false);
    expect(next.products).toBe(true);
  });

  it("says nothing about defaults when the shop matches them", () => {
    show({ products: true }, { defaults: { products: true } });

    expect(screen.queryByText(/Back to the usual set/)).not.toBeInTheDocument();
  });
});

describe("nothing to show", () => {
  it("says so rather than rendering an empty box", () => {
    render(<ModulePicker catalog={[]} value={{}} onChange={() => {}} emptyHint="Choose a business type first." />);

    expect(screen.getByText("Choose a business type first.")).toBeInTheDocument();
  });
});
