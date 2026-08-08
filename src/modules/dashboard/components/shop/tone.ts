/**
 * The dashboard's one set of tile tones.
 *
 * Stock, the till, the floor and the dispensary each carried their own copy of
 * these two maps, which is how "low stock" ended up a shade off "parked
 * tickets" in dark mode. A figure that means the same thing looks the same
 * wherever it is read, so the classes live in exactly one place.
 */
export type Tone = "brand" | "success" | "warning" | "error" | "gray";

/** Ground + ring per tone. The ring is what gives a flat tint an edge. */
export const TONE_GROUND: Record<Tone, string> = {
  brand: "bg-brand-50 ring-brand-100 dark:bg-brand-500/10 dark:ring-brand-500/20",
  success: "bg-success-50 ring-success-100 dark:bg-success-500/10 dark:ring-success-500/20",
  warning: "bg-warning-50 ring-warning-100 dark:bg-warning-500/10 dark:ring-warning-500/20",
  error: "bg-error-50 ring-error-100 dark:bg-error-500/10 dark:ring-error-500/20",
  gray: "bg-gray-50 ring-gray-200 dark:bg-white/[0.03] dark:ring-gray-800",
};

/** Hover ground, for the tiles that are links. */
export const TONE_HOVER: Record<Tone, string> = {
  brand: "hover:bg-brand-100 dark:hover:bg-brand-500/15",
  success: "hover:bg-success-100 dark:hover:bg-success-500/15",
  warning: "hover:bg-warning-100 dark:hover:bg-warning-500/15",
  error: "hover:bg-error-100 dark:hover:bg-error-500/15",
  gray: "hover:bg-gray-100 dark:hover:bg-white/[0.06]",
};

/** The figure's own colour. Every pairing clears 4.5:1 on its ground. */
export const TONE_TEXT: Record<Tone, string> = {
  brand: "text-brand-600 dark:text-brand-400",
  success: "text-success-600 dark:text-success-500",
  warning: "text-warning-600 dark:text-warning-500",
  error: "text-error-600 dark:text-error-500",
  gray: "text-gray-800 dark:text-white/90",
};

/** Column counts that never leave a hanging tile on a wide screen. */
export function tileGrid(count: number): string {
  return `grid grid-cols-1 gap-4 sm:grid-cols-2 ${
    count >= 4 ? "xl:grid-cols-4" : count === 3 ? "xl:grid-cols-3" : ""
  }`;
}
