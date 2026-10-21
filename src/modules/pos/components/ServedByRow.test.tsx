import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ServedByRow } from "./ServedByRow";

vi.mock("../services/posService", () => ({
  posService: { sellers: async () => ({ data: [{ id: "me", name: "Kamran" }, { id: "farhat", name: "Farhat" }] }) },
}));

function Sheet({ me, anyone, sent }: { me: string | null; anyone: boolean; sent: (v: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null);

  return <ServedByRow enabled me={me} anyone={anyone} value={value} onChange={(v) => { setValue(v); sent(v); }} />;
}

const open = (me: string | null, sent = vi.fn(), anyone = true) => {
  render(<QueryClientProvider client={new QueryClient()}><Sheet me={me} anyone={anyone} sent={sent} /></QueryClientProvider>);

  return sent;
};

/** The user, 2026-10-21: "Served by" opens on whoever is at the till. */
describe("who served", () => {
  it("opens on the person at the till when they are a seller", async () => {
    open("me");
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("me"));
  });

  it("stays on Nobody once Nobody is picked — never re-seeded", async () => {
    const sent = open("me");
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("me"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });

    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(sent).toHaveBeenLastCalledWith(null);
  });

  it("names nobody it was not told is a seller", async () => {
    const sent = open("owner-not-on-the-floor");
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());

    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(sent).not.toHaveBeenCalled();
  });

  it("offers only themselves to somebody who may not credit a colleague", async () => {
    open("me", vi.fn(), false);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("me"));

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Kamran"]);
    expect(screen.getByText(/naming a colleague needs a manager/)).toBeInTheDocument();
  });
});
