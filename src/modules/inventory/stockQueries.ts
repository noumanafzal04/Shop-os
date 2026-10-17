import type { ProductFilters } from "../catalog/types";
import type { StockView } from "./components/StockViewTabs";

/**
 * WHAT THE STOCK SCREEN ASKS THE PRODUCT LIST — the rows, and the count on
 * each filter above them.
 *
 * In one place because the two had parted. The "Out of stock" count asked for
 * counted items with none left (1); the list under it drew every item and
 * badged each made-to-order dish's nought "Out of stock" (eleven). A list and
 * the count above it must ask the same question, and the test beside this
 * file holds them to it.
 */
const COUNTED = { type: "product", track_inventory: true } as const satisfies ProductFilters;

export const stockQueries = {
  /** The rows. "Needs reordering" has its own endpoint, so only all/out reach here. */
  list: (view: StockView, search: string, page: number): ProductFilters => ({
    ...COUNTED,
    search,
    page,
    out_of_stock: view === "out" || undefined,
  }),
  /** The counts — one row each, only the total is read. */
  all: { ...COUNTED, per_page: 1 } as ProductFilters,
  out: { ...COUNTED, out_of_stock: true, per_page: 1 } as ProductFilters,
  /** What is NOT listed, said, so a dish missing from the list is explained. */
  uncounted: { type: "product", track_inventory: false, per_page: 1 } as ProductFilters,
};
