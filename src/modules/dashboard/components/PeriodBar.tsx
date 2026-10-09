import { CalendarGlyph, ChevronGlyph } from "../../../components/ui/filters/FilterIcons";
import {
  DateRangeFilter,
  formatRange,
  stepRange,
  type DateRange,
} from "../../../components/ui/filters";
import { DASHBOARD_PRESETS, periodDetail, periodName, type PeriodTold } from "../period";

/**
 * THE PERIOD BOTH CONSOLES ARE READING.
 *
 * ── Where it sits, and why there ───────────────────────────────────────
 *
 * Directly above the figures it governs, as their heading. Not in the band at
 * the top of the page: that band says what is true NOW — whether anything
 * needs somebody — and a date control inside it would read as changing that.
 * And not floated in a corner of the first card, where it would look like it
 * belonged to one chart.
 *
 * ── Two halves, one of them not a control ──────────────────────────────
 *
 * The left half is what the figures on screen ARE: the period the server says
 * it answered, by name, and what it set them against. It is read from the
 * payload, so for the moment between a click and its answer it still names
 * the figures that are actually there — and says so, dimmed.
 *
 * The right half is the one date filter this platform has (see
 * components/ui/filters), with two arrows beside it: reading a dashboard a day
 * at a time is the commonest thing anybody does with one, and opening a menu
 * for each step is three clicks to say "back one".
 *
 * The arrows come BEFORE the menu on purpose. The menu's panel hangs from its
 * right edge; with the menu last in the row that edge is the page's own, and
 * the panel can never open off the side of a phone.
 */
export function PeriodBar({
  range,
  onChange,
  today,
  told,
  busy = false,
}: {
  /** What the control holds — the period being asked for. */
  range: DateRange;
  onChange: (range: DateRange) => void;
  /** The date it is, on the clock this console's periods are cut by. */
  today: Date;
  /** The period the figures on screen belong to, once there are any. */
  told?: PeriodTold;
  /** A newly asked period is on its way; what is on screen is the last one. */
  busy?: boolean;
}) {
  const earlier = stepRange(range, -1, today);
  const later = stepRange(range, 1, today);

  return (
    <section
      aria-label="Period"
      aria-busy={busy}
      data-testid="period-bar"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:ring-brand-500/25"
        >
          <CalendarGlyph className="size-5" />
        </span>
        {told ? (
          <div className={`min-w-0 transition-opacity ${busy ? "opacity-50" : ""}`}>
            <h3 className="text-lg font-semibold leading-tight tracking-tight text-gray-800 dark:text-white/90" data-testid="period-name">
              {periodName(told)}
            </h3>
            <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400" data-testid="period-detail">
              {periodDetail(told)}
            </p>
          </div>
        ) : (
          // Sized like the two lines it stands in for, so the strip under it
          // does not move when they arrive.
          <div className="space-y-2" aria-hidden>
            <span className="block h-5 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            <span className="block h-3.5 w-44 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Step
          label="Earlier period"
          to={earlier}
          today={today}
          onGo={onChange}
          left
        />
        <Step label="Later period" to={later} today={today} onGo={onChange} />
        <DateRangeFilter
          label="Period"
          value={range}
          onChange={onChange}
          presets={DASHBOARD_PRESETS}
          // A dashboard always has a period. "All time" is a report.
          allowAll={false}
          align="right"
          today={today}
        />
      </div>
    </section>
  );
}

function Step({
  label,
  to,
  today,
  onGo,
  left = false,
}: {
  label: string;
  to: DateRange | null;
  today: Date;
  onGo: (range: DateRange) => void;
  left?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // Where the arrow goes, before it is pressed.
      title={to ? formatRange(to, today) : undefined}
      disabled={to === null}
      onClick={() => to && onGo(to)}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 transition hover:border-gray-300 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400 dark:hover:text-white"
    >
      <ChevronGlyph left={left} className="size-4" />
    </button>
  );
}
