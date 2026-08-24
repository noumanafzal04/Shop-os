import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import { uuid } from "../../../common/uuid";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Alert from "../../../components/ui/alert/Alert";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useProducts } from "../../catalog/hooks/useCatalog";
import type { Product, ProductVariant } from "../../catalog/types";
import { useAdjustStock, useAgeing, useBatches, useBatchMutations, useExpiring, useLowStock, useMovements, useRaiseReorderOrders } from "../hooks/useInventory";
import { useAuthStore } from "../../../stores/authStore";
import { DisposeBatchModal } from "../components/DisposeBatchModal";
import { useConfirm } from "../../../components/ui/confirm";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import { useToast } from "../../../components/ui/toast";
import Pager from "../../../components/ui/pager";
import { useBranchColumn } from "../../branches/hooks/useBranchColumn";

type AdjustType = "in" | "out" | "set";

// Decimal stock renders clean: 5.000 → 5, 2.500 → 2.5
const qty = (n: number | string) => String(parseFloat(String(Number(n).toFixed(3))));

export default function InventoryPage() {
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 350);
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  /**
   * The reorder view. Driven by the URL so the dashboard can send the
   * shopkeeper straight to it: the Attention panel says "12 items are running
   * low", and landing on an unfiltered list of 500 products with the low ones
   * merely badged is not an answer to that sentence.
   */
  const [params, setParams] = useSearchParams();
  const reorderOnly = params.get("filter") === "low";
  const setReorderOnly = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set("filter", "low");
    else next.delete("filter");
    setParams(next, { replace: true });
    setPage(1);
  };

  const products = useProducts({ search: debounced, type: "product", page });
  // Server-computed, and branch-correct: a product with no row on THIS
  // branch's shelf holds none of it, which the endpoint counts as the most
  // urgent case rather than dropping it.
  const toast = useToast();
  const lowStock = useLowStock();
  const raiseOrders = useRaiseReorderOrders();
  const adjust = useAdjustStock();
  const modal = useModal();
  const batchModal = useModal();
  const expiring = useExpiring();
  const ageing = useAgeing();
  const { add: addBatch, update: updateBatch, remove: removeBatch } = useBatchMutations();

  const [target, setTarget] = useState<Product | null>(null);
  const [variant, setVariant] = useState<ProductVariant | null>(null);
  const [adjustType, setAdjustType] = useState<AdjustType>("in");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");

  // Batch manager state
  const [batchTarget, setBatchTarget] = useState<Product | null>(null);
  const [bNo, setBNo] = useState("");
  const [bExpiry, setBExpiry] = useState("");
  const [bQty, setBQty] = useState("");
  const [bCost, setBCost] = useState("");
  // The four digits off a tyre's sidewall. Optional everywhere; the shops that
  // need it need it badly, and nobody else ever sees the consequence.
  const [bDot, setBDot] = useState("");

  /**
   * The lot being taken off the shelf, and what it belongs to.
   *
   * A lot with stock in it is an event, not a confirmation: forty strips are
   * binned or they go back to the distributor, and those are opposite facts
   * about the same money. The server refuses the removal without an answer.
   */
  const [disposing, setDisposing] = useState<{
    batch: { id: string; batch_number: string; quantity: number; expiry_date?: string | null };
    productName: string;
  } | null>(null);
  const batches = useBatches(batchTarget?.id ?? null);

  const movements = useMovements({ product_id: target?.id });
  const branchCol = useBranchColumn();

  const openBatches = (p: Product) => {
    setBatchTarget(p);
    setBNo(""); setBExpiry(""); setBQty(""); setBCost("");
    addBatch.reset();
    batchModal.openModal();
  };

  const submitBatch = () => {
    if (!batchTarget || addBatch.isPending || !bNo.trim() || !bQty) return;
    addBatch.mutate(
      {
        productId: batchTarget.id,
        batch_number: bNo.trim(),
        expiry_date: bExpiry || undefined,
        dot_code: bDot.length === 4 ? bDot : undefined,
        quantity: Number(bQty),
        cost: bCost ? Number(bCost) : undefined,
      },
      { onSuccess: () => { setBNo(""); setBExpiry(""); setBQty(""); setBCost(""); setBDot(""); } },
    );
  };

  // In the reorder view the server decides the rows, so there is no paging and
  // no client-side search — the whole point is that the list is already short.
  const lowRows = lowStock.data ?? [];
  const rows = reorderOnly ? lowRows : products.data?.data ?? [];
  const pagination = reorderOnly ? undefined : products.data?.meta.pagination;

  /**
   * Hand the whole shortfall to a purchase order.
   *
   * This is the step the flow was missing: the shop could be told what was
   * running low and then had to retype it into a PO by hand, product by
   * product, which is the moment a busy shopkeeper stops using the feature.
   */
  /**
   * Raise the orders, rather than half-writing one.
   *
   * This used to hand the whole list to Purchase Orders as ONE pre-filled form:
   * every item a line, quantity 1, priced at the shop's own blended cost, with
   * the supplier left blank. That saved the typing of names and nothing else —
   * and it could only ever make one order, while a Monday reorder list holds
   * lines from four or five different distributors.
   *
   * The server knows all three things the form could not: who each item was
   * last bought FROM, what was last PAID to them (not what the shop's stock is
   * worth), and how many it takes to get back above the reorder level. So it
   * creates one DRAFT per supplier and the buyer edits drafts — which is what
   * a draft is for.
   */
  const orderTheseItems = () => {
    raiseOrders.mutate(lowRows.map((p) => p.id), {
      onSuccess: (res) => {
        // The server's own sentence, because it is the one that names any
        // items it could not place and says why.
        toast.success(res.message);
        navigate("/tenant/purchases");
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Those orders could not be raised."),
    });
  };

  // One idempotency key per adjustment intent (a dialog open) — a resubmit
  // after a network error replays the same movement server-side.
  const idemRef = useRef<string>(uuid());

  const openAdjust = (product: Product, v: ProductVariant | null = null) => {
    setTarget(product);
    setVariant(v);
    setAdjustType("in");
    setQuantity("");
    setReason("");
    adjust.reset();
    idemRef.current = uuid();
    modal.openModal();
  };

  const currentStock = variant ? variant.stock_quantity : target?.stock_quantity ?? 0;

  const submitAdjust = () => {
    if (!target || adjust.isPending || !quantity) return;
    adjust.mutate(
      {
        product_id: target.id,
        variant_id: variant?.id ?? undefined,
        type: adjustType,
        ...(adjustType === "set"
          ? { new_quantity: Number(quantity) }
          : { quantity: Number(quantity) }),
        reason: reason.trim() || undefined,
        idempotency_key: idemRef.current,
      },
      { onSuccess: () => modal.closeModal() },
    );
  };

  const adjustError =
    adjust.error instanceof ApiError
      ? adjust.error.firstFieldError() ?? adjust.error.message
      : null;

  return (
    <>
      <PageMeta title="Inventory | CartZe" description="Stock levels and movements" />

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Inventory</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Every stock change is recorded — nothing moves without a trace.
        </p>
      </div>

      {/* Expiry alerts. The window is the SHOP's — 90 days for a pharmacy,
          30 for everyone else, or whatever it set. A distributor takes medicine
          back inside a window that closes months before the printed date, so a
          warning at thirty days arrived after the claim was already lost. */}
      {(expiring.data?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-2xl border border-warning-300 bg-warning-50 p-4 dark:border-warning-500/40 dark:bg-warning-500/10">
          <p className="mb-2 text-sm font-semibold text-warning-700 dark:text-warning-400">
            {/* NOT "within 30 days". The window is the shop's — 90 for a
                pharmacy — and a pharmacist told "within 30 days" about a
                90-day sweep reads the urgency wrong in both directions. Each
                row carries its own date, which is the honest answer. */}
            ⚠ Expiring stock — {expiring.data!.length} batch{expiring.data!.length > 1 ? "es" : ""} inside your expiry window
          </p>
          <div className="space-y-1 text-theme-sm text-gray-700 dark:text-gray-300">
            {expiring.data!.slice(0, 6).map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {b.product?.name} · batch <span className="font-mono">{b.batch_number}</span> · {qty(b.quantity)} left
                </span>
                <span className="flex items-center gap-2">
                  <Badge size="sm" color={b.expired ? "error" : "warning"}>
                    {b.expired ? "EXPIRED" : `expires ${b.expiry_date}`}
                  </Badge>
                  {/* The action belongs where the shop is TOLD about it. Writing
                      the batch off was always possible, but only by leaving this
                      banner, finding the product in the table and opening its
                      batch manager — three steps away from the alert. */}
                  {Number(b.quantity) > 0 && (
                    <button
                      className={ROW_ACTION_DANGER}
                      disabled={removeBatch.isPending}
                      // Asked properly rather than confirmed away: near-expiry
                      // stock is exactly the stock a distributor will still
                      // take back, and this banner is where a pharmacist is
                      // told about it.
                      onClick={() =>
                        setDisposing({
                          batch: {
                            id: b.id,
                            batch_number: b.batch_number,
                            quantity: Number(b.quantity),
                            expiry_date: b.expiry_date,
                          },
                          productName: b.product?.name ?? "This item",
                        })
                      }
                    >
                      Remove
                    </button>
                  )}
                </span>
              </div>
            ))}
            {expiring.data!.length > 6 && (
              <p className="text-theme-xs text-gray-500">+{expiring.data!.length - 6} more…</p>
            )}
          </div>
        </div>
      )}

      {/* The other half of the same sweep. Stock can be dated two ways and only
          one of them used to be read again: an expiry had this banner, a
          dashboard tile, a counter warning and an alert, while a manufacture
          date had a badge inside one product's batch drawer. A tyre shop
          carrying two hundred sizes was never going to open two hundred
          drawers.

          Deliberately a different colour from the expiry banner. Expired stock
          is money already lost and unsellable; an old tyre is saleable stock
          that should go before the newer pallet. Painting them the same red
          would teach a shop to ignore both. */}
      {(ageing.data?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-white/[0.03]">
          <p className="mb-1 text-sm font-semibold text-gray-800 dark:text-gray-200">
            Ageing stock — {ageing.data!.length} lot{ageing.data!.length > 1 ? "s" : ""} past your ageing threshold
          </p>
          <p className="mb-2 text-theme-xs text-gray-500 dark:text-gray-400">
            Nothing is blocked from sale. These go before the newer stock — the counter is told when one is scanned.
          </p>
          <div className="space-y-1 text-theme-sm text-gray-700 dark:text-gray-300">
            {ageing.data!.slice(0, 6).map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {b.product?.name} · lot <span className="font-mono">{b.batch_number}</span>
                  {b.dot_code && <> · DOT <span className="font-mono">{b.dot_code}</span></>} · {qty(b.quantity)} left
                </span>
                <Badge size="sm" color={b.age_status === "old" ? "warning" : "light"}>
                  {b.age}{b.age_status === "old" ? " · old" : ""}
                </Badge>
              </div>
            ))}
            {ageing.data!.length > 6 && (
              <p className="text-theme-xs text-gray-500">+{ageing.data!.length - 6} more…</p>
            )}
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {!reorderOnly && (
          <div className="max-w-sm flex-1">
            <Input placeholder="Search products…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={reorderOnly ? "primary" : "outline"}
            onClick={() => setReorderOnly(!reorderOnly)}
          >
            {reorderOnly ? "Show all stock" : "Needs reordering"}
            {!reorderOnly && lowRows.length > 0 && (
              <span className="ml-2 rounded-full bg-warning-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {lowRows.length}
              </span>
            )}
          </Button>

          {/* Only offered to whoever can actually raise the order. */}
          {reorderOnly && lowRows.length > 0 && hasPermission("purchases.manage") && (
            <Button size="sm" variant="outline" onClick={orderTheseItems}>
              Order these {lowRows.length} item{lowRows.length > 1 ? "s" : ""}
            </Button>
          )}
        </div>
      </div>

      {reorderOnly && (
        <p className="mb-3 text-theme-sm text-gray-500 dark:text-gray-400">
          {lowStock.isPending
            ? "Checking the shelf…"
            : lowRows.length === 0
              ? "Nothing is below its reorder level. This branch is fully stocked."
              : `${lowRows.length} item${lowRows.length > 1 ? "s are" : " is"} at or below the reorder level you set.`}
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium">Product</th>
                <th className="px-6 py-3 font-medium">Stock</th>
                <th className="px-6 py-3 font-medium">Alert level</th>
                {/* Reorder view only. The button below raises real orders, and
                    a buyer pressing it without knowing who each line goes to is
                    guessing — so the screen says it before they press. */}
                {reorderOnly && <th className="px-6 py-3 font-medium">Last bought from</th>}
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {products.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={reorderOnly ? 5 : 4} className="px-6 py-4">
                      <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={reorderOnly ? 5 : 4} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    No tracked products{debounced ? " match your search" : " yet"}.
                  </td>
                </tr>
              ) : (
                rows.flatMap((p) => [
                  <tr key={p.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4">
                      <span className="font-medium text-gray-800 dark:text-white/90">{p.name}</span>
                      {p.sku && <span className="ml-2 text-theme-xs text-gray-400">SKU {p.sku}</span>}
                    </td>
                    <td className="px-6 py-4">
                      {p.low_stock_threshold !== null && Number(p.stock_quantity) <= Number(p.low_stock_threshold) ? (
                        <Badge size="sm" color="warning">{qty(p.stock_quantity)} low</Badge>
                      ) : (
                        <>{qty(p.stock_quantity)}{p.sold_by === "weight" && p.unit ? ` ${p.unit}` : ""}</>
                      )}
                    </td>
                    <td className="px-6 py-4">{p.low_stock_threshold != null ? qty(p.low_stock_threshold) : "—"}</td>
                    {reorderOnly && (
                      <td className="px-6 py-4">
                        {p.last_supplier_name ? (
                          <span className="text-gray-700 dark:text-gray-300">{p.last_supplier_name}</span>
                        ) : (
                          /* Absent, never invented. A product nobody has bought
                             has no supplier to propose, and guessing one would
                             send a real order to a stranger. */
                          <span className="text-theme-xs text-warning-600 dark:text-warning-400">
                            Never bought — pick a supplier by hand
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          className={ROW_ACTION}
                          onClick={() => openBatches(p)}
                        >
                          Batches
                        </button>
                        <button
                          className={ROW_ACTION}
                          onClick={() => openAdjust(p)}
                        >
                          Adjust
                        </button>
                      </div>
                    </td>
                  </tr>,
                  ...p.variants.map((v) => (
                    <tr key={v.id} className="bg-gray-50/50 text-theme-sm text-gray-600 dark:bg-white/[0.01] dark:text-gray-400">
                      <td className="px-6 py-3 pl-10">
                        ↳ {v.name}
                        {v.sku && <span className="ml-2 text-theme-xs text-gray-400">SKU {v.sku}</span>}
                      </td>
                      <td className="px-6 py-3">
                        {v.low_stock_threshold !== null && Number(v.stock_quantity) <= Number(v.low_stock_threshold) ? (
                          <Badge size="sm" color="warning">{qty(v.stock_quantity)} low</Badge>
                        ) : (
                          qty(v.stock_quantity)
                        )}
                      </td>
                      <td className="px-6 py-3">{v.low_stock_threshold != null ? qty(v.low_stock_threshold) : "—"}</td>
                      <td className="px-6 py-3 text-right">
                        <button
                          className={ROW_ACTION}
                          onClick={() => openAdjust(p, v)}
                        >
                          Adjust
                        </button>
                      </td>
                    </tr>
                  )),
                ])
              )}
            </tbody>
          </table>
        </div>

        <Pager pagination={pagination} onPage={setPage} noun="products" />
      </div>

      {/* Adjust modal with recent movements for the product */}
      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-lg p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          Adjust stock — {target?.name}
          {variant && <span className="text-gray-500"> / {variant.name}</span>}
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Current stock: <span className="font-semibold">{qty(currentStock)}</span>
          {target?.sold_by === "weight" && target.unit ? ` ${target.unit}` : ""}
        </p>

        {adjustError && (
          <div className="mb-4">
            <Alert variant="error" title="Couldn't adjust" message={adjustError} />
          </div>
        )}

        <div className="mb-4 flex gap-2">
          {(
            [
              ["in", "Stock in"],
              ["out", "Stock out"],
              ["set", "Recount"],
            ] as Array<[AdjustType, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setAdjustType(value)}
              className={`rounded-lg border px-4 py-2 text-sm transition ${
                adjustType === value
                  ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10"
                  : "border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <Label>{adjustType === "set" ? "New counted quantity" : "Quantity"}</Label>
          <Input
            type="number"
            min="0"
            step={target?.sold_by === "weight" ? 0.001 : 1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={adjustType === "set" ? "e.g. 42" : target?.sold_by === "weight" ? "e.g. 2.5" : "e.g. 5"}
          />
        </div>

        <div className="mb-6">
          <Label>Reason (optional)</Label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              adjustType === "in" ? "e.g. Supplier delivery" : adjustType === "out" ? "e.g. Damaged" : "e.g. Physical recount"
            }
          />
        </div>

        <div className="mb-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={submitAdjust} disabled={adjust.isPending || !quantity}>
            {adjust.isPending ? "Applying…" : "Apply"}
          </Button>
        </div>

        {/* Recent movements for this product */}
        {target && (
          <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
            <h4 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Recent movements</h4>
            {movements.isLoading ? (
              <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            ) : (movements.data?.data ?? []).length === 0 ? (
              <p className="text-theme-xs text-gray-400">No movements yet.</p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto text-theme-xs text-gray-500 dark:text-gray-400">
                {(movements.data?.data ?? []).slice(0, 8).map((m) => (
                  <li key={m.id} className="flex justify-between">
                    <span>
                      {m.type === "set" ? "Recount" : m.quantity_change > 0 ? "In" : "Out"}
                      {m.variant ? ` · ${m.variant.name}` : ""}
                      {/* WHICH branch moved it. An owner looking at the
                          all-branches view sees "Out −3" twice with no way to
                          tell whether that is one shop or two — and stock is the
                          one figure where that distinction is the whole
                          question. */}
                      {branchCol.show ? ` · ${branchCol.label(m.branch_id)}` : ""}
                      {m.reason ? ` — ${m.reason}` : ""}
                    </span>
                    <span className={m.quantity_change > 0 ? "text-success-500" : "text-error-500"}>
                      {m.quantity_change > 0 ? "+" : ""}
                      {m.quantity_change} → {m.quantity_after}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>

      {/* Batch / lot manager (expiry tracking) */}
      <Modal isOpen={batchModal.isOpen} onClose={batchModal.closeModal} className="max-w-lg p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          Batches — {batchTarget?.name}
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Track lots with expiry dates. Adding a batch stocks it in; sales use the earliest expiry first.
        </p>

        {addBatch.error instanceof ApiError && (
          <div className="mb-3">
            <Alert variant="error" title="Couldn't add batch" message={addBatch.error.firstFieldError() ?? addBatch.error.message} />
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-2">
          <div>
            <Label>Batch / lot no.</Label>
            <Input value={bNo} onChange={(e) => setBNo(e.target.value)} placeholder="e.g. LOT-2401" />
          </div>
          <div>
            <Label>
              Expiry date{batchTarget?.item_type === "medicine" && <span className="text-error-500"> *</span>}
            </Label>
            <Input type="date" value={bExpiry} onChange={(e) => setBExpiry(e.target.value)} />
            {batchTarget?.item_type === "medicine" && (
              <p className="mt-1 text-theme-xs text-gray-400">Required for medicines</p>
            )}
          </div>
          <div>
            <Label>DOT code (tyres)</Label>
            <Input value={bDot} onChange={(e) => setBDot(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="e.g. 2224" />
            <p className="mt-1 text-theme-xs text-gray-400">
              Week then year off the sidewall — rubber ages on the shelf.
            </p>
          </div>
          <div>
            <Label>Quantity</Label>
            <Input type="number" min="0" step={batchTarget?.sold_by === "weight" ? 0.001 : 1} value={bQty} onChange={(e) => setBQty(e.target.value)} />
          </div>
          <div>
            <Label>Unit cost (optional)</Label>
            <Input type="number" min="0" step={0.01} value={bCost} onChange={(e) => setBCost(e.target.value)} />
          </div>
        </div>
        <Button
          size="sm"
          onClick={submitBatch}
          disabled={addBatch.isPending || !bNo.trim() || !bQty || (batchTarget?.item_type === "medicine" && !bExpiry)}
        >
          {addBatch.isPending ? "Adding…" : "Add batch (stock in)"}
        </Button>

        <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-800">
          <h4 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Current batches</h4>
          {batches.isLoading ? (
            <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          ) : (batches.data ?? []).length === 0 ? (
            <p className="text-theme-xs text-gray-400">No batches yet — stock is untracked by lot.</p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {(batches.data ?? []).map((b) => {
                const expired = b.expiry_date !== null && new Date(b.expiry_date) < new Date();
                return (
                  <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-theme-sm dark:border-gray-800">
                    <span className="text-gray-700 dark:text-gray-300">
                      <span className="font-mono">{b.batch_number}</span> · {qty(b.quantity)} left
                      {expired && <span className="ml-2 text-error-500">EXPIRED</span>}
                      {/* Age, not expiry. "old" is a nudge to price it or send
                          it back — never a block on selling it. */}
                      {b.age && (
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 text-theme-xs ${
                            b.age_status === "old"
                              ? "bg-error-50 text-error-600 dark:bg-error-500/10"
                              : b.age_status === "ageing"
                                ? "bg-warning-50 text-warning-600 dark:bg-warning-500/10"
                                : "text-gray-400"
                          }`}
                        >
                          {b.age} old{b.dot_code ? ` · DOT ${b.dot_code}` : ""}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {/* Lot metadata is editable in place (e.g. filling in the
                          expiry on a lot auto-created by a PO receipt). */}
                      <input
                        type="date"
                        className="rounded border border-gray-300 px-1.5 py-0.5 text-theme-xs dark:border-gray-700 dark:bg-gray-900"
                        value={b.expiry_date ? b.expiry_date.slice(0, 10) : ""}
                        disabled={updateBatch.isPending}
                        onChange={(e) => updateBatch.mutate({ id: b.id, expiry_date: e.target.value || null })}
                      />
                      <button
                        className={ROW_ACTION_DANGER}
                        onClick={() =>
                          Number(b.quantity) > 0
                            ? setDisposing({
                                batch: {
                                  id: b.id,
                                  batch_number: b.batch_number,
                                  quantity: Number(b.quantity),
                                  expiry_date: b.expiry_date,
                                },
                                productName: batchTarget?.name ?? "This item",
                              })
                            // An empty lot is housekeeping — a mis-keyed batch
                            // number being tidied away. Nothing to explain.
                            : void confirm({ title: "Remove this empty batch?", message: "It holds no stock, so nothing moves.", confirmLabel: "Remove", tone: "danger" }).then((ok) => ok && removeBatch.mutate({ id: b.id }))
                        }
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* A lot with stock in it is an event, not a confirmation. */}
      {disposing && (
        <DisposeBatchModal
          batch={disposing.batch}
          productName={disposing.productName}
          busy={removeBatch.isPending}
          onClose={() => setDisposing(null)}
          onConfirm={(disposal) =>
            removeBatch.mutate(
              { id: disposing.batch.id, disposal },
              { onSuccess: () => setDisposing(null) },
            )
          }
        />
      )}
    </>
  );
}
