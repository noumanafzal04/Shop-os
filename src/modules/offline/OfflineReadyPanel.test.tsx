import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The user, 2026-10-24: "Save everything on this device — this button coloured,
 * or this section highlighted, if offline is assigned." A shop whose plan lets
 * it sell with no line, on a device that cannot yet, is told so in colour.
 */
let ready = false;
let offlineDays: number | null = 3;
let onServer: { products: number; customers: number } | null = null;
let held = 200;
vi.mock("./readiness", async (actual) => ({
  notSavedYet: (await actual<typeof import("./readiness")>()).notSavedYet,
  readOfflineReadiness: async () => ({ products: ready ? held : 0, customers: 0, codes: 0, lastPullAt: null, onServer, ready }),
  readinessLabel: () => "label",
}));
vi.mock("./device/deviceService", () => ({ deviceService: { list: async () => ({ data: { devices: [], offline_days: offlineDays } }) } }));
vi.mock("./outbox/outbox", () => ({ adoptStranded: vi.fn(), strandedReason: vi.fn(), strandedRows: async () => [] }));
vi.mock("./shift/shiftQueue", () => ({ adoptStrandedShiftOps: vi.fn(), strandedShiftOps: async () => [] }));
vi.mock("../../components/ui/confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("../../components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
let finishSaving: () => void = () => {};
vi.mock("./sync/pullNow", () => ({ pullNow: () => new Promise<void>((done) => { finishSaving = done; }) }));
vi.mock("./device/tillHere", () => ({ markTillHere: vi.fn() }));

import OfflineReadyPanel from "./OfflineReadyPanel";

const show = () => render(<QueryClientProvider client={new QueryClient()}><OfflineReadyPanel /></QueryClientProvider>);

describe("saving this device for selling offline", () => {
  it("is highlighted, with a coloured button, when the plan allows offline and this device is not ready", async () => {
    ready = false; offlineDays = 3;
    const { container } = show();
    expect(await screen.findByText(/sell without internet for up to 3 days/)).toBeInTheDocument();
    expect(container.querySelector("[data-offline-ready]")?.getAttribute("data-offline-ready")).toBe("needed");
    expect(screen.getByRole("button", { name: "Save everything on this device" }).className).toContain("bg-brand-500");
  });

  it("is calm once the device is ready, and plain where the plan has no offline", async () => {
    ready = true; offlineDays = 3;
    const first = show();
    expect(await screen.findByText("This device can sell offline")).toBeInTheDocument();
    expect(first.container.querySelector("[data-offline-ready]")?.getAttribute("data-offline-ready")).toBe("ready");
    first.unmount();

    ready = false; offlineDays = null;
    const second = show();
    expect(await screen.findByText("This device is not ready to sell offline")).toBeInTheDocument();
    expect(screen.queryByText(/sell without internet/)).toBeNull();
    expect(second.container.querySelector("[data-offline-ready]")?.getAttribute("data-offline-ready")).toBe("not-ready");
  });

  it("says when only part of the shop is on this device, with how far it has got", async () => {
    ready = true; offlineDays = 3; held = 12000; onServer = { products: 50000, customers: 0 };
    show();

    expect(await screen.findByText("This device is only partly saved")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Products saved on this device" })).toHaveAttribute("aria-valuenow", "12000");
    onServer = null; held = 200;
  });

  it("counts up on the button while it saves, as the pages land", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ready = true; offlineDays = 3; held = 1000; onServer = { products: 50000, customers: 0 };
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Save everything on this device" }));

    held = 12000;
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(await screen.findByRole("button", { name: "Saving… 12,000 of 50,000" })).toBeDisabled();

    held = 50000;
    await act(async () => { finishSaving(); });
    expect(await screen.findByText("This device can sell offline")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    vi.useRealTimers();
    onServer = null; held = 200;
  });
});
