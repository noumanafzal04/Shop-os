import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { TenantThemed } from "./guards";
import { deviceService } from "../../modules/offline/device/deviceService";
import { useOfflineStore } from "../../modules/offline/offlineStore";
import { resetDbCache } from "../../modules/offline/db/open";

/**
 * The offline boot is actually WIRED UP.
 *
 * This repository's most persistent defect is not a broken capability — it is a
 * working one with nothing reaching it. A reorder list nobody could open, a
 * kitchen station with no writer, a permission label the server sent that the
 * panel never asked for. Every one of them passed its own unit tests.
 *
 * So this test does not check the boot works; useOfflineBoot.test.tsx does
 * that. It checks the single link that makes it run at all: TenantThemed is the
 * one component every shop screen sits under, POS included, and if the call
 * were dropped from it the whole module would sit there being correct and never
 * once execute.
 */

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

// Theming pulls the shop's settings over the network; irrelevant here.
vi.mock("../../modules/shop/hooks/useShop", () => ({ useTenantTheme: () => {} }));
vi.mock("../../components/theme/ThemeCustomizer", () => ({ default: () => null }));

const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
  localStorage.clear();
  useOfflineStore.setState({ deviceId: null, registered: false, offlineDays: null });

  vi.spyOn(deviceService, "register").mockResolvedValue(
    envelope({
      id: "d1",
      name: null,
      platform: "web" as const,
      branch: null,
      register: null,
      last_seen_at: null,
      days_offline: 0,
      revoked: false,
      revoked_at: null,
    }),
  );
  vi.spyOn(deviceService, "list").mockResolvedValue(envelope({ devices: [], offline_days: 3 }));
});

describe("every shop screen boots the till", () => {
  it("announces the device when a tenant screen mounts", async () => {
    render(
      <MemoryRouter initialEntries={["/tenant/pos"]}>
        <Routes>
          <Route element={<TenantThemed />}>
            <Route path="/tenant/pos" element={<div>till</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(deviceService.register).toHaveBeenCalledTimes(1));
    expect(useOfflineStore.getState().deviceId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("learns the shop's offline window", async () => {
    render(
      <MemoryRouter initialEntries={["/tenant"]}>
        <Routes>
          <Route element={<TenantThemed />}>
            <Route path="/tenant" element={<div>dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(useOfflineStore.getState().offlineDays).toBe(3));
  });

  it("still renders the screen underneath it", async () => {
    // The boot is a side effect, never a gate. A till that will not paint
    // because a device call failed is the worst possible trade.
    vi.spyOn(deviceService, "register").mockRejectedValue(new Error("Network Error"));

    const { getByText } = render(
      <MemoryRouter initialEntries={["/tenant/pos"]}>
        <Routes>
          <Route element={<TenantThemed />}>
            <Route path="/tenant/pos" element={<div>till</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(getByText("till")).toBeInTheDocument();
  });
});
