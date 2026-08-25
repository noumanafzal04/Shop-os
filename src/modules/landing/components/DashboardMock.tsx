import { ALERT, HOURS, KPIS, PEAK, SHOP, TOP } from "./dashboardData";
import { rupees } from "./tradeCarts";

/**
 * THE OWNER'S SIDE OF THE SAME DAY.
 *
 * The till answers "can my cashier work". This answers the question the person
 * paying actually has: at nine at night, what did the shop do today, and is
 * anything wrong.
 *
 * Drawn rather than screenshotted, for the same reasons the till is. A real
 * capture is a wall of six-point text at this size, it needs a second copy for
 * dark mode, and it becomes a lie the first time a button moves — a landing
 * page that shows a screen the product no longer has is worse than one that
 * shows no screen at all. What is here is true of the product and will stay
 * true: takings by hour, what is owed, what is running out, what sold.
 *
 * If a real capture is ever wanted, it goes in this component's place and
 * nothing else on the page has to change.
 *
 * The day it shows comes from `dashboardData`, shared with the app window in
 * the hero. It held its own copy for an afternoon, which is one edit away from
 * the same shop reporting two different totals on one page.
 *
 * ── It lays itself out by ITS OWN width, not the window's ──────────────
 *
 * This is shown inside a phone frame about 340px wide, on a page that is
 * 1440px wide. Written with ordinary `lg:` classes it took the WIDE layout
 * inside that phone — four takings tiles crammed into a third of a screen,
 * "Rs 146,000" clipped to "Rs 146…" — because a breakpoint asks the viewport,
 * never the box the component is standing in.
 *
 * So the wrapper is a `@container` and every layout variant here is `@lg:`.
 * The base classes are the NARROW layout on purpose: if container queries are
 * ever unavailable, it falls back to the one that fits anywhere.
 */

function Kpi({ label, value, foot, tone = "plain" }: {
  label: string; value: string; foot: string; tone?: "plain" | "warn" | "good";
}) {
  const footTone =
    tone === "warn" ? "text-warning-600 dark:text-warning-400"
      : tone === "good" ? "text-success-600 dark:text-success-400"
        : "text-gray-500 dark:text-gray-400";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-gray-400 @lg:text-[11px] @lg:tracking-[0.12em] dark:text-gray-500">
        {label}
      </p>
      {/* One line, always. "Rs 146,000" broke after "Rs" in a four-across
          grid, which makes a headline figure read as two of them. */}
      <p className="mt-2 whitespace-nowrap text-[1.35rem] font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
        {value}
      </p>
      <p className={`mt-1 text-[11px] font-medium leading-snug ${footTone}`}>{foot}</p>
    </div>
  );
}

export function DashboardMock() {
  return (
    <div className="@container overflow-hidden rounded-3xl border border-gray-200 bg-gray-50 shadow-2xl shadow-gray-900/10 dark:border-white/10 dark:bg-gray-900 dark:shadow-black/40">
      {/* The chrome, said in one line rather than drawn — a sidebar at this
          size is decoration that costs a third of the picture. */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 @lg:px-5 @lg:py-3.5 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-[11px] font-bold text-white">
            {SHOP.initials}
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{SHOP.name}</p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">{SHOP.branch} · today</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-success-50 px-2.5 py-1 text-[11px] font-semibold text-success-600 dark:bg-success-500/15 dark:text-success-400">
          <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
          Day open
        </span>
      </div>

      <div className="space-y-3 p-3.5 @lg:space-y-4 @lg:p-5">
        <div className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
          {KPIS.map((kpi) => (
            <Kpi key={kpi.label} label={kpi.label} value={kpi.value} foot={kpi.foot} tone={kpi.tone} />
          ))}
        </div>

        <div className="grid gap-3 @lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          {/* Takings by hour. Bars rather than a curve: a shopkeeper reads
              this to find the hour they must have staff on the counter, and
              a bar has an hour under it. */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex flex-col gap-0.5 @lg:flex-row @lg:items-baseline @lg:justify-between @lg:gap-3">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Takings by hour</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                Busiest 7–8 pm · Rs {rupees(PEAK)}
              </p>
            </div>

            {/* NO `items-end` HERE, and that is the whole bug this once had.
                Setting it stops the columns stretching to the 9rem, so each
                one shrank to the height of its own hour label — and every bar,
                sized as a percentage of a parent that was now zero tall,
                computed to nothing. The chart rendered as twelve numbers under
                an empty box. Each column stretches; the bar is pushed to the
                bottom by `items-end` on the column's inner box instead. */}
            <div className="mt-4 flex h-28 gap-1.5 @lg:mt-5 @lg:h-36" aria-hidden="true">
              {HOURS.map((hour, i) => {
                const share = hour.amount / PEAK;

                return (
                  <div key={hour.at} className="flex flex-1 flex-col items-center gap-2">
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className={`grows-up w-full rounded-t-md ${
                          hour.amount === PEAK
                            ? "bg-brand-500"
                            : "bg-brand-200 dark:bg-brand-500/35"
                        }`}
                        style={{
                          height: `${Math.round(share * 100)}%`,
                          "--grow-delay": `${i * 45}ms`,
                        } as React.CSSProperties}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
                      {hour.at}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="sr-only">
              Takings rise through the evening and peak between seven and eight,
              at Rs {rupees(PEAK)}.
            </p>
          </div>

          {/* What actually sold. Shown only where there is room: in the phone
              frame this list doubled the picture's height for information the
              hero's window already carries. */}
          <div className="hidden rounded-2xl border border-gray-200 bg-white p-4 @lg:block dark:border-white/10 dark:bg-white/[0.03]">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Sold most today</p>

            <ul className="mt-4 space-y-3.5">
              {TOP.map((item) => (
                <li key={item.name} className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-gray-800 dark:text-gray-200">
                      {item.name}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">{item.sold}</p>
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-gray-900 dark:text-white">
                    Rs {rupees(item.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* The one row that is not a number: the shop telling you something.
            It is here because being told beats going and looking. */}
        <div className="flex items-start gap-3 rounded-2xl border border-warning-200 bg-warning-50 p-4 dark:border-warning-500/25 dark:bg-warning-500/10">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning-500/20 text-warning-600 dark:text-warning-400">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
              <path d="M10 6.5v4.2M10 13.8h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-warning-800 dark:text-warning-300">
              {ALERT.title}
            </p>
            <p className="mt-0.5 text-[12px] text-warning-700/80 dark:text-warning-400/80">
              {ALERT.body}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
