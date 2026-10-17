import { useEffect, useState } from "react";

import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Button from "../../../components/ui/button/Button";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { ApiError } from "../../../common/types/api";
import { useOnceKey } from "../../../common/onceKey";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { shopWallToday } from "../../../common/shopDay";
import { useMoney } from "../../shop/hooks/useShop";
import { useProducts } from "../../catalog/hooks/useCatalog";
import { DeliverTo } from "../../branches/components/ReceiveInto";
import { usePurchaseOrderMutations } from "../hooks/usePurchases";
import { lineOut, orderables } from "../orderLines";
import { fromOrderable, lineIsWrong, withAdded, type DraftLine } from "../orderDraft";
import { SupplierPicker } from "./SupplierPicker";
import { SupplierItemsTable } from "./SupplierItemsTable";
import { OrderLinesTable } from "./OrderLinesTable";

/**
 * A NEW PURCHASE ORDER.
 *
 * Who it is to, then what: choosing the supplier opens everything bought from
 * them before (SupplierItemsTable), ticked into the order at last time's
 * quantity and cost; anything new to them is found by searching; the order's
 * own table (OrderLinesTable) names every box and adds it up.
 *
 * `startWith` is the reorder view's hand-off: the short items, already lines,
 * with only the supplier and the real quantities left to fill in.
 */
export function NewPurchaseOrder({
  isOpen,
  onClose,
  startWith,
}: {
  isOpen: boolean;
  onClose: () => void;
  startWith: DraftLine[];
}) {
  const money = useMoney();
  const { create } = usePurchaseOrderMutations();
  // One press, one order: a double "Place order" made two Rs 7,200 orders.
  const once = useOnceKey();

  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null);
  // Where the supplier is to bring THIS order. Empty is "the usual place".
  const [deliverTo, setDeliverTo] = useState("");
  const [orderDate, setOrderDate] = useState(shopWallToday());
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [typed, setTyped] = useState("");
  const search = useDebouncedValue(typed.trim(), 250);
  const products = useProducts({ search: search || undefined });

  // A fresh form each time it opens — with the hand-off's lines when there are some.
  useEffect(() => {
    if (!isOpen) return;
    setSupplier(null);
    setDeliverTo("");
    setOrderDate(shopWallToday());
    setLines(startWith);
    setTyped("");
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, startWith]);

  const onOrder = new Set(lines.map((l) => l.key));
  const wrong = lines.some(lineIsWrong);
  const refused = create.error instanceof ApiError ? create.error.firstFieldError() ?? create.error.message : null;
  const canSend = supplier !== null && lines.length > 0 && !wrong && !create.isPending;

  const send = (status: "draft" | "ordered") => {
    if (!canSend) return;
    create.mutate(
      {
        supplier_id: supplier.id,
        order_date: orderDate,
        status,
        // Left unchosen, the server addresses it by the same rule the form shows.
        deliver_to_branch_id: deliverTo || undefined,
        items: lines.map(lineOut),
        idempotency_key: once.key,
      },
      { onSuccess: () => { once.renew(); onClose(); } },
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-4xl p-6">
      <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">New purchase order</h3>
      {refused && <div className="mb-3"><Alert variant="error" title="Couldn't create" message={refused} /></div>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Supplier</Label>
          <SupplierPicker value={supplier} onChange={setSupplier} />
        </div>
        <div>
          <Label>Order date</Label>
          <Input aria-label="Order date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </div>
      </div>

      <div className="mt-3 empty:hidden">
        <DeliverTo value={deliverTo} onChange={setDeliverTo} />
      </div>

      <div className="mt-4 space-y-4">
        {supplier !== null && (
          <SupplierItemsTable
            key={supplier.id}
            supplier={supplier}
            onOrder={onOrder}
            onAdd={(added) => setLines((ls) => withAdded(ls, added))}
            onRemove={(key) => setLines((ls) => ls.filter((l) => l.key !== key))}
          />
        )}

        {/* Anything new to this supplier — found by name, SKU or barcode. */}
        <div>
          <Label>Add another item</Label>
          <Input placeholder="Search all products…" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Search all products" />
          {search !== "" && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
              {products.isPending ? (
                <p className="p-3 text-theme-xs text-gray-400">Looking…</p>
              ) : (products.data?.data ?? []).length === 0 ? (
                <ListEmpty from={products} what="the products">
                  <p className="p-3 text-theme-xs text-gray-400">No products match.</p>
                </ListEmpty>
              ) : (
                (products.data?.data ?? []).flatMap((p) => orderables(p)).map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    disabled={onOrder.has(o.key)}
                    onClick={() => { setLines((ls) => withAdded(ls, [fromOrderable(o)])); setTyped(""); }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-white/5"
                  >
                    {o.label} <span className="text-theme-xs text-gray-400">· cost {money(o.cost)}{onOrder.has(o.key) ? " · on this order" : ""}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <OrderLinesTable lines={lines} onChange={setLines} />
      </div>

      {wrong && (
        <p className="mt-3 text-theme-sm text-error-600 dark:text-error-400">
          A line marked in red has no quantity or a cost below nought.
        </p>
      )}
      {supplier === null && lines.length > 0 && (
        <p className="mt-3 text-theme-sm text-gray-500 dark:text-gray-400">Choose who this order is to.</p>
      )}

      <div className="mt-5 flex justify-end gap-3">
        <Button size="sm" variant="outline" onClick={() => send("draft")} disabled={!canSend}>Save draft</Button>
        <Button size="sm" onClick={() => send("ordered")} disabled={!canSend}>{create.isPending ? "Saving…" : "Place order"}</Button>
      </div>
    </Modal>
  );
}
