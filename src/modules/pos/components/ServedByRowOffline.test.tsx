import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * WHO SERVED, WITH NO LINE (services #S5).
 *
 * Offline the seller list request failed, the "Served by" box vanished, and a
 * salon's sale synced with nobody named — the stylist's day short, nobody told.
 * The list now comes down with the catalogue and is read from the device.
 */
let online = false;
vi.mock("../services/posService", () => ({
  posService: {
    sellers: async () => {
      if (!online) throw new Error("ERR_INTERNET_DISCONNECTED");
      return { data: [{ id: "u1", name: "Rukhsana" }] };
    },
  },
}));
let kept: Array<{ id: string; name: string }> = [];
vi.mock("../../offline/tillSettings", () => ({ sellersOnDevice: async () => kept }));

import { ServedByRow } from "./ServedByRow";

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServedByRow enabled me="u1" anyone value={null} onChange={() => {}} />
    </QueryClientProvider>,
  );

describe("the Served by box with the line down", () => {
  it("keeps the stylists the till last received", async () => {
    online = false;
    kept = [{ id: "u1", name: "Rukhsana" }, { id: "u2", name: "Shazia" }];
    show();

    expect(await screen.findByRole("option", { name: "Shazia" })).toBeInTheDocument();
    expect(screen.getByLabelText("Served by")).toBeInTheDocument();
  });

  it("asks the server while there is a line", async () => {
    online = true;
    kept = [];
    show();

    expect(await screen.findByRole("option", { name: "Rukhsana" })).toBeInTheDocument();
  });
});
