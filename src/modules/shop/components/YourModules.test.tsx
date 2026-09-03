import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { YourModules } from "./YourModules";
import { shopService } from "../services/shopService";

/**
 * The answer to "why can I not see Purchases".
 *
 * Modules stay the admin's decision. What was missing was not control — it was
 * the answer: a screen that has simply vanished reads as a broken product.
 */

const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });

const CATALOG = [
  { key: "pos", label: "Point of Sale", description: "The till.", group: "Selling", depends: [], enabled: true },
  { key: "purchasing", label: "Suppliers & Purchases", description: "Orders and payables.", group: "Stock", depends: ["inventory"], enabled: false },
  { key: "inventory", label: "Inventory", description: "Stock tracking.", group: "Stock", depends: ["products"], enabled: true },
];

function show(rows = CATALOG) {
  vi.spyOn(shopService, "modules").mockResolvedValue(envelope(rows) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <YourModules />
    </QueryClientProvider>,
  );
}

describe("what this shop has", () => {
  it("counts what is on against everything there is", async () => {
    show();

    expect(await screen.findByText("Your shop has 2 of 3 parts switched on")).toBeInTheDocument();
  });

  it("lists the parts that are OFF as well, by name", async () => {
    // The half that sends somebody to support: it is not missing, it is
    // available and not switched on — and now they can ask for it in the words
    // the admin will recognise.
    show();

    expect(await screen.findByText("Suppliers & Purchases")).toBeInTheDocument();
    expect(screen.getByText("Orders and payables.")).toBeInTheDocument();
  });

  it("says which is which to a screen reader, not only in colour", async () => {
    show();

    expect(await screen.findByText("— not switched on")).toBeInTheDocument();
    expect(screen.getAllByText("— on")).toHaveLength(2);
  });

  it("groups them the way the admin screen does", async () => {
    show();

    expect(await screen.findByText("Selling")).toBeInTheDocument();
    expect(screen.getByText("Stock")).toBeInTheDocument();
    // 1 of 1 in Selling, 1 of 2 in Stock.
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  it("says it is not the shop's own switch to throw", async () => {
    // A read-only screen that did not say so would read as a broken control.
    show();

    expect(await screen.findByText(/changed only by support/)).toBeInTheDocument();
  });

  it("says so when it cannot load, rather than showing an empty shop", async () => {
    vi.spyOn(shopService, "modules").mockRejectedValue(new Error("down"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <YourModules />
      </QueryClientProvider>,
    );

    // "0 of 0 parts switched on" would be a lie told confidently.
    expect(await screen.findByText(/Couldn't load what your shop has/)).toBeInTheDocument();
  });
});
