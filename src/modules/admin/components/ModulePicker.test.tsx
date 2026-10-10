import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ModulePicker, type ModuleBands } from "./ModulePicker";
import type { ModuleInfo } from "../services/adminService";

/**
 * The picker sorts a shop's modules by where each comes from — the plan, an
 * add-on, or not this trade's at all. What is held here is that a person
 * setting up a small shop sees a small list, that an add-on says what it
 * costs, and that nothing which is ON is ever folded out of sight.
 */
const CATALOG: ModuleInfo[] = [
  { key: "products", label: "Products", description: "A catalog.", group: "Selling", depends: [] },
  { key: "pos", label: "Point of Sale", description: "The till.", group: "Selling", depends: [] },
  { key: "inventory", label: "Inventory", description: "Stock tracking.", group: "Stock", depends: ["products"] },
  { key: "purchasing", label: "Suppliers & Purchases", description: "Orders and payables.", group: "Stock", depends: ["inventory"] },
  { key: "kitchen", label: "Kitchen Tickets", description: "A pass for the kitchen.", group: "Trade-specific", depends: ["products"] },
];

const BASIC_FOR_A_MART: ModuleBands = {
  included: ["products", "pos"],
  addons: ["inventory", "purchasing"],
  other: ["kitchen"],
  essential: ["products"],
};

function show(value: Record<string, boolean>, extra: Partial<Parameters<typeof ModulePicker>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <ModulePicker
      catalog={CATALOG}
      value={value}
      onChange={onChange}
      offer={BASIC_FOR_A_MART}
      prices={{ inventory: 400 }}
      planName="Basic"
      tradeLabel="a mart"
      {...extra}
    />,
  );

  return onChange;
}

const band = (id: string) => within(screen.getByTestId(id));

