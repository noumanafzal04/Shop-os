import { useEffect, useMemo, useRef, useState } from "react";
import { useMoney, useShopSettings } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Alert from "../../../components/ui/alert/Alert";
import { useAuthStore } from "../../../stores/authStore";
import { useGenerateBarcode, useProducts } from "../hooks/useCatalog";
import { code128BarsSvg, code128ModuleCount } from "../utils/code128";
import type { Product } from "../types";

/**
 * Label stock, in millimetres, because a sticker is a physical object. Sizing
 * the page in px and hoping meant a "medium" label printed at whatever the
 * driver felt like; mm survives the trip to the printer intact.
 */
type StockKey = "38x25" | "50x25" | "50x38" | "100x50";

interface Stock {
  label: string;
  hint: string;
  w: number; // mm
  h: number; // mm
  bar: number; // barcode block height, mm
  name: number; // pt
  price: number; // pt
  meta: number; // pt
  lines: 1 | 2; // product-name lines that fit
}

const STOCKS: Record<StockKey, Stock> = {
  "38x25": { label: "38 × 25", hint: "Small", w: 38, h: 25, bar: 8, name: 5.5, price: 8, meta: 4.5, lines: 1 },
  "50x25": { label: "50 × 25", hint: "Standard", w: 50, h: 25, bar: 9, name: 6, price: 9.5, meta: 5, lines: 1 },
  "50x38": { label: "50 × 38", hint: "Tall", w: 50, h: 38, bar: 13, name: 7.5, price: 12, meta: 6, lines: 2 },
  "100x50": { label: "100 × 50", hint: "Shelf tag", w: 100, h: 50, bar: 18, name: 12, price: 18, meta: 8.5, lines: 2 },
};

/** Sticker padding and the gap between stickers on a sheet, mm. */
const PAD = 1.5;
const GAP = 2;

/**
 * Narrowest bar a supermarket scanner reliably reads, mm. Below this the label
 * prints and looks fine, and then fails at the till — which is the worst place
 * to discover it, so we say so here instead.
 */
const MIN_X_DIM = 0.25;

