import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

/**
 * #P1 — FUEL SOLD WHILE NO SHIFT WAS OPEN.
 *
 * Three paid sales rung before a shift opened were shown to the owner as
 * "MISSING FROM THE GROUND — a leak", and "rung at the till" was short by
 * them. The server now counts them at the next close and works out the part
 * of a tank variance the till sold and no meter counted; these screens add
 * the first in and take the second out. And the till says when no shift is
 * open — a prompt, never a gate.
 */
let report: unknown;
let openNow = { forecourt: true, open: false, number: null as string | null };
vi.mock("../services/fuelService", () => ({
  fuelService: {
    report: async () => ({ data: report }),
    openNow: async () => ({ data: openNow }),
  },
}));
vi.mock("../../shop/hooks/useShop", () => ({ useMoney: () => (n: number | string) => `M${Number(n).toFixed(2)}` }));
let canOpen = true;
vi.mock("../../../stores/authStore", () => ({
  useAuthStore: (pick: (s: { hasPermission: (p: string) => boolean }) => unknown) => pick({ hasPermission: () => canOpen }),
}));

import { FuelReportTab } from "./FuelReportTab";
import { ForecourtClosedStrip } from "./ForecourtClosedStrip";

const wrap = (ui: React.ReactNode) =>
  render(<MemoryRouter><QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider></MemoryRouter>);

const totals = (over: Record<string, number>) => ({
  shifts: 2, shifts_open: 0, shifts_repriced: 0,
  litres_sold: 59.546, test_litres: 0, fuel_value: 16536.44,
  pos_fuel_litres: 59.546, pos_fuel_value: 16536.44,
  between_litres: 0, between_value: 0, waiting_litres: 0, waiting_value: 0,
  sold_unmetered_litres: 0, sold_unmetered_value: 0,
  unbilled_litres: 0, unbilled_value: 0, tank_variance_litres: 0, tank_variance_value: 0,
  ...over,
});
const asReport = (t: ReturnType<typeof totals>) => ({ totals: t, by_product: [], by_attendant: [], shifts: [], range: { from: "", to: "" } });

describe("the fuel report, with fuel sold while no shift was open", () => {
  it("counts it in what the till rang, and says so", async () => {
    report = asReport(totals({ between_litres: 391.071, between_value: 109499.88 }));
    wrap(<FuelReportTab range={{ from: "2026-10-24", to: "2026-10-24" }} />);

    // 59.546 + 391.071
    expect(await screen.findByText("450.617 L")).toBeInTheDocument();
    expect(screen.getByText(/Sold with no shift open: 391.071 L/)).toBeInTheDocument();
  });

  it("does not call fuel the till sold a leak", async () => {
    report = asReport(totals({
      unbilled_litres: -391.071, unbilled_value: -109499.88,
      tank_variance_litres: 416.525, tank_variance_value: 116627,
      sold_unmetered_litres: 391.071, sold_unmetered_value: 109499.88,
    }));
    wrap(<FuelReportTab range={{ from: "2026-10-24", to: "2026-10-24" }} />);

    // Only the 25.454 L that really is missing.
    expect(await screen.findByText("25.454 L")).toBeInTheDocument();
    expect(screen.getByText(/Not counted as missing: 391.071 L/)).toBeInTheDocument();
    expect(screen.queryByText("416.525 L")).toBeNull();
  });

  it("says what is waiting to be counted rather than leaving it out", async () => {
    report = asReport(totals({ waiting_litres: 20, waiting_value: 5600 }));
    wrap(<FuelReportTab range={{ from: "2026-10-24", to: "2026-10-24" }} />);

    expect(await screen.findByText(/Waiting to be counted: 20 L/)).toBeInTheDocument();
  });
});

describe("the till, at a pump with no shift open", () => {
  it("says so, and offers the forecourt to someone who can open one", async () => {
    openNow = { forecourt: true, open: false, number: null }; canOpen = true;
    wrap(<ForecourtClosedStrip />);

    expect(await screen.findByText(/No forecourt shift is open/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open a shift" })).toHaveAttribute("href", "/tenant/fuel");
  });

  it("tells a cashier who to ask", async () => {
    openNow = { forecourt: true, open: false, number: null }; canOpen = false;
    wrap(<ForecourtClosedStrip />);

    expect(await screen.findByText(/Ask the manager to open one/)).toBeInTheDocument();
  });

  it("says nothing once a shift is open, or where there is no forecourt", async () => {
    openNow = { forecourt: true, open: true, number: "FC-000004" };
    const open = wrap(<ForecourtClosedStrip />);
    await new Promise((r) => setTimeout(r, 20));
    expect(open.container.querySelector("[data-forecourt-closed]")).toBeNull();
    open.unmount();

    openNow = { forecourt: false, open: false, number: null };
    const none = wrap(<ForecourtClosedStrip />);
    await new Promise((r) => setTimeout(r, 20));
    expect(none.container.querySelector("[data-forecourt-closed]")).toBeNull();
  });
});
