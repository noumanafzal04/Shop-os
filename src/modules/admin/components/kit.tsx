import type { ReactNode } from "react";

import { initialsOf, toneFor, type Tone } from "./face";

/**
 * THE ADMIN CONSOLE'S OWN FURNITURE.
 *
 * Every admin screen opened with the same grey sentence and went straight into
 * a table. Correct, and it read as one screen thirteen times: nothing said
 * which page this was, what it amounted to, or what needed looking at.
 *
 * Four pieces, used the same way on every page:
 *
 *   PageHeader   which screen this is — its own icon, in its own colour
 *   StatTile     what it amounts to, counted by the server
 *   Person       somebody in a list, with a face of sorts
 *   Pill         a state, in the colour of that state
 *
 * FLAT. Tints and one-pixel borders; no shadows, no gradients except the
 * dashboard's own hero. Colour here says something — green is good, amber is
 * waiting, red is stopped — and the same colour means the same thing on every
 * page.
 *
 * Every class is written out in full. A Tailwind class assembled from a
 * variable is a class the build never sees.
 */
export type { Tone };

const ICON: Record<Tone, string> = {
  brand: "bg-brand-500 text-white",
  green: "bg-success-500 text-white",
  amber: "bg-warning-500 text-white",
  red: "bg-error-500 text-white",
  sky: "bg-blue-light-500 text-white",
  orange: "bg-orange-500 text-white",
  purple: "bg-theme-purple-500 text-white",
  slate: "bg-gray-600 text-white",
};

const TINT: Record<Tone, string> = {
  brand: "border-brand-100 bg-brand-50 dark:border-brand-500/25 dark:bg-brand-500/10",
  green: "border-success-100 bg-success-50 dark:border-success-500/25 dark:bg-success-500/10",
  amber: "border-warning-100 bg-warning-50 dark:border-warning-500/25 dark:bg-warning-500/10",
  red: "border-error-100 bg-error-50 dark:border-error-500/25 dark:bg-error-500/10",
  sky: "border-blue-light-100 bg-blue-light-50 dark:border-blue-light-500/25 dark:bg-blue-light-500/10",
  orange: "border-orange-100 bg-orange-50 dark:border-orange-500/25 dark:bg-orange-500/10",
  purple: "border-theme-purple-500/15 bg-theme-purple-500/[0.07] dark:border-theme-purple-500/25 dark:bg-theme-purple-500/10",
  slate: "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-white/[0.04]",
};

const INK: Record<Tone, string> = {
  brand: "text-brand-700 dark:text-brand-300",
  green: "text-success-700 dark:text-success-400",
  amber: "text-warning-700 dark:text-warning-400",
  red: "text-error-700 dark:text-error-400",
  sky: "text-blue-light-700 dark:text-blue-light-400",
  orange: "text-orange-700 dark:text-orange-400",
  purple: "text-theme-purple-500",
  slate: "text-gray-700 dark:text-gray-300",
};

/** Which screen this is. `actions` is what the page lets you start. */
export function PageHeader({
  icon,
  tone = "brand",
  title,
  subtitle,
  actions,
}: {
  icon: ReactNode;
  tone?: Tone;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 items-center gap-3.5">
        <span aria-hidden="true" className={`flex size-11 shrink-0 items-center justify-center rounded-2xl [&>svg]:size-5 ${ICON[tone]}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-gray-800 dark:text-white/90">{title}</h1>
          {subtitle && <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * One figure, in the colour of what it is about.
 *
 * `onPress` makes it a filter: the tile that says "3 suspended" is the fastest
 * way to the three. `pressed` marks the one the list is currently narrowed to.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "slate",
  icon,
  onPress,
  pressed = false,
  loading = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  onPress?: () => void;
  pressed?: boolean;
  loading?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-theme-xs font-medium uppercase tracking-wide ${INK[tone]}`}>{label}</p>
        {icon && (
          <span aria-hidden="true" className={`flex size-8 shrink-0 items-center justify-center rounded-xl [&>svg]:size-4 ${ICON[tone]}`}>
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
        {loading ? <span className="inline-block h-7 w-14 animate-pulse rounded bg-black/10 align-middle dark:bg-white/10" /> : value}
      </p>
      {hint && <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </>
  );

  // `flex-col` and full height: a row of tiles is as tall as its tallest, and a
  // <button> centres what it holds — a pressable tile sat a line lower than
  // the plain one beside it.
  const frame = `flex h-full flex-col rounded-2xl border p-4 text-left ${TINT[tone]}`;

  return onPress ? (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={pressed}
      className={`${frame} transition hover:brightness-[0.98] ${pressed ? "ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-gray-900" : ""}`}
    >
      {body}
    </button>
  ) : (
    <div className={frame}>{body}</div>
  );
}

/** A row of figures: two across on a phone, as many as there are on a desk. */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5">{children}</div>;
}

/** Somebody in a list: initials in their own colour, their name, and one line under it. */
export function Person({ name, sub, tone }: { name: string; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className={`flex size-9 shrink-0 items-center justify-center rounded-full text-theme-xs font-semibold ${ICON[tone ?? toneFor(name)]}`}
      >
        {initialsOf(name)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium text-gray-800 dark:text-white/90">{name}</p>
        {sub && <p className="truncate text-theme-xs text-gray-500 dark:text-gray-400">{sub}</p>}
      </div>
    </div>
  );
}

/** A state, said in its colour, with a dot so it is not colour alone. */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-theme-xs font-medium ${TINT[tone]} ${INK[tone]}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** The white card every list and form on these pages sits in. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] ${className}`}>
      {children}
    </div>
  );
}

/** Nothing here yet — said with the page's icon, not a grey sentence in a table. */
export function Empty({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-white/[0.06] [&>svg]:size-6">
        {icon}
      </span>
      <p className="mt-3 text-sm font-medium text-gray-800 dark:text-white/90">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-theme-sm text-gray-500 dark:text-gray-400">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
