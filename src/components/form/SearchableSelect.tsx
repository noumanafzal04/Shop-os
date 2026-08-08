import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface SearchableOption {
  value: string;
  label: string;
  /**
   * Something the shop has switched off. It stays SELECTABLE — retiring
   * "Cooking Gas" must not make three years of gas bills unfindable — but it
   * reads as retired so nobody mistakes it for somewhere to file today's.
   */
  retired?: boolean;
  /** A trailing figure: how many entries sit under this option, usually. */
  count?: number;
}

interface Props {
  options: SearchableOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Shown on the closed button when nothing is picked. */
  placeholder?: string;
  searchPlaceholder?: string;
  /** Plural noun for the summary: "3 categories". */
  noun?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A multi-select you can type into.
 *
 * The thing it replaces is a cloud of toggle chips — one per option, all
 * rendered, all the time. That is a good control for six options and a wall
 * for a hundred and fifty, which is exactly what a books-only business has:
 * their expense categories ARE their vocabulary and they keep as many as they
 * need. Finding "Bank Charges" in a two-hundred-chip cloud is a scan, and a
 * scan is the thing a filter exists to replace.
 *
 * Three properties it has to have, none of them optional:
 *
 *   TYPE-AHEAD. The whole point. Typing narrows; nothing else does.
 *
 *   A CLOSED STATE THAT STILL TELLS THE TRUTH. "3 selected" is not enough on
 *   its own, so one choice shows its own name and several show a count — the
 *   reader can always tell whether a filter is on without opening anything.
 *
 *   KEYBOARD. Arrow keys move, Enter toggles, Escape closes and returns focus
 *   to the button. A filter that needs a mouse is a filter a fast operator
 *   stops using, and this screen belongs to people who work in it all day.
 *
 * Deliberately NOT a <select multiple>, which on a phone is a scrolling list
 * nobody can ctrl-click, and on a desktop is a box you must not let go of.
 */
export default function SearchableSelect({
  options,
  selected,
  onChange,
  placeholder = "Any",
  searchPlaceholder = "Type to filter…",
  noun = "selected",
  emptyText = "Nothing matches.",
  disabled = false,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();

    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  // Opening lands on the search box: the first thing anyone does here is type.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      const id = window.setTimeout(() => searchRef.current?.focus(), 0);

      return () => window.clearTimeout(id);
    }
  }, [open]);

  // Clicking away commits and closes — there is nothing to cancel, every
  // toggle has already taken effect.
  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener("mousedown", onDown);

    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();

      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length === 0) return;
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;

        return (next + shown.length) % shown.length;
      });

      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const option = shown[active];
      if (option) toggle(option.value);
    }
  };

  const chosen = options.filter((o) => selected.includes(o.value));
  const summary = chosen.length === 0
    ? placeholder
    : chosen.length === 1
      ? chosen[0].label
      : `${chosen.length} ${noun}`;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`flex h-11 w-full items-center justify-between gap-2 rounded-lg border px-4 text-left text-sm shadow-theme-xs transition-colors disabled:opacity-50 dark:bg-gray-900 ${
          chosen.length > 0
            ? "border-brand-300 text-gray-800 dark:border-brand-500/50 dark:text-white/90"
            : "border-gray-300 text-gray-400 dark:border-gray-700 dark:text-gray-400"
        }`}
      >
        <span className="truncate">{summary}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {chosen.length > 1 && (
            <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
              {chosen.length}
            </span>
          )}
          <Chevron open={open} />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="border-b border-gray-100 p-2 dark:border-gray-800">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              aria-controls={listId}
              className="h-9 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:text-white/90"
            />
          </div>

          <ul
            id={listId}
            role="listbox"
            aria-multiselectable
            className="max-h-64 overflow-y-auto py-1"
          >
            {shown.length === 0 ? (
              <li className="px-3 py-6 text-center text-theme-xs text-gray-400">{emptyText}</li>
            ) : (
              shown.map((option, i) => {
                const on = selected.includes(option.value);

                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => toggle(option.value)}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-theme-sm transition-colors ${
                        i === active ? "bg-brand-50 dark:bg-brand-500/10" : ""
                      }`}
                    >
                      {/* A real box, because "is this one on?" must be
                          answerable without comparing background tints. */}
                      <span
                        aria-hidden
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                          on
                            ? "border-brand-500 bg-brand-500 text-white"
                            : "border-gray-300 dark:border-gray-600"
                        }`}
                      >
                        {on && <TickGlyph />}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate ${
                          option.retired
                            ? "text-gray-400 dark:text-gray-500"
                            : "text-gray-700 dark:text-gray-200"
                        }`}
                      >
                        {option.label}
                        {option.retired && (
                          <span className="ml-1.5 text-theme-xs text-gray-400">· switched off</span>
                        )}
                      </span>
                      {option.count !== undefined && (
                        <span className="shrink-0 text-theme-xs tabular-nums text-gray-400">{option.count}</span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {selected.length > 0 && (
            <div className="border-t border-gray-100 px-2 py-1.5 dark:border-gray-800">
              <button
                type="button"
                onClick={() => onChange([])}
                className="rounded-lg px-2 py-1 text-theme-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5"
              >
                Clear {selected.length} {noun}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TickGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2.5 6.2L4.8 8.5L9.5 3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
