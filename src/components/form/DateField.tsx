import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { dateIn, isoDay, monthYear, typedDayIn, type DateFormatCode } from "../../common/format/date";
import { useDateFormat } from "../../modules/shop/hooks/useShop";
import { CalenderIcon } from "../../icons";

/**
 * A DATE — typed, or picked.
 *
 *     "date picker humne use ni kia kahin — date picker b to hona chaye? or
 *      sth khud b type kr sky."
 *
 * Every date in the panel was the browser's own `<input type="date">`. It
 * shows the day the way the BROWSER writes dates — "10/12/2026" for the
 * twelfth of October on one laptop — which nothing in the product can change,
 * and it looks and behaves differently in each browser.
 *
 * This is one field, the same everywhere:
 *
 *   it SHOWS the day the way the shop writes dates (Settings → Business → Dates)
 *   it takes what a hand TYPES — 12/10/2026, 12-10-26, 12 oct, today — because
 *     somebody entering forty bills knows every date already
 *   it opens a CALENDAR for somebody who does not
 *
 * Its value is what a date input's always was — "2026-10-12", or "" — so
 * nothing that holds a date had to change to use it.
 *
 * A day that parses is given to the form at once, while it is being typed.
 * Something that is not a day is never given: on leaving the box the last real
 * day is put back and the field says what happened, so what the screen shows
 * and what the form holds are never two different dates.
 */

export interface DateFieldProps {
  /** "2026-10-12", or "" for no date. */
  value: string;
  onChange: (day: string) => void;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** The earliest and latest day that may be chosen, as "2026-10-12". */
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Classes for the box itself — the same ones every other field wears. */
  className?: string;
  autoFocus?: boolean;
  /** The shop's own, unless a screen that is nobody's shop says otherwise. */
  format?: DateFormatCode;
  /** Given the <input>, for a caller that names it from a label nearby. */
  inputRef?: (el: HTMLInputElement | null) => void;
  /**
   * Told true while the box holds something it will not give the form — a day
   * outside min/max, or words that are not a day — and false once it does not.
   * A refused "Valid until" sent nothing, and the quotation was saved with a
   * date nobody chose (next rounds #17): a form disables Save on this.
   */
  onInvalid?: (held: boolean) => void;
}

