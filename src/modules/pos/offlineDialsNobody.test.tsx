import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dialled = vi.hoisted(() => ({ held: 0 }));
vi.mock("./services/posService", async (real) => {
  const actual = await real<typeof import("./services/posService")>();

  return {
    ...actual,
    posService: {
      ...actual.posService,
      heldList: vi.fn(async () => {
        dialled.held++;
        throw new Error("net::ERR_INTERNET_DISCONNECTED");
      }),
    },
  };
});

import { useHeldSales } from "./hooks/usePos";
import { useConnectionStore } from "../../stores/connectionStore";

/**
 * #AZ20 — with the line cut, three till calls still dialled out, failed and
 * wrote a console error each before falling back to what the device holds:
 * `GET /pos/held`, `GET /pos/sellers`, `GET /products/{id}/serials`.
 */
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { networkMode: "always", retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe("an offline till asks nobody for what it already holds", () => {
  beforeEach(() => { dialled.held = 0; });
  afterEach(() => useConnectionStore.getState().setOnline(true));

  it("the held tickets are the ones parked here, and the server is not dialled", async () => {
    useConnectionStore.getState().setOnline(false);
    const { result } = renderHook(() => useHeldSales(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(dialled.held).toBe(0);
  });

  it("online, it still asks", async () => {
    renderHook(() => useHeldSales(), { wrapper });

    await waitFor(() => expect(dialled.held).toBe(1));
  });

  it("the sellers and the in-stock serials do the same", () => {
    const servedBy = readFileSync(resolve(__dirname, "components/ServedByRow.tsx"), "utf8");
    const till = readFileSync(resolve(__dirname, "pages/PosPage.tsx"), "utf8");

    expect(servedBy).toMatch(/if \(lineIsDown\(\)\) return sellersOnDevice\(\);\s*try \{\s*return \(await posService\.sellers\(\)\)\.data;/);
    expect(till).toMatch(/queryFn: async \(\) => \(lineIsDown\(\) \? \[\] : \(await catalogService\.serials\(/);
  });
});
