import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useApplyFigures } from "./hooks/useStocktake";

/**
 * Next rounds #21: the sheet a counter signs before stock moves said "Lines
 * counted 0 · Net Rs 0" over four counted lines — it showed the totals as the
 * page first loaded them. It is now read from the server once every typed
 * figure has landed.
 */
const sheet = vi.fn(async () => ({ data: { summary: { counted: 4, short_value: 110, over_value: 1100, net_value: 990 } } }));
vi.mock("./services/stocktakeService", () => ({ stocktakeService: { sheet: () => sheet() } }));

const wrap = (qc: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

describe("the figures the Apply sheet asks a person to sign", () => {
  it("are asked of the server only when the sheet opens", async () => {
    sheet.mockClear();
    const qc = new QueryClient();
    const { result, rerender } = renderHook(({ open }) => useApplyFigures("sc1", open), { wrapper: wrap(qc), initialProps: { open: false } });
    expect(sheet).not.toHaveBeenCalled();

    rerender({ open: true });
    await waitFor(() => expect(result.current.data?.counted).toBe(4));
    expect(result.current.data?.net_value).toBe(990);
  });

  it("wait for a figure still on its way", async () => {
    sheet.mockClear();
    const qc = new QueryClient();
    let land!: () => void;
    const { result, rerender } = renderHook(
      ({ open }) => ({
        save: useMutation({ mutationKey: ["stock-counts", "record", "sc1"], mutationFn: () => new Promise<void>((r) => (land = r)) }),
        figures: useApplyFigures("sc1", open),
      }),
      { wrapper: wrap(qc), initialProps: { open: false } },
    );
    // Apply pressed: the last shelf's save goes out and the sheet opens, together.
    act(() => result.current.save.mutate());
    rerender({ open: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(sheet).not.toHaveBeenCalled();

    act(() => land());
    await waitFor(() => expect(result.current.figures.data?.counted).toBe(4));
  });
});