const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const two = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${two(m)}-${two(d)}`;

/** How somebody would type today, in each format — the hint inside an empty box. */
const SHAPE: Record<DateFormatCode, string> = { dmy_text: "dd mmm yyyy", dmy: "dd/mm/yyyy", mdy: "mm/dd/yyyy", ymd: "yyyy-mm-dd" };

/** The six weeks a month is drawn in, Monday first. */
function weeksOf(year: number, month: number): Array<Array<{ day: string; inMonth: boolean; n: number }>> {
  const first = new Date(year, month - 1, 1);
  // Monday = 0 … Sunday = 6.
  const lead = (first.getDay() + 6) % 7;
  const weeks: Array<Array<{ day: string; inMonth: boolean; n: number }>> = [];

  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const at = new Date(year, month - 1, 1 - lead + w * 7 + i);
      week.push({ day: iso(at.getFullYear(), at.getMonth() + 1, at.getDate()), inMonth: at.getMonth() === month - 1, n: at.getDate() });
    }
    weeks.push(week);
  }

  return weeks;
}

export default function DateField({
  value,
  onChange,
  id,
  name,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  min,
  max,
  disabled = false,
  placeholder,
  className = "",
  autoFocus = false,
  format,
  inputRef,
  onInvalid,
}: DateFieldProps) {
  const shops = useDateFormat();
  const code = format ?? shops;
  const calendarId = useId();

  const box = useRef<HTMLInputElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);

  // What is in the box while a hand is in it; null when it simply shows the value.
  const [typing, setTyping] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const today = isoDay(new Date());
  // The month the calendar is showing, and the day the keyboard is on.
  const [cursor, setCursor] = useState(value || today);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  const allowed = useCallback((day: string) => (!min || day >= min) && (!max || day <= max), [min, max]);
  const shown = typing ?? dateIn(code, value);

  const give = (day: string) => {
    setRefused(null);
    if (day !== value) onChange(day);
  };

  const outside = (day: string) =>
    min && day < min
      ? `That is before ${dateIn(code, min)}, the earliest day this takes.`
      : `That is after ${dateIn(code, max)}, the latest day this takes.`;

  // Held back from the form: refused, or typed words that are not yet a day it takes.
  const typedDay = typing !== null && typing.trim() !== "" ? typedDayIn(code, typing) : undefined;
  const held = refused !== null || (typedDay !== undefined && (typedDay === null || !allowed(typedDay)));
  const tell = useRef(onInvalid);
  tell.current = onInvalid;
  useEffect(() => tell.current?.(held), [held]);

  const typed = (text: string) => {
    setTyping(text);
    setRefused(null);
    if (text.trim() === "") {
      give("");

      return;
    }
    const day = typedDayIn(code, text);
    // Given as soon as it IS a day — a form that is read before the box is
    // left (a filter, a test) holds what is on the screen. A day it will not
    // take is said at once, not when the box is left (#17).
    if (day !== null && allowed(day)) give(day);
    else if (day !== null) setRefused(outside(day));
  };

  const left = () => {
    if (typing === null) return;
    const text = typing.trim();
    setTyping(null);
    if (text === "") return;

    const day = typedDayIn(code, text);
    if (day === null) setRefused(`“${text}” is not a date. Type it like ${dateIn(code, today)}, or pick it from the calendar.`);
    else if (!allowed(day)) setRefused(outside(day));
  };

  // ── The calendar ─────────────────────────────────────────────────────
  const openCalendar = () => {
    if (disabled) return;
    setCursor(value || today);
    setOpen(true);
  };
  const close = useCallback((backToTheBox = false) => {
    setOpen(false);
    if (backToTheBox) box.current?.focus();
  }, []);

  const pick = (day: string) => {
    if (!allowed(day)) return;
    setTyping(null);
    give(day);
    close(true);
  };

  // Under the box, or above it when there is no room below — and never off
  // the side of the glass. Fixed to the window, in a portal, so a sheet that
  // scrolls its own middle cannot cut the calendar in half.
  const settle = useCallback(() => {
    const at = wrap.current?.getBoundingClientRect();
    if (!at) return;
    const width = 296;
    const height = sheet.current?.offsetHeight ?? 340;
    const below = at.bottom + 6;
    const top = below + height > window.innerHeight - 8 && at.top - 6 - height > 8 ? at.top - 6 - height : Math.min(below, Math.max(8, window.innerHeight - height - 8));
    const leftEdge = Math.max(8, Math.min(at.left, window.innerWidth - width - 8));
    setPlace({ left: leftEdge, top });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);

      return;
    }
    settle();
    window.addEventListener("resize", settle);
    window.addEventListener("scroll", settle, true);

    return () => {
      window.removeEventListener("resize", settle);
      window.removeEventListener("scroll", settle, true);
    };
  }, [open, settle]);

  // A press anywhere else puts it away.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (wrap.current?.contains(target) || sheet.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);

    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  // The keyboard lands on the day it is about to move from.
  useEffect(() => {
    if (!open || place === null) return;
    sheet.current?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)?.focus({ preventScroll: true });
  }, [open, place, cursor]);

  const [cy, cm] = [Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7))];
  const weeks = useMemo(() => weeksOf(cy, cm), [cy, cm]);

  const move = (days: number, months = 0) => {
    const [y, m, d] = cursor.split("-").map(Number);
    let next: Date;
    if (months !== 0) {
      // The same day of the next month, or its last day when it has no such day.
      const last = new Date(y, m - 1 + months + 1, 0).getDate();
      next = new Date(y, m - 1 + months, Math.min(d, last));
    } else {
      next = new Date(y, m - 1, d + days);
    }
    setCursor(iso(next.getFullYear(), next.getMonth() + 1, next.getDate()));
  };

  const onCalendarKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => move(-1),
      ArrowRight: () => move(1),
      ArrowUp: () => move(-7),
      ArrowDown: () => move(7),
      PageUp: () => move(0, -1),
      PageDown: () => move(0, 1),
      Home: () => move(-((new Date(cy, cm - 1, Number(cursor.slice(8))).getDay() + 6) % 7)),
      End: () => move(6 - ((new Date(cy, cm - 1, Number(cursor.slice(8))).getDay() + 6) % 7)),
    };
    if (e.key === "Escape") {
      // Its own Escape: the sheet this field sits in must not close with it.
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopPropagation();
      close(true);
    } else if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
    }
  };

  const onBoxKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && (e.altKey || !open)) {
      e.preventDefault();
      openCalendar();
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopPropagation();
      close();
    } else if (e.key === "Enter" && typing !== null) {
      // Enter settles what was typed, as leaving the box does — and is then
      // free to do whatever Enter does in the form around it.
      left();
    }
  };

  return (
    <div ref={wrap} className="relative">
      <input
        ref={(el) => {
          box.current = el;
          inputRef?.(el);
        }}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        id={id}
        name={name}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-invalid={refused !== null || undefined}
        aria-describedby={refused !== null ? `${calendarId}-refused` : undefined}
        data-date-field=""
        data-day={value}
        value={shown}
        placeholder={placeholder ?? SHAPE[code]}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => typed(e.target.value)}
        onBlur={left}
        onKeyDown={onBoxKey}
        className={`${className} pr-11 tabular-nums`}
      />
      <button
        type="button"
        aria-label={value ? `Choose a date — ${dateIn(code, value)} is chosen` : "Choose a date"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? calendarId : undefined}
        disabled={disabled}
        // Kept out of the Tab order: the box before it opens the calendar with
        // the down arrow, and forty fields should not be eighty stops.
        tabIndex={-1}
        onClick={() => (open ? close() : openCalendar())}
        className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 disabled:pointer-events-none disabled:opacity-40 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <CalenderIcon className="size-[18px]" />
      </button>

      {refused !== null && (
        <p id={`${calendarId}-refused`} role="alert" className="mt-1.5 text-theme-xs text-error-600 dark:text-error-400">
          {refused}
        </p>
      )}

      {open && createPortal(
        <div
          ref={sheet}
          id={calendarId}
          role="dialog"
          aria-label="Choose a date"
          onKeyDown={onCalendarKey}
          // Drawn where it is not seen until it has been measured and placed —
          // a calendar that jumps is a calendar that gets a wrong day pressed.
          style={{ position: "fixed", left: place?.left ?? 0, top: place?.top ?? 0, width: 296, visibility: place ? "visible" : "hidden", zIndex: 100000 }}
          className="rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button type="button" aria-label="The month before" onClick={() => move(0, -1)} className="grid size-9 place-items-center rounded-lg text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10">‹</button>
            <p aria-live="polite" className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{monthYear(cursor)}</p>
            <button type="button" aria-label="The month after" onClick={() => move(0, 1)} className="grid size-9 place-items-center rounded-lg text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10">›</button>
          </div>

          <table role="grid" aria-label={monthYear(cursor)} className="w-full border-collapse text-center">
            <thead>
              <tr>
                {WEEK.map((d) => (
                  <th key={d} scope="col" className="pb-1 text-theme-xs font-medium text-gray-400">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0].day}>
                  {week.map(({ day, inMonth, n }) => {
                    const chosen = day === value;
                    const may = allowed(day);

                    return (
                      <td key={day} className="p-0.5">
                        <button
                          type="button"
                          data-day={day}
                          aria-label={dateIn("dmy_text", day)}
                          aria-pressed={chosen}
                          aria-current={day === today ? "date" : undefined}
                          disabled={!may}
                          tabIndex={day === cursor ? 0 : -1}
                          onClick={() => pick(day)}
                          className={`grid size-9 w-full place-items-center rounded-lg text-theme-sm tabular-nums transition ${
                            chosen
                              ? "bg-brand-500 font-semibold text-white"
                              : !may
                                ? "cursor-not-allowed text-gray-300 dark:text-gray-600"
                                : `${inMonth ? "text-gray-800 dark:text-white/90" : "text-gray-400 dark:text-gray-500"} hover:bg-brand-50 dark:hover:bg-brand-500/15 ${day === today ? "ring-1 ring-inset ring-brand-400" : ""}`
                          }`}
                        >
                          {n}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 dark:border-gray-800">
            <button type="button" disabled={!allowed(today)} onClick={() => pick(today)} className="min-h-9 rounded-lg px-3 text-theme-sm font-semibold text-brand-600 transition hover:bg-brand-50 disabled:opacity-40 dark:text-brand-400 dark:hover:bg-brand-500/10">
              Today
            </button>
            {value !== "" && (
              <button
                type="button"
                onClick={() => { setTyping(null); give(""); close(true); }}
                className="min-h-9 rounded-lg px-3 text-theme-sm font-medium text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10"
              >
                Clear
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
