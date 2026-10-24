import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The user, 2026-10-24: "Save everything on this device — this button coloured,
 * or this section highlighted, if offline is assigned." A shop whose plan lets
 * it sell with no line, on a device that cannot yet, is told so in colour.
 */
let ready = false;
let offlineDays: number | null = 3;
vi.mock("./readiness", () => ({
  readOfflineReadiness: async () => ({ products: ready ? 200 : 0, customers: 0, codes: 0, lastPullAt: null, ready }),
  readinessLabel: () => "label",
}));
vi.mock("./device/deviceService", () => ({ deviceService: { list: async () => ({ data: { devices: [], offline_days: offlineDays } }) } }));
vi.mock("./outbox/outbox", () => ({ adoptStranded: vi.fn(), strandedReason: vi.fn(), strandedRows: async () => [] }));
vi.mock("./shift/shiftQueue", () => ({ adoptStrandedShiftOps: vi.fn(), strandedShiftOps: async () => [] }));
vi.mock("../../components/ui/confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("../../components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

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
});
