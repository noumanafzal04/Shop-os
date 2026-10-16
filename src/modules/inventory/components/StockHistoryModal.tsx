import { useState } from "react";

import { Modal } from "../../../components/ui/modal";
import Button from "../../../components/ui/button/Button";
import Pager from "../../../components/ui/pager";
import TableEmpty from "../../../components/ui/table/TableEmpty";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { useNarrow } from "../../../common/hooks/useNarrow";
import { formatQuantity, formatQuantityWithUnit } from "../../../common/format/quantity";
import { shopShortDateTime } from "../../../common/format/date";
import { catalogSizeStock, catalogStock } from "../../pos/availability";
import { useBranchColumn } from "../../branches/hooks/useBranchColumn";
import type { Product } from "../../catalog/types";
import { useMovements } from "../hooks/useInventory";
import { movementChange, movementWhat } from "../movementWords";

const PER_PAGE = 15;

const changeTone = (change: number | string) =>
  Number(change) > 0 ? "text-success-600 dark:text-success-400" : Number(change) < 0 ? "text-error-600 dark:text-error-400" : "text-gray-500";

/**
 * EVERY CHANGE TO ONE ITEM'S STOCK, NEWEST FIRST.
 *
 * It used to be eight lines at the foot of the Adjust dialog: reachable only by
 * starting an adjustment, with no date, nobody's name and "+24.000 → 24.000"
 * straight off the wire. A shopkeeper asking "where did my 30 go?" needs the
 * whole trail — when, what, where, who, how much, and what was left after.
 *
 * "Left after" is the balance OF THAT PLACE: with a place chosen in the header
 * the server sends only its lines; in the whole-shop view each line names its
 * place so the balances can be read.
 */
export function StockHistoryModal({
  product,
  onClose,
  onAdjust,
}: {
  product: Product | null;
  onClose: () => void;
  /** Offered when the item is adjusted as a whole (no sizes). */
  onAdjust?: (product: Product) => void;
}) {
  const [page, setPage] = useState(1);
  const [shownFor, setShownFor] = useState<string | null>(null);
  // A different item starts on its own first page.
  if ((product?.id ?? null) !== shownFor) {
    setShownFor(product?.id ?? null);
    setPage(1);
  }

  const history = useMovements({ product_id: product?.id, page, per_page: PER_PAGE }, product !== null);
  const narrow = useNarrow();
  const branchCol = useBranchColumn();
  const sized = (product?.variants ?? []).length > 0;

  // The query keeps the last answer on screen while the next one loads, which
  // across two items would print one item's trail under another's name.
  const sent = history.data?.data ?? [];
  const lines = sent.filter((m) => m.product_id === product?.id);
  const loading = history.isLoading || (history.isFetching && lines.length < sent.length);

  return (
    <Modal isOpen={product !== null} onClose={onClose} className="max-w-3xl p-5 sm:p-6">
      {product && (
        <>
          <div className="mb-4 pr-10">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Stock history — {product.name}</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              In stock now:{" "}
              <span className="font-semibold text-gray-800 tabular-nums dark:text-white/90">
                {formatQuantityWithUnit(catalogStock(product), product.sold_by, product.unit)}
              </span>
              {sized && (
                <span className="ml-1">
                  ({(product.variants ?? []).map((v) => `${v.name} ${formatQuantity(catalogSizeStock(v))}`).join(" · ")})
                </span>
              )}
            </p>
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
              ))}
            </div>
          ) : narrow ? (
            lines.length === 0 ? (
              <ListEmpty from={history} what="the stock history">
                <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">No stock changes yet.</p>
              </ListEmpty>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="stock-history">
                {lines.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 py-2.5" data-testid="stock-history-line">
                    <div className="min-w-0">
                      <p className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">{movementWhat(m)}</p>
                      <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                        {shopShortDateTime(m.created_at)}
                        {m.variant ? ` · ${m.variant.name}` : ""}
                        {branchCol.show ? ` · ${branchCol.label(m.branch_id)}` : ""}
                        {m.creator ? ` · ${m.creator.name}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <p className={`text-theme-sm font-semibold ${changeTone(m.quantity_change)}`}>{movementChange(m.quantity_change)}</p>
                      <p className="text-theme-xs text-gray-500 dark:text-gray-400">left {formatQuantity(m.quantity_after)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="w-full text-left" data-testid="stock-history">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-theme-xs text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
                    <th className="px-4 py-2.5 font-medium">When</th>
                    <th className="px-4 py-2.5 font-medium">What</th>
                    {sized && <th className="px-4 py-2.5 font-medium">Size</th>}
                    {branchCol.show && <th className="px-4 py-2.5 font-medium">Place</th>}
                    <th className="px-4 py-2.5 font-medium">By</th>
                    <th className="px-4 py-2.5 text-right font-medium">Change</th>
                    <th className="px-4 py-2.5 text-right font-medium">Left after</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-theme-sm text-gray-700 dark:divide-gray-800 dark:text-gray-300">
                  {lines.length === 0 ? (
                    <tr>
                      <TableEmpty from={history} what="the stock history" colSpan={5 + (sized ? 1 : 0) + (branchCol.show ? 1 : 0)} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                        No stock changes yet.
                      </TableEmpty>
                    </tr>
                  ) : (
                    lines.map((m) => (
                      <tr key={m.id} data-testid="stock-history-line">
                        <td className="whitespace-nowrap px-4 py-2.5 text-gray-500 dark:text-gray-400">{shopShortDateTime(m.created_at)}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-white/90">{movementWhat(m)}</td>
                        {sized && <td className="px-4 py-2.5">{m.variant?.name ?? "—"}</td>}
                        {branchCol.show && <td className="px-4 py-2.5">{branchCol.label(m.branch_id)}</td>}
                        <td className="px-4 py-2.5">{m.creator?.name ?? "—"}</td>
                        <td className={`whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums ${changeTone(m.quantity_change)}`}>
                          {m.type === "set" ? `= ${formatQuantity(m.quantity_after)}` : movementChange(m.quantity_change)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatQuantity(m.quantity_after)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3">
            <Pager pagination={history.data?.meta.pagination} onPage={setPage} noun="changes" />
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
            {onAdjust && !sized && (
              <Button size="sm" onClick={() => onAdjust(product)}>Adjust stock</Button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
