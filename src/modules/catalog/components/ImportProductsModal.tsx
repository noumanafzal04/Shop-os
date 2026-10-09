import { useMemo, useState, type ReactNode } from "react";

import Alert from "../../../components/ui/alert/Alert";
import Button from "../../../components/ui/button/Button";
import { Modal } from "../../../components/ui/modal";
import { useToast } from "../../../components/ui/toast";
import { downloadFile, saveBlob } from "../../../common/api/download";
import { ApiError } from "../../../common/types/api";
import { useCategories, useProductMutations } from "../hooks/useCatalog";
import {
  categoryPaths,
  choicesForServer,
  failedRowsCsv,
  goingIn,
  rowsToCorrect,
  startingChoices,
  undecided,
  type CategoryChoice,
  type ImportSummary,
} from "../importFile";

/**
 * A CATALOGUE FROM A FILE — in three steps, and nothing saved before the third.
 *
 *   1. the file            a template built for this shop, or whatever the
 *                          shop's old system exported
 *   2. the check           the import itself, run and undone on the server:
 *                          what will be added, what will change, what will not
 *                          go in and why — and the two things only a person
 *                          can answer (a heading nobody knows, a category the
 *                          shop does not have)
 *   3. the import          the same thing, kept
 *
 * It used to be one step: choose a file, press Import, read what happened. So
 * a spelling mistake in a category had already become a category, and a price
 * list had already changed every row, by the time anybody could see either.
 */
