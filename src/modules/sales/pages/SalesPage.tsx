import { useEffect, useState } from "react";
import { useMoney, useShopSettings } from "../../shop/hooks/useShop";
import { Link, useSearchParams } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import Label from "../../../components/form/Label";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { downloadFile } from "../../../common/api/download";
import { useToast } from "../../../components/ui/toast";
import { useSale, useSaleMutations, useSales } from "../hooks/useSales";
import { salesService } from "../services/salesService";
import { useProducts } from "../../catalog/hooks/useCatalog";
import { useAuthStore } from "../../../stores/authStore";
import { ApiError } from "../../../common/types/api";
import type { SaleStatus } from "../types";

const STATUS_COLOR: Record<SaleStatus, "success" | "error" | "warning" | "info"> = {
  completed: "success",
  partially_refunded: "warning",
  refunded: "info",
  cancelled: "error",
};


export default function SalesPage() {
  const money = useMoney();
  // Seed the filter from ?q= so the ⌘K palette can deep-link into a filtered list.
  const [searchParams] = useSearchParams();
  const qParam = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(qParam);
  useEffect(() => {
    if (qParam) setSearch(qParam);
  }, [qParam]);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 350);

  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile("/sales/export", { search: debounced || undefined, status: status || undefined });
    } catch {
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const sales = useSales({ search: debounced, status, page });
  const { cancel, processReturn, exchange } = useSaleMutations();
  const accessToken = useAuthStore((s) => s.accessToken);
  // Counter sales need the POS module — an online-only shop sees only history.
  const hasPos = useAuthStore(
    (s) => (s.user?.tenant as { features?: Record<string, boolean> } | null | undefined)?.features?.pos ?? true,
  );
  // Show a Branch column only for multi-branch shops.
  const shopSettings = useShopSettings();
  const multiBranch = shopSettings.data ? shopSettings.data.max_branches !== 1 : false;
  const cols = multiBranch ? 7 : 6;

  const detailModal = useModal();
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useSale(detailId);
  const [cancelReason, setCancelReason] = useState("");
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [returning, setReturning] = useState(false);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  // Exchange mode: hand items back (returnQty above) + buy replacements, settle the difference.
  const [exchanging, setExchanging] = useState(false);
  const [exItems, setExItems] = useState<Array<{ product_id: string; name: string; price: number; quantity: number }>>([]);
  const [exSearch, setExSearch] = useState("");
  const [exMethod, setExMethod] = useState("cash");
  const [exAmount, setExAmount] = useState("");
  const exProducts = useProducts({ search: exSearch || undefined });

  const rows = sales.data?.data ?? [];
  const pagination = sales.data?.meta.pagination;

  const openDetail = (id: string) => {
    setDetailId(id);
    setConfirmingCancel(false);
    setReturning(false);
    setReturnQty({});
    setExchanging(false);
    setExItems([]);
    setExSearch("");
    setExMethod("cash");
    setExAmount("");
    setCancelReason("");
    detailModal.openModal();
  };

  // Units still returnable per sale item = sold - already returned.
  const remainingToReturn = (saleItemId: string, soldQty: number) => {
    const returned = (detail.data?.returns ?? [])
      .flatMap((r) => r.items ?? [])
      .filter((ri) => ri.sale_item_id === saleItemId)
      .reduce((s, ri) => s + ri.quantity, 0);
    return soldQty - returned;
  };

  const doReturn = () => {
    if (!detailId || processReturn.isPending) return;
    const items = Object.entries(returnQty)
      .filter(([, q]) => q > 0)
      .map(([sale_item_id, quantity]) => ({ sale_item_id, quantity }));
    if (items.length === 0) return;
    processReturn.mutate(
      // Refund the way the customer paid (server also defaults to this).
      { id: detailId, items, refund_method: detail.data?.payment_method },
      { onSuccess: () => { setReturning(false); setReturnQty({}); } },
    );
  };

  const addExItem = (p: { id: string; name: string; price: string | number; discount_price?: string | number | null }) => {
    const sale = Number(p.discount_price) > 0 && Number(p.discount_price) < Number(p.price) ? Number(p.discount_price) : Number(p.price);
    setExItems((xs) => {
      const ex = xs.find((x) => x.product_id === p.id);
      if (ex) return xs.map((x) => (x.product_id === p.id ? { ...x, quantity: x.quantity + 1 } : x));
      return [...xs, { product_id: p.id, name: p.name, price: sale, quantity: 1 }];
    });
    setExSearch("");
  };

  const doExchange = () => {
    if (!detailId || exchange.isPending) return;
    const return_items = Object.entries(returnQty).filter(([, q]) => q > 0).map(([sale_item_id, quantity]) => ({ sale_item_id, quantity }));
    const items = exItems.filter((x) => x.quantity > 0).map((x) => ({ product_id: x.product_id, quantity: x.quantity }));
    if (return_items.length === 0 || items.length === 0) return;
    const amount = exAmount !== "" ? Number(exAmount) || 0 : Math.max(0, exDiff);
    exchange.mutate(
      { id: detailId, return_items, items, payments: amount > 0 ? [{ method: exMethod, amount }] : [], channel: "walk_in" },
      { onSuccess: () => { setExchanging(false); setExItems([]); setReturnQty({}); setExAmount(""); setExSearch(""); } },
    );
  };

  const doCancel = () => {
    if (!detailId || cancel.isPending) return;
    cancel.mutate(
      { id: detailId, reason: cancelReason.trim() || undefined },
      { onSuccess: () => setConfirmingCancel(false) },
    );
  };

  const openInvoice = () => {
    if (!detailId) return;
    // Invoice is an authenticated HTML page — open with token via fetch+blob.
    fetch(salesService.invoiceUrl(detailId), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.text())
      .then((html) => {
        const win = window.open("", "_blank");
        win?.document.write(html);
        win?.document.close();
      });
  };

  const netUnitFor = (i: { quantity: string | number; line_total: string | number; unit_price: string | number }) => {
    const q = Number(i.quantity);
    return q > 0 ? Number(i.line_total) / q : Number(i.unit_price);
  };
  const exCredit = (detail.data?.items ?? []).reduce((s, i) => s + (returnQty[i.id] ?? 0) * netUnitFor(i), 0);
  const exTotal = exItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const exDiff = Math.round((exTotal - exCredit) * 100) / 100;

  return (
    <>
      <PageMeta title="Sales | ShopOS" description="Sales and invoices" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Sales</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Invoices and history</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
          {hasPos && (
            <Link to="/tenant/sales/new">
              <Button size="sm">+ New Sale</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          placeholder="Search invoice #, customer…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <Select
          options={[
            { value: "", label: "All statuses" },
            { value: "completed", label: "Completed" },
            { value: "partially_refunded", label: "Partially refunded" },
            { value: "refunded", label: "Refunded" },
            { value: "cancelled", label: "Cancelled" },
          ]}
          placeholder="All statuses"
          onChange={(v) => { setStatus(v); setPage(1); }}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium">Invoice</th>
                <th className="px-6 py-3 font-medium">Date</th>
                {multiBranch && <th className="px-6 py-3 font-medium">Branch</th>}
                <th className="px-6 py-3 font-medium">Customer</th>
                <th className="px-6 py-3 font-medium">Items</th>
                <th className="px-6 py-3 font-medium">Total</th>
                <th className="px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {sales.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={cols} className="px-6 py-4">
                      <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={cols} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    {debounced || status ? "No sales match these filters." : "No sales yet — make your first sale!"}
                  </td>
                </tr>
              ) : (
                rows.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer text-theme-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.02]"
                    onClick={() => openDetail(s.id)}
                  >
                    <td className="px-6 py-4 font-medium text-gray-800 dark:text-white/90">
                      {s.invoice_number}
                    </td>
                    <td className="px-6 py-4">{new Date(s.sold_at).toLocaleString()}</td>
                    {multiBranch && (
                      <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{s.branch?.name ?? "—"}</td>
                    )}
                    <td className="px-6 py-4">{s.customer_name ?? "Walk-in"}</td>
                    <td className="px-6 py-4">{s.items_count}</td>
                    <td className="px-6 py-4">{money(s.total)}</td>
                    <td className="px-6 py-4">
                      <Badge size="sm" color={STATUS_COLOR[s.status]}>
                        {s.status}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.last_page > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3 text-sm dark:border-gray-800">
            <span className="text-gray-500 dark:text-gray-400">
              {pagination.total} sales · page {pagination.current_page} of {pagination.last_page}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pagination.current_page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={pagination.current_page >= pagination.last_page} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      <Modal isOpen={detailModal.isOpen} onClose={detailModal.closeModal} className="max-w-xl p-6">
        {detail.isLoading || !detail.data ? (
          <div className="h-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                  {detail.data.invoice_number}
                </h3>
                <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {new Date(detail.data.sold_at).toLocaleString()} · {detail.data.channel.replace("_", "-")} ·{" "}
                  {detail.data.payment_method.replace("_", " ")}
                </p>
              </div>
              <Badge color={STATUS_COLOR[detail.data.status]}>
                {detail.data.status}
              </Badge>
            </div>

            {detail.data.cancel_reason && (
              <div className="mb-4">
                <Alert variant="warning" title="Cancelled" message={detail.data.cancel_reason} />
              </div>
            )}

            <div className="mb-4 max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="w-full text-left text-theme-sm">
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {(detail.data.items ?? []).map((item) => (
                    <tr key={item.id} className="text-gray-700 dark:text-gray-300">
                      <td className="px-4 py-2">
                        {item.product_name}
                        {item.variant_name && <span className="text-gray-400"> ({item.variant_name})</span>}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {item.quantity} × {money(item.unit_price)}
                      </td>
                      <td className="px-4 py-2 text-right font-medium">{money(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mb-6 space-y-1 text-right text-theme-sm text-gray-700 dark:text-gray-300">
              <div>Subtotal: {money(detail.data.subtotal)}</div>
              {Number(detail.data.discount) > 0 && <div>Discount: -{money(detail.data.discount)}</div>}
              <div className="text-base font-bold text-gray-800 dark:text-white/90">
                Total: {money(detail.data.total)}
              </div>
              <div className="text-theme-xs text-gray-500">
                Paid {money(detail.data.amount_paid)}
                {Number(detail.data.change_due) > 0 && ` · Change ${money(detail.data.change_due)}`}
              </div>
            </div>

            {/* Existing refunds on this sale */}
            {(detail.data.returns ?? []).length > 0 && (
              <div className="mb-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <p className="mb-2 text-theme-xs font-medium uppercase text-gray-400">Refunds</p>
                {(detail.data.returns ?? []).map((r) => (
                  <div key={r.id} className="flex justify-between text-theme-sm text-gray-600 dark:text-gray-300">
                    <span>{r.return_number} · {(r.items ?? []).reduce((s, i) => s + i.quantity, 0)} item(s){r.reason ? ` · ${r.reason}` : ""}</span>
                    <span className="font-medium text-error-500">-{money(r.refund_total)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Serialized units (IMEI/serial) captured on this sale */}
            {(detail.data.serials ?? []).length > 0 && (
              <div className="mb-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <p className="mb-2 text-theme-xs font-medium uppercase text-gray-400">Serials / IMEI</p>
                {(detail.data.serials ?? []).map((s) => (
                  <div key={s.id} className="flex justify-between text-theme-sm text-gray-600 dark:text-gray-300">
                    <span className="font-mono">{s.serial}</span>
                    <span className="text-gray-400">
                      {s.product_name}
                      {s.warranty_expires_at ? ` · warranty to ${new Date(s.warranty_expires_at).toLocaleDateString()}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {confirmingCancel ? (
              <div className="space-y-3">
                <Label>Cancellation reason (optional)</Label>
                <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Customer returned items" />
                <div className="flex justify-end gap-3">
                  <Button size="sm" variant="outline" onClick={() => setConfirmingCancel(false)}>Back</Button>
                  <Button size="sm" onClick={doCancel} disabled={cancel.isPending}>
                    {cancel.isPending ? "Cancelling…" : "Confirm cancel — restore stock"}
                  </Button>
                </div>
              </div>
            ) : returning ? (
              <div className="space-y-3">
                <Label>Select quantities to return</Label>
                <div className="space-y-2">
                  {(detail.data.items ?? []).map((item) => {
                    const max = remainingToReturn(item.id, item.quantity);
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
                          {item.product_name}{item.variant_name ? ` (${item.variant_name})` : ""}
                          <span className="text-theme-xs text-gray-400"> · {max} returnable</span>
                        </span>
                        <Input
                          type="number" min="0" max={String(max)}
                          value={String(returnQty[item.id] ?? 0)}
                          onChange={(e) => setReturnQty((m) => ({ ...m, [item.id]: Math.max(0, Math.min(max, Number(e.target.value))) }))}
                        />
                      </div>
                    );
                  })}
                </div>
                {processReturn.error instanceof ApiError && (
                  <Alert variant="error" title="Return failed" message={processReturn.error.message} />
                )}
                <div className="flex justify-end gap-3">
                  <Button size="sm" variant="outline" onClick={() => setReturning(false)}>Back</Button>
                  <Button size="sm" onClick={doReturn} disabled={processReturn.isPending || Object.values(returnQty).every((q) => !q)}>
                    {processReturn.isPending ? "Processing…" : "Refund & restock"}
                  </Button>
                </div>
              </div>
            ) : exchanging ? (
              <div className="space-y-4">
                <div>
                  <Label>1 · Items to hand back</Label>
                  <div className="mt-1 space-y-2">
                    {(detail.data.items ?? []).map((item) => {
                      const max = remainingToReturn(item.id, item.quantity);
                      return (
                        <div key={item.id} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
                            {item.product_name}{item.variant_name ? ` (${item.variant_name})` : ""}
                            <span className="text-theme-xs text-gray-400"> · {max} returnable</span>
                          </span>
                          <Input type="number" min="0" max={String(max)}
                            value={String(returnQty[item.id] ?? 0)}
                            onChange={(e) => setReturnQty((m) => ({ ...m, [item.id]: Math.max(0, Math.min(max, Number(e.target.value))) }))} />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <Label>2 · Replacement items</Label>
                  <Input placeholder="Search products…" value={exSearch} onChange={(e) => setExSearch(e.target.value)} />
                  {exSearch && (
                    <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
                      {(exProducts.data?.data ?? []).slice(0, 8).map((p) => (
                        <button key={p.id} onClick={() => addExItem(p)}
                          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5">
                          <span className="truncate text-gray-700 dark:text-gray-300">{p.name}</span>
                          <span className="text-gray-400">{money(p.price)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {exItems.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {exItems.map((x) => (
                        <div key={x.product_id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">{x.name} · {money(x.price)}</span>
                          <div className="flex items-center gap-1">
                            <button className="h-6 w-6 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" onClick={() => setExItems((xs) => xs.map((y) => (y.product_id === x.product_id ? { ...y, quantity: y.quantity - 1 } : y)).filter((y) => y.quantity > 0))}>−</button>
                            <span className="w-6 text-center tabular-nums text-gray-800 dark:text-white/90">{x.quantity}</span>
                            <button className="h-6 w-6 rounded bg-brand-500 text-white" onClick={() => setExItems((xs) => xs.map((y) => (y.product_id === x.product_id ? { ...y, quantity: y.quantity + 1 } : y)))}>+</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-gray-200 p-3 text-theme-sm dark:border-gray-800">
                  <div className="flex justify-between text-gray-500"><span>Return credit (est.)</span><span>{money(exCredit)}</span></div>
                  <div className="flex justify-between text-gray-500"><span>Replacement total (est.)</span><span>{money(exTotal)}</span></div>
                  <div className="mt-1 flex justify-between font-semibold text-gray-800 dark:text-white/90">
                    <span>{exDiff >= 0 ? "Difference to collect" : "Refund to customer"}</span>
                    <span>{money(Math.abs(exDiff))}</span>
                  </div>
                  {exDiff > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <select value={exMethod} onChange={(e) => setExMethod(e.target.value)}
                        className="h-11 rounded-lg border border-gray-200 bg-transparent px-2 text-theme-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                      </select>
                      <div className="flex-1"><Input type="number" min="0" placeholder={String(exDiff)} value={exAmount} onChange={(e) => setExAmount(e.target.value)} /></div>
                    </div>
                  )}
                </div>

                {exchange.error instanceof ApiError && (
                  <Alert variant="error" title="Exchange failed" message={exchange.error.message} />
                )}
                <div className="flex justify-end gap-3">
                  <Button size="sm" variant="outline" onClick={() => setExchanging(false)}>Back</Button>
                  <Button size="sm" onClick={doExchange} disabled={exchange.isPending || Object.values(returnQty).every((q) => !q) || exItems.length === 0}>
                    {exchange.isPending ? "Processing…" : "Complete exchange"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap justify-end gap-3">
                <Button size="sm" variant="outline" onClick={openInvoice}>
                  Print invoice
                </Button>
                {(detail.data.status === "completed" || detail.data.status === "partially_refunded") && (
                  <Button size="sm" variant="outline" onClick={() => setReturning(true)}>
                    Return / Refund
                  </Button>
                )}
                {(detail.data.status === "completed" || detail.data.status === "partially_refunded") && (
                  <Button size="sm" variant="outline" onClick={() => setExchanging(true)}>
                    Exchange
                  </Button>
                )}
                {detail.data.status === "completed" && (
                  <Button size="sm" variant="outline" onClick={() => setConfirmingCancel(true)}>
                    Cancel sale
                  </Button>
                )}
                <Button size="sm" onClick={detailModal.closeModal}>Close</Button>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
