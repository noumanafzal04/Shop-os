import { useState } from "react";

import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import {
  fillAll,
  regenerate,
  whatIsMissing,
  type Axis,
  type MatrixRow,
} from "../variantMatrix";

/**
 * NAME THE AXES, AND THE SIZES FALL OUT.
 *
 * What this replaces: a bare "+ Add variant" button over rows of four unlabelled
 * boxes. For a garment shop that is 3 colours × 4 sizes typed by hand — twelve
 * "Colour / Size" strings that had to stay byte-identical from memory, twelve
 * copies of the same price, and no column headers past the first row, because the
 * only thing naming those boxes was a placeholder that clears on the first
 * keystroke.
 *
 * (And it could not be used at all: "+ Add variant" had no `type`, so inside a
 * `<form onSubmit>` it submitted — creating the product with zero variants and
 * closing the drawer. Every variant in the system had come in through the API.)
 *
 * ── The shape, and where each part comes from ────────────────────────────
 *
 * Nothing here is invented. The panel already had every piece:
 *
 *   the table with real `<th>` headers   ← the stock count sheet, which is the
 *                                          only editor here that keeps its column
 *                                          names visible past row one
 *   generated rows from a count          ← the till's serial capture
 *   "set this on every size"             ← the staff form's Select all, including
 *                                          its habit of disabling when it would
 *                                          be a no-op
 *   a name on every small input          ← the shift-count denomination grid:
 *                                          `How many 1,000 notes`, not "0"
 *
 * ── One axis or two ─────────────────────────────────────────────────────
 *
 * A pizza has one (Small, Medium, Large). A drink has one (500ml, 1L). A shirt
 * has two, and two is where hand-typing stops being reasonable. Three is allowed
 * and deliberately not encouraged — 3 × 3 × 3 is twenty-seven rows, which is a
 * spreadsheet, not a form.
 */

/**
 * One-tap values, by what the axis is called.
 *
 * The axis NAMES already exist per trade — `BusinessTypes::VARIANT_ATTRIBUTES`
 * gives a diner "Size · Flavor", a chemist "Strength · Pack Size", a tyre shop
 * "Size · Brand · Load Rating". They were being spent on one line of grey hint
 * text. These are the values that go with them, so a shop taps rather than types.
 *
 * Colour and Flavor are deliberately absent: a shop's colours are its own and a
 * guessed list would be wrong in a way that looks authoritative.
 */
const SUGGESTED: Record<string, string[]> = {
  size: ["S", "M", "L", "XL", "XXL"],
  volume: ["250ml", "500ml", "1L", "1.5L", "2.25L"],
  weight: ["250g", "500g", "1kg", "5kg"],
  strength: ["250mg", "500mg", "650mg"],
  "pack size": ["Single", "Pack of 6", "Pack of 12", "Carton"],
  duration: ["30 min", "45 min", "1 hour"],
  grade: ["Petrol", "Hi-Octane", "Diesel"],
};

/** A food shop's "Size" means something different from a shirt's. */
const FOOD_SIZES = ["Small", "Medium", "Large"];

interface Props {
  axes: Axis[];
  onAxes: (axes: Axis[]) => void;
  rows: MatrixRow[];
  onRows: (rows: MatrixRow[]) => void;
  /** Axis names this trade usually varies — from the shop's business type. */
  suggestedNames: string[];
  /** The product's own price, used as the starting price for a new size. */
  basePrice: number | string;
  /** Whether a stock column is worth showing at all. */
  tracksStock: boolean;
  /** Server-side error for `variants.{i}.{field}`, if the save was refused. */
  err: (path: string) => string | undefined;
  /** A dish's sizes read Small/Medium/Large, not S/M/L. */
  isFood?: boolean;
}