export function ImportProductsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const { importCsv } = useProductMutations();
  const categories = useCategories();
  const shelves = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);

  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ImportSummary | null>(null);
  const [done, setDone] = useState<ImportSummary | null>(null);
  const [choices, setChoices] = useState<Record<string, CategoryChoice>>({});
  /** What each unrecognised heading has been said to be. */
  const [mapping, setMapping] = useState<Record<string, string>>({});
  /** The mapping the check on screen was made with — a changed one needs checking again. */
  const [checkedWith, setCheckedWith] = useState("{}");
  const [downloading, setDownloading] = useState<string | null>(null);

  const busy = importCsv.isPending;
  const error = importCsv.error instanceof ApiError ? (importCsv.error.firstFieldError() ?? importCsv.error.message) : null;

  const startOver = () => {
    setFile(null);
    setCheck(null);
    setDone(null);
    setChoices({});
    setMapping({});
    setCheckedWith("{}");
    importCsv.reset();
  };

  const close = () => {
    startOver();
    onClose();
  };

  /**
   * The check NEVER carries the category answers — only what a column is.
   *
   * Sent with them, the server takes each answer as settled and has nothing
   * left to ask: the question vanishes from the screen, and the answer can no
   * longer be changed by the one person entitled to change it. So a check
   * always reports the categories the shop does not have, and the answers stay
   * here until Import.
   */
  const runCheck = (using = mapping) => {
    if (!file || busy) return;
    importCsv.mutate(
      { file, dryRun: true, mapping: using },
      {
        onSuccess: ({ data }) => {
          setCheck(data);
          setCheckedWith(JSON.stringify(using));
          // Keep what has been answered; start the rest where they nearly are.
          setChoices((was) => ({ ...startingChoices(data.unknown_categories), ...was }));
        },
      },
    );
  };

  const runImport = () => {
    if (!file || busy) return;
    importCsv.mutate(
      { file, mapping, categories: choicesForServer(choices) },
      {
        onSuccess: ({ data }) => {
          setDone(data);
          toast.success(`${goingIn(data)} ${goingIn(data) === 1 ? "item" : "items"} brought in`);
        },
      },
    );
  };

  const template = async (format: "xlsx" | "csv") => {
    setDownloading(format);
    try {
      await downloadFile("/products/import/template", { format }, `products-import-template.${format}`);
    } catch {
      toast.error("The template could not be downloaded.");
    } finally {
      setDownloading(null);
    }
  };

  const saveFailed = (summary: ImportSummary) =>
    saveBlob(new Blob([failedRowsCsv(rowsToCorrect(summary))], { type: "text/csv;charset=utf-8" }), "rows-to-correct.csv");

  const stale = check !== null && JSON.stringify(mapping) !== checkedWith;
  const unanswered = check ? undecided(check.unknown_categories, choices) : [];
  // Rows held up by a category go in once it has been answered — unless the
  // answer was to leave them out.
  const released = check
    ? check.unknown_categories.filter((c) => choices[c.name] && choices[c.name].action !== "skip").reduce((n, c) => n + c.rows, 0)
    : 0;
  const willGoIn = check ? goingIn(check) + released : 0;

  return (
    <Modal isOpen={isOpen} onClose={close} className="max-w-2xl p-6">
      <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Import items</h3>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        From Excel or CSV. Nothing is saved until you have seen the check and pressed Import.
      </p>

      {error && <div className="mb-3"><Alert variant="error" title="That file could not be read" message={error} /></div>}

      {/* ── 1 · the file ─────────────────────────────────────────── */}
      {!check && !done && (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-200 p-3.5 dark:border-gray-800">
              <p className="mb-1 text-theme-sm font-medium text-gray-800 dark:text-white/90">Start from a template</p>
              <p className="mb-3 text-theme-xs text-gray-500 dark:text-gray-400">
                Built for <strong>your shop</strong>: only the columns you use, with your own categories in a drop-down.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => template("xlsx")} disabled={downloading !== null}>
                  {downloading === "xlsx" ? "Preparing…" : "Excel template"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => template("csv")} disabled={downloading !== null}>
                  {downloading === "csv" ? "Preparing…" : "CSV"}
                </Button>
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 p-3.5 dark:border-gray-800">
              <p className="mb-1 text-theme-sm font-medium text-gray-800 dark:text-white/90">Or bring your old system&rsquo;s file</p>
              <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                Upload it as it is. Headings like <em>Item Name</em>, <em>Product Code</em>, <em>Selling Price</em> and{" "}
                <em>Qty</em> are understood, and you are asked about any that are not.
              </p>
            </div>
          </div>

          <ul className="mb-4 space-y-1 text-theme-xs text-gray-500 dark:text-gray-400">
            <li>• Rows are matched by <strong>SKU</strong>: one you already have is updated, a new one is added.</li>
            <li>• A <strong>blank cell leaves that detail as it is</strong> — to change prices, SKU and Price are enough.</li>
            <li>• A size or a pack is its own row, with the item&rsquo;s SKU under <strong>Parent SKU</strong>.</li>
            <li>• Up to 2,000 rows in a file. Split a longer list into several.</li>
          </ul>

          <label className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="import-file">
            The file
          </label>
          <input
            id="import-file"
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); importCsv.reset(); }}
            className="mb-5 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-600 dark:text-gray-300 dark:file:bg-brand-500/10"
          />

          <div className="flex justify-end gap-3">
            <Button size="sm" variant="outline" onClick={close}>Cancel</Button>
            <Button size="sm" onClick={() => runCheck()} disabled={!file || busy}>
              {busy ? "Checking…" : "Check the file"}
            </Button>
          </div>
        </>
      )}

      {/* ── 2 · the check ────────────────────────────────────────── */}
      {check && !done && (
        <div data-testid="import-check">
          <Figures summary={check} released={released} />

          {check.same_name > 0 && (
            <div className="mb-3">
              <Alert
                variant="warning"
                title={`${check.same_name} ${check.same_name === 1 ? "row has" : "rows have"} the name of an item you already have`}
                message="They have no SKU to match on, so they will be added again. If this is the same file sent twice, stop here."
              />
            </div>
          )}

          {check.ignored_columns.some((c) => c.unknown) && (
            <Section title="Columns we did not recognise" hint="Say what each one is, or leave it out.">
              {check.ignored_columns.filter((c) => c.unknown).map((c) => (
                <div key={c.header} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{c.header}</span>
                  <select
                    aria-label={`What the column ${c.header} is`}
                    value={mapping[c.header] ?? ""}
                    onChange={(e) => setMapping((was) => ({ ...was, [c.header]: e.target.value }))}
                    className={SELECT}
                  >
                    <option value="">Leave it out</option>
                    {Object.entries(check.fields).map(([field, name]) => (
                      <option key={field} value={field}>{name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </Section>
          )}

          {check.ignored_columns.some((c) => !c.unknown) && (
            <Section title="Columns left out">
              <ul className="space-y-1 text-theme-xs text-gray-500 dark:text-gray-400">
                {check.ignored_columns.filter((c) => !c.unknown).map((c) => (
                  <li key={c.header}><strong className="text-gray-700 dark:text-gray-300">{c.header}</strong> — {c.reason}.</li>
                ))}
              </ul>
            </Section>
          )}

          {check.unknown_categories.length > 0 && (
            <Section
              title="Categories your shop does not have"
              hint="Nothing is made up for you. Choose what each one is."
            >
              {check.unknown_categories.map((c) => {
                const choice = choices[c.name];
                const value = !choice ? "" : choice.action === "map" ? `map:${choice.id}` : choice.action;

                return (
                  <div key={c.name} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span className="text-theme-sm text-gray-800 dark:text-white/90">
                      <strong>{c.name}</strong>{" "}
                      <span className="text-theme-xs text-gray-500 dark:text-gray-400">· {c.rows} {c.rows === 1 ? "row" : "rows"}</span>
                    </span>
                    <select
                      aria-label={`What to do with the category ${c.name}`}
                      value={value}
                      onChange={(e) => {
                        const v = e.target.value;
                        setChoices((was) => {
                          const next = { ...was };
                          if (v === "") delete next[c.name];
                          else if (v === "create" || v === "skip") next[c.name] = { action: v };
                          else next[c.name] = { action: "map", id: v.slice(4) };

                          return next;
                        });
                      }}
                      className={SELECT}
                    >
                      <option value="">Choose…</option>
                      {c.suggestion && <option value={`map:${c.suggestion.id}`}>Use “{c.suggestion.path}” (closest)</option>}
                      <option value="create">Create “{c.name}”</option>
                      <option value="skip">Leave these rows out</option>
                      {shelves.filter((s) => s.id !== c.suggestion?.id).map((s) => (
                        <option key={s.id} value={`map:${s.id}`}>Use “{s.path}”</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </Section>
          )}

          <Problems summary={check} onSave={() => saveFailed(check)} />

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Button size="sm" variant="ghost" onClick={startOver} disabled={busy}>Choose another file</Button>
            <div className="flex gap-3">
              {stale && (
                <Button size="sm" variant="outline" onClick={() => runCheck()} disabled={busy}>
                  {busy ? "Checking…" : "Check again"}
                </Button>
              )}
              <Button
                size="sm"
                onClick={runImport}
                disabled={busy || stale || unanswered.length > 0 || willGoIn === 0}
              >
                {busy && !stale ? "Importing…" : `Import ${willGoIn} ${willGoIn === 1 ? "item" : "items"}`}
              </Button>
            </div>
          </div>
          {unanswered.length > 0 && (
            <p className="mt-2 text-right text-theme-xs text-warning-600 dark:text-warning-400">
              Choose what to do with {unanswered.length === 1 ? `“${unanswered[0]}”` : `${unanswered.length} categories`} first.
            </p>
          )}
          {stale && (
            <p className="mt-2 text-right text-theme-xs text-warning-600 dark:text-warning-400">
              You changed what a column is — check the file again.
            </p>
          )}
        </div>
      )}

      {/* ── 3 · done ─────────────────────────────────────────────── */}
      {done && (
        <div data-testid="import-done">
          <Figures summary={done} released={0} />
          <Problems summary={done} onSave={() => saveFailed(done)} />
          <div className="mt-5 flex justify-end gap-3">
            <Button size="sm" variant="outline" onClick={startOver}>Import another file</Button>
            <Button size="sm" onClick={close}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const SELECT =
  "h-9 max-w-[18rem] rounded-lg border border-gray-300 bg-white px-2.5 text-theme-sm text-gray-800 focus:border-brand-400 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mb-3 rounded-xl border border-gray-200 px-3.5 py-3 dark:border-gray-800">
      <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{title}</p>
      {hint && <p className="mb-1 text-theme-xs text-gray-500 dark:text-gray-400">{hint}</p>}
      <div className="mt-1 divide-y divide-gray-100 dark:divide-gray-800">{children}</div>
    </div>
  );
}

/** The counts, said the same way before and after. */
function Figures({ summary, released }: { summary: ImportSummary; released: number }) {
  const waiting = Math.max(0, summary.waiting - released);
  const tiles: Array<{ key: string; label: string; n: number; tone: string }> = [
    { key: "created", label: summary.dry_run ? "New items" : "Added", n: summary.created, tone: "text-success-600 dark:text-success-400" },
    { key: "updated", label: summary.dry_run ? "Will change" : "Changed", n: summary.updated, tone: "text-brand-600 dark:text-brand-400" },
    { key: "failed", label: summary.dry_run ? "Will not go in" : "Did not go in", n: summary.failed, tone: "text-error-600 dark:text-error-400" },
    ...(summary.dry_run ? [{ key: "waiting", label: "Waiting on you", n: waiting, tone: "text-warning-600 dark:text-warning-400" }] : []),
    ...(summary.skipped > 0 ? [{ key: "skipped", label: "Left out", n: summary.skipped, tone: "text-gray-600 dark:text-gray-300" }] : []),
  ];

  return (
    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.key} data-testid={`import-${t.key}`} className="rounded-xl border border-gray-200 px-3 py-2.5 dark:border-gray-800">
          <div className={`text-xl font-semibold tabular-nums ${t.tone}`}>{t.n}</div>
          <div className="text-theme-xs text-gray-500 dark:text-gray-400">{t.label}</div>
        </div>
      ))}
    </div>
  );
}

/** What did not go in, row by row — and the rows themselves, to correct. */
function Problems({ summary, onSave }: { summary: ImportSummary; onSave: () => void }) {
  const refused = summary.errors;
  const toCorrect = rowsToCorrect(summary).failed_rows.length;

  return (
    <>
      {refused.length > 0 && (
        <Section title={summary.dry_run ? "Rows that will not go in" : "Rows that did not go in"}>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-theme-xs text-error-600 dark:text-error-400">
            {refused.slice(0, 20).map((e) => (
              <li key={e.row}>Row {e.row}: {e.messages.join(" ")}</li>
            ))}
            {refused.length > 20 && <li>…and {refused.length - 20} more.</li>}
          </ul>
        </Section>
      )}

      {summary.warnings.length > 0 && (
        <Section title="Worth knowing">
          <ul className="max-h-28 space-y-1 overflow-y-auto text-theme-xs text-warning-700 dark:text-warning-400">
            {summary.warnings.slice(0, 15).map((w) => (
              <li key={w.row}>Row {w.row}: {w.messages.join(" ")}</li>
            ))}
            {summary.warnings.length > 15 && <li>…and {summary.warnings.length - 15} more.</li>}
          </ul>
        </Section>
      )}

      {toCorrect > 0 && (
        <button type="button" onClick={onSave} className="text-theme-sm font-medium text-brand-500 hover:text-brand-600">
          ↓ Download the {toCorrect} {toCorrect === 1 ? "row" : "rows"} to correct
        </button>
      )}
    </>
  );
}
