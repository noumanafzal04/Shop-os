import { useState } from "react";

import Input from "../../../components/form/input/InputField";
import Badge from "../../../components/ui/badge/Badge";
import Pager from "../../../components/ui/pager";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { formatQuantity } from "../../../common/format/quantity";
import { shopDate } from "../../../common/format/date";
import { ApiError } from "../../../common/types/api";
import { useMoney } from "../../shop/hooks/useShop";
import { useNarrow } from "../../../common/hooks/useNarrow";
import { useSupplierItems } from "../hooks/usePurchases";
import { purchasesService } from "../services/purchasesService";
import { fromSupplierItem, type DraftLine } from "../orderDraft";
import type { SupplierItem } from "../types";

const PAGE = 10;
/** The server's own ceiling for one answer (SupplierItemsController::MOST). */
const ALL_AT_ONCE = 500;

/**
 * WHAT THIS SUPPLIER SOLD US BEFORE — ticked into the order.
 *
 * The user, 2026-10-17: the next order to the same distributor was built one
 * search at a time. Every item ever bought from them is listed here, a page at
 * a time, with last time's quantity and cost and what is on the shelf now.
 * Tick some, tick a page, or add all of them; a ticked item becomes a line
 * below at last time's quantity, which the order's own table then changes.
 */
