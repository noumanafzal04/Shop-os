import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet } from "../../../common/api/client";
import { catalogService } from "./catalogService";

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
