import { ALERT, HOURS, KPIS, PEAK, SHOP, TOP } from "./dashboardData";
import { rupees } from "./tradeCarts";

/**
 * THE HERO'S PICTURE: the whole application, not one card of it.
 *
 * The fold used to show a till ringing a sale. It made the offline argument
 * well and it made the product look like a cash register — a shopkeeper buying
 * a business system wants to see the business system: the rail down the side
 * with everything on it, the shop's name at the top, and the day counted.
 *
 * ── Why it is drawn and not captured ───────────────────────────────────
 *
 * A screenshot of the real console is unreadable at this size, needs a second
 * copy for dark mode, and becomes a lie the first time a button moves. A
 * landing page showing a screen the product no longer has is worse than one
 * showing no screen. Everything here is true of the product and will stay true.
 *
 * ── Why the type is bigger than the real app's ─────────────────────────
 *
 * Deliberately, and it is the whole trick. Put a 1440px console into a 1100px
 * frame and 13px labels become 10px smudges: the picture then says "some
 * software" and nothing else. The LAYOUT is the app's, exactly — same rail,
 * same header, same tiles — and the type inside runs about a third larger, so
 * every label can actually be read. Nothing is invented to make it fit.
 *
 * ── Dark in both themes ────────────────────────────────────────────────
 *
 * It stands on a near-black band whichever theme the visitor is in, so it
 * carries the app's dark chrome always. A light window there would be a hole
 * in the page rather than a screen in a dark room.
 */

/** The rail, with the icon each row has in the real app. */
const RAIL: Array<{ name: string; d: string; on?: boolean }> = [
  { name: "Dashboard", d: "M4 4.5h6v6H4zM14 4.5h6v6h-6zM4 13.5h6v6H4zM14 13.5h6v6h-6z", on: true },
  { name: "Point of sale", d: "M3.5 5.5h17v10h-17zM8 19.5h8M12 15.5v4" },
  { name: "Products", d: "M4 8.5 12 4l8 4.5-8 4.5-8-4.5ZM4 8.5v7l8 4.5 8-4.5v-7" },
  { name: "Stock", d: "M5 6.5h14v13H5zM9 6.5V4h6v2.5M9 12h6M9 15.5h4" },
  { name: "Khata", d: "M6 3.5h12v17H6zM9.5 8h5M9.5 12h5M9.5 16h3" },
  { name: "Reports", d: "M4 19.5h16M7 16.5V10M12 16.5V5.5M17 16.5v-4" },
];

function Row({ name, d, on }: { name: string; d: string; on?: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
        on ? "bg-brand-500/15 text-brand-300" : "text-white/45"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px] shrink-0">
        <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`text-[15px] ${on ? "font-semibold" : "font-medium"}`}>{name}</span>
    </div>
  );
}