export default function VariantMatrixEditor({
  axes, onAxes, rows, onRows, suggestedNames, basePrice, tracksStock, err, isFood = false,
}: Props) {
  const [bulkPrice, setBulkPrice] = useState("");
  const missing = whatIsMissing(rows);

  const setAxis = (i: number, patch: Partial<Axis>) => {
    const next = axes.map((a, j) => (j === i ? { ...a, ...patch } : a));
    onAxes(next);
    onRows(regenerate(next, rows, basePrice));
  };

  const addAxis = () => {
    // The trade's next unused suggestion, so the common case is one tap.
    const taken = new Set(axes.map((a) => a.name.toLowerCase()));
    const name = suggestedNames.find((n) => !taken.has(n.toLowerCase())) ?? "";
    onAxes([...axes, { name, values: [] }]);
  };

  const dropAxis = (i: number) => {
    const next = axes.filter((_, j) => j !== i);
    onAxes(next);
    onRows(regenerate(next, rows, basePrice));
  };

  const addValue = (i: number, raw: string) => {
    // Comma or Enter, because a shop pasting "Red, Blue, Black" means three.
    const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length === 0) return;
    setAxis(i, { values: [...axes[i].values, ...values] });
  };

  const suggestionsFor = (name: string): string[] => {
    const key = name.trim().toLowerCase();
    if (key === "size" && isFood) return FOOD_SIZES;

    return SUGGESTED[key] ?? [];
  };

  return (
    <div>
      {/* ── the axes ───────────────────────────────────────────────── */}
      <p className="mb-3 text-theme-xs text-gray-500 dark:text-gray-400">
        {suggestedNames.length > 0
          ? `Shops like yours usually vary: ${suggestedNames.join(" · ")}.`
          : "Name what varies, then list the values."}
      </p>

      <div className="space-y-3">
        {axes.map((axis, i) => (
          <div key={i} className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
            <div className="mb-2 flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor={`axis-name-${i}`}>What varies</Label>
                <Input
                  id={`axis-name-${i}`}
                  value={axis.name}
                  onChange={(e) => setAxis(i, { name: e.target.value })}
                  placeholder="Colour"
                  list={`axis-suggestions-${i}`}
                />
                <datalist id={`axis-suggestions-${i}`}>
                  {suggestedNames.map((n) => <option key={n} value={n} />)}
                </datalist>
              </div>
              <button
                type="button"
                aria-label={`Remove the ${axis.name || "unnamed"} option`}
                className={ROW_ACTION_DANGER}
                onClick={() => dropAxis(i)}
              >
                ✕
              </button>
            </div>

            {/* The values, as chips. A chip is removable at a glance; a
                comma-separated string in one box is not. */}
            {axis.values.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {axis.values.map((v, vi) => (
                  <span
                    key={`${v}-${vi}`}
                    className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-theme-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                  >
                    {v}
                    <button
                      type="button"
                      aria-label={`Remove ${v}`}
                      className="text-brand-400 transition hover:text-brand-700 dark:hover:text-brand-200"
                      onClick={() => setAxis(i, { values: axis.values.filter((_, j) => j !== vi) })}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            <ValueBox
              axisName={axis.name}
              onAdd={(raw) => addValue(i, raw)}
            />

            {suggestionsFor(axis.name).filter((s) => !axis.values.some((v) => v.toLowerCase() === s.toLowerCase())).length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-theme-xs text-gray-400">Common:</span>
                {suggestionsFor(axis.name)
                  .filter((s) => !axis.values.some((v) => v.toLowerCase() === s.toLowerCase()))
                  .map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="rounded-md border border-gray-200 px-2 py-0.5 text-theme-xs text-gray-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-gray-700 dark:text-gray-300"
                      onClick={() => setAxis(i, { values: [...axis.values, s] })}
                    >
                      + {s}
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {axes.length < 3 && (
        <button type="button" className={`mt-2 ${ROW_ACTION}`} onClick={addAxis}>
          {axes.length === 0 ? "+ Add sizes or colours" : "+ Add another option"}
        </button>
      )}

      {/* ── the rows ───────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <p className="text-theme-xs font-medium uppercase tracking-wide text-gray-400">
              {rows.length} {rows.length === 1 ? "size" : "sizes"}
            </p>

            {/* Set one price on all of them. Disabled when it would change
                nothing, which is how the staff form's Select all behaves — a
                button that does nothing teaches people to stop pressing it. */}
            <div className="flex items-end gap-2">
              <div>
                <Label htmlFor="bulk-price">Same price for all</Label>
                <Input
                  id="bulk-price"
                  type="number"
                  min="0"
                  value={bulkPrice}
                  onChange={(e) => setBulkPrice(e.target.value)}
                  placeholder="e.g. 1200"
                  className="max-w-32"
                />
              </div>
              <button
                type="button"
                disabled={bulkPrice === ""}
                className={`${ROW_ACTION} disabled:opacity-40`}
                onClick={() => { onRows(fillAll(rows, "price", bulkPrice)); setBulkPrice(""); }}
              >
                Apply to all
              </button>
            </div>
          </div>

          {/* A real table with real headers. The old grid's only column labels
              were placeholders, so past row one nobody could tell price from
              stock — and a shirt is twelve rows deep. */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            {/* A stable handle for the browser tests. They found this by role
                first and matched the product list behind the drawer as well —
                the same lesson the till tiles learned when a test guessed at
                class names. */}
            <table data-variant-grid className="w-full min-w-[34rem] text-left text-theme-sm">
              <thead className="border-b border-gray-100 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <tr>
                  <th className="px-3 py-2">Size</th>
                  <th className="px-3 py-2">Code / barcode</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  {tracksStock && <th className="px-3 py-2 text-right">Opening stock</th>}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id ?? r.name} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                    <td className="px-3 py-2 font-medium text-gray-800 dark:text-white/90">
                      {r.name}
                      {err(`variants.${i}.name`) && (
                        <span className="block text-theme-xs text-error-500">{err(`variants.${i}.name`)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Cell
                        label={`Code for ${r.name}`}
                        value={r.sku ?? ""}
                        onChange={(v) => onRows(rows.map((x, j) => (j === i ? { ...x, sku: v } : x)))}
                        width="w-28"
                      />
                      {err(`variants.${i}.sku`) && (
                        <span className="block text-theme-xs text-error-500">{err(`variants.${i}.sku`)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Cell
                        label={`Price for ${r.name}`}
                        value={String(r.price ?? "")}
                        onChange={(v) => onRows(rows.map((x, j) => (j === i ? { ...x, price: v } : x)))}
                        numeric
                      />
                      {/* The server has always required this and refused without
                          it — and the form never rendered the error, so a blank
                          price produced a save that appeared to do nothing. */}
                      {err(`variants.${i}.price`) && (
                        <span className="block text-theme-xs text-error-500">{err(`variants.${i}.price`)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/* Accepted and stored by the server since the beginning,
                          and never offered here — so every variant fell back to
                          the parent's cost in the margin report, and the
                          "sells below cost" warning could not fire. */}
                      <Cell
                        label={`Cost for ${r.name}`}
                        value={String(r.cost ?? "")}
                        onChange={(v) => onRows(rows.map((x, j) => (j === i ? { ...x, cost: v } : x)))}
                        numeric
                      />
                    </td>
                    {tracksStock && (
                      <td className="px-3 py-2 text-right">
                        {r.id === undefined ? (
                          <Cell
                            label={`Opening stock for ${r.name}`}
                            value={String(r.stock_quantity ?? "")}
                            onChange={(v) => onRows(rows.map((x, j) => (j === i ? { ...x, stock_quantity: Number(v) || 0 } : x)))}
                            numeric
                          />
                        ) : (
                          // An existing size's quantity is changed in Inventory,
                          // not here: stock has one write path so every unit
                          // lands in the movement ledger.
                          <span className="text-theme-xs text-gray-400">in Inventory</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        aria-label={`Remove ${r.name}`}
                        className={ROW_ACTION_DANGER}
                        onClick={() => onRows(rows.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {missing !== null && (
            <p className="mt-2 text-theme-xs text-warning-500">{missing}</p>
          )}
          <p className="mt-1 text-theme-xs text-gray-400">
            A size's code is what the scanner reads — put the barcode there if each
            size has its own.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * One cell, with a name that says which row it belongs to.
 *
 * Twelve boxes all announced as "Price" is the state this replaces. The
 * denomination grid in the shift-count modal settled the rule: naming the box is
 * the difference between counting the five-hundreds and counting the fives.
 */
function Cell({
  label, value, onChange, numeric = false, width = "w-24",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
  width?: string;
}) {
  return (
    <input
      aria-label={label}
      inputMode={numeric ? "decimal" : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      className={`h-9 ${width} rounded-lg border border-gray-300 px-2 text-sm ${numeric ? "text-right tabular-nums" : ""} focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90`}
    />
  );
}

/** The box values are typed into. Enter or a comma commits; it never submits. */
function ValueBox({ axisName, onAdd }: { axisName: string; onAdd: (raw: string) => void }) {
  const [draft, setDraft] = useState("");
  const commit = () => { onAdd(draft); setDraft(""); };

  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={axisName.trim() === "" ? "Add a value" : `Add a ${axisName}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Enter must not submit the product form. That exact omission is why
          // the old "+ Add variant" button created a product with no variants.
          if (e.key === "Enter") { e.preventDefault(); commit(); }
        }}
        placeholder="Type a value and press Enter — or paste Red, Blue, Black"
        className="max-w-md"
      />
      <button type="button" disabled={draft.trim() === ""} className={`${ROW_ACTION} disabled:opacity-40`} onClick={commit}>
        Add
      </button>
    </div>
  );
}
