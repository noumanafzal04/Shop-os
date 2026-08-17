import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useMoney } from "../../shop/hooks/useShop";
import { uuid } from "../../../common/uuid";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Badge from "../../../components/ui/badge/Badge";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { useAuthStore } from "../../../stores/authStore";
import { useProducts } from "../../catalog/hooks/useCatalog";
import type { ProductUnit } from "../../catalog/types";
import { useSuppliers } from "../hooks/usePurchases";
import { usePurchaseOrder, usePurchaseOrders, usePurchaseOrderMutations } from "../hooks/usePurchases";
import type { PurchaseStatus } from "../types";
import { useConfirm } from "../../../components/ui/confirm";


const STATUS_COLOR: Record<PurchaseStatus, "warning" | "info" | "success" | "error" | "light"> = {
  draft: "light", ordered: "warning", partially_received: "info", received: "success", cancelled: "error",
};

interface Line { key: string; product_id: string; product_name: string; quantity: number; unit_cost: number; product_unit_id?: string | null; units?: ProductUnit[] }
let lk = 0;

/** What the Inventory reorder view hands over when it sends the shop here. */
interface ReorderItem { id: string; name: string; cost: string | number | null; units?: ProductUnit[] }

export default function PurchaseOrdersPage() {
  const confirm = useConfirm();
  const money = useMoney();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [statusFilter, setStatusFilter] = useState("");
  const orders = usePurchaseOrders({ status: statusFilter || undefined });
  const suppliers = useSuppliers({ is_active: true });
  const { create, place, receive, cancel } = usePurchaseOrderMutations();

  const createModal = useModal();
  const detailModal = useModal();
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = usePurchaseOrder(detailId ?? undefined);

  // One idempotency key per receive intent — regenerated when a different PO
  // is opened and after each successful receipt, so a retry after a network
  // error replays instead of double-receiving.
  const receiveKeyRef = useRef<string>(uuid());
  useEffect(() => { receiveKeyRef.current = uuid(); }, [detailId]);
  const doReceive = (id: string) =>
    receive.mutate(
      { id, idempotency_key: receiveKeyRef.current },
      { onSuccess: () => { receiveKeyRef.current = uuid(); } },
    );

  // ── Detailed receive (per-line qty + serials + batch/expiry) ──────
  const receiveModal = useModal();
  type RcvRow = { quantity: string; batch_number: string; expiry_date: string; serials: string };
  const [rcv, setRcv] = useState<Record<string, RcvRow>>({});
  const setRcvField = (itemId: string, patch: Partial<RcvRow>) =>
    setRcv((r) => ({ ...r, [itemId]: { ...r[itemId], ...patch } }));

  const openReceive = () => {
    const rows: Record<string, RcvRow> = {};
    for (const it of detail.data?.items ?? []) {
      const outstanding = Number(it.quantity_ordered) - Number(it.quantity_received);
      if (outstanding > 0) rows[it.id] = { quantity: String(outstanding), batch_number: "", expiry_date: "", serials: "" };
    }
    setRcv(rows);
    receiveModal.openModal();
  };

  const parseSerials = (s: string) =>
    s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

  const submitReceive = (id: string) => {
    const items = Object.entries(rcv)
      .filter(([, r]) => Number(r.quantity) > 0)
      .map(([itemId, r]) => {
        const serials = parseSerials(r.serials);
        return {
          id: itemId,
          quantity: Number(r.quantity),
          ...(r.batch_number ? { batch_number: r.batch_number } : {}),
          ...(r.expiry_date ? { expiry_date: r.expiry_date } : {}),
          ...(serials.length ? { serials } : {}),
        };
      });
    receive.mutate(
      { id, items, idempotency_key: receiveKeyRef.current },
      { onSuccess: () => { receiveKeyRef.current = uuid(); receiveModal.closeModal(); } },
    );
  };

  // Create form
  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([]);
  const [prodSearch, setProdSearch] = useState("");
  const products = useProducts({ search: prodSearch || undefined });
  const createErr = create.error instanceof ApiError ? create.error.firstFieldError() ?? create.error.message : null;

  const total = useMemo(() => lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0), [lines]);

  const openCreate = () => {
    setSupplierId(""); setOrderDate(new Date().toISOString().slice(0, 10)); setLines([]); setProdSearch("");
    createModal.openModal();
  };

  /**
   * Arriving from the Inventory reorder view with a shortfall in hand.
   *
   * The shop is dropped into a half-written order — every low item already a
   * line, quantity 1, at its last known cost — with only the supplier and the
   * real quantities left to fill in. Retyping a dozen products was the step
   * that made the reorder list not worth opening.
   *
   * The history entry is replaced on the way in, so a back-and-forward or a
   * refresh does not reopen the same half-written order over and over.
   */
  const location = useLocation();
  const navigate = useNavigate();
  const handoff = (location.state as { reorder?: ReorderItem[] } | null)?.reorder;

  useEffect(() => {
    if (!handoff?.length) return;

    setSupplierId("");
    setOrderDate(new Date().toISOString().slice(0, 10));
    setProdSearch("");
    setLines(handoff.map((p) => ({
      key: `l${++lk}`,
      product_id: p.id,
      product_name: p.name,
      quantity: 1,
      unit_cost: Number(p.cost ?? 0),
      product_unit_id: null,
      units: p.units,
    })));
    createModal.openModal();
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);
  const addLine = (p: { id: string; name: string; cost: string | number | null; units?: ProductUnit[] }) => {
    if (lines.some((l) => l.product_id === p.id)) return;
    setLines((ls) => [...ls, { key: `l${++lk}`, product_id: p.id, product_name: p.name, quantity: 1, unit_cost: Number(p.cost ?? 0), product_unit_id: null, units: p.units }]);
    setProdSearch("");
  };
  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submitPO = (status: "draft" | "ordered") => {
    if (!supplierId || lines.length === 0 || create.isPending) return;
    create.mutate(
      {
        supplier_id: supplierId, order_date: orderDate, status,
        items: lines.map((l) => ({ product_id: l.product_id, product_unit_id: l.product_unit_id || undefined, quantity: l.quantity, unit_cost: l.unit_cost })),
      },
      { onSuccess: () => createModal.closeModal() },
    );
  };

  const openDetail = (id: string) => { setDetailId(id); detailModal.openModal(); };

  if (!hasPermission("purchases.manage")) {
    return <Alert variant="error" title="No access" message="You don't have permission to manage purchases." />;
  }

  const rows = orders.data?.data ?? [];
  const d = detail.data;
  const prodRows = products.data?.data ?? [];

  return (
    <>
      <PageMeta title="Purchases | ShopOS" description="Purchase orders & receiving" />
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Purchase Orders</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Order stock, receive into inventory, and track supplier payments.</p>
        </div>
        <Button size="sm" onClick={openCreate}>+ New purchase order</Button>
      </div>

      <div className="mb-4 flex gap-2">
        {["", "draft", "ordered", "partially_received", "received", "cancelled"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-3 py-1 text-theme-xs capitalize transition ${statusFilter === s ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10" : "border-gray-200 text-gray-500 dark:border-gray-700"}`}>
            {s === "" ? "All" : s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="border-b border-gray-100 text-theme-xs uppercase text-gray-400 dark:border-gray-800">
            <tr><th className="px-5 py-3">PO #</th><th className="px-5 py-3">Supplier</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Payment</th><th className="px-5 py-3 text-right">Total</th></tr>
          </thead>
          <tbody>
            {orders.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={6} className="px-5 py-4"><div className="h-5 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td></tr>)
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-500 dark:text-gray-400">No purchase orders yet.</td></tr>
            ) : (
              rows.map((o) => (
                <tr key={o.id} className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50 dark:border-gray-800/50 dark:hover:bg-white/5" onClick={() => openDetail(o.id)}>
                  <td className="px-5 py-3 font-medium text-gray-800 dark:text-white/90">{o.po_number}</td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{o.supplier?.name ?? "—"}</td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{o.order_date}</td>
                  <td className="px-5 py-3"><Badge size="sm" color={STATUS_COLOR[o.status]}>{o.status.replace(/_/g, " ")}</Badge></td>
                  <td className="px-5 py-3 capitalize text-gray-500 dark:text-gray-400">{o.payment_status}</td>
                  <td className="px-5 py-3 text-right font-medium text-gray-800 dark:text-white/90">{money(o.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create PO */}
      <Modal isOpen={createModal.isOpen} onClose={createModal.closeModal} className="max-w-2xl p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">New purchase order</h3>
        {createErr && <div className="mb-3"><Alert variant="error" title="Couldn't create" message={createErr} /></div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select className="h-11 rounded-lg border border-gray-200 bg-transparent px-3 text-sm dark:border-gray-700 dark:bg-gray-900" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Select supplier…</option>
            {(suppliers.data?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </div>

        {/* Product picker */}
        <div className="mt-4">
          <Input placeholder="Search products to add…" value={prodSearch} onChange={(e) => setProdSearch(e.target.value)} />
          {prodSearch && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
              {prodRows.length === 0 ? <p className="p-3 text-theme-xs text-gray-400">No products.</p> :
                prodRows.map((p) => (
                  <button key={p.id} type="button" onClick={() => addLine(p)} className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/5">
                    {p.name} <span className="text-theme-xs text-gray-400">· cost {money(p.cost ?? 0)}</span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Lines */}
        <div className="mt-4 space-y-2">
          {lines.length === 0 && <p className="text-theme-xs text-gray-400">Add at least one product.</p>}
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-12 items-center gap-2">
              <span className="col-span-4 truncate text-sm text-gray-700 dark:text-gray-300">{l.product_name}</span>
              {/* Buy in a pack (Box) or the base unit — stock lands in base units */}
              <div className="col-span-2">
                {l.units && l.units.length > 0 ? (
                  <select
                    value={l.product_unit_id ?? ""}
                    onChange={(e) => setLine(l.key, { product_unit_id: e.target.value || null })}
                    className="h-11 w-full rounded-lg border border-gray-200 bg-transparent px-2 text-theme-sm text-gray-700 focus:outline-hidden dark:border-gray-700 dark:text-gray-200"
                  >
                    <option value="">Each</option>
                    {l.units.map((u) => (
                      <option key={u.id} value={u.id}>{u.name} (×{Number(u.factor)})</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-theme-xs text-gray-400">each</span>
                )}
              </div>
              <div className="col-span-2"><Input type="number" min="1" value={String(l.quantity)} onChange={(e) => setLine(l.key, { quantity: Number(e.target.value) })} /></div>
              <div className="col-span-3"><Input type="number" min="0" value={String(l.unit_cost)} onChange={(e) => setLine(l.key, { unit_cost: Number(e.target.value) })} /></div>
              <button type="button" className="col-span-1 text-error-500" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 dark:border-gray-800">
          <span className="text-sm text-gray-500 dark:text-gray-400">Total</span>
          <span className="text-lg font-bold text-gray-800 dark:text-white/90">{money(total)}</span>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={() => submitPO("draft")} disabled={create.isPending || !supplierId || !lines.length}>Save draft</Button>
          <Button size="sm" onClick={() => submitPO("ordered")} disabled={create.isPending || !supplierId || !lines.length}>{create.isPending ? "Saving…" : "Place order"}</Button>
        </div>
      </Modal>

      {/* PO detail */}
      <Modal isOpen={detailModal.isOpen} onClose={detailModal.closeModal} className="max-w-2xl p-6">
        {!d ? <div className="h-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" /> : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">{d.po_number}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{d.supplier?.name} · {d.order_date}</p>
              </div>
              <Badge color={STATUS_COLOR[d.status]}>{d.status.replace(/_/g, " ")}</Badge>
            </div>

            <div className="mb-4 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="bg-gray-50 text-theme-xs uppercase text-gray-400 dark:bg-white/5"><tr><th className="px-4 py-2">Item</th><th className="px-4 py-2 text-center">Ordered</th><th className="px-4 py-2 text-center">Received</th><th className="px-4 py-2 text-right">Cost</th></tr></thead>
                <tbody>
                  {(d.items ?? []).map((it) => (
                    <tr key={it.id} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                        {it.product_name}{it.variant_name ? ` / ${it.variant_name}` : ""}
                        {it.unit_name ? <span className="ml-1 text-theme-xs text-gray-400">({it.unit_name} ×{Number(it.unit_factor)})</span> : null}
                      </td>
                      <td className="px-4 py-2 text-center">{it.quantity_ordered}</td>
                      <td className="px-4 py-2 text-center">{it.quantity_received}</td>
                      <td className="px-4 py-2 text-right">{money(it.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mb-4 flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Paid {money(d.amount_paid)} · {d.payment_status}</span>
              <span className="font-bold text-gray-800 dark:text-white/90">Total {money(d.total)}</span>
            </div>

            {cancel.error instanceof ApiError && <div className="mb-3"><Alert variant="error" title="Action failed" message={cancel.error.message} /></div>}
            {receive.error instanceof ApiError && <div className="mb-3"><Alert variant="error" title="Action failed" message={receive.error.message} /></div>}

            <div className="flex flex-wrap justify-end gap-3">
              {d.status === "draft" && (
                <Button size="sm" variant="outline" onClick={() => place.mutate(d.id)} disabled={place.isPending}>Place order</Button>
              )}
              {(d.status === "ordered" || d.status === "partially_received") && (
                <>
                  <Button size="sm" variant="outline" onClick={openReceive} disabled={receive.isPending}>Receive with details…</Button>
                  <Button size="sm" onClick={() => doReceive(d.id)} disabled={receive.isPending}>
                    {receive.isPending ? "Receiving…" : "Receive all → stock in"}
                  </Button>
                </>
              )}
              {(d.status === "draft" || d.status === "ordered" || d.status === "partially_received") && (
                <Button size="sm" variant="outline" onClick={async () => {
                  if (await confirm({ title: "Cancel this purchase order?", message: "Nothing is received and the order stops being expected.", confirmLabel: "Cancel PO", cancelLabel: "Keep it", tone: "danger" })) cancel.mutate({ id: d.id, reason: "Cancelled by user" });
                }} disabled={cancel.isPending}>Cancel PO</Button>
              )}
            </div>
          </>
        )}
      </Modal>

      {/* Detailed receive — per-line quantity + serials + batch/expiry */}
      <Modal isOpen={receiveModal.isOpen} onClose={receiveModal.closeModal} className="max-w-2xl p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Receive goods</h3>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">Confirm quantities. Enter serials for serialized items and a batch/expiry for medicines.</p>
        {receive.error instanceof ApiError && <div className="mb-3"><Alert variant="error" title="Couldn't receive" message={receive.error.message} /></div>}

        <div className="max-h-[60dvh] space-y-3 overflow-y-auto pr-1">
          {(detail.data?.items ?? [])
            .filter((it) => Number(it.quantity_ordered) - Number(it.quantity_received) > 0)
            .map((it) => {
              const row = rcv[it.id];
              if (!row) return null;
              const isSerial = !!it.product?.tracks_serial;
              const isMedicine = it.product?.item_type === "medicine";
              const serialCount = parseSerials(row.serials).length;
              const outstanding = Number(it.quantity_ordered) - Number(it.quantity_received);
              return (
                <div key={it.id} className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-gray-800 dark:text-white/90">{it.product_name}{it.variant_name ? ` / ${it.variant_name}` : ""}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-theme-xs text-gray-400">of {outstanding}</span>
                      <div className="w-24"><Input type="number" min="0" max={String(outstanding)} value={row.quantity} onChange={(e) => setRcvField(it.id, { quantity: e.target.value })} /></div>
                    </div>
                  </div>

                  {isMedicine && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div><label className="mb-1 block text-theme-xs text-gray-400">Batch # (optional)</label><Input value={row.batch_number} onChange={(e) => setRcvField(it.id, { batch_number: e.target.value })} placeholder="Auto = PO number" /></div>
                      <div><label className="mb-1 block text-theme-xs text-gray-400">Expiry <span className="text-error-500">*</span></label><Input type="date" value={row.expiry_date} onChange={(e) => setRcvField(it.id, { expiry_date: e.target.value })} /></div>
                    </div>
                  )}

                  {isSerial && (
                    <div className="mt-2">
                      <label className="mb-1 block text-theme-xs text-gray-400">Serials / IMEIs — one per line ({serialCount}/{row.quantity || 0})</label>
                      <textarea
                        value={row.serials}
                        onChange={(e) => setRcvField(it.id, { serials: e.target.value })}
                        rows={Math.min(6, Math.max(2, Number(row.quantity) || 2))}
                        className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-theme-sm text-gray-800 focus:border-brand-500 focus:outline-none dark:border-gray-700 dark:text-white/90"
                        placeholder={"IMEI-000001\nIMEI-000002"}
                      />
                      {serialCount > Number(row.quantity || 0) && (
                        <p className="mt-1 text-theme-xs text-error-500">More serials than units received.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
          <Button size="sm" variant="outline" onClick={receiveModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={() => detail.data && submitReceive(detail.data.id)} disabled={receive.isPending}>{receive.isPending ? "Receiving…" : "Receive → stock in"}</Button>
        </div>
      </Modal>
    </>
  );
}
