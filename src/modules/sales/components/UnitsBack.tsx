import type { SoldUnit, WhichUnits } from "../unitsBack";

/**
 * Under a line that is being handed back: which of its numbered units.
 *
 * Drawn only where there is something to say. A grocery line never sees it; a
 * phone that was the only one on its bill sees a single line telling the
 * cashier the number is going back on the shelf; one phone of two gets the
 * question — and the sheet will not take the return until it is answered.
 */
export function UnitsBack({
  name,
  out,
  which,
  ticked,
  onToggle,
}: {
  name: string;
  out: SoldUnit[];
  which: WhichUnits;
  ticked: string[];
  onToggle: (serial: string) => void;
}) {
  if (which.mode === "none") return null;

  if (which.mode === "all") {
    return (
      <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400" data-testid="units-back-all">
        Back on the shelf by number:{" "}
        <span className="font-mono text-gray-700 dark:text-gray-300">{out.map((u) => u.serial).join(", ")}</span>
      </p>
    );
  }

  const short = ticked.length < which.atLeast;

  return (
    <fieldset className="mt-1.5 rounded-lg border border-warning-200 bg-warning-25 px-3 py-2 dark:border-warning-500/30 dark:bg-warning-500/10" data-testid="units-back-pick">
      <legend className="px-1 text-theme-xs font-medium text-warning-700 dark:text-warning-300">
        Which unit of {name} came back?
      </legend>
      <div className="space-y-1">
        {out.map((u) => (
          <label key={u.id} className="flex cursor-pointer items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={ticked.includes(u.serial)}
              // No more ticks than units coming back — the next tick would be a lie.
              disabled={!ticked.includes(u.serial) && ticked.length >= which.atMost}
              onChange={() => onToggle(u.serial)}
              className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            />
            <span className="font-mono">{u.serial}</span>
          </label>
        ))}
      </div>
      <p className={`mt-1.5 text-theme-xs ${short ? "text-warning-700 dark:text-warning-300" : "text-gray-500 dark:text-gray-400"}`}>
        {short
          ? `Tick ${which.atLeast === 1 ? "the one" : `the ${which.atLeast}`} that came back — its number goes back on the shelf and off the customer's warranty.`
          : which.atLeast === 0 && ticked.length === 0
            ? "Leave these unticked only if what came back is the unit that was sold without a number."
            : "That number goes back on the shelf, and off the customer's warranty."}
      </p>
    </fieldset>
  );
}
