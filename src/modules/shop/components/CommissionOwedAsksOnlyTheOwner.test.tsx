import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as client from "../../../common/api/client";
import { useAuthStore } from "../../../stores/authStore";
import { CommissionOwed } from "./CommissionOwed";

/**
 * WHAT THE SHOP OWES THE PLATFORM IS ASKED ONLY FOR SOMEBODY WHO MAY KNOW.
 *
 * The Subscription screen is on every member of staff's menu, and it holds
 * this panel. The server answers it for whoever holds Shop settings and
 * refuses the rest — so a cashier, a stock keeper, an accountant and a
 * manager each drew a 403 by opening a screen their own menu had offered.
 * Found by walking the shop as each of them and reading what was refused.
 */

const owed = {
  applies: true, rate: 4.5, rate_is_yours: false,
  outstanding: { orders: 2, base: 6900, amount: 310 },
  charges: [], invoices: [],
};

/** How many times the commission bill was asked for — the shop's settings are asked for too, by the money formatter. */
let asked: string[];

const shown = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CommissionOwed />
    </QueryClientProvider>,
  );

const signedInAs = (role: string, permissions: string[]) =>
  useAuthStore.setState({ user: { id: "u1", role, permissions, tenant: { id: "t1" } } as never, isAuthenticated: true });

beforeEach(() => {
  asked = [];
  vi.spyOn(client, "apiGet").mockImplementation((async (url: string) => {
    if (url === "/commission") asked.push(url);

    return { success: true, message: "", data: url === "/commission" ? owed : {}, errors: {}, meta: {} };
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("who is asked for", () => {
  it("the owner — and they are told", async () => {
    signedInAs("shop_owner", []);

    shown();

    expect(await screen.findByText("Marketplace commission")).toBeInTheDocument();
    expect(asked).toEqual(["/commission"]);
  });

  it("a member of staff who holds Shop settings", async () => {
    signedInAs("staff", ["settings.manage"]);

    shown();

    await waitFor(() => expect(asked).toHaveLength(1));
  });

  it.each([
    ["a cashier", ["sales.manage", "discounts.apply", "customers.manage"]],
    ["a stock keeper", ["products.manage", "inventory.manage"]],
    ["an accountant", ["expenses.manage", "reports.view"]],
    ["a manager without Shop settings", ["sales.manage", "purchases.manage", "reports.view", "orders.manage"]],
  ])("not %s — the server would only refuse", async (_who, permissions) => {
    signedInAs("staff", permissions);

    const { container } = shown();
    await new Promise((turn) => setTimeout(turn, 60));

    expect(asked, "a request the server refuses was sent anyway").toEqual([]);
    expect(container).toBeEmptyDOMElement();
  });
});
