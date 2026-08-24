import { useState } from "react";
import { useMoney, useShopSettings } from "../../shop/hooks/useShop";
import BranchStockModal from "../../transfers/components/BranchStockModal";
import BranchPriceModal from "../../branches/components/BranchPriceModal";
import { Link, Outlet, useNavigate, useSearchParams } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import Select from "../../../components/form/Select";
import Input from "../../../components/form/input/InputField";
import { useAuthStore } from "../../../stores/authStore";
import { useCategories, useProductMutations, useProducts, useSoldOut, useVariantSoldOut } from "../hooks/useCatalog";
import type { ItemTypeCode, Product } from "../types";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { ApiError } from "../../../common/types/api";
import { api } from "../../../common/api/client";
import { downloadFile } from "../../../common/api/download";
import { useToast } from "../../../components/ui/toast";
import Pager from "../../../components/ui/pager";

/** Friendly label for each item type (drops the raw product/service split). */
const TYPE_LABEL: Record<ItemTypeCode, string> = {
  physical_product: "Product",
  food_item: "Food",
  medicine: "Medicine",
  service: "Service",
  deal: "Deal",
};
const TYPE_COLOR: Record<ItemTypeCode, "primary" | "info" | "success" | "warning" | "light"> = {
  physical_product: "primary",
  food_item: "warning",
  medicine: "info",
  service: "success",
  deal: "light",
};

