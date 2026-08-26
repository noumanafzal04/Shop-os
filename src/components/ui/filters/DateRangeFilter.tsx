import { useEffect, useState } from "react";

import { Modal } from "../modal";
import { CalendarGlyph, ChevronGlyph } from "./FilterIcons";
import { FilterOption, FilterPopover } from "./FilterPopover";
import {
  EMPTY_RANGE,
  formatRange,
  fromIsoDate,
  isSameRange,
  matchPreset,
  monthGrid,
  monthName,
  orderRange,
  RANGE_KEYS,
  rangeName,
  resolveRange,
  toIsoDate,
  type DateRange,
  type RangeKey,
} from "./dateRanges";

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * THE DATE FILTER.
 *
 * What it replaces, on every list that had one: two bare text inputs and a
 * hyphen. Somebody who wanted last month had to know what month it was, how
 * many days it had, and type both ends without a typo — and once they had, the
 * screen said nothing about what it was showing them.
 *
 * ── A name, and the dates that name resolves to, side by side ──────────
 *
 * Every row in this menu carries both. "Last 30 days" is how somebody thinks;
 * "28 Jul – 26 Aug" is what they came to check. Showing only the name asks to
 * be trusted; showing only the dates makes them do the arithmetic they opened
 * the menu to avoid.
 *
 * ── Custom is a MODAL, not a third panel ───────────────────────────────
 *
 * Picking two specific days needs two months on screen at once — a range that
 * crosses a month boundary is most of why anybody reaches for custom — and
 * that does not fit under a toolbar button on a laptop, let alone a tablet. It
 * also needs a Cancel, because a half-picked range must be abandonable without
 * having already changed the list underneath.
 */
