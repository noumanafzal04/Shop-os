import { TRADE_ICON, type TradeCode } from "./tradeIcon";

/**
 * THE HERO'S ONE PICTURE: a till ringing a sale, with the line down.
 *
 * Not a screenshot. A screenshot of a POS at hero size is unreadable, ages the
 * moment a button moves, and needs a second one for dark mode. This is the
 * till reduced to the four things a shopkeeper looks for — what went in, what
 * it costs, that it is still working offline, and that the money is counted.
 *
 * The "Offline" pill is the whole argument of the product and it is why this
 * mock exists at all: every POS can show a cart, and this one can show a cart
 * with no internet behind it.
 */
const LINES: Array<{ name: string; qty: string; price: string }> = [
  { name: "Chicken Karahi", qty: "1 plate", price: "1,450" },
  { name: "Garlic Naan", qty: "4 pcs", price: "320" },
  { name: "Mineral Water", qty: "2 btl", price: "160" },
];

export function TillMock() {
  return (
    <div className="relative">
      {/* A soft light behind the card, so it sits on the page rather than on
          top of it. Purely decorative and hidden from the reader. */}
      <div
        aria-hidden="true"
        className="absolute -inset-8 -z-10 rounded-[3rem] bg-brand-500/10 blur-3xl dark:bg-brand-500/20"
      />

      {/* THE RECEIPT, half behind the till.
          The till alone was a screenshot of a cart, which every POS has. What
          makes this one worth a picture is that the sale COMPLETED with no
          line behind it — so the slip carries an OFF- number, which is the
          thing a shop can find a customer by afterwards. Tucked behind and
          rotated, because it is the second thing you read, not the first. */}
      <div
        aria-hidden="true"
        className="absolute -right-2 -top-24 hidden w-44 rotate-6 rounded-lg bg-white p-3.5 shadow-xl ring-1 ring-gray-900/5 lg:block dark:bg-gray-100"
      >
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Receipt</p>
        <p className="mt-1 font-mono text-[11px] font-semibold text-gray-800">OFF-TILL-7K2M-000118</p>
        <div className="my-2 border-t border-dashed border-gray-300" />
        <div className="space-y-1">
          {[["Chicken Karahi", "1,450"], ["Garlic Naan", "320"], ["Mineral Water", "160"]].map(([n, v]) => (
            <div key={n} className="flex justify-between text-[10px] text-gray-500">
              <span className="truncate pr-2">{n}</span>
              <span className="tabular-nums">{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between border-t border-gray-300 pt-1.5 text-[11px] font-bold text-gray-800">
          <span>Total</span>
          <span className="tabular-nums">Rs 1,930</span>
        </div>
      </div>

      <div className="breathes relative overflow-hidden rounded-2xl bg-pos-ground shadow-2xl ring-1 ring-white/10">
        {/* Till header — register name, and the state of the line. */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/20 text-brand-300">
              {(() => {
                const Icon = TRADE_ICON["food" as TradeCode];

                return <Icon className="h-4 w-4" />;
              })()}
            </span>
            <span className="text-sm font-semibold text-white/90">Counter 1</span>
          </div>

          {/* THE POINT OF THE WHOLE PICTURE. */}
          <span className="flex items-center gap-1.5 rounded-full bg-warning-500/15 px-2.5 py-1 text-[11px] font-semibold text-warning-400">
            <span className="h-1.5 w-1.5 rounded-full bg-warning-400" />
            Offline · 3 saved here
          </span>
        </div>

        {/* The cart. Each line arrives after the one above it. */}
        <div className="space-y-1 p-3">
          {LINES.map((line, i) => (
            <div
              key={line.name}
              className="rings-up flex items-center justify-between rounded-xl bg-pos-card px-3.5 py-2.5"
              style={{ "--ring-delay": `${400 + i * 260}ms` } as React.CSSProperties}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-800">{line.name}</p>
                <p className="text-[11px] text-gray-500">{line.qty}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-800">
                Rs {line.price}
              </span>
            </div>
          ))}
        </div>

        {/* The total, and the button a thumb actually presses. */}
        <div
          className="rings-up border-t border-white/10 p-4"
          style={{ "--ring-delay": "1180ms" } as React.CSSProperties}
        >
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
              Grand total
            </span>
            <span className="text-2xl font-bold tabular-nums text-white">Rs 1,930</span>
          </div>
          <div className="rounded-xl bg-brand-500 py-3 text-center text-sm font-semibold text-white">
            Tender / Pay
          </div>
        </div>
      </div>

      {/* THE END OF THE STORY, and the reason a shopkeeper would switch: the
          line came back and the queue emptied itself. Arrives last, after the
          cart and the total, because it only means anything once you have seen
          what was being held. */}
      <div
        className="rings-up absolute -bottom-7 left-6 flex items-center gap-2.5 rounded-xl bg-white px-4 py-3 shadow-xl ring-1 ring-gray-900/5 dark:bg-gray-900 dark:ring-white/10"
        style={{ "--ring-delay": "1600ms" } as React.CSSProperties}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
            <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <p className="text-xs font-semibold text-gray-800 dark:text-white/90">Line back — 3 sent</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">Nothing was lost</p>
        </div>
      </div>
    </div>
  );
}