/** Small square thumbnail — the item's first photo, or an initial tile. */
function Thumb({ product }: { product: Product }) {
  const url = (product.images ?? [])[0]?.url;
  if (url) {
    return <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />;
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm font-semibold text-gray-400 dark:bg-white/[0.06]">
      {product.name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function ProductsPage() {
  const money = useMoney();
  const navigate = useNavigate();
  // Plan / module awareness — same signals the product form uses, so the list
  // only shows columns that apply to this shop.
  const features = useAuthStore(
    (s) => (s.user?.tenant as unknown as { features?: Record<string, boolean> })?.features,
  );
  const inventoryEnabled = features?.inventory ?? false;
  const servicesEnabled = features?.services ?? false;
  const marketplaceEnabled = features?.marketplace ?? false;

  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  /**
   * Opened straight onto one category when the URL says so.
   *
   * The Categories screen shows an item count per category and, until this
   * existed, that number was a dead end — the only way to see WHAT those items
   * were was to come here and find the category in the filter again.
   */
  const [categoryId, setCategoryId] = useState(() => searchParams.get("category") ?? "");
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebouncedValue(search, 350);

  const products = useProducts({
    search: debouncedSearch,
    type: type as "" | "product" | "service",
    category_id: categoryId,
    low_stock: lowStock,
    page,
  });
  const categories = useCategories();
  const { remove, importCsv } = useProductMutations();

  const confirmModal = useModal();
  const [target, setTarget] = useState<Product | null>(null);

  // Multi-branch: offer a "check other branches" lookup on each item.
  const shopSettings = useShopSettings();
  const multiBranch = shopSettings.data ? shopSettings.data.max_branches !== 1 : false;
  const [lookup, setLookup] = useState<Product | null>(null);
  const [priceEdit, setPriceEdit] = useState<Product | null>(null);
  const soldOut = useSoldOut();
  const variantSoldOut = useVariantSoldOut();
  /** The product whose sizes are being taken off, one at a time. */
  const [eightySix, setEightySix] = useState<Product | null>(null);

  // ── Export the current (filtered) catalog to CSV ─────────────────
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile("/products/export", {
        search: debouncedSearch || undefined,
        type: type || undefined,
        category_id: categoryId || undefined,
        low_stock: lowStock || undefined,
      });
    } catch {
      toast.error("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  // ── Bulk CSV import ──────────────────────────────────────────────
  const importModal = useModal();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const importSummary = importCsv.data?.data ?? null;
  const importError = importCsv.error instanceof ApiError
    ? importCsv.error.firstFieldError() ?? importCsv.error.message
    : null;

  const openImport = () => {
    setCsvFile(null);
    importCsv.reset();
    importModal.openModal();
  };
  const runImport = () => {
    if (!csvFile || importCsv.isPending) return;
    importCsv.mutate(csvFile);
  };
  const downloadTemplate = async () => {
    const res = await api.get("/products/import/template", { responseType: "blob" });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const rows = products.data?.data ?? [];
  const pagination = products.data?.meta.pagination;
  // Item, Category, Price, [Stock], Status, Actions
  const colCount = inventoryEnabled ? 6 : 5;

  const askDelete = (product: Product) => {
    setTarget(product);
    confirmModal.openModal();
  };

  const doDelete = () => {
    if (!target || remove.isPending) return;
    remove.mutate(target.id, { onSettled: confirmModal.closeModal });
  };

  return (
    <>
      <PageMeta title="Items | CartZe" description="Products and services" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">
            Products & Services
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Your catalog — everything you sell
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
          <Button size="sm" variant="outline" onClick={openImport}>Import CSV</Button>
          <Link to="/tenant/products/new">
            <Button size="sm">+ Add Item</Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          placeholder="Search name or SKU…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        {/* Product vs service only matters for shops that offer services. */}
        {servicesEnabled && (
          <Select
            aria-label="Filter by item type"
            options={[
              { value: "", label: "All types" },
              { value: "product", label: "Products" },
              { value: "service", label: "Services" },
            ]}
            placeholder="All types"
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
          />
        )}
        <Select
          aria-label="Filter by category"
          options={[
            { value: "", label: "All categories" },
            ...(categories.data ?? []).flatMap((c) => [
              { value: c.id, label: c.name },
              ...(c.children ?? []).map((ch) => ({ value: ch.id, label: `— ${ch.name}` })),
            ]),
          ]}
          placeholder="All categories"
          onChange={(v) => {
            setCategoryId(v);
            setPage(1);
          }}
        />
        {/* Low-stock only makes sense when the shop tracks inventory. */}
        {inventoryEnabled && (
          <label className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-4 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={lowStock}
              onChange={(e) => {
                setLowStock(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4"
            />
            Low stock only
          </label>
        )}
      </div>

      {/* Result count */}
      {!products.isLoading && (
        <p className="mb-3 text-theme-xs text-gray-400">
          {pagination?.total ?? rows.length} {(pagination?.total ?? rows.length) === 1 ? "item" : "items"}
        </p>
      )}

      {products.isError && (
        <div className="mb-4">
          <Alert variant="error" title="Couldn't load items" message="Check your connection and try again." />
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium">Item</th>
                <th className="hidden px-6 py-3 font-medium md:table-cell">Category</th>
                <th className="px-6 py-3 font-medium">Price</th>
                {inventoryEnabled && <th className="px-6 py-3 font-medium">Stock</th>}
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {products.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={colCount} className="px-6 py-4">
                      <div className="h-10 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-6 py-16 text-center">
                    {debouncedSearch || type || categoryId || lowStock ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400">Nothing matches these filters.</p>
                    ) : (
                      <div className="mx-auto max-w-xs">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-2xl dark:bg-brand-500/10">
                          🗂️
                        </div>
                        <p className="mb-1 text-sm font-medium text-gray-800 dark:text-white/90">No items yet</p>
                        <p className="mb-4 text-theme-xs text-gray-400">Add your first product or service to start selling.</p>
                        <Link to="/tenant/products/new">
                          <Button size="sm">+ Add Item</Button>
                        </Link>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/tenant/products/${p.id}/edit`)}
                    className="cursor-pointer text-theme-sm text-gray-700 transition hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Thumb product={p} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-gray-800 dark:text-white/90">{p.name}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-theme-xs text-gray-400">
                            <Badge size="sm" color={TYPE_COLOR[p.item_type]}>{TYPE_LABEL[p.item_type]}</Badge>
                            {p.variants.length > 0 && <span>{p.variants.length} variants</span>}
                            {p.sku && <span>SKU: {p.sku}</span>}
                            {p.requires_prescription && <span className="text-error-400">℞</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-6 py-4 md:table-cell">{p.category?.name ?? "—"}</td>
                    <td className="px-6 py-4">
                      {p.branch_price != null ? (
                        // This branch overrides the catalog price (Phase 4c).
                        <span className="flex flex-col leading-tight">
                          <span className="font-medium text-gray-800 dark:text-white/90">{money(p.branch_price)}</span>
                          <span className="text-theme-xs text-brand-500">branch price</span>
                        </span>
                      ) : p.discount_price != null ? (
                        <span className="flex flex-col leading-tight">
                          <span className="font-medium text-gray-800 dark:text-white/90">{money(p.discount_price)}</span>
                          <span className="text-theme-xs text-gray-400 line-through">{money(p.price)}</span>
                        </span>
                      ) : (
                        money(p.price)
                      )}
                    </td>
                    {inventoryEnabled && (
                      <td className="px-6 py-4">
                        {!p.track_inventory ? (
                          <span className="text-gray-400">—</span>
                        ) : p.low_stock_threshold !== null && p.stock_quantity <= p.low_stock_threshold ? (
                          <Badge size="sm" color="warning">{p.stock_quantity} low</Badge>
                        ) : (
                          p.stock_quantity
                        )}
                      </td>
                    )}
                    <td className="px-6 py-4">
                      <Badge size="sm" color={p.is_active ? "success" : "light"}>
                        {p.is_active ? "Active" : "Inactive"}
                      </Badge>
                      {marketplaceEnabled && !p.visible_in_marketplace && (
                        <div className="mt-1 text-theme-xs text-gray-400">In-store only</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        {multiBranch && p.track_inventory && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setLookup(p); }}
                            className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-brand-500 dark:hover:bg-white/[0.06]"
                            aria-label={`Stock by branch for ${p.name}`}
                            title="Stock by branch"
                          >
                            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                              <path d="M3 7l7-4 7 4-7 4-7-4z" strokeLinejoin="round" />
                              <path d="M3 7v6l7 4 7-4V7" strokeLinejoin="round" />
                            </svg>
                          </button>
                        )}
                        {multiBranch && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setPriceEdit(p); }}
                            className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-brand-500 dark:hover:bg-white/[0.06]"
                            aria-label={`Branch pricing for ${p.name}`}
                            title="Branch pricing"
                          >
                            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                              <path d="M10 3v14M6.5 6.5h5.25a2.25 2.25 0 010 4.5H8.25a2.25 2.25 0 000 4.5h5.25" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        )}
                        {/* Eighty-six — off the menu tonight, back on tomorrow.
                            Sits with the row actions rather than inside the
                            product editor because it is a SERVICE decision made
                            twice a day, not a catalog edit made once, and a
                            chef is not opening a thirty-field form to make it. */}
                        {!p.track_inventory && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              // A product with sizes has no single answer: the
                              // large bases ran out, the small ones did not. So
                              // the same button asks WHICH, and only where there
                              // is a which — one extra tap, and never a form.
                              if ((p.variants ?? []).some((v) => v.is_active)) {
                                setEightySix(p);

                                return;
                              }
                              soldOut.mutate({ id: p.id, off: !p.sold_out });
                            }}
                            disabled={soldOut.isPending}
                            className={`rounded-lg p-2 transition disabled:opacity-40 ${
                              p.sold_out
                                ? "bg-warning-500/15 text-warning-600 hover:bg-warning-500/25 dark:text-warning-400"
                                : "text-gray-400 hover:bg-gray-100 hover:text-warning-500 dark:hover:bg-white/[0.06]"
                            }`}
                            aria-label={p.sold_out ? `Put ${p.name} back on` : `Mark ${p.name} sold out`}
                            title={p.sold_out ? "Sold out — press to put it back on" : "Mark sold out for now"}
                          >
                            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                              <circle cx="10" cy="10" r="7" />
                              <path d="M5 5l10 10" strokeLinecap="round" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/tenant/products/${p.id}/edit`); }}
                          className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-brand-500 dark:hover:bg-white/[0.06]"
                          aria-label={`Edit ${p.name}`}
                        >
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <path d="M13.5 3.5l3 3L7 16l-4 1 1-4 9.5-9.5z" strokeLinejoin="round" />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); askDelete(p); }}
                          className="rounded-lg p-2 text-gray-400 transition hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10"
                          aria-label={`Delete ${p.name}`}
                        >
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <path d="M4 6h12M8 6V4h4v2m1 0l-.5 10h-9L3 6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <Pager pagination={pagination} onPage={setPage} noun="items" />
      </div>

      {/* Delete confirmation */}
      {/* WHICH SIZE ran out.
          A pizzeria loses large bases, not pizza — and 86'ing the product took
          Small and Medium off the menu with it, all evening, on the busiest
          item there is. One tap from the same button, and no form: this is a
          decision made twice a day by whoever is cooking. */}
      <Modal isOpen={eightySix !== null} onClose={() => setEightySix(null)} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          {eightySix?.name} — what has run out?
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Off for tonight. Press again when the delivery lands.
        </p>

        <div className="space-y-2">
          {(eightySix?.variants ?? []).filter((v) => v.is_active).map((v) => {
            const off = v.sold_out_at !== null && v.sold_out_at !== undefined;

            return (
              <button
                key={v.id}
                type="button"
                disabled={variantSoldOut.isPending}
                onClick={() => eightySix && variantSoldOut.mutate(
                  { productId: eightySix.id, variantId: v.id, off: !off },
                  { onSuccess: () => setEightySix(null) },
                )}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition disabled:opacity-40 ${
                  off
                    ? "border-warning-500/40 bg-warning-500/10 text-warning-700 dark:text-warning-400"
                    : "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"
                }`}
              >
                <span className="font-medium">{v.name}</span>
                <span className="text-theme-xs">{off ? "Off — put it back on" : "Mark it off"}</span>
              </button>
            );
          })}
        </div>

        {/* The product-level flag is still a real sentence: "no pizza tonight"
            is not the same as "no large". */}
        <button
          type="button"
          disabled={soldOut.isPending}
          onClick={() => eightySix && soldOut.mutate(
            { id: eightySix.id, off: !eightySix.sold_out },
            { onSuccess: () => setEightySix(null) },
          )}
          className="mt-4 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
        >
          {eightySix?.sold_out ? "Put the whole item back on" : "All of it — take the item off"}
        </button>
      </Modal>

      <Modal isOpen={confirmModal.isOpen} onClose={confirmModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-2 text-lg font-semibold text-gray-800 dark:text-white/90">
          Delete "{target?.name}"?
        </h3>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
          The item is removed from your catalog. Past sales and reports keep
          their history.
        </p>
        <div className="flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={confirmModal.closeModal}>
            Cancel
          </Button>
          {/* Filled red, matching the shared confirm dialog. This modal
              predates it and was rendering the brand colour, so the button
              that deletes a product was the same button as Save. */}
          <button
            onClick={doDelete}
            disabled={remove.isPending}
            className="rounded-lg bg-error-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-error-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </Modal>

      {/* Bulk CSV import */}
      <Modal isOpen={importModal.isOpen} onClose={importModal.closeModal} className="max-w-lg p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Import products from CSV</h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Load your whole catalog at once. Rows are matched by <strong>SKU</strong> — an existing SKU updates that item, a new one is created.
        </p>

        <button onClick={downloadTemplate} className="mb-3 text-theme-sm text-brand-500 hover:text-brand-600">
          ↓ Download sample CSV template
        </button>

        {/* Expected format — so the columns are clear before downloading. */}
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
          <p className="mb-1.5 font-medium text-gray-700 dark:text-gray-300">Expected columns</p>
          <p className="mb-2 text-gray-500 dark:text-gray-400">
            <span className="rounded bg-error-50 px-1 font-medium text-error-600 dark:bg-error-500/10">name</span> and{" "}
            <span className="rounded bg-error-50 px-1 font-medium text-error-600 dark:bg-error-500/10">price</span> are required. Rows match by <strong>sku</strong> (updates if it exists). <code>item_type</code>: physical_product · food_item · medicine · service. <code>sold_by</code>: unit · weight. <code>barcodes</code>: extra codes separated by <code>|</code>. Boolean columns (requires_prescription, is_active, visible_in_marketplace): 1/0.
          </p>
          <div className="overflow-x-auto">
            <code className="whitespace-pre text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
              name,item_type,sku,price,category,unit,sold_by,stock_quantity,barcodes{"\n"}
              Loose Sugar,physical_product,SUG-KG,180,Grocery,kg,weight,100,{"\n"}
              Panadol 500mg,medicine,PAN-500,120,Medicines,strip,unit,200,8964..|8965..
            </code>
          </div>
        </div>

        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
          className="mb-4 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-600 dark:text-gray-300 dark:file:bg-brand-500/10"
        />

        {importError && <div className="mb-3"><Alert variant="error" title="Import failed" message={importError} /></div>}

        {importSummary && (
          <div className="mb-4 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
            <p className="text-gray-700 dark:text-gray-300">
              <span className="font-medium text-success-600">{importSummary.created} created</span>,{" "}
              <span className="font-medium text-brand-600">{importSummary.updated} updated</span>
              {importSummary.failed > 0 && <>, <span className="font-medium text-error-600">{importSummary.failed} failed</span></>}
              {" "}of {importSummary.total} rows.
            </p>
            {importSummary.errors.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-theme-xs text-error-500">
                {importSummary.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>Row {e.row}: {e.messages.join(", ")}</li>
                ))}
                {importSummary.errors.length > 20 && <li>…and {importSummary.errors.length - 20} more.</li>}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={importModal.closeModal}>
            {importSummary ? "Close" : "Cancel"}
          </Button>
          <Button size="sm" onClick={runImport} disabled={!csvFile || importCsv.isPending}>
            {importCsv.isPending ? "Importing…" : "Import"}
          </Button>
        </div>
      </Modal>

      {/* Cross-branch availability ("check other branches") */}
      <BranchStockModal
        productId={lookup?.id ?? null}
        productName={lookup?.name}
        onClose={() => setLookup(null)}
      />

      {/* Per-branch price overrides */}
      <BranchPriceModal
        productId={priceEdit?.id ?? null}
        productName={priceEdit?.name}
        onClose={() => setPriceEdit(null)}
      />

      {/* Product editor drawer (routes: /products/new, /products/:id/edit) */}
      <Outlet />
    </>
  );
}
