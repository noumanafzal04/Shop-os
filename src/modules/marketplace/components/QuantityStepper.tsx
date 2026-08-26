import { MinusIcon, PlusIcon, TrashIcon } from "./MarketIcons";

/**
 * − 2 +
 *
 * One control, used on the card, in the mini-cart, on the product page and on
 * the cart page. The alternative — each surface rolling its own — is how one of
 * them ends up letting the quantity reach zero and leaving an invisible line in
 * the basket.
 *
 * At one, the minus becomes a bin: "take it out" is what the customer means by
 * pressing minus on the last one, and a disabled minus makes them hunt for a
 * remove button that is somewhere else on the card.
 */
export function QuantityStepper({
  value,
  onChange,
  max,
  size = "md",
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  /** Nothing above this can be bought. Omitted when the shop does not track it. */
  max?: number | null;
  size?: "sm" | "md";
  /** What is being counted, for a screen reader. */
  label: string;
}) {
  const atCeiling = max !== null && max !== undefined && value >= max;

  const box = size === "sm" ? "h-8" : "h-10";
  const btn = size === "sm" ? "size-8" : "size-10";
  const glyph = size === "sm" ? "size-3.5" : "size-4";

  return (
    <div
      className={`inline-flex ${box} items-center rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-white/5`}
    >
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        aria-label={value <= 1 ? `Remove ${label}` : `One fewer ${label}`}
        className={`${btn} grid place-items-center rounded-l-xl text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white`}
      >
        {value <= 1 ? <TrashIcon className={glyph} /> : <MinusIcon className={glyph} />}
      </button>

      <span
        aria-live="polite"
        className={`min-w-8 text-center text-sm font-semibold tabular-nums text-gray-900 dark:text-white`}
      >
        {value}
      </span>

      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={atCeiling}
        aria-label={atCeiling ? `No more ${label} in stock` : `One more ${label}`}
        title={atCeiling ? "That is all the shop has" : undefined}
        className={`${btn} grid place-items-center rounded-r-xl text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white`}
      >
        <PlusIcon className={glyph} />
      </button>
    </div>
  );
}
