import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { CaretGlyph } from "./FilterIcons";

/**
 * A FILTER CONTROL AND THE PANEL IT OPENS.
 *
 * Every popper on the platform was being rebuilt at its call site, and each
 * rebuild forgot something different: one closed on a click outside and not on
 * Escape, one had neither, several never told a screen reader they were a menu
 * at all. This is the one implementation, so the next screen gets all of it for
 * free.
 *
 * ── The three ways a panel must be able to close ───────────────────────
 *
 *   · picking something          — the caller closes it, via `close`
 *   · clicking away              — mousedown, so a drag that starts inside and
 *                                  ends outside does not count as leaving
 *   · Escape                     — and the FOCUS COMES BACK to the trigger,
 *                                  which is the half everybody skips; without
 *                                  it a keyboard user who escapes a menu is
 *                                  returned to the top of the document
 *
 * ── Why the panel is not a portal ──────────────────────────────────────
 *
 * It is absolutely positioned inside its own wrapper, so it inherits the dark
 * theme and needs no measuring. The cost is that an ancestor with
 * `overflow: hidden` would clip it — which is why the filter bar that hosts
 * these is deliberately not inside the scroll container of its table.
 */
export function FilterPopover({
  label,
  value,
  icon,
  active = false,
  align = "left",
  panelClassName = "w-64",
  children,
  onOpenChange,
}: {
  /** What the control filters — shown small above the value, or as the value
   *  itself when nothing is chosen. */
  label: string;
  /** The current choice, in the words the reader picked it by. */
  value?: string;
  icon?: ReactNode;
  active?: boolean;
  align?: "left" | "right";
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open) return;

    const away = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) change(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      change(false);
      // Back where they were. A menu that closes and drops the focus leaves a
      // keyboard user at the top of the page with no idea why.
      trigger.current?.focus();
    };

    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);

    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = active && value !== undefined;

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => change(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? panelId : undefined}
        className={`inline-flex h-11 min-w-0 items-center gap-2 rounded-xl border px-3.5 text-theme-sm font-medium transition ${
          chosen || open
            ? "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-500/50 dark:bg-brand-500/10 dark:text-brand-300"
            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:text-white"
        }`}
      >
        {icon && <span className={chosen || open ? "" : "text-gray-400"}>{icon}</span>}
        <span className="truncate">
          {/* The label is only worth its space while nothing is chosen. Once
              something is, the CHOICE is the thing being read, and repeating
              "Date: Date" is how a toolbar fills up with words. */}
          {chosen ? value : label}
        </span>
        <CaretGlyph up={open} className="size-3.5 shrink-0 opacity-60" />
      </button>

      {open && (
        <div
          id={panelId}
          className={`absolute top-full z-50 mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white p-1.5 shadow-theme-xl dark:border-gray-800 dark:bg-gray-900 ${
            align === "right" ? "right-0" : "left-0"
          } ${panelClassName}`}
        >
          {children(() => change(false))}
        </div>
      )}
    </div>
  );
}

/**
 * One row inside a panel: what it is, what it resolves to, and whether it is
 * the one in force.
 *
 * The `hint` is the reason this exists as a component rather than a `<button>`
 * at each call site — a menu that says "Last 30 days" without saying
 * "28 Jul – 26 Aug" is asking to be trusted about the one thing the reader
 * opened it to check.
 */
export function FilterOption({
  selected,
  hint,
  onPick,
  children,
}: {
  selected?: boolean;
  hint?: ReactNode;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected ?? false}
      onClick={onPick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-theme-sm transition ${
        selected
          ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
          : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint !== undefined && (
        <span className={`shrink-0 text-theme-xs tabular-nums ${selected ? "text-brand-600 dark:text-brand-300" : "text-gray-400"}`}>
          {hint}
        </span>
      )}
      {selected && <TickMark />}
    </button>
  );
}

function TickMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true">
      <path
        d="m5 12.5 4.5 4.5L19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
