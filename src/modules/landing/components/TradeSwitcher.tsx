import { useState } from "react";

import { TRADE_CART } from "./tradeCarts";
import { TRADE_ICON, type TradeCode } from "./tradeIcon";

const ORDER: TradeCode[] = [
  "food", "mart", "pharmacy", "retail", "wholesale",
  "services", "automotive", "petroleum", "finance",
];

/** A trade's own screen, as a real shop of that trade has it on a phone. */
const picture = (code: TradeCode): string => `/landing/trade-${code}.webp`;

/**
 * Fetched when a tile is pointed at or reached by keyboard, so the picture is
 * there by the time it is pressed. Nine photographs are not fetched for a
 * visitor who looks at one.
 */
function warm(code: TradeCode): void {
  new Image().src = picture(code);
}

/**
 * PICK YOUR TRADE, AND WATCH THE TILL CHANGE.
 *
 * The old version of this section was eight icons in a grid under a sentence
 * claiming the product knows one trade from another. That is the claim stated,
 * not shown — and every competitor's page states it. Here the visitor spends
 * one tap and sees a pharmacy's till carry a batch number where a pump's
 * carries a meter reading. Whoever has never stood behind a counter cannot
 * fake the units, so the units are the argument.
 *
 * The tabs are real tabs: arrow keys move between them and only the selected
 * one is in the tab order, which is what a screen reader and a keyboard both
 * expect of a tablist.
 */
export function TradeSwitcher() {
  const [trade, setTrade] = useState<TradeCode>("food");
  const cart = TRADE_CART[trade];

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;

    event.preventDefault();
    const next = ORDER[(ORDER.indexOf(trade) + step + ORDER.length) % ORDER.length];
    setTrade(next);
    document.getElementById(`trade-tab-${next}`)?.focus();
  }

  const Mark = TRADE_ICON[trade];

  return (
    <div>
      {/* NINE TILES — and nine is three threes.
          They were pills that wrapped where the words ran out: seven on one
          line and two under it on a laptop, and a row to swipe on a phone
          with six of the nine off the edge. A choice of nine should look
          like nine: one row of equal tiles where there is room, a square of
          three by three where there is not. A short name on the tile, the
          trade's whole name for whoever has it read aloud. */}
      <div
        role="tablist"
        aria-label="Choose a trade"
        onKeyDown={onKeyDown}
        className="mx-auto grid max-w-xl grid-cols-3 gap-2.5 sm:gap-3 lg:max-w-none lg:grid-cols-9"
      >
        {ORDER.map((code) => {
          const Icon = TRADE_ICON[code];
          const on = code === trade;

          return (
            <button
              key={code}
              id={`trade-tab-${code}`}
              role="tab"
              type="button"
              aria-label={TRADE_CART[code].label}
              aria-selected={on}
              aria-controls="trade-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => setTrade(code)}
              onPointerEnter={() => warm(code)}
              onFocus={() => warm(code)}
              className={`group flex min-w-0 flex-col items-center gap-2.5 rounded-2xl border px-2 py-4 text-center transition duration-200 ${
                on
                  ? "border-brand-500 bg-brand-500 text-white shadow-lg shadow-brand-500/25"
                  : "border-gray-200 bg-white text-gray-600 hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:border-brand-500/40"
              }`}
            >
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl transition duration-200 ${
                on
                  ? "bg-white/15 text-white"
                  : "bg-brand-50 text-brand-600 group-hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300"
              }`}>
                <Icon className="h-5.5 w-5.5" />
              </span>
              <span className="max-w-full truncate text-[13px] font-semibold leading-tight">{TRADE_CART[code].short}</span>
            </button>
          );
        })}
      </div>

      {/* ONE CARD, TWO HALVES. What the trade gets, and the till that proves
          it — the same height, side by side. They were a list floating in an
          open column beside a narrower card, and the eye had nothing to line
          the two up by. The till's half is the page's own night: it is the
          one lit thing in the section, as it is in the hero. */}
      <div
        id="trade-panel"
        role="tabpanel"
        aria-labelledby={`trade-tab-${trade}`}
        className="mt-6 grid overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-xl shadow-gray-900/[0.04] sm:mt-8 lg:grid-cols-2 dark:border-white/10 dark:bg-white/[0.03]"
      >
        <div className="flex flex-col justify-center p-6 sm:p-10 lg:p-12">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-lg shadow-brand-500/25">
              <Mark className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-500">
                What it does {cart.where}
              </p>
              <h3 className="mt-1 text-2xl font-bold tracking-[-0.01em]">{cart.label}</h3>
            </div>
          </div>

          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {cart.does.map((point, i) => (
              <li
                key={`${trade}-${point}`}
                className="rings-up flex gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-[14.5px] leading-relaxed text-gray-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300"
                style={{ "--ring-delay": `${i * 90}ms` } as React.CSSProperties}
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3 w-3">
                    <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {point}
              </li>
            ))}
          </ul>

          {/* THE LINE ONLY THIS TRADE HAS. A batch number, a meter reading, a
              KOT — the product's own answer to "does it understand my shop". */}
          <p
            key={`${trade}-note`}
            className="rings-up mt-5 flex items-center gap-2.5 rounded-2xl border border-dashed border-brand-300 bg-brand-25 px-4 py-3 text-[13.5px] text-gray-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-gray-200"
            style={{ "--ring-delay": `${cart.does.length * 90}ms` } as React.CSSProperties}
          >
            <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-300">Only here</span>
            <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-brand-300 dark:bg-brand-500/40" />
            <span className="min-w-0">{cart.note}</span>
          </p>

          <p className="mt-6 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            None of it is a setting you have to go and find. Choose the trade
            once, and the shop arrives already knowing.
          </p>
        </div>

        {/* THE TRADE'S OWN SCREEN, in a hand — a photograph of a real shop of
            this trade, in the frame the hero's phone stands in. It was a till
            drawn out of divs; see `tradeCarts.ts` for why it is not any more.
            The frame holds its shape from the first paint, so nothing moves
            when the picture arrives or the trade is changed. */}
        <div className="landing-night relative flex items-center justify-center overflow-hidden px-6 py-10 sm:px-10 lg:py-12">
          <div aria-hidden="true" className="landing-night-light pointer-events-none absolute inset-0 [--light-size:80%_62%] [--light-at:50%_42%] [--light-strength:38%] [--light-ends:72%]" />
          <div className="relative w-[15.5rem] rounded-[2.3rem] bg-gray-950 p-2 shadow-[0_40px_90px_-20px_rgba(0,0,0,0.7)] ring-1 ring-white/20 sm:w-[16.5rem]">
            <div className="relative aspect-[402/874] overflow-hidden rounded-[1.8rem] bg-pos-ground">
              <img
                key={trade}
                src={picture(trade)}
                width={804}
                height={1748}
                loading="lazy"
                decoding="async"
                alt={cart.shows}
                className="fades-in absolute inset-0 size-full object-cover object-top"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