describe("three bands, by where a module comes from", () => {
  it("puts what the plan gives in one, and what can be added in another", () => {
    show({ products: true, pos: true });

    expect(band("modules-included").getByRole("switch", { name: "Products" })).toBeChecked();
    expect(band("modules-included").getByRole("switch", { name: "Point of Sale" })).toBeChecked();
    expect(band("modules-addons").getByRole("switch", { name: "Inventory" })).not.toBeChecked();
    expect(band("modules-addons").getByRole("switch", { name: "Suppliers & Purchases" })).not.toBeChecked();
    expect(screen.getByText("In Basic")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 on")).toBeInTheDocument();
  });

  it("does not ask a mart about a kitchen until somebody goes looking", async () => {
    show({ products: true, pos: true });

    expect(screen.queryByRole("switch", { name: "Kitchen Tickets" })).not.toBeInTheDocument();
    expect(screen.getByText(/Not usual for a mart/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Not usual for a mart/ }));
    expect(band("modules-other").getByRole("switch", { name: "Kitchen Tickets" })).toBeInTheDocument();
  });

  it("never folds away a module the shop already has", () => {
    // Granted once, deliberately: it is an add-on this shop has, and it is on the bill.
    show({ products: true, pos: true, kitchen: true });

    expect(band("modules-addons").getByRole("switch", { name: "Kitchen Tickets" })).toBeChecked();
    expect(screen.queryByTestId("modules-other")).not.toBeInTheDocument();
  });

  it("says which of the plan's modules the trade cannot do without, and which were switched off here", () => {
    show({ products: true, pos: false });

    expect(band("modules-included").getByText("needed")).toHaveAttribute("title", "A mart cannot open without it");
    expect(band("modules-included").getByText("off for this shop")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 on")).toBeInTheDocument();
  });
});

describe("an add-on says what it costs", () => {
  it("prices the ones the platform has priced, and says the rest are free", () => {
    show({ products: true, pos: true });

    expect(within(document.querySelector('[data-module="inventory"]') as HTMLElement).getByText("Rs 400 / mo")).toBeInTheDocument();
    expect(within(document.querySelector('[data-module="purchasing"]') as HTMLElement).getByText("Free to add")).toBeInTheDocument();
    // What the plan includes carries no price at all.
    expect(within(document.querySelector('[data-module="products"]') as HTMLElement).queryByText(/Rs|Free to add/)).not.toBeInTheDocument();
  });

  it("adds up what was switched on past the plan", () => {
    show({ products: true, pos: true, inventory: true, purchasing: true });

    expect(screen.getByTestId("modules-addons-total")).toHaveTextContent("2 add-ons · Rs 400 a month on top of the plan");
  });

  it("says so when the add-ons cost nothing", () => {
    show({ products: true, pos: true, inventory: true, purchasing: true }, { prices: {} });

    expect(screen.getByTestId("modules-addons-total")).toHaveTextContent("nothing extra to pay");
  });

  it("lets one shop be given its own price — only where that can be saved, and only for an add-on it has", async () => {
    const onOwnPrices = vi.fn();
    show({ products: true, pos: true, inventory: true }, { ownPrices: {}, onOwnPrices });

    const box = screen.getByRole("spinbutton", { name: "Inventory: this shop's own price a month" });
    expect(screen.queryByRole("spinbutton", { name: /Suppliers & Purchases/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /Products/ })).not.toBeInTheDocument();

    await userEvent.type(box, "3");
    expect(onOwnPrices).toHaveBeenLastCalledWith({ inventory: "3" });
  });

  it("counts the shop's own price, not the platform's, once it has one", () => {
    show({ products: true, pos: true, inventory: true }, { ownPrices: { inventory: "250" }, onOwnPrices: vi.fn() });

    expect(screen.getByTestId("modules-addons-total")).toHaveTextContent("1 add-on · Rs 250 a month on top of the plan");
  });

  it("offers no price box on a screen that cannot save one", () => {
    show({ products: true, pos: true, inventory: true });

    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
});

describe("a press that moves other switches", () => {
  it("pulls the whole chain up rather than refusing", async () => {
    const onChange = show({ products: true, pos: true });

    await userEvent.click(screen.getByRole("switch", { name: "Suppliers & Purchases" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ inventory: true, purchasing: true }));
  });

  it("says before the press what else it will switch on", () => {
    show({ products: true, pos: true });

    expect(screen.getByText("Also switches on Inventory.")).toBeInTheDocument();
  });

  it("says after the press what else moved", async () => {
    show({ products: true, pos: true });

    await userEvent.click(screen.getByRole("switch", { name: "Suppliers & Purchases" }));

    expect(screen.getByRole("status")).toHaveTextContent("Also switched on: Inventory.");
  });

  it("warns that switching the catalog off takes what stands on it", () => {
    show({ products: true, pos: true, inventory: true });

    expect(screen.getByText("Inventory needs this — off here is off there too.")).toBeInTheDocument();
  });
});

describe("back to just the plan", () => {
  it("is offered once the shop is not exactly what the plan gives, and puts it back", async () => {
    const onChange = show({ products: true, pos: true, inventory: true });

    await userEvent.click(screen.getByRole("button", { name: "Back to just the plan" }));

    expect(onChange).toHaveBeenCalledWith({ products: true, pos: true, inventory: false, purchasing: false, kitchen: false });
  });

  it("says nothing when the shop has exactly the plan", () => {
    show({ products: true, pos: true });

    expect(screen.queryByRole("button", { name: "Back to just the plan" })).not.toBeInTheDocument();
  });
});

describe("with nothing to sort by", () => {
  it("lists every module as on offer when no plan and trade have said otherwise", () => {
    show({ products: true }, { offer: undefined });

    expect(screen.queryByTestId("modules-included")).not.toBeInTheDocument();
    expect(band("modules-addons").getAllByRole("switch")).toHaveLength(CATALOG.length);
  });

  it("says so rather than rendering an empty box", () => {
    render(<ModulePicker catalog={[]} value={{}} onChange={vi.fn()} emptyHint="Choose a business type first." />);

    expect(screen.getByText("Choose a business type first.")).toBeInTheDocument();
  });
});