export function AppWindowMock() {
  return (
    <div className="relative">
      {/* The light the screen throws into the room. Decorative. */}
      <div
        aria-hidden="true"
        className="absolute -inset-8 -z-10 rounded-[3.5rem] bg-brand-500/20 blur-[90px]"
      />

      <div className="relative overflow-hidden rounded-2xl bg-gray-900 shadow-[0_50px_110px_-25px_rgba(0,0,0,0.75)] ring-1 ring-white/12 sm:rounded-3xl">
        {/* The lit top edge — a screen that is on. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent"
        />

        <div className="flex">
          {/* ── The rail ──────────────────────────────────────────────
              Hidden below `sm`. A 224px sidebar on a 390px screen leaves the
              content 160px wide, which is not a smaller picture of the app —
              it is an unreadable one. The phone gets the same window, cropped
              to the part that carries the meaning. */}
          <aside className="hidden w-56 shrink-0 flex-col border-r border-white/8 bg-gray-950/70 p-3.5 sm:flex">
            <div className="mb-6 flex items-center gap-2.5 px-2 pt-1.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500">
                <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="h-5 w-5">
                  <path
                    d="M8 9.4h2.1l1 3m0 0 1.7 6.2a1.6 1.6 0 0 0 1.55 1.2h6.3a1.6 1.6 0 0 0 1.55-1.2l1.25-4.6a1.1 1.1 0 0 0-1.06-1.4H11.1"
                    stroke="white" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
                  />
                  <circle cx="14.4" cy="23.2" r="1.6" fill="white" />
                  <circle cx="21.4" cy="23.2" r="1.6" fill="white" />
                </svg>
              </span>
              <span className="text-[17px] font-semibold tracking-tight text-white">
                Cart<span className="text-brand-400">Ze</span>
              </span>
            </div>

            <div className="space-y-0.5">
              {RAIL.map((item) => <Row key={item.name} {...item} />)}
            </div>
          </aside>

          {/* ── The console ─────────────────────────────────────────── */}
          <div className="min-w-0 flex-1">
            {/* Header: whose shop, which branch, and the state of the line. */}
            <div className="flex items-center justify-between gap-4 border-b border-white/8 px-4 py-3.5 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-[13px] font-bold text-white">
                  {SHOP.initials}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-white">{SHOP.name}</p>
                  <p className="truncate text-[12px] text-white/40">{SHOP.branch} · today</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2.5">
                {/* THE POINT OF THE WHOLE PICTURE, and it is in the header
                    rather than on a card because it is true of the entire
                    application, not of one screen. */}
                <span className="flex items-center gap-1.5 rounded-full bg-warning-500/15 px-3 py-1.5 text-[12px] font-semibold text-warning-400 ring-1 ring-warning-500/25">
                  <span className="h-1.5 w-1.5 rounded-full bg-warning-400" />
                  <span className="hidden sm:inline">Offline · 3 saved here</span>
                  <span className="sm:hidden">Offline</span>
                </span>
                <span className="hidden h-9 w-9 items-center justify-center rounded-full bg-white/8 text-[12px] font-semibold text-white/70 lg:flex">
                  IQ
                </span>
              </div>
            </div>

            <div className="space-y-3.5 p-4 sm:p-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {KPIS.map((kpi, i) => (
                  <div
                    key={kpi.label}
                    className="rings-up rounded-2xl border border-white/8 bg-white/[0.04] p-4"
                    style={{ "--ring-delay": `${140 + i * 90}ms` } as React.CSSProperties}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/35">
                      {kpi.label}
                    </p>
                    <p className="mt-2 whitespace-nowrap text-[1.6rem] font-bold tabular-nums tracking-tight text-white">
                      {kpi.value}
                    </p>
                    <p className={`mt-1 text-[12px] font-medium leading-snug ${
                      kpi.tone === "warn" ? "text-warning-400" : "text-white/35"
                    }`}>
                      {kpi.foot}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[15px] font-semibold text-white">Takings by hour</p>
                    <p className="text-[12px] text-white/35">Busiest 7–8 pm</p>
                  </div>

                  {/* NO `items-end` on this row. Setting it stops the columns
                      stretching, so each shrinks to its own hour label and
                      every bar — a percentage of a now-zero parent — computes
                      to nothing. The chart renders as numbers under an empty
                      box, which is exactly what it once did. */}
                  <div className="mt-5 flex h-32 gap-1.5 sm:h-36" aria-hidden="true">
                    {HOURS.map((hour, i) => (
                      <div key={hour.at} className="flex flex-1 flex-col items-center gap-2">
                        <div className="flex w-full flex-1 items-end">
                          <div
                            className={`grows-up w-full rounded-t-md ${
                              hour.amount === PEAK ? "bg-brand-500" : "bg-brand-500/35"
                            }`}
                            style={{
                              height: `${Math.round((hour.amount / PEAK) * 100)}%`,
                              "--grow-delay": `${300 + i * 45}ms`,
                            } as React.CSSProperties}
                          />
                        </div>
                        <span className="text-[11px] tabular-nums text-white/30">{hour.at}</span>
                      </div>
                    ))}
                  </div>

                  <p className="sr-only">
                    Takings rise through the evening and peak between seven and
                    eight, at Rs {rupees(PEAK)}.
                  </p>
                </div>

                {/* The list an owner checks before reordering. Hidden on a
                    phone, where the four tiles and the chart are already the
                    whole message. */}
                <div className="hidden rounded-2xl border border-white/8 bg-white/[0.04] p-4 sm:block">
                  <p className="text-[15px] font-semibold text-white">Sold most today</p>
                  <ul className="mt-4 space-y-3.5">
                    {TOP.map((item) => (
                      <li key={item.name} className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-white/80">{item.name}</p>
                          <p className="text-[11px] text-white/30">{item.sold}</p>
                        </div>
                        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-white">
                          Rs {rupees(item.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-2xl border border-warning-500/25 bg-warning-500/10 p-4">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning-500/20 text-warning-400">
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
                    <path d="M10 6.5v4.2M10 13.8h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-warning-300">{ALERT.title}</p>
                  <p className="mt-0.5 text-[12.5px] text-warning-400/75">{ALERT.body}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