const FIELDS = [
  { key: "name", label: "Product name" },
  { key: "price", label: "Price" },
  { key: "digits", label: "Barcode number" },
  { key: "shop", label: "Shop name" },
  { key: "pack", label: "Pack size" },
  { key: "cut", label: "Cut lines" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export default function LabelsPage() {
  const money = useMoney();
  const settings = useShopSettings();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const shopName = useAuthStore((s) => s.user?.tenant?.business_name) ?? "";

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const products = useProducts({ search: query || undefined, page });
  const generate = useGenerateBarcode();

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [query]);

  // How many labels each product gets, plus the product itself — held here and
  // not looked up from the visible page, so a run built across two searches
  // still prints both halves.
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Record<string, Product>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const [stockKey, setStockKey] = useState<StockKey>("50x25");
  const [showOptions, setShowOptions] = useState(false);
  const [mode, setMode] = useState<"sheet" | "roll">("sheet");
  const [skip, setSkip] = useState(0);
  // Settings → Barcodes says what a label carries in this shop; the tick boxes
  // here override it for one print run. The two switches used to save and then
  // be read by nobody, so a shop that turned the price off still printed it.
  const [fields, setFields] = useState<Record<FieldKey, boolean>>({
    name: true, price: true, digits: true, shop: false, pack: false, cut: true,
  });
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !settings.data) return;
    seeded.current = true;
    setFields((f) => ({
      ...f,
      name: settings.data.barcode_show_name !== false,
      price: settings.data.barcode_show_price !== false,
    }));
  }, [settings.data]);

  const [bulkBusy, setBulkBusy] = useState(false);

  const stock = STOCKS[stockKey];
  const rows = products.data?.data ?? [];
  const pagination = products.data?.meta.pagination;
  const missing = rows.filter((p) => !p.barcode);

  const queue = useMemo(
    () => Object.entries(qtys)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ product: picked[id], qty: q }))
      .filter((r) => !!r.product),
    [qtys, picked],
  );

  const total = queue.reduce((n, r) => n + r.qty, 0);

  /** The print list: each product repeated by its quantity. */
  const sheet = useMemo(() => {
    const out: Product[] = [];
    for (const r of queue) for (let i = 0; i < r.qty; i++) out.push(r.product);
    return out;
  }, [queue]);

  /**
   * Bars get thinner as the code gets longer and the label stays the same
   * width. Flag the products that have crossed the line for this stock.
   */
  const tooThin = useMemo(
    () => queue.filter((r) => (stock.w - PAD * 2) / code128ModuleCount(r.product.barcode!) < MIN_X_DIM),
    [queue, stock.w],
  );

  const setQty = (p: Product, q: number) => {
    const n = Math.max(0, Math.min(999, Math.round(q)));
    setQtys((m) => {
      const next = { ...m };
      if (n === 0) delete next[p.id]; else next[p.id] = n;
      return next;
    });
    setPicked((m) => {
      if (n === 0) { const { [p.id]: _drop, ...rest } = m; return rest; }
      return { ...m, [p.id]: p };
    });
  };

  /** Clearing the box to retype must not be read as "zero" until you leave it. */
  const commitDraft = (p: Product) => {
    const raw = drafts[p.id];
    setDrafts((d) => { const { [p.id]: _drop, ...rest } = d; return rest; });
    if (raw === undefined) return;
    setQty(p, raw.trim() === "" ? 0 : Number(raw));
  };

  const generateAll = async () => {
    if (bulkBusy || missing.length === 0) return;
    setBulkBusy(true);
    try {
      for (const p of missing) await generate.mutateAsync(p.id);
    } finally {
      setBulkBusy(false);
    }
  };

  if (!hasPermission("products.manage")) {
    return <Alert variant="error" title="No access" message="You don't have permission to manage the catalog." />;
  }

  const printCss = mode === "roll"
    ? `@page { size: ${stock.w}mm ${stock.h}mm; margin: 0; }`
    : `@page { size: A4; margin: 8mm; }`;

  const stepper = (p: Product) => {
    const q = qtys[p.id] ?? 0;
    return (
      <div className="flex shrink-0 items-center gap-1">
        <button
          className="h-8 w-8 rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/10"
          onClick={() => setQty(p, q - 1)}
          disabled={q === 0}
          aria-label={`One fewer ${p.name} label`}
        >
          −
        </button>
        <input
          className="h-8 w-12 rounded-lg border border-gray-200 bg-white text-center text-sm tabular-nums text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          value={drafts[p.id] ?? String(q)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value.replace(/\D/g, "") }))}
          onBlur={() => commitDraft(p)}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          aria-label={`Labels for ${p.name}`}
        />
        <button
          className="h-8 w-8 rounded-lg bg-brand-500 text-white transition hover:bg-brand-600"
          onClick={() => setQty(p, q + 1)}
          aria-label={`One more ${p.name} label`}
        >
          +
        </button>
      </div>
    );
  };

  return (
    <>
      <PageMeta title="Barcode Labels | ShopOS" description="Generate and print barcode labels" />

      <style>{`
        #label-sheet { display: none; }
        @media print {
          ${printCss}
          body * { visibility: hidden; }
          #label-sheet, #label-sheet * { visibility: visible; }
          #label-sheet { display: block !important; position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          .lbl { break-inside: avoid; }
          .roll-page { break-after: page; }
          .roll-page:last-child { break-after: auto; }
        }
      `}</style>

      <div className="no-print mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Barcode labels</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Pick products, choose a sticker size, print.</p>
        </div>
        <div className="flex items-center gap-2">
          {missing.length > 0 && (
            <Button size="sm" variant="outline" onClick={generateAll} disabled={bulkBusy}>
              {bulkBusy ? "Generating…" : `Generate ${missing.length} barcode${missing.length > 1 ? "s" : ""}`}
            </Button>
          )}
          <Button size="sm" onClick={() => window.print()} disabled={total === 0}>
            Print{total > 0 ? ` ${total} label${total > 1 ? "s" : ""}` : ""}
          </Button>
        </div>
      </div>

      <div className="no-print grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
        {/* ── Products ─────────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] xl:col-span-7">
          <div className="p-4">
            <Input placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {/* What's queued, always in view — including products from a search you've since left. */}
          {queue.length > 0 && (
            <div className="border-y border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-white/[0.02]">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-theme-xs font-medium uppercase tracking-wide text-gray-400">
                  {total} label{total > 1 ? "s" : ""} queued
                </span>
                <button
                  className="text-theme-xs font-medium text-gray-400 transition hover:text-error-500"
                  onClick={() => { setQtys({}); setPicked({}); setDrafts({}); }}
                >
                  Clear
                </button>
              </div>
              <div className="space-y-1.5">
                {queue.map((r) => (
                  <div key={r.product.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200">{r.product.name}</span>
                    {stepper(r.product)}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-[26rem] space-y-0.5 overflow-y-auto p-2">
            {products.isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
              ))
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-400">No products match.</p>
            ) : (
              rows.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 rounded-lg px-2.5 py-2 transition ${
                    (qtys[p.id] ?? 0) > 0 ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-gray-50 dark:hover:bg-white/5"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-800 dark:text-white/90">{p.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-theme-xs text-gray-400">
                      <span className="tabular-nums">{money(p.price)}</span>
                      {p.barcode ? (
                        <span className="truncate font-mono">{p.barcode}</span>
                      ) : (
                        <span className="text-warning-600 dark:text-warning-400">no barcode</span>
                      )}
                    </div>
                  </div>

                  {p.barcode ? (
                    stepper(p)
                  ) : (
                    <button
                      className="shrink-0 rounded-lg border border-brand-500 px-2.5 py-1.5 text-theme-xs font-medium text-brand-600 transition hover:bg-brand-50 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
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

          {pagination && pagination.last_page > 1 && (
            <footer className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-2.5 dark:border-gray-800">
              <span className="text-theme-xs text-gray-400">Page {pagination.current_page} of {pagination.last_page}</span>
              <div className="flex gap-1">
                <button
                  className="rounded-lg border border-gray-200 px-2.5 py-1 text-theme-xs text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
                  onClick={() => setPage((n) => n - 1)}
                  disabled={pagination.current_page <= 1}
                >
                  Prev
                </button>
                <button
                  className="rounded-lg border border-gray-200 px-2.5 py-1 text-theme-xs text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
                  onClick={() => setPage((n) => n + 1)}
                  disabled={pagination.current_page >= pagination.last_page}
                >
                  Next
                </button>
              </div>
            </footer>
          )}
        </section>

        {/* ── Label ────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] xl:col-span-5">
          <div className="flex flex-wrap gap-1.5 p-4">
            {(Object.keys(STOCKS) as StockKey[]).map((k) => {
              const s = STOCKS[k];
              const on = k === stockKey;
              return (
                <button
                  key={k}
                  onClick={() => setStockKey(k)}
                  className={`flex-1 rounded-lg border px-2 py-2 transition ${
                    on
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                      : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600"
                  }`}
                >
                  <span className={`block whitespace-nowrap text-theme-xs font-semibold tabular-nums ${on ? "text-brand-600 dark:text-brand-400" : "text-gray-700 dark:text-gray-200"}`}>
                    {s.label}
                  </span>
                  <span className="block text-[10px] text-gray-400">{s.hint}</span>
                </button>
              );
            })}
          </div>

          <div className="px-4 pb-4">
            {queue.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400">Nothing queued yet.</p>
                <p className="mt-1 text-theme-xs text-gray-400">
                  Add labels with <span className="font-semibold">+</span> and they'll show here at real size.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl bg-gray-100 p-4 dark:bg-gray-900/60">
                {/* One of each product, at true size — twelve copies of the same
                    sticker told you nothing the first one didn't. */}
                <div className="mx-auto flex w-fit flex-wrap justify-center bg-white p-3 shadow-sm" style={{ gap: `${GAP}mm` }}>
                  {queue.slice(0, 6).map((r) => (
                    <LabelCard key={r.product.id} p={r.product} stock={stock} fields={fields} shopName={shopName} money={money} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {tooThin.length > 0 && (
            <p className="mx-4 mb-4 rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-400">
              {tooThin.length === 1 ? `${tooThin[0].product.name}'s barcode is` : `${tooThin.length} barcodes are`}{" "}
              too long for a {stock.label} mm sticker — the bars print too thin to scan. Pick a wider size.
            </p>
          )}

          <div className="border-t border-gray-100 dark:border-gray-800">
            <button
              className="flex w-full items-center justify-between px-4 py-3 text-theme-xs text-gray-500 transition hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              onClick={() => setShowOptions((v) => !v)}
            >
              <span className="font-medium">
                Options
                <span className="ml-2 font-normal text-gray-400">
                  {mode === "sheet" ? `A4 sheet${skip ? ` · skip ${skip}` : ""}` : "Label roll"}
                </span>
              </span>
              <span className={`transition ${showOptions ? "rotate-180" : ""}`}>⌄</span>
            </button>

            {showOptions && (
              <div className="space-y-4 px-4 pb-4">
                <div>
                  <p className="mb-1.5 text-theme-xs font-medium uppercase tracking-wide text-gray-400">Show on label</p>
                  <div className="flex flex-wrap gap-1.5">
                    {FIELDS.map((f) => (
                      <button
                        key={f.key}
                        onClick={() => setFields((s) => ({ ...s, [f.key]: !s[f.key] }))}
                        className={`rounded-full border px-3 py-1.5 text-theme-xs transition ${
                          fields[f.key]
                            ? "border-brand-500 bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                            : "border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-theme-xs font-medium uppercase tracking-wide text-gray-400">Paper</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex gap-1.5">
                      {([["sheet", "A4 sheet"], ["roll", "Label roll"]] as const).map(([m, label]) => (
                        <button
                          key={m}
                          onClick={() => setMode(m)}
                          className={`rounded-lg border px-3 py-1.5 text-theme-xs transition ${
                            mode === m
                              ? "border-brand-500 bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                              : "border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {mode === "sheet" && (
                      <label className="flex items-center gap-2 text-theme-xs text-gray-500 dark:text-gray-400">
                        Skip
                        <input
                          type="number"
                          min={0}
                          max={99}
                          value={skip}
                          onChange={(e) => setSkip(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
                          className="h-8 w-14 rounded-lg border border-gray-200 bg-white px-2 text-center text-sm tabular-nums text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                        />
                        used stickers
                      </label>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Print-only sheet — hidden on screen; the preview above is what you see. */}
      <div id="label-sheet">
        {mode === "roll" ? (
          sheet.map((p, i) => (
            <div className="roll-page" key={`${p.id}-${i}`}>
              <LabelCard p={p} stock={stock} fields={fields} shopName={shopName} money={money} />
            </div>
          ))
        ) : (
          <div className="flex flex-wrap" style={{ gap: `${GAP}mm` }}>
            {Array.from({ length: skip }).map((_, i) => (
              <div key={`skip-${i}`} style={{ width: `${stock.w}mm`, height: `${stock.h}mm` }} />
            ))}
            {sheet.map((p, i) => (
              <LabelCard key={`${p.id}-${i}`} p={p} stock={stock} fields={fields} shopName={shopName} money={money} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function LabelCard({
  p, stock, fields, shopName, money,
}: {
  p: Product;
  stock: Stock;
  fields: Record<FieldKey, boolean>;
  shopName: string;
  money: (n: string | number) => string;
}) {
  // Discount-aware price; weight items show the per-unit rate ("/kg").
  const sale =
    p.discount_price != null && Number(p.discount_price) > 0 && Number(p.discount_price) < Number(p.price)
      ? Number(p.discount_price)
      : null;
  const perUnit = p.sold_by === "weight" && p.unit ? `/${p.unit}` : "";
  // Largest pack (units are sorted smallest-first) → "Box = 100 pcs".
  const pack = fields.pack && p.units?.length ? p.units[p.units.length - 1] : null;
  const head = (fields.shop && shopName) || fields.name;

  return (
    <div
      className={`lbl flex flex-col justify-between overflow-hidden bg-white text-center text-black ${
        fields.cut ? "border border-gray-300" : ""
      }`}
      style={{ width: `${stock.w}mm`, height: `${stock.h}mm`, padding: `${PAD}mm` }}
    >
      {head ? (
        <div className="min-h-0">
          {fields.shop && shopName && (
            <div className="truncate uppercase leading-none" style={{ fontSize: `${stock.meta}pt`, letterSpacing: "0.08em" }}>
              {shopName}
            </div>
          )}
          {fields.name && (
            <div
              className={`font-medium ${stock.lines === 1 ? "line-clamp-1" : "line-clamp-2"}`}
              style={{ fontSize: `${stock.name}pt`, lineHeight: 1.15 }}
            >
              {p.name}
            </div>
          )}
        </div>
      ) : (
        <div />
      )}

      <div className="min-h-0">
        <div style={{ height: `${stock.bar}mm` }} dangerouslySetInnerHTML={{ __html: code128BarsSvg(p.barcode!) }} />
        {fields.digits && (
          <div className="font-mono leading-none" style={{ fontSize: `${stock.meta}pt`, letterSpacing: "0.06em" }}>
            {p.barcode}
          </div>
        )}
      </div>

      {(fields.price || pack) && (
        <div className="flex items-baseline justify-center gap-1 leading-none">
          {fields.price && (
            <span className="font-bold tabular-nums" style={{ fontSize: `${stock.price}pt` }}>
              {money(sale ?? p.price)}
              {perUnit && <span className="font-normal" style={{ fontSize: `${stock.meta}pt` }}>{perUnit}</span>}
            </span>
          )}
          {fields.price && sale != null && (
            <span className="text-gray-500 line-through" style={{ fontSize: `${stock.meta}pt` }}>{money(p.price)}</span>
          )}
          {pack && (
            <span className="ml-auto truncate text-gray-600" style={{ fontSize: `${stock.meta}pt` }}>
              {pack.name} = {Number(pack.factor)} {p.unit ?? "pcs"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
