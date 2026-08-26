import type { OrderStatus } from "../services/ordersService";

/**
 * HOW EACH STAGE LOOKS AND WHAT IT IS CALLED, in one place.
 *
 * The row and the detail panel both draw it, and a queue where the list says
 * "New" and the panel behind it says "Pending" is a queue somebody has to
 * translate. Kept out of both components so neither owns it.
 */
export const STAGE: Record<
  OrderStatus,
  { label: string; short: string; dot: string; chip: string }
> = {
  pending: {
    label: "Waiting to be confirmed",
    short: "New",
    dot: "bg-warning-500",
    chip: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400",
  },
  confirmed: {
    label: "Confirmed",
    short: "Confirmed",
    dot: "bg-blue-light-500",
    chip: "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-500/15 dark:text-blue-light-400",
  },
  preparing: {
    label: "Being prepared",
    short: "Preparing",
    dot: "bg-brand-500",
    chip: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  },
  ready: {
    label: "Ready for collection",
    short: "Ready",
    dot: "bg-success-500",
    chip: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400",
  },
  out_for_delivery: {
    label: "Out for delivery",
    short: "On the way",
    dot: "bg-brand-600",
    chip: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  },
  completed: {
    label: "Completed",
    short: "Completed",
    dot: "bg-gray-400",
    chip: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300",
  },
  cancelled: {
    label: "Cancelled",
    short: "Cancelled",
    dot: "bg-error-500",
    chip: "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400",
  },
};
