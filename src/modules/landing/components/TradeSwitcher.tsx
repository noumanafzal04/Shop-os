import { useState } from "react";

import { TillMock } from "./TillMock";
import { TRADE_CART } from "./tradeCarts";
import { TRADE_ICON, type TradeCode } from "./tradeIcon";

const ORDER: TradeCode[] = [
  "food", "mart", "pharmacy", "retail",
  "services", "automotive", "petroleum", "finance",
];

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

  return (
    <div>
      {/* The rail. It scrolls sideways on a phone rather than wrapping to
          three ragged rows — a row you swipe reads as a row of choices. */}
      <div
        role="tablist"
        aria-label="Choose a trade"
        onKeyDown={onKeyDown}
        className="-mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-2 sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0"
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
              aria-selected={on}
              aria-controls="trade-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => setTrade(code)}
              className={`flex shrink-0 snap-start items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition ${
                on
                  ? "border-brand-500 bg-brand-500 text-white shadow-lg shadow-brand-500/25"
                  : "border-gray-200 bg-white text-gray-600 hover:border-brand-300 hover:text-brand-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:border-brand-500/40"
              }`}
            >
              <Icon className="h-4.5 w-4.5" />
              {TRADE_CART[code].label}
            </button>
          );
        })}
      </div>

      <div
        id="trade-panel"
        role="tabpanel"
        aria-labelledby={`trade-tab-${trade}`}
        className="mt-10 grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_26rem]"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-500">
            What it does {cart.where}
          </p>

          <ul className="mt-6 space-y-4">
            {cart.does.map((point, i) => (
              <li
                key={`${trade}-${point}`}
                className="rings-up flex gap-3.5 text-[15px] leading-relaxed text-gray-700 dark:text-gray-300"
                style={{ "--ring-delay": `${i * 90}ms` } as React.CSSProperties}
              >
                <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3 w-3">
                    <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {point}
              </li>
            ))}
          </ul>

          <p className="mt-8 text-sm text-gray-500 dark:text-gray-400">
            None of it is a setting you have to go and find. Choose the trade
            once, and the shop arrives already knowing.
          </p>
        </div>

        <TillMock trade={trade} />
      </div>
    </div>
  );
}
