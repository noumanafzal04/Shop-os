/**
 * A number pad for a till with no keyboard.
 *
 * The POS is a web app, and a great many of these counters will run it on a
 * cheap Android tablet bolted to a stand. On one of those, every numeric field
 * — a tender, a quantity, a weight — depends on the OS keyboard appearing,
 * which on a locked-down kiosk browser it often does not, and which in any case
 * covers half the screen the cashier is reading. Until now there was no other
 * way to enter a number: the till simply could not be operated by touch.
 *
 * Deliberately plain. Big targets, one job each, and no cleverness about
 * decimals — a weight is `1.250` and the cashier types exactly that. The dot is
 * suppressed once the value already has one, because a second dot produces
 * `NaN` and the field would silently read as zero.
 *
 * Value in, value out, as a string: the caller owns the state and the parsing,
 * exactly as it does for the text input this sits beside.
 */
export function NumPad({
  value,
  onChange,
  onSubmit,
  submitLabel,
  disabled,
  allowDecimal = true,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  /** Wired to the big confirm key. Omit it and the key isn't drawn. */
  onSubmit?: () => void;
  submitLabel?: string;
  disabled?: boolean;
  /** A quantity of units has no decimal; a weight does. */
  allowDecimal?: boolean;
  className?: string;
}) {
  const press = (key: string) => {
    if (key === "." && (!allowDecimal || value.includes("."))) return;
    // A leading dot is a typo waiting to become NaN.
    if (key === "." && value === "") return onChange("0.");
    // "007" is nobody's intention.
    if (value === "0" && key !== ".") return onChange(key);
    onChange(value + key);
  };

  const keyClass =
    "flex h-12 items-center justify-center rounded-xl border border-gray-200 bg-white text-lg font-semibold tabular-nums text-gray-800 transition-colors active:bg-brand-50 active:border-brand-400 disabled:opacity-40 dark:border-gray-700 dark:bg-white/[0.03] dark:text-white/90 dark:active:bg-brand-500/10";

  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
        <button key={k} type="button" disabled={disabled} onClick={() => press(k)} className={keyClass}>
          {k}
        </button>
      ))}

      <button
        type="button"
        disabled={disabled || !allowDecimal}
        onClick={() => press(".")}
        className={keyClass}
        aria-label="Decimal point"
      >
        .
      </button>
      <button type="button" disabled={disabled} onClick={() => press("0")} className={keyClass}>
        0
      </button>
      {/* Backspace, not clear. A cashier who mistypes the last digit of a
          five-digit tender should not have to key the whole thing again — and
          holding it down to empty the field is one gesture either way. */}
      <button
        type="button"
        disabled={disabled || value === ""}
        onClick={() => onChange(value.slice(0, -1))}
        className={keyClass}
        aria-label="Delete last digit"
      >
        ⌫
      </button>

      {onSubmit && (
        <button
          type="button"
          disabled={disabled}
          onClick={onSubmit}
          className="col-span-3 flex h-12 items-center justify-center rounded-xl bg-brand-500 text-base font-semibold text-white transition-colors active:bg-brand-600 disabled:opacity-40"
        >
          {submitLabel ?? "Done"}
        </button>
      )}
    </div>
  );
}
