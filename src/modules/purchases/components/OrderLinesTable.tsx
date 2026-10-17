import { useState, type ReactNode } from "react";

import Input from "../../../components/form/input/InputField";
import Button from "../../../components/ui/button/Button";
import { ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import { useNarrow } from "../../../common/hooks/useNarrow";
import { useMoney } from "../../shop/hooks/useShop";
import { draftTotal, lineAmount, lineIsWrong, withQuantityForAll, type DraftLine } from "../orderDraft";

/**
 * THE ORDER ITSELF — every line, each box named.
 *
 * The user, 2026-10-17: "quantity aur price ka title b hona chahye" — two bare
 * number boxes side by side, and nothing said which was which. Each column has
 * its heading now, each box its own name, and the line's amount is shown
 * beside it so a cost typed into the quantity box is seen at once. One
 * quantity can be given to every line ("10 of each") and then changed line by
 * line.
 */
export function OrderLinesTable({ lines, onChange }: { lines: DraftLine[]; onChange: (lines: DraftLine[]) => void }) {
  const money = useMoney();
  const narrow = useNarrow(640);
  const [forAll, setForAll] = useState("");

  const set = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  if (lines.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-gray-300 p-4 text-center text-theme-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Nothing on this order yet — tick items above, or search for one below.
      </p>
    );
  }

  const remove = (key: string) => onChange(lines.filter((x) => x.key !== key));

  return (
    <section aria-label="This order" className="rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3 dark:border-gray-800">
        <h4 className="mr-auto text-sm font-semibold text-gray-800 dark:text-white/90">
          This order <span className="font-normal text-gray-400">· {lines.length} {lines.length === 1 ? "item" : "items"}</span>
        </h4>
        <label className="flex items-center gap-2 text-theme-xs text-gray-500 dark:text-gray-400">
          Quantity for every line
          <span className="w-20">
            <Input type="number" min="1" value={forAll} onChange={(e) => setForAll(e.target.value)} aria-label="Quantity for every line" />
          </span>
        </label>
        <Button size="sm" variant="outline" disabled={!(Number(forAll) > 0)} onClick={() => { onChange(withQuantityForAll(lines, Number(forAll))); setForAll(""); }}>
          Apply
        </Button>
      </div>

      {narrow ? (
        // A phone has no room for five columns side by side — the table
        // scrolled sideways and hid the cost. Each line is a card instead,
        // every box with its name written above it.
        <ul className="max-h-[28rem] divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
          {lines.map((l) => (
            <li key={l.key} data-testid="order-line" className={`space-y-2 p-3 ${lineIsWrong(l) ? "bg-error-50/60 dark:bg-error-500/[0.06]" : ""}`}>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-theme-sm text-gray-800 dark:text-white/90">{l.label}</span>
                <RemoveLine line={l} onRemove={remove} />
              </div>
              {l.units.length > 0 && (
                <Named name="Unit"><UnitSelect line={l} onSet={set} /></Named>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Named name="Quantity"><QuantityBox line={l} onSet={set} /></Named>
                <Named name="Cost each"><CostBox line={l} onSet={set} /></Named>
              </div>
              <div className="flex items-center justify-between text-theme-sm">
                <span className="text-theme-xs text-gray-500 dark:text-gray-400">Amount</span>
                <span className="font-medium tabular-nums text-gray-800 dark:text-white/90">{money(lineAmount(l))}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full min-w-[680px] text-left text-theme-sm">
            <thead className="sticky top-0 bg-white dark:bg-gray-900">
              <tr className="border-b border-gray-100 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="w-44 px-3 py-2 font-medium">Unit</th>
                <th className="w-28 px-3 py-2 font-medium">Quantity</th>
                <th className="w-32 px-3 py-2 font-medium">Cost each</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Amount</th>
                <th className="w-10 px-2 py-2"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {lines.map((l) => (
                <tr key={l.key} data-testid="order-line" className={lineIsWrong(l) ? "bg-error-50/60 dark:bg-error-500/[0.06]" : ""}>
                  <td className="px-3 py-2 text-gray-800 dark:text-white/90">{l.label}</td>
                  <td className="px-3 py-2">
                    {l.units.length > 0 ? <UnitSelect line={l} onSet={set} /> : <span className="text-theme-xs text-gray-400">Each</span>}
                  </td>
                  <td className="px-3 py-2"><QuantityBox line={l} onSet={set} /></td>
                  <td className="px-3 py-2"><CostBox line={l} onSet={set} /></td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-800 dark:text-white/90">{money(lineAmount(l))}</td>
                  <td className="px-2 py-2 text-right"><RemoveLine line={l} onRemove={remove} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-gray-100 px-3 py-3 dark:border-gray-800">
        <span className="text-sm text-gray-500 dark:text-gray-400">Total</span>
        <span className="text-lg font-bold tabular-nums text-gray-800 dark:text-white/90" data-testid="order-total">{money(draftTotal(lines))}</span>
      </div>
    </section>
  );
}

type LineSetter = (key: string, patch: Partial<DraftLine>) => void;

/** A box's name written above it — on a phone there is no column heading to say it. */
function Named({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-theme-xs text-gray-500 dark:text-gray-400" aria-hidden="true">{name}</span>
      {children}
    </div>
  );
}

/** Bought by the pack or by the piece — stock lands in pieces either way. */
function UnitSelect({ line, onSet }: { line: DraftLine; onSet: LineSetter }) {
  return (
    <select
      aria-label={`Unit for ${line.label}`}
      value={line.product_unit_id ?? ""}
      onChange={(e) => onSet(line.key, { product_unit_id: e.target.value || null })}
      className="h-11 w-full rounded-lg border border-gray-200 bg-transparent px-2 text-theme-sm text-gray-700 focus:outline-hidden dark:border-gray-700 dark:text-gray-200"
    >
      <option value="">Each</option>
      {line.units.map((u) => <option key={u.id} value={u.id}>{u.name} (×{Number(u.factor)})</option>)}
    </select>
  );
}

function QuantityBox({ line, onSet }: { line: DraftLine; onSet: LineSetter }) {
  return <Input aria-label={`Quantity of ${line.label}`} type="number" min="1" value={String(line.quantity)} onChange={(e) => onSet(line.key, { quantity: Number(e.target.value) })} />;
}

function CostBox({ line, onSet }: { line: DraftLine; onSet: LineSetter }) {
  return <Input aria-label={`Cost each for ${line.label}`} type="number" min="0" value={String(line.unit_cost)} onChange={(e) => onSet(line.key, { unit_cost: Number(e.target.value) })} />;
}

function RemoveLine({ line, onRemove }: { line: DraftLine; onRemove: (key: string) => void }) {
  return <button type="button" aria-label={`Remove ${line.label}`} className={ROW_ACTION_DANGER} onClick={() => onRemove(line.key)}>✕</button>;
}
