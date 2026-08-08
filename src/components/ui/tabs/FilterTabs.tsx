import type { ReactNode } from "react";

export interface FilterTab<K extends string> {
  key: K;
  label: string;
  /** Optional leading glyph. Sized by the caller; 18px reads best. */
  icon?: ReactNode;
  /** Optional trailing count — something time-sensitive that follows you between tabs. */
  badge?: ReactNode;
}

/**
 * The one filter bar.
 *
 * Every screen that splits itself into topics was drawing its own row of
 * buttons, and they had drifted: three different underline weights, two
 * different active colours, and a hover state on some but not others. This is
 * the single treatment — a segmented track with the active topic filled in the
 * shop's brand colour.
 *
 * Deliberately NOT the underline style, which is now reserved for a *second*
 * level of tabs inside one topic (Settings → Point of Sale). Two levels of
 * navigation on one screen must not read as the same control.
 *
 * `sticky` pins the bar under the app header on desktop, for pages long enough
 * that you would otherwise scroll back up to leave a topic. It bleeds to the
 * layout's own padding, so it only belongs on a page rendered inside AppLayout.
 */
export function FilterTabs<K extends string>({
  tabs,
  value,
  onChange,
  sticky = false,
  className = "",
}: {
  tabs: readonly FilterTab<K>[];
  value: K;
  onChange: (key: K) => void;
  sticky?: boolean;
  className?: string;
}) {
  const shell = sticky
    ? "z-20 -mx-4 overflow-x-auto bg-white/90 px-4 py-2 backdrop-blur-md dark:bg-gray-900/90 md:-mx-6 md:px-6 lg:sticky lg:top-[76px]"
    : "overflow-x-auto";

  return (
    <div className={`${shell} ${className}`}>
      <div className="flex w-max gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800/60">
        {tabs.map((t) => {
          const active = value === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(t.key)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-theme-sm font-medium transition ${
                active
                  ? "bg-brand-500 text-white shadow-theme-xs"
                  : "text-gray-500 hover:bg-white/70 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
              }`}
            >
              {t.icon && <span className={active ? "" : "opacity-70"}>{t.icon}</span>}
              {t.label}
              {t.badge}
            </button>
          );
        })}
      </div>
    </div>
  );
}
