import { useEffect, useMemo, useState } from "react";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Alert from "../../../components/ui/alert/Alert";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { ApiError } from "../../../common/types/api";
import { useProducts, useProduct } from "../../catalog/hooks/useCatalog";
import { useSuppliers } from "../../purchases/hooks/usePurchases";
import { useWriteOffStock } from "../hooks/useInventory";
import type { Product } from "../../catalog/types";

/**
 * TAKING SOMETHING OFF THE SHELF AND SAYING WHAT IT COST.
 *
 * Until this existed, the Disposals register could only be filled by deleting
 * a BATCH — so a mart, a clothing shop or a hardware store, none of which
 * batch their stock, were handed a screen about their losses that could never
 * hold one. What they used instead was Inventory → Adjust → out, "Damaged",
 * which moves the stock correctly and records no money at all:
 * `stock_movements` has no cost column.
 *
 * ── Why the item is TYPED, not picked from a list ───────────────────
 *
 * The obvious control is the shared product dropdown. It drains ten pages and
 * stops: a thousand items. The shops this screen is for carry six to ten
 * thousand, so the dropdown would quietly not contain most of the shelf — the
 * defect class this codebase has now hit ten times. A search box asks the
 * server, and the server knows the whole catalogue.
 */
export function WriteOffModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState<Product | null>(null);
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [disposition, setDisposition] = useState<"written_off" | "returned_to_supplier">("written_off");
  const [reason, setReason] = useState("damaged");
  const [notes, setNotes] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [creditExpected, setCreditExpected] = useState("");
  const [error, setError] = useState<string | null>(null);

  const writeOff = useWriteOffStock();

  // Typing hits the server on every keystroke otherwise, and this screen's
  // reader is a shopkeeper with a damaged carton in one hand.
  useEffect(() => {
    const t = setTimeout(() => setSearch(typed.trim()), 250);

    return () => clearTimeout(t);
  }, [typed]);

  const results = useProducts({ search: search || undefined, page: 1, per_page: 10 });
  // The list row does not carry sizes; the detail does. Only asked once
  // something is picked.
  const detail = useProduct(picked?.id);
  const sizes = detail.data?.variants ?? [];
  const needsASize = sizes.length > 0;

  const suppliers = useSuppliers({ is_active: true }, { enabled: disposition === "returned_to_supplier" });

  const reset = () => {
    setTyped(""); setSearch(""); setPicked(null); setVariantId("");
    setQuantity(""); setNotes(""); setSupplierId(""); setCreditExpected("");
    setDisposition("written_off"); setReason("damaged"); setError(null);
  };

  const close = () => { reset(); onClose(); };

  const onShelf = useMemo(() => {
    if (picked === null) return null;
    if (needsASize) {
      const v = sizes.find((s) => s.id === variantId);

      return v === undefined ? null : Number(v.stock_quantity ?? 0);
    }

    return Number(picked.stock_quantity ?? 0);
  }, [picked, needsASize, sizes, variantId]);

  const submit = () => {
    if (picked === null || !quantity) return;
    setError(null);
    writeOff.mutate(
      {
        product_id: picked.id,
        variant_id: needsASize ? variantId : undefined,
        quantity: Number(quantity),
        disposition,
        reason,
        notes: notes.trim() || undefined,
        supplier_id: disposition === "returned_to_supplier" && supplierId ? supplierId : undefined,
        credit_expected:
          disposition === "returned_to_supplier" && creditExpected ? Number(creditExpected) : undefined,
      },
      {
        onSuccess: close,
        // The server refuses a lot-tracked item here and names the lot path.
        // Swallowing that would leave a pharmacist pressing a dead button.
        onError: (e) => setError(e instanceof ApiError ? e.message : "That was not recorded."),
      },
    );
  };

  return (
    <Modal isOpen={open} onClose={close} className="max-w-lg">
      <ModalForm
        title="Write off stock"
        description="Something binned, broken, expired or going back to the supplier — and what it cost you."
        footer={
          <>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button
              onClick={submit}
              disabled={
                writeOff.isPending || picked === null || !quantity ||
                Number(quantity) <= 0 || (needsASize && !variantId)
              }
            >
              {writeOff.isPending ? "Recording…" : "Record"}
            </Button>
          </>
        }
      >
        {error !== null && <Alert variant="error" title="Not recorded" message={error} />}

        {picked === null ? (
          <div>
            <Label htmlFor="write-off-search">Which item</Label>
            <Input
              id="write-off-search"
              value={typed}
              placeholder="Type a name or a barcode"
              onChange={(e) => setTyped(e.target.value)}
            />
            <div className="mt-2 max-h-60 space-y-1 overflow-y-auto">
              {search.length === 0 ? (
                <p className="py-3 text-center text-theme-xs text-gray-400">
                  Start typing — your whole catalogue is searched, not the first page of it.
                </p>
              ) : results.isLoading ? (
                <p className="py-3 text-center text-theme-xs text-gray-400">Looking…</p>
              ) : (results.data?.data ?? []).length === 0 ? (
                <p className="py-3 text-center text-theme-xs text-gray-400">Nothing matches “{search}”.</p>
              ) : (
                (results.data?.data ?? []).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setPicked(p); setVariantId(""); }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 text-left text-theme-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/[0.04]"
                  >
                    <span className="truncate text-gray-700 dark:text-gray-300">{p.name}</span>
                    <span className="shrink-0 tabular-nums text-theme-xs text-gray-400">
                      {Number(p.stock_quantity ?? 0)} in stock
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800">
            <span className="truncate text-theme-sm font-medium text-gray-700 dark:text-gray-300">
              {picked.name}
            </span>
            <button
              type="button"
              className="shrink-0 text-theme-xs text-brand-500 hover:underline"
              onClick={() => { setPicked(null); setVariantId(""); }}
            >
              Change
            </button>
          </div>
        )}

        {picked !== null && needsASize && (
          <div>
            <Label htmlFor="write-off-size">Which size</Label>
            <select
              id="write-off-size"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="">Choose…</option>
              {sizes.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {Number(v.stock_quantity ?? 0)} in stock
                </option>
              ))}
            </select>
          </div>
        )}

        {picked !== null && (
          <>
            <div>
              <Label htmlFor="write-off-qty">How many</Label>
              <Input
                id="write-off-qty"
                type="number"
                min="0"
                step={0.001}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              {onShelf !== null && (
                <p className="mt-1 text-theme-xs text-gray-400">{onShelf} on the shelf right now.</p>
              )}
            </div>

            <div>
              <Label htmlFor="write-off-where">Where it went</Label>
              <select
                id="write-off-where"
                value={disposition}
                onChange={(e) => setDisposition(e.target.value as typeof disposition)}
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="written_off">Binned — the money is gone</option>
                <option value="returned_to_supplier">Back to the supplier — expecting credit</option>
              </select>
            </div>

            <div>
              <Label htmlFor="write-off-why">Why</Label>
              <select
                id="write-off-why"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="damaged">Damaged</option>
                <option value="expired">Expired</option>
                <option value="recall">Recalled</option>
                <option value="other">Other</option>
              </select>
            </div>

            {disposition === "returned_to_supplier" && (
              <>
                <div>
                  <Label htmlFor="write-off-supplier">Back to whom</Label>
                  <select
                    id="write-off-supplier"
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                  >
                    <option value="">Not saying yet</option>
                    {(suppliers.data?.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="write-off-credit">Credit you expect</Label>
                  <Input
                    id="write-off-credit"
                    type="number"
                    min="0"
                    step={0.001}
                    value={creditExpected}
                    onChange={(e) => setCreditExpected(e.target.value)}
                  />
                  <p className="mt-1 text-theme-xs text-gray-400">
                    What you are claiming, not what has arrived. Record the money when it comes.
                  </p>
                </div>
              </>
            )}

            <div>
              <Label htmlFor="write-off-notes">Note</Label>
              <Input
                id="write-off-notes"
                value={notes}
                placeholder="Optional — e.g. carton fell off the trolley"
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </>
        )}
      </ModalForm>
    </Modal>
  );
}
