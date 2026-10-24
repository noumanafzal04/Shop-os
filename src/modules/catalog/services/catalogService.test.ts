import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet } from "../../../common/api/client";
import { catalogService } from "./catalogService";
import type { ProductFilters } from "../types";

vi.mock("../../../common/api/client", () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

/**
 * A SELLING SCREEN ASKS THE SERVER FOR WHAT IS SOLD.
 *
 * Tester pass 5 (B62): the café's flour — kept for the parathas, never sold —
 * was offered in the till's search at 0. "On sale" was asked as "switched on"
 * only; an item kept as an ingredient is switched on and still not sold.
 */
describe("asking for what is on sale", () => {
  beforeEach(() => vi.mocked(apiGet).mockResolvedValue({ data: [] } as never));

  it("asks for switched-on items that are sold", async () => {
    await catalogService.products({ search: "flour", for_sale: true });

    const params = vi.mocked(apiGet).mock.calls[0][1]?.params as Record<string, unknown>;
    expect(params.is_active).toBe(1);
    expect(params.for_sale).toBe(1);
  });

  it("the catalogue itself asks for everything, ingredients included", async () => {
    await catalogService.products({ search: "flour" });

    const calls = vi.mocked(apiGet).mock.calls;
    const params = calls[calls.length - 1][1]?.params as Record<string, unknown>;
    expect(params.for_sale).toBeUndefined();
    expect(params.is_active).toBeUndefined();
  });
});

describe("asking the stock screen's question", () => {
  beforeEach(() => vi.mocked(apiGet).mockResolvedValue({ data: [] } as never));

  const lastParams = () => {
    const calls = vi.mocked(apiGet).mock.calls;
    return calls[calls.length - 1][1]?.params as Record<string, unknown>;
  };

  it("asks for the counted, or for the not counted — and a list that does not say asks for both", async () => {
    await catalogService.products({ track_inventory: true });
    expect(lastParams().track_inventory).toBe(1);

    // false is a question too — "how many are not counted" — not an absence.
    await catalogService.products({ track_inventory: false });
    expect(lastParams().track_inventory).toBe(0);

    await catalogService.products({});
    expect(lastParams().track_inventory).toBeUndefined();
  });
});

/**
 * EVERY FILTER REACHES THE WIRE.
 *
 * The params are named one by one, and `tyre_size` was in the type and not in
 * the list: the till's "Tyres that fit" said it was filtering and sent nothing
 * (#38). `Required<ProductFilters>` makes this test fail to compile when a new
 * filter is added and not listed here — and then fail to pass until the
 * service sends it.
 */
describe("every filter the screens can set is sent", () => {
  beforeEach(() => vi.mocked(apiGet).mockResolvedValue({ data: [] } as never));

  it("drops none of them", async () => {
    const every: Required<ProductFilters> = {
      search: "dunlop",
      tyre_size: "195/65 R15",
      type: "product",
      category_id: "c-1",
      low_stock: true,
      out_of_stock: true,
      track_inventory: true,
      for_sale: true,
      page: 2,
      per_page: 50,
    };
    await catalogService.products(every);

    const calls = vi.mocked(apiGet).mock.calls;
    const params = calls[calls.length - 1][1]?.params as Record<string, unknown>;
    for (const key of Object.keys(every)) {
      expect(params[key], `the ${key} filter never left the browser`).not.toBeUndefined();
    }
    expect(params.tyre_size).toBe("195/65 R15");
  });
});
