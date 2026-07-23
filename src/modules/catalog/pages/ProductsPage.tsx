import { useState } from "react";
import { useMoney } from "../../shop/hooks/useShop";
import { Link } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import Select from "../../../components/form/Select";
import Input from "../../../components/form/input/InputField";
import { useCategories, useProductMutations, useProducts } from "../hooks/useCatalog";
import type { Product } from "../types";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { ApiError } from "../../../common/types/api";
import { api } from "../../../common/api/client";

export default function ProductsPage() {
  const money = useMoney();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [categoryId, setCategoryId] = useState("");
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
      <PageMeta title="Items | ShopOS" description="Products and services" />

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
          <Button size="sm" variant="outline" onClick={openImport}>Import CSV</Button>
          <Link to="/tenant/products/new">
            <Button size="sm">+ Add Item</Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Input
          placeholder="Search name or SKU…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
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
        <Select
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
      </div>

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
                <th className="px-6 py-3 font-medium">Type</th>
                <th className="px-6 py-3 font-medium">Category</th>
                <th className="px-6 py-3 font-medium">Price</th>
                <th className="px-6 py-3 font-medium">Stock</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {products.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-6 py-4">
                      <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    {debouncedSearch || type || categoryId || lowStock
                      ? "Nothing matches these filters."
                      : "No items yet — add your first product or service."}
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-800 dark:text-white/90">{p.name}</div>
                      {p.sku && <div className="text-theme-xs text-gray-400">SKU: {p.sku}</div>}
                      {p.variants.length > 0 && (
                        <div className="text-theme-xs text-gray-400">{p.variants.length} variants</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <Badge size="sm" color={p.type === "service" ? "info" : "primary"}>
                        {p.type}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">{p.category?.name ?? "—"}</td>
                    <td className="px-6 py-4">{money(p.price)}</td>
                    <td className="px-6 py-4">
                      {p.type === "service" ? (
                        "—"
                      ) : p.low_stock_threshold !== null && p.stock_quantity <= p.low_stock_threshold ? (
                        <Badge size="sm" color="warning">{p.stock_quantity} low</Badge>
                      ) : (
                        p.stock_quantity
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <Badge size="sm" color={p.is_active ? "success" : "light"}>
                        {p.is_active ? "active" : "inactive"}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        to={`/tenant/products/${p.id}/edit`}
                        className="mr-3 text-brand-500 hover:text-brand-600 dark:text-brand-400"
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => askDelete(p)}
                        className="text-error-500 hover:text-error-600"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.last_page > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3 text-sm dark:border-gray-800">
            <span className="text-gray-500 dark:text-gray-400">
              {pagination.total} items · page {pagination.current_page} of {pagination.last_page}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pagination.current_page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pagination.current_page >= pagination.last_page}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
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
          <Button size="sm" onClick={doDelete} disabled={remove.isPending}>
            {remove.isPending ? "Deleting…" : "Delete"}
          </Button>
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
    </>
  );
}