export function SupplierItemsTable({
  supplier,
  onOrder,
  onAdd,
  onRemove,
}: {
  supplier: { id: string; name: string };
  /** Keys of the items already on the order. */
  onOrder: Set<string>;
  onAdd: (lines: DraftLine[]) => void;
  onRemove: (key: string) => void;
}) {
  const money = useMoney();
  const narrow = useNarrow(640);
  const [typed, setTyped] = useState("");
  const search = useDebouncedValue(typed.trim(), 300);
  const [page, setPage] = useState(1);
  const items = useSupplierItems(supplier.id, { search: search || undefined, page, per_page: PAGE });
  const rows = items.data?.data ?? [];
  const total = items.data?.meta.pagination?.total ?? 0;
  const [addingAll, setAddingAll] = useState(false);
  const [allFailed, setAllFailed] = useState<string | null>(null);

  const pageAllOn = rows.length > 0 && rows.every((r) => onOrder.has(r.key));
  const togglePage = () => (pageAllOn ? rows.forEach((r) => onRemove(r.key)) : onAdd(rows.map(fromSupplierItem)));
  const toggle = (r: SupplierItem) => (onOrder.has(r.key) ? onRemove(r.key) : onAdd([fromSupplierItem(r)]));

  // Every one of them, whatever page is showing — asked of the server in one go.
  const addAll = async () => {
    setAddingAll(true);
    setAllFailed(null);
    try {
      const all = await purchasesService.supplierItems(supplier.id, { search: search || undefined, page: 1, per_page: ALL_AT_ONCE });
      onAdd(all.data.map(fromSupplierItem));
    } catch (e) {
      setAllFailed(e instanceof ApiError ? e.message : "They could not be loaded — try again.");
    } finally {
      setAddingAll(false);
    }
  };

  return (
    <section aria-label={`Bought from ${supplier.name} before`} className="rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3 dark:border-gray-800">
        <h4 className="mr-auto text-sm font-semibold text-gray-800 dark:text-white/90">
          Bought from {supplier.name} before
          {total > 0 && <span className="ml-1 font-normal text-gray-400">· {total.toLocaleString()}</span>}
        </h4>
        <div className="w-full sm:w-56">
          <Input placeholder="Search these items…" value={typed} onChange={(e) => { setTyped(e.target.value); setPage(1); }} aria-label="Search this supplier's items" />
        </div>
        {total > 0 && (
          <button
            type="button"
            className="rounded-lg border border-brand-300 px-3 py-2 text-theme-sm font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:border-brand-500/40 dark:text-brand-400 dark:hover:bg-brand-500/10"
            disabled={addingAll}
            onClick={() => void addAll()}
          >
            {addingAll ? "Adding…" : `Add all ${total.toLocaleString()}`}
          </button>
        )}
      </div>
      {allFailed && <p className="px-3 pt-2 text-theme-xs text-error-600 dark:text-error-400">{allFailed}</p>}

      {items.isPending ? (
        <div className="space-y-2 p-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />)}
        </div>
      ) : rows.length === 0 ? (
        <ListEmpty from={items} what={`what ${supplier.name} sold you before`}>
          <p className="p-4 text-center text-theme-sm text-gray-500 dark:text-gray-400">
            {search ? "Nothing bought from them matches that." : `Nothing has been ordered from ${supplier.name} yet — add items with the search below.`}
          </p>
        </ListEmpty>
      ) : narrow ? (
        // A hand holds a list, not a table: the same three facts, stacked.
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          <li className="flex items-center gap-3 px-3 py-2 text-theme-xs text-gray-500 dark:text-gray-400">
            <input type="checkbox" aria-label="Tick every item on this page" checked={pageAllOn} onChange={togglePage} className="size-4 accent-brand-500" />
            Tick this page
          </li>
          {rows.map((r) => (
            <li key={r.key} data-testid="supplier-item" className={`flex items-start gap-3 px-3 py-2.5 ${onOrder.has(r.key) ? "bg-brand-50/60 dark:bg-brand-500/[0.06]" : ""}`}>
              <input type="checkbox" aria-label={`Order ${r.name}`} checked={onOrder.has(r.key)} onChange={() => toggle(r)} className="mt-1 size-4 shrink-0 accent-brand-500" />
              <div className="min-w-0 flex-1">
                <ItemName item={r} />
                <div className="mt-1 text-theme-xs text-gray-600 dark:text-gray-300"><LastTime item={r} money={money} /></div>
              </div>
              <div className="shrink-0 text-right"><InStock item={r} /></div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-theme-sm">
            <thead>
              <tr className="border-b border-gray-100 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" aria-label="Tick every item on this page" checked={pageAllOn} onChange={togglePage} className="size-4 accent-brand-500" />
                </th>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Last time</th>
                <th className="px-3 py-2 text-right font-medium">In stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((r) => (
                <tr key={r.key} data-testid="supplier-item" className={onOrder.has(r.key) ? "bg-brand-50/60 dark:bg-brand-500/[0.06]" : ""}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Order ${r.name}`} checked={onOrder.has(r.key)} onChange={() => toggle(r)} className="size-4 accent-brand-500" />
                  </td>
                  <td className="px-3 py-2"><ItemName item={r} /></td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300"><LastTime item={r} money={money} /></td>
                  <td className="px-3 py-2 text-right"><InStock item={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-3 pb-2">
        <Pager pagination={items.data?.meta.pagination} onPage={setPage} noun="items" />
      </div>
    </section>
  );
}

function ItemName({ item }: { item: SupplierItem }) {
  return (
    <>
      <span className="text-gray-800 dark:text-white/90">{item.name}</span>
      {item.sku && <span className="block text-theme-xs text-gray-400">SKU {item.sku}</span>}
    </>
  );
}

/** "10 Carton of 12 at Rs 780", and when — what the last order to them said. */
function LastTime({ item, money }: { item: SupplierItem; money: (n: number) => string }) {
  return (
    <>
      <span className="tabular-nums">
        {formatQuantity(item.last.quantity)}{item.last.unit_name ? ` ${item.last.unit_name}` : ""} at {money(item.last.unit_cost)}
      </span>
      <span className="block text-theme-xs text-gray-400">
        {item.last.ordered_on ? shopDate(item.last.ordered_on) : item.last.po_number}
        {item.times_ordered > 1 && ` · ordered ${item.times_ordered} times`}
      </span>
    </>
  );
}

/** On the shelf now — warned when at or below its alert level, "not counted" when nobody counts it. */
function InStock({ item }: { item: SupplierItem }) {
  if (!item.track_inventory) return <span className="text-theme-xs text-gray-400">not counted</span>;

  const low = item.low_stock_threshold !== null && item.in_stock <= item.low_stock_threshold;

  return low ? (
    <Badge size="sm" color={item.in_stock <= 0 ? "error" : "warning"}>{formatQuantity(item.in_stock)}</Badge>
  ) : (
    <span className="tabular-nums text-gray-700 dark:text-gray-300">{formatQuantity(item.in_stock)}</span>
  );
}
