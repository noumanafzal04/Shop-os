import { tradeLabel } from "./format";

/**
 * A PRODUCT THAT HAS NO PHOTOGRAPH STILL HAS TO LOOK LIKE A PRODUCT.
 *
 * Most shops upload pictures for their bestsellers and nothing else, so a grid
 * that shows a grey box with a broken-image glyph for the other forty reads as
 * a broken page rather than an incomplete catalog — and the shop it belongs to
 * looks abandoned.
 *
 * So the fallback is drawn, not apologised for: a tint derived from the
 * product's own name (the same name always gets the same colour, which makes a
 * grid look arranged rather than random), the first letters, and the trade
 * underneath. It is quiet enough to sit beside real photographs without
 * competing with them.
 */
const TINTS = [
  "from-emerald-100 to-teal-50 text-emerald-700 dark:from-emerald-500/15 dark:to-teal-500/5 dark:text-emerald-300",
  "from-amber-100 to-orange-50 text-amber-700 dark:from-amber-500/15 dark:to-orange-500/5 dark:text-amber-300",
  "from-sky-100 to-indigo-50 text-sky-700 dark:from-sky-500/15 dark:to-indigo-500/5 dark:text-sky-300",
  "from-rose-100 to-pink-50 text-rose-700 dark:from-rose-500/15 dark:to-pink-500/5 dark:text-rose-300",
  "from-violet-100 to-fuchsia-50 text-violet-700 dark:from-violet-500/15 dark:to-fuchsia-500/5 dark:text-violet-300",
  "from-lime-100 to-emerald-50 text-lime-700 dark:from-lime-500/15 dark:to-emerald-500/5 dark:text-lime-300",
];

/**
 * A stable index from the name. Not `Math.random()` and not the array index —
 * both would repaint the same product a different colour on the next render or
 * the next page, which is the sort of flicker that reads as a bug.
 */
const tintFor = (seed: string): string => {
  let sum = 0;
  for (let i = 0; i < seed.length; i++) sum = (sum + seed.charCodeAt(i) * (i + 1)) % 997;

  return TINTS[sum % TINTS.length];
};

/** Up to two initials — "Chicken Biryani" → CB, "Cola" → C. */
const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "•";

export function ProductThumb({
  name,
  image,
  trade,
  className = "",
}: {
  name: string;
  image?: string | null;
  trade?: string | null;
  className?: string;
}) {
  if (image) {
    return (
      <img
        src={image}
        alt={name}
        loading="lazy"
        className={`h-full w-full object-cover transition duration-500 group-hover/card:scale-105 ${className}`}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br ${tintFor(name)} ${className}`}
    >
      <span className="text-3xl font-bold tracking-tight">{initialsOf(name)}</span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-60">
        {tradeLabel(trade)}
      </span>
    </div>
  );
}
