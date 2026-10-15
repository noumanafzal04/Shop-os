import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAuthStore } from "../../../stores/authStore";
import { CustomerSuggestions } from "./CustomerSuggestions";

/**
 * The till's Customer box and the quotation form find somebody already on
 * file from a few letters or digits; a tap fills both boxes (L8).
 */

const asked: string[] = [];
vi.mock("../../../common/api/client", () => ({
  apiGet: async (_path: string, opts: { params: { q: string } }) => {
    asked.push(opts.params.q);
    return { data: [{ id: "c1", name: "Ahmed Khan", phone: "0300-1234567" }, { id: "c2", name: null, phone: "03001239999" }] };
  },
}));

function wrap(node: ReactNode): ReactNode {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;
}

const withCustomers = (on: boolean) =>
  useAuthStore.setState({ user: { tenant: { features: { customers: on } } } } as never);

beforeEach(() => {
  asked.length = 0;
  withCustomers(true);
});

describe("finding a customer already on file", () => {
  it("lists who matches three letters of a name, and a tap fills both boxes", async () => {
    const onPick = vi.fn();
    render(wrap(<CustomerSuggestions name="Ahm" phone="" onPick={onPick} />));

    await waitFor(() => expect(screen.getByTestId("customer-suggestions")).toBeInTheDocument());
    expect(asked).toEqual(["Ahm"]);
    fireEvent.click(screen.getByRole("button", { name: /Ahmed Khan/ }));
    expect(onPick).toHaveBeenCalledWith({ id: "c1", name: "Ahmed Khan", phone: "0300-1234567" });
    expect(screen.getByRole("button", { name: /No name yet/ })).toBeInTheDocument();
  });

  it("searches by the number once it has four digits", async () => {
    render(wrap(<CustomerSuggestions name="Ah" phone="0300 12" onPick={() => {}} />));
    await waitFor(() => expect(asked).toEqual(["0300 12"]));
  });

  it("asks nothing for two letters, or without the Customers module", async () => {
    render(wrap(<CustomerSuggestions name="Ah" phone="03" onPick={() => {}} />));
    withCustomers(false);
    render(wrap(<CustomerSuggestions name="Ahmed" phone="" onPick={() => {}} />));
    await new Promise((r) => setTimeout(r, 400));
    expect(asked).toEqual([]);
    expect(screen.queryByTestId("customer-suggestions")).toBeNull();
  });

  it("goes away once the boxes hold the person found", async () => {
    render(wrap(<CustomerSuggestions name="Ahmed Khan" phone="0300-1234567" onPick={() => {}} />));
    await waitFor(() => expect(asked.length).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("customer-suggestions")).toBeNull();
  });
});
