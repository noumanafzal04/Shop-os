import { useMemo, useState } from "react";
import { useMoney } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Alert from "../../../components/ui/alert/Alert";
import Badge from "../../../components/ui/badge/Badge";
import { useAuthStore } from "../../../stores/authStore";
import { useGenerateBarcode, useProducts } from "../hooks/useCatalog";
import { code128Svg } from "../utils/code128";
import type { Product } from "../types";


type LabelSize = "small" | "medium" | "large";
const SIZES: Record<LabelSize, { width: number; barHeight: number; module: number }> = {
  small: { width: 120, barHeight: 30, module: 1.1 },
  medium: { width: 150, barHeight: 40, module: 1.4 },
  large: { width: 190, barHeight: 52, module: 1.8 },
};

export default function LabelsPage() {
  const money = useMoney();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [search, setSearch] = useState("");
  const products = useProducts({ search: search || undefined });
  const generate = useGenerateBarcode();

  // productId → number of labels to print
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [size, setSize] = useState<LabelSize>("medium");
  const [bulkBusy, setBulkBusy] = useState(false);

  const rows = products.data?.data ?? [];
  const byId = useMemo(() => new Map(rows.map((p) => [p.id, p])), [rows]);
  const missing = rows.filter((p) => !p.barcode);

  // Flatten the print list: each product repeated by its quantity.
  const sheet = useMemo(() => {
    const out: Product[] = [];
    for (const [id, q] of Object.entries(qtys)) {
      const p = byId.get(id);
      if (p && p.barcode && q > 0) for (let i = 0; i < q; i++) out.push(p);
    }
    return out;
  }, [qtys, byId]);

  const setQty = (id: string, q: number) => setQtys((m) => ({ ...m, [id]: Math.max(0, q) }));

  const generateAll = async () => {
    if (bulkBusy || missing.length === 0) return;
    setBulkBusy(true);
    try {
      for (const p of missing) {
        await generate.mutateAsync(p.id);
      }
    } finally {
      setBulkBusy(false);
    }
  };

  if (!hasPermission("products.manage")) {
    return <Alert variant="error" title="No access" message="You don't have permission to manage the catalog." />;
  }

  return (
    <>
      <PageMeta title="Barcode Labels | ShopOS" description="Generate and print barcode labels" />

      <style>{`
        #label-sheet { display: none; }
        @media print {
          body * { visibility: hidden; }
          #label-sheet, #label-sheet * { visibility: visible; }
          #label-sheet { display: block !important; position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Barcode Labels</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Generate barcodes and print scannable price labels.</p>
        </div>
        <div className="flex items-center gap-2">
          {missing.length > 0 && (
            <Button size="sm" variant="outline" onClick={generateAll} disabled={bulkBusy}>
              {bulkBusy ? "Generating…" : `Generate all missing (${missing.length})`}
            </Button>
          )}
          <Button size="sm" onClick={() => window.print()} disabled={sheet.length === 0}>
            🖨 Print {sheet.length > 0 ? `${sheet.length} label${sheet.length > 1 ? "s" : ""}` : ""}
          </Button>
        </div>
      </div>

      <div className="no-print grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Picker */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">1 · Pick products</p>
            {sheet.length > 0 && (
              <button className="text-theme-xs text-gray-400 underline hover:text-gray-600" onClick={() => setQtys({})}>Clear all</button>
            )}
          </div>
          <div className="mb-3"><Input placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="max-h-[28rem] space-y-1 overflow-y-auto">
            {products.isLoading ? (
              Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />)
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">No products.</p>
            ) : (
              rows.map((p) => (
                <div key={p.id} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 ${(qtys[p.id] ?? 0) > 0 ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
                  <div className="min-w-0">
                    <div className="truncate text-sm text-gray-800 dark:text-white/90">{p.name}</div>
                    <div className="text-theme-xs text-gray-400">
                      {money(p.price)}
                      {p.barcode ? <span className="font-mono"> · {p.barcode}</span> : <span className="text-warning-500"> · no barcode yet</span>}
                    </div>
                  </div>
                  {p.barcode ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button className="h-7 w-7 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300" onClick={() => setQty(p.id, (qtys[p.id] ?? 0) - 1)}>−</button>
                      <span className="w-8 text-center text-sm tabular-nums text-gray-800 dark:text-white/90">{qtys[p.id] ?? 0}</span>
                      <button className="h-7 w-7 rounded-lg bg-brand-500 text-white hover:bg-brand-600" onClick={() => setQty(p.id, (qtys[p.id] ?? 0) + 1)}>+</button>
                    </div>
                  ) : (
                    <button
                      className="shrink-0 rounded-lg border border-brand-500 px-2 py-1 text-theme-xs font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:hover:bg-brand-500/10"
                      onClick={() => generate.mutate(p.id)}
                      disabled={generate.isPending || bulkBusy}
                    >
                      Generate
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Live preview */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              2 · Preview {sheet.length > 0 && <Badge size="sm" color="info">{sheet.length}</Badge>}
            </p>
            <div className="flex gap-1">
              {(Object.keys(SIZES) as LabelSize[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={`rounded-lg px-3 py-1 text-theme-xs capitalize transition ${size === s ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
            {sheet.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-gray-400">No labels yet.</p>
                <p className="mt-1 text-theme-xs text-gray-400">Tap <span className="font-semibold">+</span> on a product to add labels, then print.</p>
              </div>
            ) : (
              <LabelGrid items={sheet.slice(0, 12)} size={size} />
            )}
            {sheet.length > 12 && <p className="mt-2 text-center text-theme-xs text-gray-400">Showing 12 of {sheet.length} — all {sheet.length} will print.</p>}
          </div>
        </div>
      </div>

      {/* Print-only sheet (hidden on screen; the preview above is what you see) */}
      <div id="label-sheet">
        <LabelGrid items={sheet} size={size} print />
      </div>
    </>
  );
}

function LabelGrid({ items, size, print = false }: { items: Product[]; size: LabelSize; print?: boolean }) {
  const money = useMoney();
  const s = SIZES[size];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((p, i) => {
        // Discount-aware price; weight items show the per-unit rate ("/kg").
        const sale = p.discount_price != null && Number(p.discount_price) > 0 && Number(p.discount_price) < Number(p.price)
          ? Number(p.discount_price) : null;
        const perUnit = p.sold_by === "weight" && p.unit ? `/${p.unit}` : "";
        // Largest pack (units are sorted smallest-first) → "Box = 100 pcs".
        const pack = p.units && p.units.length ? p.units[p.units.length - 1] : null;
        return (
          <div
            key={`${p.id}-${i}`}
            className={`flex flex-col items-center justify-center rounded border border-gray-200 bg-white px-2 py-1 text-center ${print ? "" : "shadow-sm"}`}
            style={{ width: s.width }}
          >
            <span className="w-full truncate text-[11px] font-medium text-black">{p.name}</span>
            <span dangerouslySetInnerHTML={{ __html: code128Svg(p.barcode!, { height: s.barHeight, moduleWidth: s.module }) }} />
            <span className="text-[11px] font-semibold text-black">
              {money(sale ?? p.price)}<span className="font-normal">{perUnit}</span>
              {sale != null && <span className="ml-1 font-normal text-gray-500 line-through">{money(p.price)}</span>}
            </span>
            {pack && (
              <span className="w-full truncate text-[9px] text-gray-600">
                {pack.name} = {Number(pack.factor)} {p.unit ?? "pcs"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