export function DateRangeFilter({
  value,
  onChange,
  label = "Date",
  presets = RANGE_KEYS,
  align = "left",
  allowAll = true,
  extra = [],
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  label?: string;
  presets?: readonly RangeKey[];
  align?: "left" | "right";
  /** Whether "All time" is offered. A ledger says yes; a shift report cannot. */
  allowAll?: boolean;
  /**
   * Ranges this SCREEN knows about and the generic list cannot.
   *
   * The reports screen offers the Pakistani tax year — 1 July to 30 June —
   * which is the window behind the annual return and every advance-tax
   * working, and which no calendar preset here can express. Rather than teach
   * this component about FBR, the caller hands in the range it has already
   * worked out (see reportPeriod.ts, where the boundary is tested).
   *
   * Shown above the standard presets, because a shop that has one of these
   * usually wants it.
   */
  extra?: ReadonlyArray<{ key: string; label: string; range: DateRange }>;
}) {
  const [custom, setCustom] = useState(false);
  const today = new Date();
  const preset = matchPreset(value, today);
  const chosen = value.from !== null || value.to !== null;
  // A caller-supplied range is named by its own row, so it must not ALSO tick
  // "Custom range…" — two ticks in one menu is a menu that cannot be read.
  const named = preset !== null || extra.some((option) => isSameRange(value, option.range));

  return (
    <>
      <FilterPopover
        label={label}
        value={formatRange(value, today)}
        icon={<CalendarGlyph className="size-4" />}
        active={chosen}
        align={align}
        panelClassName="w-72"
      >
        {(close) => (
          <div role="listbox" aria-label={label}>
            {extra.map((option) => (
              <FilterOption
                key={option.key}
                selected={isSameRange(value, option.range)}
                hint={formatRange(option.range, today)}
                onPick={() => {
                  onChange(option.range);
                  close();
                }}
              >
                {option.label}
              </FilterOption>
            ))}
            {extra.length > 0 && <div className="my-1.5 border-t border-gray-100 dark:border-gray-800" />}

            {allowAll && (
              <FilterOption
                selected={preset === "all"}
                onPick={() => {
                  onChange(EMPTY_RANGE);
                  close();
                }}
              >
                {rangeName("all")}
              </FilterOption>
            )}

            {presets.map((key) => {
              const range = resolveRange(key, today);

              return (
                <FilterOption
                  key={key}
                  selected={preset === key}
                  hint={formatRange(range, today)}
                  onPick={() => {
                    onChange(range);
                    close();
                  }}
                >
                  {rangeName(key)}
                </FilterOption>
              );
            })}

            <div className="my-1.5 border-t border-gray-100 dark:border-gray-800" />

            <button
              type="button"
              onClick={() => {
                close();
                setCustom(true);
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-theme-sm transition ${
                // A range that is nobody's preset got there through this
                // dialog, so this row is where the tick belongs.
                chosen && !named
                  ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                  : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5"
              }`}
            >
              <CalendarGlyph className="size-4 shrink-0 opacity-70" />
              <span className="flex-1">Custom range…</span>
              {chosen && !named && (
                <span className="text-theme-xs text-brand-600 dark:text-brand-300">{formatRange(value, today)}</span>
              )}
            </button>
          </div>
        )}
      </FilterPopover>

      <CustomRangeDialog
        open={custom}
        initial={value}
        presets={presets}
        onClose={() => setCustom(false)}
        onApply={(range) => {
          onChange(range);
          setCustom(false);
        }}
      />
    </>
  );
}

/**
 * Two months, a start, an end, and nothing applied until Apply.
 *
 * The draft lives here and is reset every time the dialog opens: a range half
 * picked and then cancelled must leave the list exactly as it was, and a
 * dialog that kept yesterday's abandoned first click would hand it back as
 * today's start date.
 */
function CustomRangeDialog({
  open,
  initial,
  presets,
  onClose,
  onApply,
}: {
  open: boolean;
  initial: DateRange;
  presets: readonly RangeKey[];
  onClose: () => void;
  onApply: (range: DateRange) => void;
}) {
  const [draft, setDraft] = useState<DateRange>(initial);
  const [month, setMonth] = useState(() => startingMonth(initial));

  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setMonth(startingMonth(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const today = toIsoDate(new Date());
  const complete = draft.from !== null && draft.to !== null;

  /**
   * Clicking a day. The FIRST click starts a new range; the second closes it,
   * whichever side of the first it lands on. Clicking again starts over rather
   * than extending — extending an already-complete range is how a picker
   * becomes impossible to narrow once it has been widened.
   */
  const pick = (iso: string) => {
    setDraft((current) =>
      current.from === null || current.to !== null
        ? { from: iso, to: null }
        : orderRange(current.from, iso),
    );
  };

  return (
    <Modal isOpen={open} onClose={onClose} className="max-w-3xl p-0">
      <div className="border-b border-gray-100 px-6 py-5 dark:border-gray-800">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Pick a custom range</h3>
      </div>

      <div className="flex flex-col gap-6 px-6 py-5 sm:flex-row">
        {/* The presets stay reachable from in here. Somebody who opens this
            dialog and realises they wanted "last month" after all should not
            have to cancel out of it to say so. */}
        <div className="shrink-0 sm:w-40">
          <p className="mb-2 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">Quick ranges</p>
          <div className="flex flex-wrap gap-1 sm:flex-col">
            {presets.slice(0, 7).map((key) => {
              const range = resolveRange(key);

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setDraft(range);
                    setMonth(startingMonth(range));
                  }}
                  className={`rounded-lg px-2.5 py-1.5 text-left text-theme-sm transition ${
                    isSameRange(draft, range)
                      ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                      : "text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5"
                  }`}
                >
                  {rangeName(key)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 flex-1 sm:border-l sm:border-gray-100 sm:pl-6 sm:dark:border-gray-800">
          <div className="mb-5 flex items-center gap-3">
            <EndBox title="Start" iso={draft.from} armed={draft.from === null || draft.to !== null} />
            <ChevronGlyph className="size-4 shrink-0 text-gray-400" />
            <EndBox title="End" iso={draft.to} armed={draft.from !== null && draft.to === null} />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            {[0, 1].map((offset) => {
              const shown = new Date(month.getFullYear(), month.getMonth() + offset, 1);

              return (
                <MonthTable
                  key={offset}
                  year={shown.getFullYear()}
                  month={shown.getMonth()}
                  draft={draft}
                  today={today}
                  onPick={pick}
                  onStep={offset === 0 ? (step) => setMonth(new Date(month.getFullYear(), month.getMonth() + step, 1)) : undefined}
                  showBack={offset === 0}
                  showForward={offset === 1}
                  onForward={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                  // The second month is drawn on small screens too, stacked —
                  // the whole reason for custom is a range that crosses one.
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
        <p className="text-theme-sm text-gray-500 dark:text-gray-400">
          {/* Says what is missing, not that something is wrong. Apply is
              disabled below and this is the sentence that explains why. */}
          {draft.from === null
            ? "Select a start and end date"
            : draft.to === null
              ? "Now pick the end date"
              : formatRange(draft)}
        </p>

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setDraft(EMPTY_RANGE)}
            disabled={draft.from === null}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-theme-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-theme-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onApply(draft)}
            disabled={!complete}
            className="rounded-xl bg-brand-500 px-4 py-2.5 text-theme-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40"
          >
            Apply range
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Which month to open on: the range's own start, or this month. */
function startingMonth(range: DateRange): Date {
  const anchor = range.from !== null ? fromIsoDate(range.from) : new Date();

  return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
}

/** "10 August 2026" — what a day cell is called when the number alone is
 *  ambiguous, which in a two-month grid it always is. */
function fullDate(iso: string): string {
  return fromIsoDate(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function EndBox({ title, iso, armed }: { title: string; iso: string | null; armed: boolean }) {
  return (
    <div
      className={`min-w-0 flex-1 rounded-xl border px-3.5 py-2.5 transition ${
        armed
          ? "border-brand-400 dark:border-brand-500/60"
          : "border-gray-200 dark:border-gray-800"
      }`}
    >
      <p className="text-theme-xs font-semibold uppercase tracking-wide text-gray-400">{title}</p>
      <p className={`truncate text-theme-sm ${iso === null ? "text-gray-400" : "font-medium text-gray-800 dark:text-white/90"}`}>
        {iso === null ? "Select a date" : formatRange({ from: iso, to: iso })}
      </p>
    </div>
  );
}

function MonthTable({
  year,
  month,
  draft,
  today,
  onPick,
  showBack,
  showForward,
  onStep,
  onForward,
}: {
  year: number;
  month: number;
  draft: DateRange;
  today: string;
  onPick: (iso: string) => void;
  showBack: boolean;
  showForward: boolean;
  onStep?: (step: number) => void;
  onForward: () => void;
}) {
  const cells = monthGrid(year, month);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        {showBack ? (
          <button
            type="button"
            onClick={() => onStep?.(-1)}
            aria-label="Previous month"
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5 dark:hover:text-white"
          >
            <ChevronGlyph left className="size-4" />
          </button>
        ) : (
          <span className="size-7" />
        )}
        <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{monthName(year, month)}</p>
        {showForward ? (
          <button
            type="button"
            onClick={onForward}
            aria-label="Next month"
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5 dark:hover:text-white"
          >
            <ChevronGlyph className="size-4" />
          </button>
        ) : (
          <span className="size-7" />
        )}
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {WEEKDAYS.map((day) => (
          <div key={day} className="pb-1 text-center text-theme-xs font-semibold text-gray-400">
            {day}
          </div>
        ))}

        {cells.map((cell) => {
          const isStart = cell.iso === draft.from;
          const isEnd = cell.iso === draft.to;
          const inside =
            draft.from !== null && draft.to !== null && cell.iso > draft.from && cell.iso < draft.to;

          return (
            <div
              key={cell.iso}
              className={
                // The band behind a middle day is drawn on the CELL, not the
                // button, so a selected range reads as one continuous bar
                // rather than a row of separate pills.
                inside || (isStart && draft.to !== null) || (isEnd && draft.from !== null)
                  ? `bg-brand-50 dark:bg-brand-500/10 ${isStart ? "rounded-l-lg" : ""} ${isEnd ? "rounded-r-lg" : ""}`
                  : ""
              }
            >
              <button
                type="button"
                onClick={() => onPick(cell.iso)}
                aria-current={cell.iso === today ? "date" : undefined}
                // THE FULL DATE, not the number printed in it.
                //
                // Two months are on screen, so "10" is 10 August and also 10
                // September — two controls with one name, and a screen reader
                // hears the dialog as a list of numbers repeated twice with
                // nothing to tell them apart. Sighted users read the column
                // and the month heading; nobody else has either.
                aria-label={fullDate(cell.iso)}
                className={`mx-auto grid size-9 place-items-center rounded-lg text-theme-sm transition ${
                  isStart || isEnd
                    ? "bg-brand-500 font-semibold text-white"
                    : cell.inMonth
                      ? "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
                      : "text-gray-300 hover:bg-gray-100 dark:text-gray-600 dark:hover:bg-white/5"
                } ${cell.iso === today && !isStart && !isEnd ? "ring-1 ring-brand-400" : ""}`}
              >
                {cell.day}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
