import { Fragment, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import TableEmpty from "../../../components/ui/table/TableEmpty";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import Pager from "../../../components/ui/pager";
import { useBranchStore } from "../../../stores/branchStore";
import { useStockByPlace } from "../hooks/useTransfers";
import type { StockPlace } from "../services/stockByPlaceService";
import { fullestOther, isLowAt, refillLink } from "../stockWords";
import { qty } from "../transferWords";

/** The product column: wide enough for a name, and held at the left edge. */
const STUCK = "sticky left-0 z-[1] min-w-[13rem] max-w-[18rem] bg-white dark:bg-gray-900";
const STUCK_SOFT = "sticky left-0 z-[1] min-w-[13rem] max-w-[18rem] bg-gray-50 dark:bg-gray-900";

/**
 * Stock by place — one row per product, one column per branch and warehouse.
 *
 * Every other stock figure in the panel is ONE number: the place being looked
 * at, or the business added up. Neither answers what a shop with a godown asks
 * all day — the shelf is empty, is there more in the back? — and the one
 * screen that could, did it a product at a time at the till.
 *
 * "Running low here, held elsewhere" is the list that question makes: what
 * this place is short of that the business already owns. Each row carries a
 * link that opens the transfer to fetch it.
 */
export default function StockByPlacePage() {
  const operating = useBranchStore((s) => s.activeBranchId);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [at, setAt] = useState<string>("");
  const [refill, setRefill] = useState(false);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  const stock = useStockByPlace({ page, search: search.trim() || undefined, at: at || undefined, only: refill ? "refill" : undefined });
  const rows = stock.data?.data ?? [];
  const places = (stock.data?.meta?.places ?? []) as StockPlace[];
  // The server's answer to "which place is HERE" — the one named, else the
  // one being worked at.
  const here = (stock.data?.meta?.at as string | null | undefined) ?? (at || operating || null);
  const hereName = places.find((p) => p.id === here)?.name ?? "this place";
  const columns = places.length + 4;

  const reset = () => setPage(1);

  return (
    <>
      <PageMeta title="Stock by place" description="What every branch and warehouse holds" />

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Stock by place</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">What every branch and warehouse holds, side by side</p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <Input
            aria-label="Search stock"
            value={search}
            onChange={(e) => { setSearch(e.target.value); reset(); }}
            placeholder="Search by name, brand, SKU or barcode…"
          />
        </div>
        {places.length > 1 && (
          <div className="w-56">
            <Select
              aria-label="Looking at"
              options={places.map((p) => ({ value: p.id, label: p.kind === "warehouse" ? `${p.name} — warehouse` : p.name }))}
              value={here ?? ""}
              onChange={(v) => { setAt(v); reset(); }}
              placeholder="Looking at…"
            />
          </div>
        )}
        <button
          type="button"
          aria-pressed={refill}
          onClick={() => { setRefill((on) => !on); reset(); }}
          data-testid="stock-refill"
          className={`h-11 rounded-xl border px-4 text-theme-sm font-medium transition ${
            refill
              ? "border-brand-500 bg-brand-500 text-white"
              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-800 dark:bg-transparent dark:text-gray-300"
          }`}
        >
          Running low at {hereName}, held elsewhere
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="stock-by-place">
            <thead>
              <tr className="border-b border-gray-200 text-left text-theme-xs uppercase text-gray-400 dark:border-gray-800">
                {/* The name stays put while the places scroll under it: with
                    seven places a row is a line of numbers with nothing to
                    say whose they are. */}
                <th className={`${STUCK} px-6 py-3 font-medium`}>Product</th>
                {places.map((p) => (
                  <th key={p.id} className={`whitespace-nowrap px-4 py-3 text-right font-medium ${p.id === here ? "text-brand-600 dark:text-brand-400" : ""}`}>
                    {p.name}
                    {p.kind === "warehouse" && <span className="block text-[10px] font-normal normal-case text-gray-400">warehouse</span>}
                  </th>
                ))}
                <th className="whitespace-nowrap px-4 py-3 text-right font-medium" title="Sent and not yet counted in — on nobody's shelf">On the road</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-6 py-3 text-right font-medium">Bring it</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {stock.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={columns} className="px-6 py-4"><div className="h-5 animate-pulse rounded bg-gray-100 dark:bg-gray-800" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <TableEmpty from={stock} what="the stock" colSpan={columns} className="px-6 py-12 text-center text-gray-400">
                    {refill
                      ? `Nothing ${hereName} is short of is held anywhere else.`
                      : search.trim() !== "" ? "Nothing in stock by that name." : "No stocked products yet."}
                  </TableEmpty>
                </tr>
              ) : (
                rows.map((row) => {
                  const low = isLowAt(row, here);
                  const from = here ? fullestOther(row, places, here) : null;
                  const sized = row.sizes.length > 0;
                  const open = !!openRows[row.id];

                  return (
                    <Fragment key={row.id}>
                      <tr data-testid="stock-row">
                        <td className={`${STUCK} px-6 py-3.5`}>
                          {sized ? (
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() => setOpenRows((o) => ({ ...o, [row.id]: !open }))}
                              className="flex items-center gap-2 text-left font-medium text-gray-800 dark:text-white/90"
                            >
                              <svg className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <path d="M7.5 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              {row.name}
                              <span className="whitespace-nowrap text-theme-xs font-normal text-gray-400">{row.sizes.length} sizes</span>
                            </button>
                          ) : (
                            <span className="font-medium text-gray-800 dark:text-white/90">{row.name}</span>
                          )}
                          {row.sku && <span className="block text-theme-xs text-gray-400">{row.sku}</span>}
                        </td>
                        {places.map((p) => {
                          const held = Number(row.places[p.id] ?? 0);

                          return (
                            <td
                              key={p.id}
                              className={`px-4 py-3.5 text-right tabular-nums ${
                                p.id === here && low ? "font-semibold text-warning-600 dark:text-warning-400" : held === 0 ? "text-gray-300 dark:text-gray-600" : "text-gray-700 dark:text-gray-200"
                              }`}
                              title={p.id === here && low ? `At or below the reorder level of ${qty(row.low_stock_threshold)}` : undefined}
                            >
                              {qty(held)}
                            </td>
                          );
                        })}
                        <td className={`px-4 py-3.5 text-right tabular-nums ${row.on_the_road > 0 ? "text-blue-light-600 dark:text-blue-light-400" : "text-gray-300 dark:text-gray-600"}`}>
                          {qty(row.on_the_road)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-medium tabular-nums text-gray-800 dark:text-white/90">{qty(row.total)}</td>
                        <td className="px-6 py-3.5 text-right">
                          {here && from ? (
                            <Link
                              to={refillLink(from.id, here, row.name)}
                              className="whitespace-nowrap text-theme-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
                            >
                              From {from.name}
                            </Link>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">—</span>
                          )}
                        </td>
                      </tr>
                      {sized && open && row.sizes.map((size) => (
                        <tr key={size.id} className="bg-gray-50/60 dark:bg-white/[0.02]" data-testid="stock-size-row">
                          <td className={`${STUCK_SOFT} py-2.5 pl-12 pr-6 text-theme-sm text-gray-600 dark:text-gray-300`}>{size.name}</td>
                          {places.map((p) => (
                            <td key={p.id} className="px-4 py-2.5 text-right text-theme-sm tabular-nums text-gray-600 dark:text-gray-300">
                              {qty(size.places[p.id] ?? 0)}
                            </td>
                          ))}
                          <td className="px-4 py-2.5 text-right text-theme-sm tabular-nums text-gray-500">{qty(size.on_the_road)}</td>
                          <td className="px-4 py-2.5 text-right text-theme-sm tabular-nums text-gray-700 dark:text-gray-200">{qty(size.total)}</td>
                          <td />
                        </tr>
                      ))}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pager pagination={stock.data?.meta?.pagination} onPage={setPage} noun="products" />
      </div>
    </>
  );
}
