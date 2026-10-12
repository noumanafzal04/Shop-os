import { TruckIcon } from "../../../icons";

/**
 * DELIVERY OR PICKUP — as a badge, in its own colour, with its own picture.
 *
 * It was two grey words at the foot of a card and a column that only a wide
 * screen drew. But it is the first thing anybody packing an order needs to
 * know — does this go in a rider's bag or wait on the counter — so it is told
 * the way a stage is told: by shape and colour, readable across a kitchen.
 * The same badge on the board, in the table, and in the order's sheet.
 */
export function HowItReaches({ how, className = "" }: { how: "delivery" | "pickup"; className?: string }) {
  const delivery = how === "delivery";

  return (
    <span
      data-how={how}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-theme-xs font-semibold ${
        delivery
          ? "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-500/15 dark:text-blue-light-400"
          : "bg-theme-purple-500/10 text-theme-purple-500 dark:bg-theme-purple-500/20"
      } ${className}`}
    >
      {delivery ? (
        <TruckIcon aria-hidden="true" className="size-3.5" />
      ) : (
        // A bag with its handles: what is handed over a counter.
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-3.5">
          <path d="M4.5 7h11l-.8 9.2a1 1 0 0 1-1 .8H6.3a1 1 0 0 1-1-.8L4.5 7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M7.5 9V6.5a2.5 2.5 0 0 1 5 0V9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
      {delivery ? "Delivery" : "Pickup"}
    </span>
  );
}
