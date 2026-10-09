import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMoney, useShopSettings, useUpdateShopSettings } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Alert from "../../../components/ui/alert/Alert";
import { useToast } from "../../../components/ui/toast";
import { useAuthStore } from "../../../stores/authStore";
import { useGenerateBarcode, useProducts } from "../hooks/useCatalog";
import { code128BarsSvg, code128ModuleCount } from "../utils/code128";
import { ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import Pager from "../../../components/ui/pager";
import { Dropdown } from "../../../components/ui/dropdown/Dropdown";
import { GAP, PAD, PAGE, STOCKS, perSheet, printables, sheets, type Printable, type Stock, type StockKey } from "../labels/sheet";
import { LABEL_FIELDS, labelPrefs, toSettings, type LabelPrefs } from "../labels/prefs";

/**
 * BARCODE LABELS — what to print on one side, the paper it lands on, on the other.
 *
 * ── What was wrong with the screen before ───────────────────────────────
 *
 * It previewed "one of each product", so nobody could say how many sheets a
 * run would take or where on the sheet a sticker would land. Its settings were
 * in two places — two switches under Settings → Barcodes, six more behind a
 * collapsed "Options" here, forgotten on every visit — so nobody printing could
 * say which were in force. And a product was ONE label: its carton, which is
 * scanned by the carton's barcode and sold at the carton's price, had none.
 *
 * So: the right-hand side is the SHEET, as it will print, one sheet at a time
 * with how many fit and how many sheets there are; every setting is on this
 * page, open, and saved for the shop; and each pack or size with a barcode of
 * its own is its own row, with its own count.
 */

/**
 * Narrowest bar a supermarket scanner reliably reads, mm. Below this the label
 * prints and looks fine, and then fails at the till — which is the worst place
 * to discover it, so we say so here instead.
 */
const MIN_X_DIM = 0.25;

/** CSS pixels in a millimetre, for fitting a 210 mm sheet into the column. */
const PX_PER_MM = 96 / 25.4;

export default function LabelsPage() {
  const money = useMoney();
  const settings = useShopSettings();
  const save = useUpdateShopSettings();
  const toast = useToast();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const shopName = useAuthStore((s) => s.user?.tenant?.business_name) ?? "";
  // Whoever prints labels need not be whoever manages Settings. Their choices
  // still print — they are simply not kept, and the page says which it is.
  const keeps = hasPermission("settings.manage");

  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [query, setQuery] = useState(params.get("search") ?? "");
  const [page, setPage] = useState(1);
  const products = useProducts({ search: query || undefined, page });
  const generate = useGenerateBarcode();

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [query]);

  // How many of each label, and the label itself — held here and not looked up
  // from the visible page, so a run built across two searches prints both halves.
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Record<string, Printable>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // The shop's saved choices, taken once they arrive; changed here.
  const [prefs, setPrefs] = useState<LabelPrefs>(() => labelPrefs(undefined));
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !settings.data) return;
    seeded.current = true;
    setPrefs(labelPrefs(settings.data));
  }, [settings.data]);

  const change = (patch: Partial<LabelPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    if (!keeps) return;
    save.mutate(toSettings(patch), {
      onError: (e) => toast.error(e instanceof Error ? e.message : "That setting was not saved."),
    });
  };

  const [fieldsOpen, setFieldsOpen] = useState(false);
  /** Shown as large as the column allows; "actual size" is the paper at 100%, scrolled. */
  const [actualSize, setActualSize] = useState(false);
  const [zoom, setZoom] = useState(1);

  /** Stickers already peeled off the first sheet. About THIS sheet of paper, so never saved. */
  const [skip, setSkip] = useState(0);
  const [sheetNo, setSheetNo] = useState(1);
  const [bulkBusy, setBulkBusy] = useState(false);

  const stock = STOCKS[prefs.stock];
  const fit = perSheet(stock);
  const rows = products.data?.data ?? [];
  const pagination = products.data?.meta.pagination;
  const missing = rows.filter((p) => !p.barcode && printables(p).length === 0);

  const queue = useMemo(
    () => Object.entries(qtys)
      .filter(([, q]) => q > 0)
      .map(([key, q]) => ({ label: picked[key], qty: q }))
      .filter((r) => !!r.label),
    [qtys, picked],
  );
  const total = queue.reduce((n, r) => n + r.qty, 0);

  /** The run: each label repeated by its count, in the order it was added. */
  const run = useMemo(() => {
    const out: Printable[] = [];
    for (const r of queue) for (let i = 0; i < r.qty; i++) out.push(r.label);
    return out;
  }, [queue]);

  // A roll is one sticker a "page"; a sheet is as many as fit.
  const paper = useMemo(
    () => (prefs.paper === "roll" ? sheets(run, 1) : sheets(run, fit.count, skip)),
    [prefs.paper, run, fit.count, skip],
  );
  const shown = Math.min(Math.max(1, sheetNo), Math.max(1, paper.length));
  useEffect(() => { if (sheetNo !== shown) setSheetNo(shown); }, [sheetNo, shown]);

  /**
   * Bars get thinner as the code gets longer and the label stays the same
   * width. Flag the ones that have crossed the line for this stock.
   */
  const tooThin = useMemo(
    () => queue.filter((r) => (stock.w - PAD * 2) / code128ModuleCount(r.label.barcode) < MIN_X_DIM),
    [queue, stock.w],
  );

  const setQty = (label: Printable, q: number) => {
    const n = Math.max(0, Math.min(999, Math.round(q)));
    setQtys((m) => {
      const next = { ...m };
      if (n === 0) delete next[label.key]; else next[label.key] = n;
      return next;
    });
    setPicked((m) => {
      if (n === 0) { const { [label.key]: _drop, ...rest } = m; return rest; }
      return { ...m, [label.key]: label };
    });
  };

  /** Clearing the box to retype must not be read as "zero" until you leave it. */
  const commitDraft = (label: Printable) => {
    const raw = drafts[label.key];
    setDrafts((d) => { const { [label.key]: _drop, ...rest } = d; return rest; });
    if (raw === undefined) return;
    setQty(label, raw.trim() === "" ? 0 : Number(raw));
  };

  /**
   * Barcodes for everything on this page that lacks one. The count is reported
   * either way — a partial result is a result, and it has to be stated.
   */
  const generateAll = async () => {
    if (bulkBusy || missing.length === 0) return;
    setBulkBusy(true);
    let done = 0;
    try {
      for (const p of missing) {
        await generate.mutateAsync(p.id);
        done++;
      }
      toast.success(`${done} barcode${done === 1 ? "" : "s"} generated`);
    } catch (e) {
      toast.error(
        done === 0
          ? `Couldn't generate barcodes. ${e instanceof Error ? e.message : ""}`.trim()
          : `Stopped after ${done} of ${missing.length}. ${e instanceof Error ? e.message : ""}`.trim(),
      );
    } finally {
      setBulkBusy(false);
    }
  };

  if (!hasPermission("products.manage")) {
    return <Alert variant="error" title="No access" message="You don't have permission to manage the catalog." />;
  }

  const printCss = prefs.paper === "roll"
    ? `@page { size: ${stock.w}mm ${stock.h}mm; margin: 0; }`
    : `@page { size: A4; margin: ${PAGE.margin}mm; }`;

  const stepper = (label: Printable) => {
    const q = qtys[label.key] ?? 0;
    return (
      <div className="flex shrink-0 items-center gap-1">
        <button
          className="h-8 w-8 rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/10"
          onClick={() => setQty(label, q - 1)}
          disabled={q === 0}
          aria-label={`One fewer ${label.name} label`}
        >
          −
        </button>
        <input
          className="h-8 w-12 rounded-lg border border-gray-200 bg-white text-center text-sm tabular-nums text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          value={drafts[label.key] ?? String(q)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDrafts((d) => ({ ...d, [label.key]: e.target.value.replace(/\D/g, "") }))}
          onBlur={() => commitDraft(label)}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          aria-label={`Labels for ${label.name}`}
        />
        <button
          className="h-8 w-8 rounded-lg bg-brand-500 text-white transition hover:bg-brand-600"
          onClick={() => setQty(label, q + 1)}
          aria-label={`One more ${label.name} label`}
        >
          +
        </button>
      </div>
    );
  };

  const card = (label: Printable, key: string) => (
    <LabelCard key={key} label={label} stock={stock} prefs={prefs} shopName={shopName} money={money} />
  );

  return (
    <>
      <PageMeta title="Barcode Labels" description="Generate and print barcode labels" />

      <style>{`
        #label-sheet { display: none; }
        @media print {
          ${printCss}
          body * { visibility: hidden; }
          #label-sheet, #label-sheet * { visibility: visible; }
          #label-sheet { display: block !important; position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          .lbl { break-inside: avoid; }
          .paper-page { break-after: page; }
          .paper-page:last-child { break-after: auto; }
        }
      `}</style>

      <div className="no-print mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/tenant/products" className="text-theme-xs text-gray-500 hover:text-brand-500">← Products</Link>
          <h2 className="mt-0.5 text-xl font-semibold text-gray-800 dark:text-white/90">Barcode labels</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Say how many of each on the left. The paper on the right is what will print.</p>
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

      {/* The list is as wide as a name and a count need, and no wider: every
          pixel past that is the sheet's, so it is shown as near to its real
          size as the screen allows. */}
      {/* Split from `lg`, not `xl`: a tablet held sideways is 1024 wide, and
          stacked there the sheet scrolls away from the list that fills it. */}
      <div className="no-print flex flex-col items-start gap-5 lg:flex-row">
        {/* ── What to print ────────────────────────────────────── */}
        <section className="w-full shrink-0 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] lg:w-[300px] xl:w-[340px]">
          <div className="p-4">
            <Input aria-label="Search products" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {/* What's queued, always in view — including labels from a search you've since left. */}
          {queue.length > 0 && (
            <div data-testid="label-queue" className="border-y border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-white/[0.02]">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-theme-xs font-medium uppercase tracking-wide text-gray-400">
                  {total} label{total > 1 ? "s" : ""} to print
                </span>
                <button className={ROW_ACTION_DANGER} onClick={() => { setQtys({}); setPicked({}); setDrafts({}); }}>
                  Clear
                </button>
              </div>
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {queue.map((r) => (
                  <div key={r.label.key} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200">{r.label.name}</span>
                    {stepper(r.label)}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-[30rem] space-y-0.5 overflow-y-auto p-2">
            {products.isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
              ))
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-400">No products match.</p>
            ) : (
              rows.map((p) => {
                const labels = printables(p);
                const own = labels.find((l) => l.part === null);
                const parts = labels.filter((l) => l.part !== null);
                const any = labels.some((l) => (qtys[l.key] ?? 0) > 0);

                return (
                  <div key={p.id} className={`rounded-lg px-2.5 py-2 transition ${any ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-gray-800 dark:text-white/90">{p.name}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-theme-xs text-gray-400">
                          <span className="tabular-nums">{money(p.price)}</span>
                          {p.barcode ? (
                            <span className="truncate font-mono">{p.barcode}</span>
                          ) : parts.length > 0 ? (
                            <span>labels by size or pack</span>
                          ) : (
                            <span className="text-warning-600 dark:text-warning-400">no barcode</span>
                          )}
                        </div>
                      </div>

                      {own ? (
                        stepper(own)
                      ) : parts.length === 0 ? (
                        <button
                          className="shrink-0 rounded-lg border border-brand-500 px-2.5 py-1.5 text-theme-xs font-medium text-brand-600 transition hover:bg-brand-50 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
                          onClick={() =>
                            generate.mutate(p.id, {
                              onSuccess: () => toast.success(`Barcode generated for ${p.name}`),
                              onError: (e) =>
                                toast.error(e instanceof Error ? e.message : `Couldn't generate a barcode for ${p.name}.`),
                            })
                          }
                          disabled={generate.isPending || bulkBusy}
                        >
                          Generate
                        </button>
                      ) : null}
                    </div>

                    {/* Each pack and size that has a barcode of its own is its
                        own sticker: a carton is scanned by the carton's code. */}
                    {parts.map((l) => (
                      <div key={l.key} className="mt-1.5 flex items-center gap-3 border-l-2 border-gray-200 pl-3 dark:border-gray-700">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-theme-sm text-gray-700 dark:text-gray-200">{l.part}</div>
                          <div className="flex items-center gap-2 text-theme-xs text-gray-400">
                            <span className="tabular-nums">{money(l.price)}</span>
                            <span className="truncate font-mono">{l.barcode}</span>
                          </div>
                        </div>
                        {stepper(l)}
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>

          <Pager pagination={pagination} onPage={setPage} noun="items" />
        </section>

        {/* ── The paper ────────────────────────────────────────── */}
        <div className="w-full min-w-0 flex-1 space-y-4">
          <section data-testid="label-settings" className="rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-white/[0.03]">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className={CAPTION}>Sticker size</span>
                <select aria-label="Sticker size" value={prefs.stock} onChange={(e) => change({ stock: e.target.value as StockKey })} className={SELECT}>
                  {(Object.keys(STOCKS) as StockKey[]).map((k) => (
                    <option key={k} value={k}>{STOCKS[k].label} mm — {STOCKS[k].hint}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={CAPTION}>Printed on</span>
                <select aria-label="Printed on" value={prefs.paper} onChange={(e) => change({ paper: e.target.value === "roll" ? "roll" : "sheet" })} className={SELECT}>
                  <option value="sheet">A4 sheet of stickers</option>
                  <option value="roll">Label roll</option>
                </select>
              </label>

              {/* Six things a label may carry, several at once — so a list of
                  ticks, not a list of one. The button says how it stands. */}
              <div className="relative">
                <span className={CAPTION}>On each label</span>
                <button
                  type="button"
                  aria-haspopup="true"
                  aria-expanded={fieldsOpen}
                  onClick={() => setFieldsOpen((v) => !v)}
                  className={`dropdown-toggle flex items-center justify-between gap-2 text-left ${SELECT}`}
                  data-testid="label-fields"
                >
                  <span className="truncate">{LABEL_FIELDS.filter((f) => prefs[f.key]).map((f) => f.label).join(", ") || "Barcode only"}</span>
                  <span aria-hidden="true">▾</span>
                </button>
                <Dropdown isOpen={fieldsOpen} onClose={() => setFieldsOpen(false)} className="left-0 mt-1 w-56 p-2">
                  {LABEL_FIELDS.map((f) => (
                    <label key={f.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-theme-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={prefs[f.key]}
                        onChange={() => change({ [f.key]: !prefs[f.key] })}
                        className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-400"
                      />
                      {f.label}
                    </label>
                  ))}
                </Dropdown>
              </div>

              {prefs.paper === "sheet" && (
                <label className="block">
                  <span className={CAPTION}>Used stickers to skip</span>
                  <input
                    type="number"
                    min={0}
                    max={fit.count - 1}
                    value={skip}
                    aria-label="Stickers already used on the first sheet"
                    onChange={(e) => setSkip(Math.max(0, Math.min(fit.count - 1, Number(e.target.value) || 0)))}
                    className={`w-24 tabular-nums ${SELECT}`}
                  />
                </label>
              )}
            </div>

            {/* WHICH settings are in force, said — the whole reason these are
                on this page and not under Settings. */}
            <p data-testid="label-settings-state" className="mt-2.5 text-theme-xs text-gray-500 dark:text-gray-400">
              {!keeps
                ? "For this print only — your shop's saved label settings are changed by whoever manages Settings."
                : save.isPending
                  ? "Saving…"
                  : "Saved for your shop — every label prints this way until you change it here."}
            </p>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
              {/* How many fit, how many there are, how many sheets that is. */}
              <p data-testid="label-count" className="text-theme-sm text-gray-700 dark:text-gray-200">
                {prefs.paper === "roll" ? (
                  total === 0 ? "One sticker at a time, off a roll." : <><strong>{total}</strong> label{total === 1 ? "" : "s"} off the roll</>
                ) : (
                  <>
                    <strong>{fit.count}</strong> fit on a sheet ({fit.cols} across, {fit.rows} down)
                    {total > 0 && <> · <strong>{total}</strong> label{total === 1 ? "" : "s"} · <strong>{paper.length}</strong> sheet{paper.length === 1 ? "" : "s"}</>}
                  </>
                )}
              </p>

              <div className="flex flex-wrap items-center gap-3">
                {/* The sheet at its real size where the screen has room for
                    it; where it has not, as large as fits — and one press
                    from real size, scrolled. */}
                {prefs.paper === "sheet" && total > 0 && (zoom < 0.995 || actualSize) && (
                  <button
                    type="button"
                    onClick={() => setActualSize((v) => !v)}
                    aria-pressed={actualSize}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-theme-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                  >
                    {actualSize ? "Fit to screen" : `Actual size (shown at ${Math.round(zoom * 100)}%)`}
                  </button>
                )}

                {paper.length > 1 && (
                  <div className="flex items-center gap-1.5" role="group" aria-label={prefs.paper === "roll" ? "Which label" : "Which sheet"}>
                    <button
                      type="button"
                      className="h-8 w-8 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
                      onClick={() => setSheetNo(shown - 1)}
                      disabled={shown <= 1}
                      aria-label={prefs.paper === "roll" ? "Previous label" : "Previous sheet"}
                    >
                      ‹
                    </button>
                    <span data-testid="label-page" className="min-w-[7.5rem] text-center text-theme-sm tabular-nums text-gray-700 dark:text-gray-200">
                      {prefs.paper === "roll" ? "Label" : "Sheet"} {shown} of {paper.length}
                    </span>
                    <button
                      type="button"
                      className="h-8 w-8 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
                      onClick={() => setSheetNo(shown + 1)}
                      disabled={shown >= paper.length}
                      aria-label={prefs.paper === "roll" ? "Next label" : "Next sheet"}
                    >
                      ›
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4">
              {total === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Nothing to print yet.</p>
                  <p className="mt-1 text-theme-xs text-gray-400">
                    Add labels with <span className="font-semibold">+</span> on the left and the sheet fills up here.
                  </p>
                </div>
              ) : prefs.paper === "roll" ? (
                <div className="flex justify-center overflow-x-auto rounded-xl bg-gray-100 p-6 dark:bg-gray-900/60">
                  <div data-testid="label-paper" className="bg-white shadow-sm">
                    {(paper[shown - 1] ?? []).map((l, i) => (l ? card(l, `${l.key}-${i}`) : null))}
                  </div>
                </div>
              ) : (
                <SheetPreview actualSize={actualSize} onScale={setZoom}>
                  <div
                    data-testid="label-paper"
                    className="grid content-start"
                    style={{
                      gridTemplateColumns: `repeat(${fit.cols}, ${stock.w}mm)`,
                      gridAutoRows: `${stock.h}mm`,
                      gap: `${GAP}mm`,
                      padding: `${PAGE.margin}mm`,
                    }}
                  >
                    {(paper[shown - 1] ?? []).map((l, i) =>
                      l ? card(l, `${l.key}-${i}`) : (
                        // A sticker already peeled off: nothing prints here.
                        <div key={`used-${i}`} data-used className="rounded-sm border border-dashed border-gray-300 bg-gray-50" />
                      ),
                    )}
                  </div>
                </SheetPreview>
              )}
            </div>

            {tooThin.length > 0 && (
              <p className="mx-4 mb-4 rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-400">
                {tooThin.length === 1 ? `${tooThin[0].label.name}'s barcode is` : `${tooThin.length} barcodes are`}{" "}
                too long for a {stock.label} mm sticker — the bars print too thin to scan. Pick a wider size.
              </p>
            )}
          </section>
        </div>
      </div>

      {/* Print-only — the same sheets the preview pages through, every one of them. */}
      <div id="label-sheet">
        {paper.map((labels, n) => (
          <div className="paper-page" key={n}>
            {prefs.paper === "roll" ? (
              labels.map((l, i) => (l ? card(l, `${l.key}-${n}-${i}`) : null))
            ) : (
              <div
                className="grid content-start"
                style={{ gridTemplateColumns: `repeat(${fit.cols}, ${stock.w}mm)`, gridAutoRows: `${stock.h}mm`, gap: `${GAP}mm` }}
              >
                {labels.map((l, i) => (l ? card(l, `${l.key}-${n}-${i}`) : <div key={`used-${n}-${i}`} />))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

const CAPTION = "mb-1 block text-theme-xs font-medium text-gray-500 dark:text-gray-400";
const SELECT =
  "h-10 min-w-[11rem] max-w-[16rem] rounded-lg border border-gray-300 bg-white px-3 text-theme-sm text-gray-800 focus:border-brand-400 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/**
 * An A4 sheet, drawn at its true size — and only made smaller where the screen
 * has not the room for it.
 *
 * Laid out in real millimetres and then scaled as a whole, so where a sticker
 * sits in the preview is where it sits on the paper: a preview laid out in its
 * own units is a second layout, and two layouts drift. `actualSize` is the
 * paper at 100% whatever the room, scrolled inside its frame.
 */
function SheetPreview({ actualSize, onScale, children }: { actualSize: boolean; onScale: (scale: number) => void; children: React.ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(1);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;

    // 24 px of grey round the sheet, so it reads as paper on a desk.
    const measure = () => setFits(Math.min(1, (el.clientWidth - 24) / (PAGE.w * PX_PER_MM)));
    measure();

    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  useEffect(() => onScale(fits), [fits, onScale]);

  const scale = actualSize ? 1 : fits;

  return (
    <div ref={frame} data-testid="label-frame" className={`rounded-xl bg-gray-100 p-3 dark:bg-gray-900/60 ${actualSize ? "overflow-auto" : "overflow-hidden"}`}>
      <div className="mx-auto" style={{ width: `${PAGE.w * PX_PER_MM * scale}px`, height: `${PAGE.h * PX_PER_MM * scale}px` }}>
        <div
          className="origin-top-left bg-white shadow-sm"
          style={{ width: `${PAGE.w}mm`, height: `${PAGE.h}mm`, transform: `scale(${scale})` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function LabelCard({
  label, stock, prefs, shopName, money,
}: {
  label: Printable;
  stock: Stock;
  prefs: LabelPrefs;
  shopName: string;
  money: (n: string | number) => string;
}) {
  const pack = prefs.pack ? label.packLine : null;
  const head = (prefs.shop && shopName) || prefs.name;

  return (
    <div
      className={`lbl flex flex-col justify-between overflow-hidden bg-white text-center text-black ${
        prefs.cut ? "border border-gray-300" : ""
      }`}
      style={{ width: `${stock.w}mm`, height: `${stock.h}mm`, padding: `${PAD}mm` }}
    >
      {head ? (
        <div className="min-h-0">
          {prefs.shop && shopName && (
            <div className="truncate uppercase leading-none" style={{ fontSize: `${stock.meta}pt`, letterSpacing: "0.08em" }}>
              {shopName}
            </div>
          )}
          {prefs.name && (
            <div
              className={`font-medium ${stock.lines === 1 ? "line-clamp-1" : "line-clamp-2"}`}
              style={{ fontSize: `${stock.name}pt`, lineHeight: 1.15 }}
            >
              {label.name}
            </div>
          )}
        </div>
      ) : (
        <div />
      )}

      <div className="min-h-0">
        <div style={{ height: `${stock.bar}mm` }} dangerouslySetInnerHTML={{ __html: code128BarsSvg(label.barcode) }} />
        {prefs.digits && (
          <div className="font-mono leading-none" style={{ fontSize: `${stock.meta}pt`, letterSpacing: "0.06em" }}>
            {label.barcode}
          </div>
        )}
      </div>

      {(prefs.price || pack) && (
        <div className="flex items-baseline justify-center gap-1 leading-none">
          {prefs.price && (
            <span className="font-bold tabular-nums" style={{ fontSize: `${stock.price}pt` }}>
              {money(label.price)}
              {label.perUnit && <span className="font-normal" style={{ fontSize: `${stock.meta}pt` }}>{label.perUnit}</span>}
            </span>
          )}
          {prefs.price && label.was != null && (
            <span className="text-gray-500 line-through" style={{ fontSize: `${stock.meta}pt` }}>{money(label.was)}</span>
          )}
          {pack && (
            <span className="ml-auto truncate text-gray-600" style={{ fontSize: `${stock.meta}pt` }}>
              {pack}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
